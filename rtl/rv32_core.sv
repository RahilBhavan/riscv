// Educational RV32I execution core. Harvard memories with a ready handshake.
// See docs/ARCHITECTURE.md for the supported execution environment.
// DOT4=0 removes the custom unit; custom-0 then traps like any illegal encoding.
// MEXT=1 adds the M extension on an iterative multiplier/divider.
// ZICSR=1 adds Zicsr, machine-mode trap entry, MRET and interrupts. With ZICSR=0 a trap halts the core.
module rv32_core #(parameter bit DOT4 = 1, parameter bit MEXT = 0, parameter bit ZICSR = 0, parameter [31:0] RESET_PC = 0) (
    input wire clk, input wire reset,
    output wire [31:0] imem_addr, input wire [31:0] imem_rdata,
    output wire [31:0] dmem_addr, output wire [31:0] dmem_wdata,
    output wire [3:0] dmem_wstrb, output wire dmem_read,
    input wire [31:0] dmem_rdata,
    output reg retire_valid, output reg [31:0] retire_pc,
    output reg [31:0] retire_insn, output reg [4:0] retire_rd,
    output reg [31:0] retire_data, output reg retire_trap,
    output wire stall_event, output wire flush_event,
    output wire imem_valid, input wire imem_ready, input wire dmem_ready,
    input wire irq_software, input wire irq_timer, input wire irq_external,
    output reg retire_intr
`ifdef RISCV_FORMAL
    , output reg rvfi_valid, output reg [63:0] rvfi_order, output reg [31:0] rvfi_insn,
    output reg rvfi_trap, output reg rvfi_halt, output reg rvfi_intr,
    output reg [1:0] rvfi_mode, output reg [1:0] rvfi_ixl,
    output reg [4:0] rvfi_rs1_addr, output reg [4:0] rvfi_rs2_addr,
    output reg [31:0] rvfi_rs1_rdata, output reg [31:0] rvfi_rs2_rdata,
    output reg [4:0] rvfi_rd_addr, output reg [31:0] rvfi_rd_wdata,
    output reg [31:0] rvfi_pc_rdata, output reg [31:0] rvfi_pc_wdata,
    output reg [31:0] rvfi_mem_addr, output reg [3:0] rvfi_mem_rmask, output reg [3:0] rvfi_mem_wmask,
    output reg [31:0] rvfi_mem_rdata, output reg [31:0] rvfi_mem_wdata
`endif
);
    reg [31:0] regs [0:31];
    reg [31:0] pc;
    reg f_valid, x_valid, m_valid, w_valid;
    reg [31:0] f_pc, f_insn, x_pc, x_insn, x_a, x_b;
    reg [31:0] m_pc, m_insn, m_result, m_store;
    reg [4:0] m_rd, w_rd;
    reg m_write, m_load, m_store_en, m_trap, m_intr;
    reg [2:0] m_funct3;
    reg [31:0] w_pc, w_insn, w_result;
    reg w_write, w_trap, w_intr;
    wire [6:0] op = x_insn[6:0];
    wire [2:0] funct3 = x_insn[14:12];
    wire [6:0] funct7 = x_insn[31:25];
    wire [4:0] rs1 = x_insn[19:15], rs2 = x_insn[24:20];
    wire [31:0] imm_i = {{20{x_insn[31]}}, x_insn[31:20]};
    wire [31:0] imm_s = {{20{x_insn[31]}}, x_insn[31:25], x_insn[11:7]};
    wire [31:0] imm_b = {{19{x_insn[31]}}, x_insn[31], x_insn[7], x_insn[30:25], x_insn[11:8], 1'b0};
    wire [31:0] imm_u = {x_insn[31:12],12'b0};
    wire [31:0] imm_j = {{11{x_insn[31]}}, x_insn[31], x_insn[19:12], x_insn[20], x_insn[30:21],1'b0};
    reg [31:0] a, b, result, target;
    reg wr, ld, st, trap, taken, legal;
    reg signed [31:0] dot;
    integer lane;

    // Machine-mode state. Only read or written when ZICSR=1; synthesis removes it otherwise.
    reg mstatus_mie, mstatus_mpie, mie_msie, mie_mtie, mie_meie;
    reg [31:0] mtvec, mscratch, mepc, mcause, mtval;
    reg [3:0] cause;
    reg [31:0] tval;
    reg csr_known, csr_write, is_mret;
    reg [31:0] csr_old, csr_new;
    wire [11:0] csr_addr = x_insn[31:20];
    wire [31:0] csr_src = funct3[2] ? {27'b0, rs1} : a;
    wire [31:0] mstatus = {19'b0, 2'b11, 3'b0, mstatus_mpie, 3'b0, mstatus_mie, 3'b0};
    wire [31:0] mip = {20'b0, irq_external, 3'b0, irq_timer, 3'b0, irq_software, 3'b0};
    wire [31:0] mie = {20'b0, mie_meie, 3'b0, mie_mtie, 3'b0, mie_msie, 3'b0};
    wire [31:0] misa = 32'h40000100 | (MEXT ? 32'h00001000 : 32'h0);
    wire [31:0] pending = mip & mie;
    wire [3:0] irq_cause = pending[11] ? 4'd11 : pending[3] ? 4'd3 : 4'd7;

    // Iterative multiply/divide: one result bit per cycle, 32 cycles per operation.
    wire is_md = MEXT && op == 7'h33 && funct7 == 7'h01;
    reg md_busy, md_done, md_neg, md_zero;
    reg [5:0] md_count;
    reg [2:0] md_f3;
    reg [63:0] md_acc;
    reg [31:0] md_div, md_a;
`ifdef RISCV_FORMAL_ALTOPS
    reg [31:0] md_alt;
`endif
    wire md_active = md_busy || md_done;
    wire irq = ZICSR && mstatus_mie && pending != 0 && x_valid && !md_active;
    reg [31:0] md_result;
    wire [63:0] md_product = md_neg ? -md_acc : md_acc;
    always @* begin
        case (md_f3)
            0: md_result = md_product[31:0];
            1, 2, 3: md_result = md_product[63:32];
            4, 5: md_result = md_zero ? 32'hffffffff : md_neg ? -md_acc[31:0] : md_acc[31:0];
            default: md_result = md_zero ? md_a : md_neg ? -md_acc[63:32] : md_acc[63:32];
        endcase
`ifdef RISCV_FORMAL_ALTOPS
        md_result = md_alt;
`endif
    end

    // Newest producer wins; a load becomes available only in WB.
    always @* begin
        a = x_a; b = x_b;
        if (w_valid && w_write && w_rd != 0) begin
            if (rs1 == w_rd) a = w_result;
            if (rs2 == w_rd) b = w_result;
        end
        if (m_valid && m_write && !m_load && !m_trap && m_rd != 0) begin
            if (rs1 == m_rd) a = m_result;
            if (rs2 == m_rd) b = m_result;
        end
    end
    always @* begin
        result = 0; target = 0; wr = 0; ld = 0; st = 0;
        trap = 0; taken = 0; legal = 1; dot = 0;
        cause = 2; tval = x_insn; csr_known = 0; csr_write = 0; csr_old = 0; csr_new = 0; is_mret = 0;
        if (DOT4)
            for (lane = 0; lane < 4; lane = lane + 1)
                dot = dot + ($signed(a[lane*8 +: 8]) * $signed(b[lane*8 +: 8]));
        case (csr_addr)
            12'h300: begin csr_known = 1; csr_old = mstatus; end
            12'h301: begin csr_known = 1; csr_old = misa; end
            12'h304: begin csr_known = 1; csr_old = mie; end
            12'h305: begin csr_known = 1; csr_old = mtvec; end
            12'h310: begin csr_known = 1; csr_old = 0; end
            12'h340: begin csr_known = 1; csr_old = mscratch; end
            12'h341: begin csr_known = 1; csr_old = mepc; end
            12'h342: begin csr_known = 1; csr_old = mcause; end
            12'h343: begin csr_known = 1; csr_old = mtval; end
            12'h344: begin csr_known = 1; csr_old = mip; end
            12'hf11, 12'hf12, 12'hf13, 12'hf14, 12'hf15: begin csr_known = 1; csr_old = 0; end
            default: ;
        endcase
        case (funct3[1:0])
            1: csr_new = csr_src;
            2: csr_new = csr_old | csr_src;
            default: csr_new = csr_old & ~csr_src;
        endcase
        case (op)
            7'h37: begin wr=1; result=imm_u; end
            7'h17: begin wr=1; result=x_pc+imm_u; end
            7'h6f: begin wr=1; result=x_pc+4; taken=1; target=x_pc+imm_j; end
            7'h67: begin wr=1; result=x_pc+4; taken=1; target=(a+imm_i)&32'hfffffffe; legal=funct3==0; end
            7'h63: begin
                target=x_pc+imm_b;
                case (funct3)
                    0: taken=a==b; 1: taken=a!=b;
                    4: taken=$signed(a)<$signed(b); 5: taken=$signed(a)>=$signed(b);
                    6: taken=a<b; 7: taken=a>=b;
                    default: legal=0;
                endcase
            end
            7'h03: begin
                wr=1; ld=1; result=a+imm_i;
                legal=(funct3==0 || funct3==1 || funct3==2 || funct3==4 || funct3==5);
                if ((funct3==1 || funct3==5) && result[0]) trap=1;
                if (funct3==2 && result[1:0]!=0) trap=1;
                cause = 4; tval = result;
            end
            7'h23: begin
                st=1; result=a+imm_s;
                legal=(funct3<=2);
                if (funct3==1 && result[0]) trap=1;
                if (funct3==2 && result[1:0]!=0) trap=1;
                cause = 6; tval = result;
            end
            7'h13, 7'h33: begin
                wr=1;
                if (is_md) result=md_result;
                else case (funct3)
                    0: begin
                        if (op==7'h13) result=a+imm_i;
                        else begin
                            legal=(funct7==0 || funct7==7'h20);
                            result=funct7==7'h20 ? a-b : a+b;
                        end
                    end
                    1: begin result=a << (op==7'h13 ? x_insn[24:20] : b[4:0]); legal=funct7==0; end
                    2: begin result={31'b0,($signed(a)<$signed(op==7'h13 ? imm_i : b))}; legal=op==7'h13 || funct7==0; end
                    3: begin result={31'b0,(a<(op==7'h13 ? imm_i : b))}; legal=op==7'h13 || funct7==0; end
                    4: begin result=a^(op==7'h13 ? imm_i : b); legal=op==7'h13 || funct7==0; end
                    5: begin
                        legal=funct7==0 || funct7==7'h20;
                        if (funct7==7'h20) result=$signed(a) >>> (op==7'h13 ? x_insn[24:20] : b[4:0]);
                        else result=a >> (op==7'h13 ? x_insn[24:20] : b[4:0]);
                    end
                    6: begin result=a|(op==7'h13 ? imm_i : b); legal=op==7'h13 || funct7==0; end
                    7: begin result=a&(op==7'h13 ? imm_i : b); legal=op==7'h13 || funct7==0; end
                endcase
            end
            // custom-0: dot4 rd,rs1,rs2, signed packed int8 -> signed int32.
            7'h0b: begin wr=1; result=dot; legal=DOT4 && funct3==0 && funct7==0; end
            7'h0f: legal=funct3==0 && x_insn[31:28]==0; // base FENCE, reserved fields ignored
            7'h73: begin
                if (funct3==0) begin
                    // ECALL and EBREAK trap. Under ZICSR, MRET returns and WFI is a no-op.
                    if (x_insn==32'h00000073) begin trap=1; cause=11; tval=0; end
                    else if (x_insn==32'h00100073) begin trap=1; cause=3; tval=x_pc; end
                    else if (ZICSR && x_insn==32'h30200073) begin is_mret=1; taken=1; target=mepc; end
                    else legal=ZICSR && x_insn==32'h10500073;
                end else begin
                    wr=1; result=csr_old;
                    csr_write = funct3[1:0]==1 || rs1!=0;
                    legal=ZICSR && funct3!=4 && csr_known && !(csr_write && csr_addr[11:10]==2'b11);
                end
            end
            default: legal=0;
        endcase
        if (!legal) begin trap=1; cause=2; tval=x_insn; end
        else if (taken && target[1:0]!=0) begin trap=1; cause=0; tval=target; end
        if (trap || irq) begin wr=0; ld=0; st=0; taken=0; csr_write=0; is_mret=0; end
    end
    wire [6:0] f_op = f_insn[6:0];
    wire f_csr = ZICSR && f_op==7'h73 && f_insn[13:12]!=0 && !f_insn[14];
    wire uses_rs1 = f_op==7'h67 || f_op==7'h63 || f_op==7'h03 || f_op==7'h23 || f_op==7'h13 || f_op==7'h33 || (DOT4 && f_op==7'h0b) || f_csr;
    wire uses_rs2 = f_op==7'h63 || f_op==7'h23 || f_op==7'h33 || (DOT4 && f_op==7'h0b);
    wire hazard = f_valid && x_valid && ld && !trap && x_insn[11:7]!=0 &&
        ((uses_rs1 && f_insn[19:15]==x_insn[11:7]) || (uses_rs2 && f_insn[24:20]==x_insn[11:7]));
    // An unfinished data access holds the whole pipeline; an unfinished M operation holds EX and younger.
    wire mem_wait = m_valid && (m_load || m_store_en) && !m_trap && !dmem_ready;
    wire ex_hold = x_valid && is_md && !md_done && !irq;
    wire advance = !mem_wait && !ex_hold;
    wire redirect = x_valid && taken;
    wire fault = x_valid && (trap || irq);
    wire [31:0] trap_target = {mtvec[31:2], 2'b00} + ((irq && mtvec[0]) ? {26'b0, irq_cause, 2'b00} : 32'b0);
    // A trap halts fetch (ZICSR=0) or enters the trap vector, flushes younger instructions, and drains older work.
    reg halted;
    assign stall_event = advance && hazard && !redirect && !fault;
    assign flush_event = advance && (redirect || fault);
    assign imem_addr = pc;
    assign imem_valid = !reset && !halted;
    assign dmem_addr = {m_result[31:2],2'b0};
    assign dmem_read = !reset && m_valid && m_load && !m_trap;
    assign dmem_wdata = m_store << (8*m_result[1:0]);
    assign dmem_wstrb = (!reset && m_valid && m_store_en && !m_trap) ?
        ((m_funct3==0 ? 4'b0001 : m_funct3==1 ? 4'b0011 : 4'b1111) << m_result[1:0]) : 4'b0;
    wire [31:0] shifted_load = dmem_rdata >> (8*m_result[1:0]);
    reg [31:0] load_value;
    always @* begin
        case(m_funct3)
            0: load_value={{24{shifted_load[7]}},shifted_load[7:0]};
            1: load_value={{16{shifted_load[15]}},shifted_load[15:0]};
            4: load_value={24'b0,shifted_load[7:0]};
            5: load_value={16'b0,shifted_load[15:0]};
            default: load_value=shifted_load;
        endcase
    end
    wire md_a_signed = funct3==1 || funct3==2 || funct3==4 || funct3==6;
    wire md_b_signed = funct3==1 || funct3==4 || funct3==6;
    wire md_a_neg = md_a_signed && a[31], md_b_neg = md_b_signed && b[31];
    wire [32:0] md_sum = {1'b0, md_acc[63:32]} + {1'b0, md_div};
    wire [32:0] md_diff = md_acc[63:31] - {1'b0, md_div};
    integer i;
    always @(posedge clk) begin
        if (reset) begin
            pc<=RESET_PC; f_valid<=0; x_valid<=0; m_valid<=0; w_valid<=0;
            halted<=0; retire_valid<=0; retire_pc<=0; retire_insn<=0;
            retire_rd<=0; retire_data<=0; retire_trap<=0; retire_intr<=0;
            m_write<=0; m_load<=0; m_store_en<=0; m_trap<=0; m_intr<=0; w_write<=0; w_trap<=0; w_intr<=0;
            f_pc<=0; f_insn<=0; x_pc<=0; x_insn<=0; x_a<=0; x_b<=0;
            m_pc<=0; m_insn<=0; m_result<=0; m_store<=0; m_rd<=0; m_funct3<=0;
            w_pc<=0; w_insn<=0; w_result<=0; w_rd<=0;
            mstatus_mie<=0; mstatus_mpie<=0; mie_msie<=0; mie_mtie<=0; mie_meie<=0;
            mtvec<=0; mscratch<=0; mepc<=0; mcause<=0; mtval<=0;
            md_busy<=0; md_done<=0;
            for(i=0;i<32;i=i+1) regs[i]<=0;
        end else begin
            retire_valid<=w_valid; retire_pc<=w_pc; retire_insn<=w_insn;
            retire_rd<=(w_write && !w_trap) ? w_rd : 5'b0;
            retire_data<=(w_write && !w_trap && w_rd!=0) ? w_result : 32'b0;
            retire_trap<=w_valid && w_trap;
            retire_intr<=w_valid && w_intr;
            if(w_valid && w_write && !w_trap && w_rd!=0) regs[w_rd]<=w_result;
            regs[0]<=0;
            if (MEXT && md_busy) begin
                if (md_f3[2]) md_acc <= !md_diff[32] ? {md_diff[31:0], md_acc[30:0], 1'b1} : {md_acc[62:0], 1'b0};
                else md_acc <= md_acc[0] ? {md_sum, md_acc[31:1]} : {1'b0, md_acc[63:1]};
                md_count <= md_count - 1;
                if (md_count == 1) begin md_busy <= 0; md_done <= 1; end
            end
            if (mem_wait) begin
                // Keep EX operands current while its producers drain into the register file.
                w_valid<=0; x_a<=a; x_b<=b;
            end else begin
                w_valid<=m_valid; w_pc<=m_pc; w_insn<=m_insn; w_rd<=m_rd;
                w_write<=m_write; w_trap<=m_trap; w_intr<=m_intr; w_result<=m_load ? load_value : m_result;
                if (ex_hold) begin
                    m_valid<=0; x_a<=a; x_b<=b;
                    if (!md_busy) begin
                        md_busy<=1; md_count<=32; md_f3<=funct3; md_a<=a; md_zero<=b==0;
                        md_neg<=funct3[2] && funct3[1] ? md_a_neg : md_a_neg ^ md_b_neg;
                        md_acc<={32'b0, md_a_neg ? -a : a}; md_div<=md_b_neg ? -b : b;
`ifdef RISCV_FORMAL_ALTOPS
                        case (funct3)
                            0: md_alt <= (a + b) ^ 32'h5876063e;
                            1: md_alt <= (a + b) ^ 32'hf6583fb7;
                            2: md_alt <= (a - b) ^ 32'hecfbe137;
                            3: md_alt <= (a + b) ^ 32'h949ce5e8;
                            4: md_alt <= (a - b) ^ 32'h7f8529ec;
                            5: md_alt <= (a - b) ^ 32'h10e8fd70;
                            6: md_alt <= (a - b) ^ 32'h8da68fa5;
                            7: md_alt <= (a - b) ^ 32'h3138d0e1;
                        endcase
`endif
                    end
                end else begin
                    m_valid<=x_valid; m_pc<=x_pc; m_insn<=x_insn; m_rd<=x_insn[11:7];
                    m_write<=wr; m_load<=ld; m_store_en<=st; m_trap<=trap || irq; m_intr<=irq;
                    m_result<=result; m_store<=b; m_funct3<=funct3;
                    if (x_valid) md_done<=0;
                    if (ZICSR && x_valid) begin
                        if (trap || irq) begin
                            mepc<=x_pc; mcause<=irq ? {1'b1, 27'b0, irq_cause} : {28'b0, cause};
                            mtval<=irq ? 32'b0 : tval; mstatus_mpie<=mstatus_mie; mstatus_mie<=0;
                        end else if (is_mret) begin
                            mstatus_mie<=mstatus_mpie; mstatus_mpie<=1;
                        end else if (csr_write) case (csr_addr)
                            12'h300: begin mstatus_mie<=csr_new[3]; mstatus_mpie<=csr_new[7]; end
                            12'h304: begin mie_msie<=csr_new[3]; mie_mtie<=csr_new[7]; mie_meie<=csr_new[11]; end
                            12'h305: mtvec<={csr_new[31:2], 1'b0, csr_new[0]};
                            12'h340: mscratch<=csr_new;
                            12'h341: mepc<={csr_new[31:2], 2'b00};
                            12'h342: mcause<=csr_new;
                            12'h343: mtval<=csr_new;
                            default: ;
                        endcase
                    end
                    if(redirect || fault) begin
                        f_valid<=0; x_valid<=0;
                        if(redirect) pc<=target;
                        if(fault && ZICSR) pc<=trap_target;
                        if(fault && !ZICSR) halted<=1;
                    end else if(hazard) begin
                        x_valid<=0;
                    end else begin
                        x_valid<=f_valid; x_pc<=f_pc; x_insn<=f_insn;
                        // WB-to-ID bypass is needed across the same rising edge.
                        x_a<=f_insn[19:15]==0 ? 32'b0 :
                            (w_valid && w_write && !w_trap && w_rd==f_insn[19:15] ? w_result : regs[f_insn[19:15]]);
                        x_b<=f_insn[24:20]==0 ? 32'b0 :
                            (w_valid && w_write && !w_trap && w_rd==f_insn[24:20] ? w_result : regs[f_insn[24:20]]);
                        f_valid<=!halted && imem_ready; f_pc<=pc; f_insn<=imem_rdata;
                        if(!halted && imem_ready) pc<=pc+4;
                    end
                end
            end
        end
    end
`ifdef RISCV_FORMAL
    // RVFI trace, built from values carried alongside each instruction. Simulation and synthesis omit it.
    reg [31:0] m_rs1_rdata, m_rs2_rdata, m_pc_wdata, w_rs1_rdata, w_rs2_rdata, w_pc_wdata;
    reg [4:0] m_rs1_addr, m_rs2_addr, w_rs1_addr, w_rs2_addr;
    reg [31:0] w_mem_rdata, w_mem_wdata;
    reg [3:0] w_mem_rmask, w_mem_wmask;
    reg [31:0] w_mem_addr;
    reg next_intr;
    wire x_uses_rs1 = op==7'h67 || op==7'h63 || op==7'h03 || op==7'h23 || op==7'h13 || op==7'h33 || (DOT4 && op==7'h0b) ||
        (ZICSR && op==7'h73 && funct3!=0 && !funct3[2]);
    wire x_uses_rs2 = op==7'h63 || op==7'h23 || op==7'h33 || (DOT4 && op==7'h0b);
    always @(posedge clk) begin
        if (reset) begin
            rvfi_valid<=0; rvfi_order<=0; next_intr<=0;
        end else begin
            if (!mem_wait) begin
                w_rs1_addr<=m_rs1_addr; w_rs2_addr<=m_rs2_addr; w_rs1_rdata<=m_rs1_rdata; w_rs2_rdata<=m_rs2_rdata;
                w_pc_wdata<=m_pc_wdata; w_mem_addr<=dmem_addr;
                w_mem_rmask<=dmem_read ? ((m_funct3[1:0]==0 ? 4'b0001 : m_funct3[1:0]==1 ? 4'b0011 : 4'b1111) << m_result[1:0]) : 4'b0;
                w_mem_wmask<=dmem_wstrb; w_mem_rdata<=dmem_rdata; w_mem_wdata<=dmem_wdata;
                if (advance) begin
                    m_rs1_addr<=x_uses_rs1 ? rs1 : 5'b0; m_rs2_addr<=x_uses_rs2 ? rs2 : 5'b0;
                    m_rs1_rdata<=x_uses_rs1 && rs1!=0 ? a : 32'b0; m_rs2_rdata<=x_uses_rs2 && rs2!=0 ? b : 32'b0;
                    m_pc_wdata<=redirect ? target : (fault && ZICSR) ? trap_target : x_pc+4;
                end
            end
            rvfi_valid<=w_valid && !w_intr;
            if (w_valid) next_intr<=ZICSR && w_trap;
            if (w_valid && !w_intr) begin
                rvfi_order<=rvfi_order+rvfi_valid; rvfi_insn<=w_insn; rvfi_trap<=w_trap;
                rvfi_halt<=!ZICSR && w_trap; rvfi_intr<=next_intr; rvfi_mode<=3; rvfi_ixl<=1;
                rvfi_rs1_addr<=w_rs1_addr; rvfi_rs2_addr<=w_rs2_addr; rvfi_rs1_rdata<=w_rs1_rdata; rvfi_rs2_rdata<=w_rs2_rdata;
                rvfi_rd_addr<=(w_write && !w_trap) ? w_rd : 5'b0; rvfi_rd_wdata<=(w_write && !w_trap && w_rd!=0) ? w_result : 32'b0;
                rvfi_pc_rdata<=w_pc; rvfi_pc_wdata<=w_pc_wdata;
                rvfi_mem_addr<=w_mem_addr; rvfi_mem_rmask<=w_mem_rmask; rvfi_mem_wmask<=w_mem_wmask;
                rvfi_mem_rdata<=w_mem_rdata; rvfi_mem_wdata<=w_mem_wdata;
            end
        end
    end
`endif
endmodule
