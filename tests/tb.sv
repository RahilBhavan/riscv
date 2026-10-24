// +program=<hex> [+data=<hex>] [+max_cycles=N] [+waits=P +wait_seed=S] [+trace]
// +waits=P withholds each memory ready with probability P/256, from a seeded LFSR.
// Under ZICSR, a store to 0x3ffc drives the interrupt lines from bits 0..2 (software, timer, external),
// and the run ends when EBREAK retires; otherwise it ends at the first trap.
module tb #(parameter DOT4 = 1, parameter MEXT = 0, parameter ZICSR = 0);
    reg clk=0, reset=1;
    always #5 clk=~clk;
    wire [31:0] ia, da, dw, ri, rp, rv;
    wire [4:0] rd;
    wire [3:0] we;
    wire dr, valid, trap, stall, flush, ivalid, intr;
    reg imem_ready=1, dmem_ready=1;
    reg [31:0] lfsr=32'h1;
    reg [2:0] irq_lines=0;
    reg [31:0] imem[0:4095];
    reg [7:0] mem[0:16383];
    // While a port is not ready it returns noise, so a core that ignores ready reads garbage.
    wire [31:0] data_in=dmem_ready ? {mem[(da+3)&16383],mem[(da+2)&16383],mem[(da+1)&16383],mem[da&16383]} : ~lfsr;
    wire [31:0] insn_in=imem_ready ? imem[ia[13:2]] : lfsr;
    rv32_core #(.DOT4(DOT4), .MEXT(MEXT), .ZICSR(ZICSR)) dut(clk,reset,ia,insn_in,da,dw,we,dr,data_in,
        valid,rp,ri,rd,rv,trap,stall,flush,ivalid,imem_ready,dmem_ready,irq_lines[0],irq_lines[1],irq_lines[2],intr);
    integer i, cycles=0, max_cycles=200000, waits=0;
    reg [1023:0] program_file, data_file;
    function [31:0] program_word(input [31:0] address);
        program_word = imem[address[13:2]];
    endfunction
    `include "tests/invariants.svh"
    initial begin
        for(i=0;i<4096;i=i+1) imem[i]=32'h00000013;
        for(i=0;i<16384;i=i+1) mem[i]=0;
        if(!$value$plusargs("program=%s",program_file)) $fatal(1,"missing program");
        $readmemh(program_file,imem);
        if($value$plusargs("data=%s",data_file)) $readmemh(data_file,mem);
        void'($value$plusargs("max_cycles=%d",max_cycles));
        void'($value$plusargs("waits=%d",waits));
        void'($value$plusargs("wait_seed=%h",lfsr));
        if(lfsr==0) lfsr=1;
        repeat(2) @(negedge clk);
        reset=0;
    end
    always @(posedge clk) begin
        if(!reset && dmem_ready) begin
            for(i=0;i<4;i=i+1) if(we[i]) begin
                mem[(da+i)&16383]<=dw[8*i+:8];
                $display("STORE %08x %02x",da+i,dw[8*i+:8]);
            end
            if(ZICSR && we[0] && (da&16383)==16380) irq_lines<=dw[2:0];
        end
    end
    // Ready for the next rising edge changes just after this one, so it settles before the falling-edge checks.
    always @(posedge clk) if(waits) begin
        lfsr<={lfsr[30:0], lfsr[31]^lfsr[21]^lfsr[1]^lfsr[0]};
        imem_ready<=lfsr[7:0]>=waits;
        dmem_ready<=lfsr[15:8]>=waits;
    end
    always @(negedge clk) begin
        if(!reset) begin
            invariants_step();
            cycles=cycles+1;
            if($test$plusargs("trace"))
                $display("TRACE %0d %08x %01x %08x %01x %08x %01x %08x %01x %08x %01x %01x %01x %08x %08x",
                    cycles,ia,!dut.halted,dut.f_pc,dut.f_valid,dut.x_pc,dut.x_valid,
                    dut.m_pc,dut.m_valid,dut.w_pc,dut.w_valid,stall,flush,dut.a,dut.b);
            if(stall) $display("STALL");
            if(flush) $display("FLUSH");
            if(valid) begin
                // mcause still holds this interrupt: the first handler instruction reaches EX no earlier than this cycle.
                if(intr) $display("IRQ %08x",dut.mcause);
                $display("RET %08x %08x %02x %08x %01x %01x",rp,ri,rd,rv,trap,intr);
                if(trap && (!ZICSR || (!intr && ri==32'h00100073))) begin
                    invariants_done(); $display("CYCLES %0d",cycles); $finish;
                end
            end
            if(cycles>max_cycles) $fatal(1,"timeout");
        end
    end
endmodule
