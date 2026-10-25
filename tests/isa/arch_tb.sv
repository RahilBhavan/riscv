// Bench for externally assembled programs: one 4 MiB memory image serves both ports.
// Addresses wrap at 4 MiB, so data placed at 0x8001_0000 by a program lands at 0x1_0000.
// +image=<hex words> +halt=<hex pc> [+sig_begin=<hex> +sig_end=<hex> +signature=<file>] [+trace] [+waits=P +wait_seed=S]
// With ZICSR=0 any trap before the halt ECALL is a failure; with ZICSR=1 traps enter the test's handler.
module arch_tb #(parameter MEXT = 0, parameter ZICSR = 0, parameter [31:0] RESET_PC = 0);
    reg clk=0, reset=1;
    always #5 clk=~clk;
    wire [31:0] ia, da, dw, ri, rp, rv;
    wire [4:0] rd;
    wire [3:0] we;
    wire dr, valid, trap, stall, flush, ivalid, intr;
    reg imem_ready=1, dmem_ready=1;
    reg [31:0] lfsr=32'h1;
    reg [31:0] mem[0:1048575];
    // While a port is not ready it returns noise, so a core that ignores ready reads garbage.
    rv32_core #(.MEXT(MEXT), .ZICSR(ZICSR), .RESET_PC(RESET_PC)) dut(clk,reset,ia,imem_ready ? mem[ia[21:2]] : lfsr,da,dw,we,dr,dmem_ready ? mem[da[21:2]] : ~lfsr,valid,rp,ri,rd,rv,trap,stall,flush,
        ivalid,imem_ready,dmem_ready,1'b0,1'b0,1'b0,intr);
    function [31:0] program_word(input [31:0] address);
        program_word = mem[address[21:2]];
    endfunction
    `include "tests/invariants.svh"

    integer i, cycles=0, max_cycles=2000000, out, waits=0;
    reg [31:0] halt, sig_begin, sig_end;
    reg [1023:0] image, signature;
    reg trace;
    initial begin
        for(i=0;i<1048576;i=i+1) mem[i]=0;
        if(!$value$plusargs("image=%s",image) || !$value$plusargs("halt=%h",halt)) $fatal(1,"missing +image or +halt");
        if($value$plusargs("max_cycles=%d",max_cycles)) $display("max_cycles=%0d",max_cycles);
        trace=$test$plusargs("trace");
        void'($value$plusargs("waits=%d",waits));
        void'($value$plusargs("wait_seed=%h",lfsr));
        if(lfsr==0) lfsr=1;
        $readmemh(image,mem);
        repeat(2) @(negedge clk);
        reset=0;
    end
    integer lane;
    always @(posedge clk) if(!reset && dmem_ready) for(lane=0;lane<4;lane=lane+1) if(we[lane]) begin
        mem[da[21:2]][8*lane+:8]<=dw[8*lane+:8];
        if(trace) $display("STORE %08x %02x",da+lane,dw[8*lane+:8]);
    end
    // Ready for the next rising edge changes just after this one, so it settles before the falling-edge checks.
    always @(posedge clk) if(waits) begin
        lfsr<={lfsr[30:0], lfsr[31]^lfsr[21]^lfsr[1]^lfsr[0]};
        imem_ready<=lfsr[7:0]>=waits;
        dmem_ready<=lfsr[15:8]>=waits;
    end
    always @(negedge clk) if(!reset) begin
        invariants_step();
        cycles=cycles+1;
        if(valid) begin
            if(trace) $display("RET %08x %08x %02x %08x %01x %01x",rp,ri,rd,rv,trap,intr);
            if(trap && (!ZICSR || rp===halt)) begin
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
