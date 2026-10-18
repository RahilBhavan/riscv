`timescale 1ns/1ps
// Standalone teaching lab; not part of the measured RV32I core.
module learning_chain(input wire clk, reset, input wire [31:0] value,
                      output reg [31:0] a, b);
    always @(posedge clk) begin
        if (reset) begin a <= 0; b <= 0; end
        else begin a <= value; b <= a; end
    end
endmodule
module rtl_basics_tb;
    reg clk=0, reset=1;
    reg [31:0] value=0;
    wire [31:0] a,b;
    always #5 clk=~clk;
    learning_chain dut(clk,reset,value,a,b);
    initial begin
        repeat(2) @(negedge clk);
        reset=0; value=5;
        @(negedge clk);
        if(a!==5 || b!==0) $fatal(1,"first edge prediction wrong");
        value=9;
        @(negedge clk);
        if(a!==9 || b!==5) $fatal(1,"second edge prediction wrong");
        $display("PASS rtl_basics: a=9 b=5");
        $finish;
    end
endmodule
