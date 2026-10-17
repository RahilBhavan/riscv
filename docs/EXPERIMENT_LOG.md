# Experiment log

## Initial implementation — 2026-10-17

The workspace initially contained only a placeholder README and icon. No week-one core or remote was present. A new educational implementation, test oracle and open-source implementation flow were created. This is not a measurement of the missing draft and does not establish improvement over it.

Question: does the pipeline preserve sequential architectural behavior under the supplied memory contract?

Method: directed instruction/hazard/trap cases plus 20 seeded random programs; compare each retired PC, instruction, destination, value and trap flag, and the complete ordered byte-write stream. Run in Icarus and Verilator. See `reports/verification.json` for counts, `tests/run.py` for inputs/oracle, and `build/regression.log` after reproducing.

Question: can the design map and route on an inexpensive FPGA family using open tools?

Method: registered measurement shell, iCE40 HX8K CT256, 12 MHz target, seed 1. See `reports/implementation.json` and raw routing evidence. Excludes memories and board peripherals. No board was connected or programmed.

Question: what coverage is actually collected?

Method: Verilator core-only line instrumentation, no source exclusions; count nonzero points over total points. Functional bins are a separate fixed 46-bin instruction/outcome plan. Neither metric establishes architectural certification, exhaustive operand coverage or hazard-cross completeness.

Open work: recover original draft; external ISA-model/ACT4 integration; simulation invariants and mid-flight reset tests; broader hazard crosses; exhaustive isolated DOT4 lane sweep; matched RV32I scalar/DOT4 kernel benchmark; DOT4 area/timing ablation; synchronous-memory/board integration. The build guide distributes these across the learning workflow.

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
