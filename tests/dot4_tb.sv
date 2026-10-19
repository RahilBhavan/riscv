// DOT4 evidence bench.
// +sweep: runs the generated lane-sweep program and checks every DOT4 against a scalar
//         product of the expected byte pair, both at EX (operands) and at retirement.
// +encodings: resets the core for each of the 1,024 custom-0 funct3/funct7 encodings and
//         checks that only funct3=0/funct7=0 executes; all others must trap without effect.
module dot4_tb;
    reg clk=0, reset=1;
    always #5 clk=~clk;
    wire [31:0] ia, da, dw, ri, rp, rv;
    wire [4:0] rd;
    wire [3:0] we;
    wire dr, valid, trap, stall, flush;
    reg [31:0] imem[0:4095];
    reg [7:0] mem[0:16383];
    wire [31:0] data_in={mem[(da+3)&16383],mem[(da+2)&16383],mem[(da+1)&16383],mem[da&16383]};
    rv32_core dut(clk,reset,ia,imem[ia[13:2]],da,dw,we,dr,data_in,valid,rp,ri,rd,rv,trap,stall,flush);
    function [31:0] program_word(input [31:0] address);
        program_word = imem[address[13:2]];
    endfunction
    `include "tests/invariants.svh"

    integer i, cycles=0, stores=0;
    always @(posedge clk) if(!reset) for(i=0;i<4;i=i+1) if(we[i]) begin
        mem[(da+i)&16383]<=dw[8*i+:8];
        stores=stores+1;
    end
    // Invariant steps run in the controlling thread so a restart cannot interleave with a step.
    task tick;
        begin
            @(negedge clk);
            invariants_step();
            cycles=cycles+1;
        end
    endtask

    // Sweep scoreboard: case n covers lane n/65536, a=byte (n/256)%256-128, b=n%256-128.
    integer issued=0, retired=0;
    reg [31:0] checksum=0;
    function [31:0] lane_value(input integer n, input integer which);
        lane_value = (((which ? n : n >> 8) & 255) ^ 128) << (8 * (n >> 16));
    endfunction
    function signed [31:0] product(input integer n);
        reg signed [7:0] a, b;
        begin
            a = ((n >> 8) & 255) ^ 128;
            b = (n & 255) ^ 128;
            product = a * b;
        end
    endfunction
    task run_sweep;
        begin
            repeat(2) @(negedge clk);
            reset=0;
            @(negedge clk);
            forever begin
                tick();
                if(dut.x_valid && dut.x_insn[6:0]==7'h0b) begin
                    if(dut.a!==lane_value(issued,0) || dut.b!==lane_value(issued,1))
                        $fatal(1,"DOT4 case %0d operands %08x %08x, expected %08x %08x",issued,dut.a,dut.b,lane_value(issued,0),lane_value(issued,1));
                    issued=issued+1;
                end
                if(valid && ri[6:0]==7'h0b) begin
                    if(trap || rv!==product(retired))
                        $fatal(1,"DOT4 case %0d result %08x trap %0d, expected %08x",retired,rv,trap,product(retired));
                    checksum=(checksum^rv)*32'd16777619;
                    retired=retired+1;
                end
                if(valid && trap) begin
                    if(ri!==32'h00100073) $fatal(1,"sweep ended on unexpected trap %08x at %08x",ri,rp);
                    if(retired!=262144 || issued!=262144) $fatal(1,"sweep ran %0d/%0d cases",issued,retired);
                    invariants_done();
                    $display("DOT4_SWEEP cases=%0d checksum=%08x cycles=%0d",retired,checksum,cycles);
                    $finish;
                end
                if(cycles>3000000) $fatal(1,"sweep timeout");
            end
        end
    endtask

    integer f3, f7, legal_runs=0, trap_runs=0, steps;
    reg seen_custom;
    task run_encoding(input integer funct3, input integer funct7);
        begin
            reset=1;
            for(i=0;i<4096;i=i+1) imem[i]=32'h00000013;
            imem[0]=32'h04d00293;  // addi x5,x0,77
            imem[1]=32'h00300313;  // addi x6,x0,3
            imem[2]=(funct7<<25)|(6<<20)|(6<<15)|(funct3<<12)|(5<<7)|7'h0b; // custom-0 x5,x6,x6
            imem[3]=32'h08502023;  // sw x5,128(x0): younger, must not run after a trap
            imem[4]=32'h00100073;  // ebreak
            stores=0; seen_custom=0;
            invariants_restart();
            repeat(2) @(negedge clk);
            reset=0;
            @(negedge clk);
            for(steps=0; steps<40 && !(valid && trap); steps=steps+1) begin
                tick();
                if(valid && rp==8) begin
                    seen_custom=1;
                    if(trap !== (funct3!=0 || funct7!=0)) $fatal(1,"custom-0 f3=%0d f7=%0d trap=%0d",funct3,funct7,trap);
                end
            end
            if(!(valid && trap) || !seen_custom) $fatal(1,"custom-0 f3=%0d f7=%0d did not finish",funct3,funct7);
            invariants_done();
            if(funct3==0 && funct7==0) begin
                if(rp!=16 || dut.regs[5]!=9 || stores!=4) $fatal(1,"valid DOT4 control run failed");
                legal_runs=legal_runs+1;
            end else begin
                if(rp!=8 || ri!==imem[2] || rd!=0 || rv!=0 || dut.regs[5]!=77 || stores!=0)
                    $fatal(1,"custom-0 f3=%0d f7=%0d trap had a side effect",funct3,funct7);
                trap_runs=trap_runs+1;
            end
        end
    endtask

    reg [1023:0] program_file;
    initial begin
        for(i=0;i<16384;i=i+1) mem[i]=0;
        if($test$plusargs("sweep")) begin
            for(i=0;i<4096;i=i+1) imem[i]=32'h00000013;
            if(!$value$plusargs("program=%s",program_file)) $fatal(1,"missing program");
            $readmemh(program_file,imem);
            run_sweep();
        end else if($test$plusargs("encodings")) begin
            for(f7=0;f7<128;f7=f7+1) for(f3=0;f3<8;f3=f3+1) run_encoding(f3,f7);
            $display("CUSTOM0 encodings=%0d trapped=%0d executed=%0d",legal_runs+trap_runs,trap_runs,legal_runs);
            $finish;
        end else $fatal(1,"choose +sweep or +encodings");
    end
endmodule
