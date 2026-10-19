module reset_tb;
    reg clk=0, reset=1;
    always #5 clk=~clk;
    wire [31:0] ia, da, dw, rp, ri, rv;
    wire [3:0] we;
    wire [4:0] rd;
    wire dr, valid, trap, stall, flush;
    reg [31:0] insn;
    integer writes=0, cycles=0;
    rv32_core dut(clk,reset,ia,insn,da,dw,we,dr,32'd9,valid,rp,ri,rd,rv,trap,stall,flush);
    always @* case(ia)
        0: insn=32'h00900093;  // addi x1,x0,9
        4: insn=32'h08102023;  // sw x1,128(x0)
        8: insn=32'h08002103;  // lw x2,128(x0)
        12: insn=32'h001101b3; // add x3,x2,x1: load-use stall
        16: insn=32'h00000463; // beq x0,x0,+8: redirect
        20: insn=32'h00100213; // addi x4,x0,1: wrong path
        24: insn=32'h08302223; // sw x3,132(x0)
        default: insn=32'h00100073;
    endcase
    always @(posedge clk) begin
        cycles=cycles+1;
        // Memory endpoints may sample requests even when the core is resetting.
        if(we!=0) writes=writes+1;
        if(reset && (we!=0 || dr)) $fatal(1,"memory request during reset");
        if(valid && rp==20) $fatal(1,"wrong-path instruction retired");
        if(cycles>200) $fatal(1,"reset test timeout");
    end
    task assert_reset;
        begin
            reset=1; #1;
            if(we!=0 || dr) $fatal(1,"reset must suppress pending requests before edge");
            @(posedge clk); #1;
            if(valid || dut.f_valid || dut.x_valid || dut.m_valid || dut.w_valid || dut.halted || stall || flush)
                $fatal(1,"reset did not clear pipeline");
            if(dut.regs[1]!=0 || dut.regs[2]!=0 || dut.regs[3]!=0 || dut.pc!=0)
                $fatal(1,"reset did not clear architectural state");
            @(negedge clk); reset=0;
        end
    endtask
    // Conditions are sampled at falling edges so delta-cycle glitches after a rising edge cannot match.
    initial begin
        repeat(2) @(negedge clk);
        reset=0;
        while(!(we!=0)) @(negedge clk); // store is pending, not yet sampled
        assert_reset();
        if(writes!=0) $fatal(1,"pending store escaped reset");
        while(!(dr)) @(negedge clk);
        assert_reset();
        if(writes!=1) $fatal(1,"load reset disturbed preceding store");
        // The stall cycle also holds the first store in MEM, so that store must not land either.
        while(!(stall)) @(negedge clk);
        if(!stall || we==0) $fatal(1,"expected a load-use stall with a pending store");
        assert_reset();
        if(writes!=1) $fatal(1,"store escaped reset during load-use stall");
        while(!(flush && !dut.fault)) @(negedge clk);
        if(!dut.redirect || dut.x_pc!=16) $fatal(1,"expected the BEQ redirect in EX");
        assert_reset();
        if(writes!=2) $fatal(1,"reset during redirect disturbed older store");
        // EBREAK in EX while sw x3 waits in MEM: the drain and the trap record must both vanish.
        while(!(flush && dut.fault)) @(negedge clk);
        if(!dut.fault || we==0) $fatal(1,"expected a trap drain with a pending store");
        assert_reset();
        if(writes!=3) $fatal(1,"store escaped reset during trap drain");
        wait(valid && trap); #1;
        if(writes!=5 || rp!=28 || dut.regs[1]!=9 || dut.regs[2]!=9 || dut.regs[3]!=18 || dut.regs[4]!=0)
            $fatal(1,"restart failed");
        $display("PASS pending store reset, pending load reset, load-use stall reset, redirect reset, trap-drain reset, pipeline clear, architectural restart");
        $finish;
    end
endmodule
