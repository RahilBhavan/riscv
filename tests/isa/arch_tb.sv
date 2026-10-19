// Bench for externally assembled programs: one 4 MiB memory image serves both ports.
// Addresses wrap at 4 MiB, so data placed at 0x8001_0000 by a program lands at 0x1_0000.
// +image=<hex words> +halt=<hex pc> [+sig_begin=<hex> +sig_end=<hex> +signature=<file>] [+trace]
module arch_tb;
    reg clk=0, reset=1;
    always #5 clk=~clk;
    wire [31:0] ia, da, dw, ri, rp, rv;
    wire [4:0] rd;
    wire [3:0] we;
    wire dr, valid, trap, stall, flush;
    reg [31:0] mem[0:1048575];
    rv32_core dut(clk,reset,ia,mem[ia[21:2]],da,dw,we,dr,mem[da[21:2]],valid,rp,ri,rd,rv,trap,stall,flush);
    function [31:0] program_word(input [31:0] address);
        program_word = mem[address[21:2]];
    endfunction
    `include "tests/invariants.svh"

    integer i, cycles=0, max_cycles=2000000, out;
    reg [31:0] halt, sig_begin, sig_end;
    reg [1023:0] image, signature;
    reg trace;
    initial begin
        for(i=0;i<1048576;i=i+1) mem[i]=0;
        if(!$value$plusargs("image=%s",image) || !$value$plusargs("halt=%h",halt)) $fatal(1,"missing +image or +halt");
        if($value$plusargs("max_cycles=%d",max_cycles)) $display("max_cycles=%0d",max_cycles);
        trace=$test$plusargs("trace");
        $readmemh(image,mem);
        repeat(2) @(negedge clk);
        reset=0;
    end
    integer lane;
    always @(posedge clk) if(!reset) for(lane=0;lane<4;lane=lane+1) if(we[lane]) begin
        mem[da[21:2]][8*lane+:8]<=dw[8*lane+:8];
        if(trace) $display("STORE %08x %02x",da+lane,dw[8*lane+:8]);
    end
    always @(negedge clk) if(!reset) begin
        invariants_step();
        cycles=cycles+1;
        if(valid) begin
            if(trace) $display("RET %08x %08x %02x %08x %01x",rp,ri,rd,rv,trap);
            if(trap) begin
                if(rp!==halt || ri!==32'h00000073) $fatal(1,"unexpected trap %08x at %08x before halt %08x",ri,rp,halt);
                invariants_done();
                if($value$plusargs("signature=%s",signature)) begin
                    if(!$value$plusargs("sig_begin=%h",sig_begin) || !$value$plusargs("sig_end=%h",sig_end)) $fatal(1,"missing signature bounds");
                    out=$fopen(signature,"w");
                    for(i=sig_begin; i<sig_end; i=i+4) $fdisplay(out,"%08x",mem[i[21:2]]);
                    $fclose(out);
                end
                $display("HALT cycles=%0d",cycles);
                $finish;
            end
        end
        if(cycles>max_cycles) $fatal(1,"timeout after %0d cycles",cycles);
    end
endmodule
