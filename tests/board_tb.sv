// Runs board_top with its real program image and judges it only through its
// pins: the LEDs and the decoded UART status line. EXPECT_FAIL=1 runs a corrupted
// image that must report a signature FAIL. Define NETLIST to drive a synthesized
// netlist whose simulation parameters were set at synthesis time.
module board_tb;
    parameter PROGRAM_HEX = "build/board/program.hex";
    parameter integer EXPECT_FAIL = 0;
`include "board_program.vh"
    localparam integer DIVIDER = 8, REQUIRED_LINES = 2;
    reg clk = 0;
    always #5 clk = ~clk;
    wire [7:0] leds;
    wire tx;
`ifdef NETLIST
    board_top dut (.clk_12mhz(clk), .leds(leds), .uart_tx(tx));
`else
    board_top #(
        .PROGRAM_HEX(PROGRAM_HEX), .CLK_HZ(DIVIDER * 115_200), .POR_BITS(4),
        .WATCHDOG_BITS(14), .REPORT_BITS(15)
    ) dut (.clk_12mhz(clk), .leds(leds), .uart_tx(tx));
`endif

    // "PASS c=0 n=00001234 sig=5a978549 cyc=00000a10", most recent character lowest.
    reg [8*45-1:0] line = 0;
    reg [8*45-1:0] previous = 0;
    reg [7:0] ch;
    reg [8*8-1:0] expected;
    integer bit_index, lines = 0;
    always begin
        @(negedge tx);
        repeat (DIVIDER + DIVIDER / 2) @(posedge clk);
        for (bit_index = 0; bit_index < 8; bit_index = bit_index + 1) begin
            ch[bit_index] = tx;
            repeat (DIVIDER) @(posedge clk);
        end
        if (!tx) $fatal(1, "UART stop bit missing");
        if (ch == 8'h0a) begin
            $display("UART %0s leds=%b", line, leds);
            $sformat(expected, "%08x", EXPECTED_SIGNATURE);
            if (line[8*45-1 -: 8*8] != (EXPECT_FAIL ? "FAIL c=1" : "PASS c=0"))
                $fatal(1, "UART line has the wrong verdict");
            if ((line[8*21-1 -: 8*8] == expected) == EXPECT_FAIL)
                $fatal(1, "UART signature field disagrees with the verdict");
            if (EXPECT_FAIL ? !(leds[3] && !leds[2] && leds[7:4] == 4'b0001) : !(leds[2] && !leds[3]))
                $fatal(1, "LEDs disagree with the UART verdict: %b", leds);
            if (!EXPECT_FAIL && lines != 0 && line[8*34-1 -: 8*8] <= previous[8*34-1 -: 8*8])
                $fatal(1, "pass count did not advance between reports");
            previous = line;
            lines = lines + 1;
            if (lines == REQUIRED_LINES) begin
                if (EXPECT_FAIL) $display("BOARD FAIL-DETECTED");
                else $display("BOARD PASS");
                $finish;
            end
            line = 0;
        end else if (ch != 8'h0d) begin
            line = {line[8*44-1:0], ch};
        end
    end

    integer cycles = 0;
    always @(posedge clk) begin
        cycles = cycles + 1;
        if (cycles > 200_000) $fatal(1, "timeout: leds=%b lines=%0d", leds, lines);
    end
endmodule
