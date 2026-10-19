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

## 2026-10-19 — External ISA comparison, hazard cross, invariants, DOT4 sweep, reset

Question: does the core still agree when the oracle is not our own Python model, and do the new checks catch the bugs they claim to catch?

All commands run in the tool image: `docker build -t rv32-tools .`, then `docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools make test reset-test dot4-sweep isa-compare mutants lint coverage`. The RTL is unchanged (sha256 `cf82d634…`). No RTL bug was found.

External reference. The image builds Spike from riscv-isa-sim commit `5a760667bf0d0ab893173b9eeff9c109c8d7dd9a` and adds Ubuntu's `riscv64-unknown-elf-gcc` 13.2.0. It fetches riscv-arch-test tag `3.10.0` (tarball sha256 `8d8562c3…`), the last RISCOF-format release. This is not ACT4 and not certification: a local runner (`tests/isa_compare.py`) assembles each test twice from the same source, once for Spike (linked at 0x80000000, tohost halt) and once for the core (linked at 0, ECALL halt, `tests/isa/dut/model_test.h`). The core must reach the ECALL with no earlier trap, and its signature region must equal Spike's `+signature` dump. Result: 39/39 RV32I tests match in Icarus and Verilator, 12,720 signature words. Exclusions: none. No test needed CSRs or a trap handler; `misalign1-jalr-01` clears bit 0 and stays aligned.

Spike commit logs. 50 seeded random programs of 300 operations (ALU, LUI, loads, stores, branches, JAL x0) run on Spike with `--log-commits`. 16,908 retirements (PC offset, word, register write) and 5,091 store bytes match the RTL in both simulators. Excluded by design: DOT4 (Spike does not know it), AUIPC and link values (Spike runs at 0x80000000, the core at 0). The existing directed programs address data from x0 at low addresses, which Spike maps to its debug module, so they do not run on Spike.

Hazard cross. `tests/hazards.py` generates 108 programs. The cross is measured on the reference trace of every program: 7 producers (ALU, load, JAL link, JALR link, LUI, AUIPC, DOT4) x 14 consumer operand slots (ALU, branch and DOT4 rs1/rs2/both; JALR base; store address/data/both; load address) x distance 1-3, plus 21 x0 false-dependency bins and 12 redirect bins (wrong-path read, wrong-path load-use, wrong-path store, target read for branch/JAL/JALR). 327/327 bins hit. The original 144 programs hit 103 of them. Each consumer is built so a missed forward changes an observable result, and the tested register holds an odd poison value first.

Invariants. `tests/invariants.svh` runs in every `tests/tb.sv` program, the arch-test bench and the DOT4 bench: x0 stays zero, registers change only through a valid non-trap WB commit that matches the retirement record, every load/store strobe belongs to an instruction that later retires (no squashed-path access), retirement follows program order and program memory, a stall holds IF/ID and inserts one bubble, a flush squashes IF/ID and EX, stall and flush never coincide, nothing is fetched after halt. 14,906 cycles checked in `make test`.

DOT4. `make dot4-sweep`: all 65,536 signed byte pairs in each lane with the other lanes zero, 262,144 DOT4 instructions through the full core. Each retirement is checked against a scalar product, each EX operand pair against the expected bytes, and the ordered FNV checksum (`475d6000`) against a Python scalar oracle. Both simulators pass (1,840,145 cycles; Verilator 0.6 s, Icarus 121 s). All 1,024 custom-0 funct3/funct7 encodings run from reset: 1,023 trap with no register or store effect, funct3=0/funct7=0 executes.

Reset. `tests/reset_tb.sv` adds reset during a load-use stall (with a store pending), during a taken-branch redirect, and during a trap drain (EBREAK in EX, store in MEM). Predicted store counts (1, 2, 3, then 5 after restart) matched.

Mutation. `make mutants` applies 23 single-bug edits to a copy of the RTL. 8/8 invariant mutants stop the simulation through an invariant alone, 8/8 hazard mutants fail the generated programs, 7/7 ISA mutants (SRA logical, SLTU signed, LH zero-extend, JALR keeps bit 0, BGE strict, AUIPC without PC, SB wrong lane) fail an arch-test signature against Spike. Of the hazard mutants, only "no load-use stall for JALR" escaped the original 144 programs. Removing `!m_load` from MEM forwarding is an equivalent mutant (the stall keeps consumers out of EX) and is not counted.

Regression now: 252 programs, 11,924 checked retirements, 46/46 instruction bins, 97.37% core line coverage (37/38, unchanged). Reports: `reports/verification.json` (new hazard and invariant fields), `reports/isa-compare.json`, `reports/dot4-sweep.json`, `reports/mutation.json`. The rtl phase of `scripts/build.sh` runs all of these; `scripts/release/build.py` requires them.

Limits: Spike is the only external reference; the arch tests check signatures, not every intermediate state; the invariants are white-box and read pipeline registers by name; multi-lane DOT4 sums are covered by directed and random programs, not exhaustively.
