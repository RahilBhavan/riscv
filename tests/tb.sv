module tb #(parameter DOT4 = 1);
    reg clk=0, reset=1;
    always #5 clk=~clk;
    wire [31:0] ia, da, dw, ri, rp, rv;
    wire [4:0] rd;
    wire [3:0] we;
    wire dr, valid, trap, stall, flush;
    reg [31:0] imem[0:4095];
    reg [7:0] mem[0:16383];
    wire [31:0] data_in={mem[(da+3)&16383],mem[(da+2)&16383],mem[(da+1)&16383],mem[da&16383]};
    rv32_core #(.DOT4(DOT4)) dut(clk,reset,ia,imem[ia[13:2]],da,dw,we,dr,data_in,valid,rp,ri,rd,rv,trap,stall,flush);
    integer i, cycles=0, max_cycles=20000;
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
        repeat(2) @(negedge clk);
        reset=0;
    end
    always @(posedge clk) begin
        if(!reset) begin
            for(i=0;i<4;i=i+1) if(we[i]) begin
                mem[(da+i)&16383]<=dw[8*i+:8];
                $display("STORE %08x %02x",da+i,dw[8*i+:8]);
            end
        end
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
                $display("RET %08x %08x %02x %08x %01x",rp,ri,rd,rv,trap);
                if(trap) begin invariants_done(); $display("CYCLES %0d",cycles); $finish; end
            end
            if(cycles>max_cycles) $fatal(1,"timeout");
        end
    end
endmodule
