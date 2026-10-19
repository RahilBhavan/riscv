# Running the core on an iCE40-HX8K Breakout Board

**Status: this image has not been run on hardware.** Everything below is checked in simulation and by place-and-route only. The section [Recording a hardware run](#recording-a-hardware-run) lists what to capture the first time it runs on a real board.

`make board` builds a bitstream for the Lattice iCE40-HX8K Breakout Board. It runs the core from on-chip block RAM, executes a self-checking program in a loop, and shows the verdict on the eight LEDs and on a USB serial line.

## Why this board

The timing estimates in `reports/implementation.json` are for the same iCE40HX8K CT256 device. The complete board image uses 5,956 of 7,680 logic cells and 23 of 32 block RAMs (`reports/board.json`). The iCE40 UltraPlus UP5K on the iCEBreaker has 5,280 logic cells, so this design does not fit it without first shrinking the core. The register file alone is 1,024 flip-flops because the core resets all 32 registers. The HX8K board also has its own FTDI programmer, a 12 MHz oscillator and eight LEDs, so it needs nothing else.

## Shopping list

- Lattice iCE40-HX8K Breakout Board, part number **ICE40HX8K-B-EVN**.
- A USB cable with a **Mini-B** plug on the board end. The board is powered from USB. The Lattice user guide lists the cable as part of the kit, but check your box.

No jumper wires, buttons or extra parts are needed.

## Build

From the repository root, with Docker:

```sh
docker build -t rv32-tools .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools make board-sim board
```

- `make board-sim` lints the board top, then simulates it with Icarus Verilog twice: once with the real program image (must report PASS) and once with an image that has one wrong immediate (must report FAIL with cause 1).
- `make board-netlist-sim` runs the same testbench on the yosys iCE40 netlist, so the mapped `SB_RAM40_4K` cells, their initial contents and their falling-edge clocks are what gets simulated. It is slow, about ten minutes or more.
- `make board` writes `build/board/board.bin` and `reports/board.json`. The report script fails the build if the memories did not map to block RAM or if the post-route Fmax is below the 12 MHz target.

## Flash

`iceprog` needs direct USB access, so run it on the host. Install your distribution's icestorm package (`fpga-icestorm` on Debian and Ubuntu, `icestorm` on most others). On Linux you may need a udev rule for the FTDI device (vendor `0403`, product `6010`) or `sudo`.

The board has two programming modes, set by jumpers J6 and J7 (Lattice EB85 user guide, "Programming Options"):

| Mode | Jumpers | Command | Survives power-off |
|---|---|---|---|
| SPI flash | J7 1-2, J6 2-4, J6 1-3 | `make prog` | yes |
| FPGA RAM (CRAM) | J6 1-2, J6 3-4, J7 removed | `make prog-sram` | no |

After programming, the green CDONE LED (D10) lights when configuration succeeded.

## What the LEDs mean

`leds[i]` drives the schematic net LEDi; the pin list and sources are in `board/ice40hx8k-breakout.pcf`. Find the heartbeat LED first: it is the one that blinks slowly no matter what.

| LED | Meaning |
|---|---|
| LED0 | Heartbeat. Toggles every 2^23 cycles (0.7 s at 12 MHz). It runs even during reset, so it proves the bitstream loaded and the clock is running. |
| LED1 | Retired-instruction counter bit 22. Toggles about every 0.4 s at 12 MHz while the core executes. Stops changing if the core halts. |
| LED2 | **PASS.** At least one signature matched and no check has failed. |
| LED3 | **FAIL.** Latched until power-off or reprogramming. |
| LED4 to LED7 | On FAIL, the cause bits. On PASS, bits 13 to 16 of the pass counter, so they count up slowly. Off before the first pass. |

FAIL causes on LED4 to LED7:

| LED | Cause |
|---|---|
| LED4 | Wrong signature: the program computed a different value from the reference model. |
| LED5 | The core retired a trap. The program contains no trap, so this means it went off the rails. |
| LED6 | Watchdog: no signature store in 2^22 cycles (0.35 s at 12 MHz). |
| LED7 | Wrong retired-instruction count between two signature stores. |

A healthy board shows LED0 and LED1 blinking, LED2 on, LED3 off, and LED4 to LED7 counting.

## Serial output

The image transmits one line every 2^24 cycles (1.4 s at 12 MHz) at 115200 baud, 8N1, on FPGA ball B12. That pin connects to channel B of the board's FT2232H, which usually appears as the second USB serial port (`/dev/ttyUSB1` on Linux when no other adapters are present). Channel A is the programming interface.

```sh
picocom -b 115200 /dev/ttyUSB1
```

```
PASS c=0 n=00001f4e sig=5a978549 cyc=000006b6
```

- `PASS`, `FAIL`, or `WAIT` (no signature yet).
- `c` is the cause bits from the table above, as a hex digit.
- `n` is the number of passing loops since reset, in hex.
- `sig` is the last signature the program stored. A passing board prints the expected value from `reports/board.json` (`self_test.expected_signature`).
- `cyc` is the clock cycles the last loop took, in hex. In simulation it is `0x6b6` (1,718 cycles for 1,591 instructions).

## What the program checks

`tests/board_program.py` builds the image from the same generators and reference model as `make test`. It includes forwarding, ALU and immediate cases, every load and store width and offset, taken and not-taken branches of every kind, JAL, a position-independent JALR, a backward loop, the four DOT4 cases and one 300-instruction random program. After each case the program folds every register the case wrote into a running signature in x31. At the end it folds 64 words of data memory, stores x31 to address `0x2000`, and jumps back to the start. Each loop clears its registers and data first, so every loop must produce the same signature.

The expected signature comes from the Python reference model, not from the RTL. `board_top` compares each store to `0x2000` against it, and also checks that each loop retires exactly the reference model's instruction count.

## How the memories work

The core expects instruction and load data in the same cycle as the address (see `docs/ARCHITECTURE.md`). iCE40 block RAM registers its read. `board_top` clocks both RAMs on the falling edge: the core updates the address at the rising edge, the RAM samples it half a cycle later, and the data is ready at the next rising edge. The core sees exactly what a combinational memory would give, and the core itself is unchanged.

The cost is that address-to-RAM and RAM-to-register paths get half a clock period. nextpnr budgets these rising-to-falling paths at half a period. A small probe design confirmed this: the same block-RAM read path reported 135 MHz on a rising-edge RAM and 71 MHz on a falling-edge RAM. In this design the limiting path is still a full-cycle path inside the core, from writeback forwarding to the branch target, at 26.9 ns.

There is no reset button input. A power-on counter holds the core in reset for 2^16 cycles (5.5 ms at 12 MHz), because iCE40 block RAM can read as zero for a short time after configuration. With the PLL, the counter also waits for the PLL LOCK signal, which passes through a two-flip-flop synchronizer first. To rerun from reset, reprogram or power-cycle the board.

Yosys maps the memories to `SB_RAM40_4KNR` (program ROM, 15 cells) and `SB_RAM40_4KNRNW` (data RAM, 8 cells). The program ROM needs 15 cells, not 16, because bits 1:0 of every RV32I instruction are `11`, so yosys replaces that slice with a constant.

## Faster clocks with the PLL

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools make board-pll PLL_MHZ=30
make prog-pll        # on the host
```

`make board-pll` runs `icepll` for the requested frequency, builds with `SB_PLL40_CORE`, sets the UART divider for the new clock, and constrains place-and-route at that frequency. It writes `build/board/board-pll.bin` and `reports/board-pll.json`, and it fails if the post-route Fmax is below the target. At `PLL_MHZ=30` the post-route estimate is 36.7 MHz. The heartbeat, retire and pass-counter LEDs blink faster in proportion to the clock.

To find the highest clock that works on your board, step `PLL_MHZ` up (for example 30, 33, 36) and keep the highest value where the board shows PASS for several minutes. A clock above the reported Fmax may still pass on one board at room temperature; record it as a measurement, not as the design's rating.

## Recording a hardware run

Before writing "runs at X MHz on hardware", capture:

1. Board part number and serial number, and a photo of the board with the LEDs lit.
2. The git commit, `bitstream_sha256` from `reports/board.json` or `reports/board-pll.json`, and the clock (`12 MHz oscillator` or `PLL_MHZ=...`).
3. The LED state after at least one minute, and a short video showing LED0, LED1 and LED4 to LED7 changing.
4. At least three consecutive serial lines, including the `sig` and `cyc` fields.
5. How long it ran and the room temperature, roughly.

The claim is honest only for the clock and the bitstream hash you recorded.
