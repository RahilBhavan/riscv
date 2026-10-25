// Self-checking iCE40-HX8K Breakout image: core, block-RAM memories, signature
// checker, LEDs and a UART status line. See docs/BOARD.md.
//
// The core expects instruction and load data in the same cycle as the address.
// iCE40 block RAM registers its read, so both memories run on the falling edge:
// the address leaves a core register at the rising edge, the RAM samples it half
// a cycle later, and its output is ready for the next rising edge. The core sees
// the same values a combinational memory would give, at half-cycle timing cost.
module board_top #(
    parameter PROGRAM_HEX = "build/board/program.hex",
    parameter integer CLK_HZ = 12_000_000,
    parameter integer BAUD = 115_200,
    // icepll settings for SB_PLL40_CORE; USE_PLL=0 runs from the 12 MHz oscillator.
    parameter integer USE_PLL = 0,
    parameter [3:0] PLL_DIVR = 4'd0,
    parameter [6:0] PLL_DIVF = 7'd0,
    parameter [2:0] PLL_DIVQ = 3'd0,
    parameter [2:0] PLL_FILTER_RANGE = 3'd1,
    // iCE40 block RAM reads return zero for a few microseconds after configuration;
    // 2^16 cycles is 5.5 ms at 12 MHz.
    parameter integer POR_BITS = 16,
    parameter integer WATCHDOG_BITS = 22,
    parameter integer REPORT_BITS = 24,
    parameter integer HEARTBEAT_BIT = 23,
    parameter integer RETIRE_LED_BIT = 22,
    parameter integer PASS_LED_BIT = 13
) (
    input wire clk_12mhz,
    output wire [7:0] leds,
    output wire uart_tx
);
`include "board_program.vh"
    localparam integer IMEM_WORDS = 2048, DMEM_WORDS = 1024;

    wire clk, clk_locked;
    generate if (USE_PLL != 0) begin : pll
        SB_PLL40_CORE #(
            .FEEDBACK_PATH("SIMPLE"), .DIVR(PLL_DIVR), .DIVF(PLL_DIVF),
            .DIVQ(PLL_DIVQ), .FILTER_RANGE(PLL_FILTER_RANGE)
        ) pll_i (
            .REFERENCECLK(clk_12mhz), .PLLOUTGLOBAL(clk), .LOCK(clk_locked),
            .RESETB(1'b1), .BYPASS(1'b0)
        );
    end else begin : direct
        assign clk = clk_12mhz;
        assign clk_locked = 1'b1;
    end endgenerate

    // LOCK is asynchronous to clk, so it passes through two flip-flops first.
    reg [1:0] lock_sync = 2'b0;
    reg [POR_BITS:0] por = 0;
    wire reset = !por[POR_BITS];
    always @(posedge clk) begin
        lock_sync <= {lock_sync[0], clk_locked};
        if (!lock_sync[1]) por <= 0;
        else if (reset) por <= por + 1'b1;
    end

    wire [31:0] imem_addr, dmem_addr, dmem_wdata;
    wire [31:0] retire_pc, retire_insn, retire_data;
    wire [4:0] retire_rd;
    wire [3:0] dmem_wstrb;
    wire dmem_read, retire_valid, retire_trap, stall_event, flush_event, imem_valid, retire_intr;
    reg [31:0] imem_rdata, dmem_rdata;
    rv32_core core (
        .clk(clk), .reset(reset),
        .imem_addr(imem_addr), .imem_rdata(imem_rdata),
        .dmem_addr(dmem_addr), .dmem_wdata(dmem_wdata), .dmem_wstrb(dmem_wstrb),
        .dmem_read(dmem_read), .dmem_rdata(dmem_rdata),
        .retire_valid(retire_valid), .retire_pc(retire_pc), .retire_insn(retire_insn),
        .retire_rd(retire_rd), .retire_data(retire_data), .retire_trap(retire_trap),
        .stall_event(stall_event), .flush_event(flush_event),
        .imem_valid(imem_valid), .imem_ready(1'b1), .dmem_ready(1'b1),
        .irq_software(1'b0), .irq_timer(1'b0), .irq_external(1'b0), .retire_intr(retire_intr)
    );

    reg [31:0] imem [0:IMEM_WORDS-1];
    // The read port samples every cycle, but the core ignores load data while a
    // store is in MEM, so same-address read-during-write results never matter.
    // no_rw_check stops yosys adding collision-bypass flip-flops around the RAM.
    (* no_rw_check *) reg [31:0] dmem [0:DMEM_WORDS-1];
    initial $readmemh(PROGRAM_HEX, imem);
    always @(negedge clk) imem_rdata <= imem[imem_addr[12:2]];

    wire dmem_hit = dmem_addr < 4 * DMEM_WORDS;
    integer lane;
    always @(negedge clk) begin
        for (lane = 0; lane < 4; lane = lane + 1)
            if (dmem_hit && dmem_wstrb[lane])
                dmem[dmem_addr[11:2]][8*lane +: 8] <= dmem_wdata[8*lane +: 8];
        dmem_rdata <= dmem[dmem_addr[11:2]];
    end

    // Failure causes, one bit each: signature, trap, watchdog, retire count.
    reg [3:0] cause = 4'b0;
    reg [31:0] passes = 0, signature = 0, cycles_per_pass = 0, pass_cycles = 0;
    reg [31:0] retired = 0, pass_retired = 0;
    reg [WATCHDOG_BITS:0] watchdog = 0;
    reg [HEARTBEAT_BIT:0] heartbeat = 0;
    wire signature_write = dmem_addr == SIGNATURE_ADDR && dmem_wstrb == 4'hf;
    wire pass = passes != 0 && cause == 0;
    wire fail = cause != 0;
    always @(posedge clk) begin
        heartbeat <= heartbeat + 1'b1;
        if (reset) begin
            cause <= 0; passes <= 0; signature <= 0; cycles_per_pass <= 0;
            pass_cycles <= 0; retired <= 0; pass_retired <= 0; watchdog <= 0;
        end else begin
            pass_cycles <= pass_cycles + 1;
            retired <= retired + {31'b0, retire_valid};
            pass_retired <= pass_retired + {31'b0, retire_valid};
            watchdog <= watchdog + 1'b1;
            if (signature_write) begin
                signature <= dmem_wdata;
                cycles_per_pass <= pass_cycles + 1;
                pass_cycles <= 0;
                pass_retired <= {31'b0, retire_valid};
                watchdog <= 0;
                if (dmem_wdata == EXPECTED_SIGNATURE) passes <= passes + 1;
                else cause[0] <= 1'b1;
                // The first pass starts at reset, not at the loop jump.
                if (passes != 0 && pass_retired != RETIRED_PER_PASS) cause[3] <= 1'b1;
            end
            if (retire_valid && retire_trap) cause[1] <= 1'b1;
            if (watchdog[WATCHDOG_BITS]) cause[2] <= 1'b1;
        end
    end

    assign leds[0] = heartbeat[HEARTBEAT_BIT];
    assign leds[1] = retired[RETIRE_LED_BIT];
    assign leds[2] = pass;
    assign leds[3] = fail;
    assign leds[7:4] = fail ? cause : pass ? passes[PASS_LED_BIT +: 4] : 4'b0;

    board_uart #(.DIVIDER(CLK_HZ / BAUD), .REPORT_BITS(REPORT_BITS)) uart (
        .clk(clk), .reset(reset), .pass(pass), .fail(fail), .cause(cause),
        .passes(passes), .signature(signature), .cycles(cycles_per_pass), .tx(uart_tx)
    );
endmodule

// Every 2^REPORT_BITS cycles, sends one 8N1 line such as
// "PASS c=0 n=00001234 sig=5a978549 cyc=00000a10\r\n".
module board_uart #(
    parameter integer DIVIDER = 104,
    parameter integer REPORT_BITS = 24
) (
    input wire clk, input wire reset,
    input wire pass, input wire fail, input wire [3:0] cause,
    input wire [31:0] passes, input wire [31:0] signature, input wire [31:0] cycles,
    output reg tx = 1'b1
);
    localparam [5:0] LINE_LEN = 6'd47;
    localparam [15:0] BAUD_RELOAD = 16'(DIVIDER - 1);
    reg [REPORT_BITS-1:0] period = 0;
    reg [5:0] index = LINE_LEN;
    reg [9:0] frame = 0;
    reg [3:0] bits = 0;
    reg [15:0] baud = 0;
    reg [31:0] s_passes = 0, s_signature = 0, s_cycles = 0;
    reg [3:0] s_cause = 0;
    reg s_pass = 0, s_fail = 0;

    function [7:0] hex(input [3:0] n);
        hex = n < 10 ? 8'h30 + {4'b0, n} : 8'h57 + {4'b0, n};
    endfunction

    reg [7:0] ch;
    always @* begin
        case (index)
            0: ch = s_fail ? "F" : s_pass ? "P" : "W";
            1: ch = "A";
            2: ch = s_pass ? "S" : "I";
            3: ch = s_fail ? "L" : s_pass ? "S" : "T";
            4, 8, 19, 32: ch = " ";
            5: ch = "c";
            6, 10, 23, 36: ch = "=";
            7: ch = hex(s_cause);
            9: ch = "n";
            20: ch = "s"; 21: ch = "i"; 22: ch = "g";
            33: ch = "c"; 34: ch = "y"; 35: ch = "c";
            45: ch = 8'h0d;
            46: ch = 8'h0a;
            default:
                if (index >= 11 && index < 19) ch = hex(s_passes[4*(18-index) +: 4]);
                else if (index >= 24 && index < 32) ch = hex(s_signature[4*(31-index) +: 4]);
                else ch = hex(s_cycles[4*(44-index) +: 4]);
        endcase
    end

    always @(posedge clk) begin
        period <= period + 1'b1;
        if (reset) begin
            index <= LINE_LEN; bits <= 0; baud <= 0; tx <= 1'b1;
        end else if (baud != 0) begin
            baud <= baud - 1'b1;
        end else if (bits != 0) begin
            tx <= frame[0];
            frame <= frame >> 1;
            bits <= bits - 1'b1;
            baud <= BAUD_RELOAD;
        end else if (index != LINE_LEN) begin
            frame <= {1'b1, ch, 1'b0};
            bits <= 4'd10;
            index <= index + 1'b1;
        end else if (&period) begin
            s_pass <= pass; s_fail <= fail; s_cause <= cause;
            s_passes <= passes; s_signature <= signature; s_cycles <= cycles;
            index <= 0;
        end
    end
endmodule
