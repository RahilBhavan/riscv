// Educational RV32I execution core. Harvard, combinational instruction/data reads.
// See docs/ARCHITECTURE.md for the supported execution environment.
module rv32_core (
    input wire clk, input wire reset,
    output wire [31:0] imem_addr, input wire [31:0] imem_rdata,
    output wire [31:0] dmem_addr, output wire [31:0] dmem_wdata,
    output wire [3:0] dmem_wstrb, output wire dmem_read,
    input wire [31:0] dmem_rdata,
    output reg retire_valid, output reg [31:0] retire_pc,
    output reg [31:0] retire_insn, output reg [4:0] retire_rd,
    output reg [31:0] retire_data, output reg retire_trap,
    output wire stall_event, output wire flush_event
);
    reg [31:0] regs [0:31];
    reg [31:0] pc;
    reg f_valid, x_valid, m_valid, w_valid;
    reg [31:0] f_pc, f_insn, x_pc, x_insn, x_a, x_b;
    reg [31:0] m_pc, m_insn, m_result, m_store;
    reg [4:0] m_rd, w_rd;
    reg m_write, m_load, m_store_en, m_trap;
    reg [2:0] m_funct3;
    reg [31:0] w_pc, w_insn, w_result;
    reg w_write, w_trap;
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
        for (lane = 0; lane < 4; lane = lane + 1)
            dot = dot + ($signed(a[lane*8 +: 8]) * $signed(b[lane*8 +: 8]));
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
            end
            7'h23: begin
                st=1; result=a+imm_s;
                legal=(funct3<=2);
                if (funct3==1 && result[0]) trap=1;
                if (funct3==2 && result[1:0]!=0) trap=1;
            end
            7'h13, 7'h33: begin
                wr=1;
                case (funct3)
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
            7'h0b: begin wr=1; result=dot; legal=funct3==0 && funct7==0; end
            7'h0f: legal=funct3==0 && x_insn[31:28]==0; // base FENCE, reserved fields ignored
            7'h73: begin trap=1; legal=x_insn==32'h00000073 || x_insn==32'h00100073; end
            default: legal=0;
        endcase
        if (!legal || (taken && target[1:0]!=0)) trap=1;
        if (trap) begin wr=0; ld=0; st=0; taken=0; end
    end
    wire [6:0] f_op = f_insn[6:0];
    wire uses_rs1 = f_op==7'h67 || f_op==7'h63 || f_op==7'h03 || f_op==7'h23 || f_op==7'h13 || f_op==7'h33 || f_op==7'h0b;
    wire uses_rs2 = f_op==7'h63 || f_op==7'h23 || f_op==7'h33 || f_op==7'h0b;
    wire hazard = f_valid && x_valid && ld && !trap && x_insn[11:7]!=0 &&
        ((uses_rs1 && f_insn[19:15]==x_insn[11:7]) || (uses_rs2 && f_insn[24:20]==x_insn[11:7]));
    wire redirect = x_valid && taken;
    wire fault = x_valid && trap;
    // Trap notifications halt fetch, flush younger instructions, and drain older work.
    reg halted;
    assign stall_event = hazard && !redirect && !fault;
    assign flush_event = redirect || fault;
    assign imem_addr = pc;
    assign dmem_addr = {m_result[31:2],2'b0};
    assign dmem_read = m_valid && m_load && !m_trap;
    assign dmem_wdata = m_store << (8*m_result[1:0]);
    assign dmem_wstrb = (m_valid && m_store_en && !m_trap) ?
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
    integer i;
    always @(posedge clk) begin
        if (reset) begin
            pc<=0; f_valid<=0; x_valid<=0; m_valid<=0; w_valid<=0;
            halted<=0; retire_valid<=0; retire_pc<=0; retire_insn<=0;
            retire_rd<=0; retire_data<=0; retire_trap<=0;
            m_write<=0; m_load<=0; m_store_en<=0; m_trap<=0; w_write<=0; w_trap<=0;
            f_pc<=0; f_insn<=0; x_pc<=0; x_insn<=0; x_a<=0; x_b<=0;
            m_pc<=0; m_insn<=0; m_result<=0; m_store<=0; m_rd<=0; m_funct3<=0;
            w_pc<=0; w_insn<=0; w_result<=0; w_rd<=0;
            for(i=0;i<32;i=i+1) regs[i]<=0;
        end else begin
            retire_valid<=w_valid; retire_pc<=w_pc; retire_insn<=w_insn;
            retire_rd<=(w_write && !w_trap) ? w_rd : 5'b0;
            retire_data<=(w_write && !w_trap && w_rd!=0) ? w_result : 32'b0;
            retire_trap<=w_valid && w_trap;
            if(w_valid && w_write && !w_trap && w_rd!=0) regs[w_rd]<=w_result;
            regs[0]<=0;
            w_valid<=m_valid; w_pc<=m_pc; w_insn<=m_insn; w_rd<=m_rd;
            w_write<=m_write; w_trap<=m_trap; w_result<=m_load ? load_value : m_result;
            m_valid<=x_valid; m_pc<=x_pc; m_insn<=x_insn; m_rd<=x_insn[11:7];
            m_write<=wr; m_load<=ld; m_store_en<=st; m_trap<=trap;
            m_result<=result; m_store<=b; m_funct3<=funct3;
            if(redirect || fault) begin
                f_valid<=0; x_valid<=0;
                if(redirect) pc<=target;
                if(fault) halted<=1;
            end else if(hazard) begin
                x_valid<=0;
            end else begin
                x_valid<=f_valid; x_pc<=f_pc; x_insn<=f_insn;
                // WB-to-ID bypass is needed across the same rising edge.
                x_a<=f_insn[19:15]==0 ? 32'b0 :
                    (w_valid && w_write && !w_trap && w_rd==f_insn[19:15] ? w_result : regs[f_insn[19:15]]);
                x_b<=f_insn[24:20]==0 ? 32'b0 :
                    (w_valid && w_write && !w_trap && w_rd==f_insn[24:20] ? w_result : regs[f_insn[24:20]]);
                f_valid<=!halted; f_pc<=pc; f_insn<=imem_rdata;
                if(!halted) pc<=pc+4;
            end
        end
    end
endmodule
