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
