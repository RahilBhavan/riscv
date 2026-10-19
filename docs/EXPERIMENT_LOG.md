# Experiment log

## Initial implementation — 2026-10-17

The workspace initially contained only a placeholder README and icon. No week-one core or remote was present. A new educational implementation, test oracle and open-source implementation flow were created. The user subsequently confirmed there is no earlier draft. These are baseline measurements of the new implementation.

Question: does the pipeline preserve sequential architectural behavior under the supplied memory contract?

Method: directed instruction/hazard/trap cases plus 20 seeded random programs; compare each retired PC, instruction, destination, value and trap flag, and the complete ordered byte-write stream. Run in Icarus and Verilator. See `reports/verification.json` for counts, `tests/run.py` for inputs/oracle, and `build/regression.log` after reproducing.

Question: can the design map and route on an inexpensive FPGA family using open tools?

Method: registered measurement shell, iCE40 HX8K CT256, 12 MHz target, seed 1. See `reports/implementation.json` and raw routing evidence. Excludes memories and board peripherals. No board was connected or programmed.

Question: what coverage is actually collected?

Method: Verilator core-only line instrumentation, no source exclusions; count nonzero points over total points. Functional bins are a separate fixed 46-bin instruction/outcome plan. Neither metric establishes architectural certification, exhaustive operand coverage or hazard-cross completeness.

Open work: external ISA-model/ACT4 integration; simulation invariants and mid-flight reset tests; broader hazard crosses; exhaustive isolated DOT4 lane sweep; matched RV32I scalar/DOT4 kernel benchmark; DOT4 area/timing ablation; synchronous-memory/board integration. The build guide distributes these across the learning workflow.

## Active build sprint — October 17–18, 2026

The user wants to build and understand the project today and tomorrow. Follow [TWO_DAY_BUILD.md](TWO_DAY_BUILD.md). Priorities: reproduce the reference, add personal directed tests, explain hazards and DOT4, perform one controlled experiment, and rerun coverage and synthesis. There is no draft to recover. Hardware board integration and broader research experiments are follow-up work. User-performed work and measurements should be recorded below as they happen.

## Copy this template for every new experiment

- Date and question:
- Primary source and section:
- Prediction and why:
- Git commit and source hashes:
- Tool versions, target and seed:
- Exact command and program/input:
- Controlled variable and fixed conditions:
- Expected result:
- Observed result and raw artifact path:
- Failure or limitation:
- Decision and next experiment:

## 2026-10-18 — Reset hardening and executable visual lab

Question: can an external memory endpoint observe a pending request while the core is resetting? The old core failed `tests/reset_tb.sv` at time 61: a pending store strobe remained asserted after reset went high. The fix gates both read enable and byte write strobes with `!reset`; architectural/pipeline state still resets synchronously.

The regression now checks pending store suppression before the next edge, pending load suppression, pipeline clearing, register/PC clearing, and successful restart. The old source was obtained with `git show HEAD:rtl/rv32_core.sv` before the fix commit; the failing simulation is deliberately not part of the passing CI target.

All 144 differential programs and 16 supplemental teaching checks pass. Verilator core line instrumentation remains 37/38 (97.37%, no exclusions). The same HX8K CT256 shell, 12 MHz constraint and route seed 1 produces 37.0768585 MHz internal Fmax, 3,962 LUT4, 1,692 FF, and 5,555/7,680 packed logic cells. The prior baseline was 34.7415 MHz / 5,554 cells. This route difference is not evidence of a general speed improvement; placement/routing changes with the netlist. No board execution or workload speedup is claimed. Current source hashes and tools are in the reports.

The eight-part visual lab embeds six real RTL traces. Each trace is checked against the sequential oracle before export. Other instruments are labeled teaching analogies. JavaScript model checks include all byte representations and 262,144 isolated lane pairs; those sweeps exercise the teaching calculator, not exhaustive RTL behavior. Historical textbook PDFs retain the earlier 34.74 MHz baseline; the README and visual lab expose current evidence.

## 2026-10-19 — DOT4 speedup, area and clock cost

Question: does DOT4 speed up an int8 dot product once the clock it costs is counted? Hypothesis from RESEARCH.md: fewer instructions, lower clock.

Method. `scripts/bench.py` (`make bench`) generates four kernels over the same packed int8 vectors (A at 0x1000, B at 0x2000, uniform random, seed 2026), each looping once per 32-bit word and storing the int32 sum to 0x100. `dot4` uses LW, LW, DOT4, ADD. `rv32i_shift` is the specified baseline: LW, SLLI/SRAI sign extension and the libgcc `__mulsi3` shift-and-add loop, inlined, with operands negated so the multiplier stays in 0..128. `rv32i_lb` replaces the shifts with LB. `rv32i_qsquare` uses LB and a quarter-square table, ab = floor((a+b)^2/4) - floor((a-b)^2/4), from a 2,048-byte table present in every memory image. Nothing is unrolled across words. Every run must match a plain Python dot product at the output word, and its retirement trace and byte stores must match the `tests/run.py` reference model. Every run satisfies cycles = retired + load-use stalls + 2 × flushes + 3; all kernels are scheduled so no run stalls. Cycles run from reset release through the EBREAK retirement, so they include setup and pipeline fill.

`scripts/ablation.py` (`make ablation`) runs the `make timing` commands for three configurations with nextpnr seeds 1 to 5. Setting the new `DOT4` parameter through `chparam` alone changes the Yosys netlist of identical logic, so the compared pair (`dot4_1`, `dot4_0`) both use `chparam`. The unchanged default flow is a third configuration; its seed 1 must reproduce `reports/implementation.json` exactly, and it does. Throughput is median Fmax divided by cycles, with baselines on the DOT4=0 core and DOT4 on the DOT4=1 core.

Cycles (Icarus RTL simulation):

| N | rv32i_shift | rv32i_lb | rv32i_qsquare | dot4 | speedup vs qsquare | vs shift |
|---|---|---|---|---|---|---|
| 16 | 897 | 865 | 223 | 45 | 4.96× | 19.93× |
| 64 | 3,789 | 3,661 | 859 | 153 | 5.61× | 24.77× |
| 256 | 14,589 | 14,077 | 3,403 | 585 | 5.82× | 24.94× |

Implementation (timing_top shell, HX8K CT256, 12 MHz constraint, seeds 1 to 5):

| Configuration | LUT4 | SB_DFF* | SB_CARRY | Logic cells | Fmax min / median / max (MHz) |
|---|---|---|---|---|---|
| dot4_1 (chparam) | 4,098 | 1,692 | 371 | 5,627 / 7,680 | 34.12 / 36.87 / 38.75 |
| dot4_0 (chparam) | 3,168 | 1,692 | 387 | 4,759 / 7,680 | 39.59 / 40.67 / 42.34 |
| dot4_1 default flow | 3,935 | 1,692 | 427 | 5,497 / 7,680 | 33.85 / 35.76 / 37.08 |

DOT4 costs 930 LUT4 and 868 logic cells (18% of the DOT4=0 shell) and 3.8 MHz median Fmax (9.3%). The same logic moves 163 LUT4 and 1.1 MHz median between synthesis entry routes, so the area delta is well outside that noise. The five-seed Fmax ranges of the pair do not overlap (rank-sum U = 0, two-sided p ≈ 0.008). Seed 1 critical paths: DOT4=0 runs from the forwarding mux through a 29-hop carry chain into the PC enable (branch resolution); DOT4=1 is a 16-LUT cone with no carries starting at the same forwarding mux, 69% routing delay. That the DOT4=1 cone is the multiplier tree is inferred from its shape, not identified by name.

Clock-adjusted throughput at median Fmax: N = 256 gives 63,029 dot products/s (16.1 M MAC/s) with DOT4 against 11,951/s (3.06 M MAC/s) for `rv32i_qsquare`, a 5.27× advantage (4.69× to 5.69× pairing extreme seeds). Against the specified shift-and-add baseline it is 22.6× (20.1× to 24.4×). At N = 16 the qsquare advantage is 4.49× because setup is a larger share.

Limiters. DOT4 spends 9 cycles per word: 7 instructions plus 2 squashed slots for the taken loop branch; DOT4 itself is 1 of the 9. The quarter-square baseline spends 53 cycles per word: 12 instructions per element plus 3 of loop control. Shift-and-add spends 55 (LB) to 57 (shift) cycles per element, about 30% of them squashed slots after taken branches, and is data dependent: the 16-element extremes vector costs 1,185 cycles instead of 897. Unrolling should shrink DOT4's loop overhead more than the baselines' (inferred, not measured), so these speedups are not an upper bound. The first quarter-square table covered only -255..255; the -128 × -128 extremes vector caught it at the output check while the trace check passed, because the reference model read the same wrong table.

Limits. These are simulation cycle counts and post-route estimates for a measurement shell, not board measurements. The core assumes combinational memories; FPGA block RAM is synchronous, so a board system would add load latency that hits the LB-heavy baselines harder. The table baseline spends 2 KiB of data memory that the DOT4 version does not. Declaring the `DOT4` parameter alone moved the official seed-1 result from 37.08 MHz / 3,962 LUT4 / 5,555 cells to 33.85 MHz / 3,935 LUT4 / 5,497 cells with no logic change; a `` `ifndef `` macro would have kept the old netlist. Single-seed Fmax should not be quoted alone.

Commands, in the Docker tool image: `make test timing bench ablation`. Bench takes about 3 s; the ablation runs 3 syntheses and 15 parallel nextpnr jobs in about 80 s wall on a 32-thread host at load average 30. `make test` now also runs `tests/run.py --no-dot4`, which checks all 144 programs against the DOT4=0 core with custom-0 trapping.
