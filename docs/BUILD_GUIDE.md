# Extended build and research guide

**Original sprint:** [TWO_DAY_BUILD.md](TWO_DAY_BUILD.md) was the October 17–18 plan. This document is the optional deeper learning path after that sprint. The reference has since built the external checks, hazard cross, benchmark, ablation and board image these days describe; each day names the target and report to compare against. There is no earlier draft to recover.

This guide is for making the project your own: rebuilding the datapath, explaining hazards, designing experiments and earning claims you can defend in a lab conversation. The checked-in implementation is a working reference, not evidence that you personally spent three weeks constructing it. The user confirmed there was no original single-cycle draft. Treat this as a new project.

Plan for 15 focused workdays over three calendar weeks, roughly 2–3 hours a day plus one longer debug session each week (about 40–55 hours). If Verilog and synchronous logic are new, allow more time. Keep a daily research block; do not leave all reading until the start or all evaluation until the end.

## First run: no board or RISC-V toolchain required

Install Docker and Git. From the repository root:

```sh
docker build -t rv32-tools .
docker run --rm -v "$PWD:/work" rv32-tools make test lint coverage timing
```

These commands run the actual RTL in two simulators, compare it to a sequential Python model, collect core line coverage, map to iCE40 logic and place/route the registered measurement shell. Build logs and intermediate files appear in `build/`; machine-readable summaries appear in `reports/`. Docker may create files owned by root on Linux; run with `--user "$(id -u):$(id -g)"` if needed, after building the image. No root access is needed inside the container for the build steps.

Native alternative: install Python 3, GNU Make, Icarus Verilog, Verilator, a C++ compiler, Yosys and nextpnr with the iCE40 backend; run `make test lint coverage timing`. The baseline versions are in the reports. A different tool version may change mapping, timing and the coverage denominator; record it instead of silently reusing old numbers. Ubuntu packages in the Dockerfile are versioned by the distribution but not locked forever. For a publication, archive the built image digest and raw logs.

Read [ARCHITECTURE.md](ARCHITECTURE.md), then open `rtl/rv32_core.sv`, `tests/tb.sv`, and `tests/run.py` together. The testbench supplies combinational memories; the Python program supplies machine words and expected architectural behavior. `timing_top.sv` is a timing fixture, not the simulated system or an FPGA demo.

## A repeatable daily research loop

Spend the first 20–30 minutes reading one relevant primary source from [RESEARCH.md](RESEARCH.md). Write a question and prediction before changing code. Spend the main block implementing one mechanism and one experiment that could falsify your prediction. End with a test run and a short entry in [EXPERIMENT_LOG.md](EXPERIMENT_LOG.md). Preserve failures and explain why the fix works.

Every entry must contain source links, the source commit or RTL hash, tool versions, test seed/input, exact command, expected behavior, observed behavior and next action. A passing screenshot without the program or command is weak evidence. A cycle trace plus a reproducible failing test is useful evidence.

## Week 1: reconstruct the architecture and prove hazards

### Day 1 — Inventory and preserve the single-cycle baseline

There is no earlier draft. Use the current implementation as a documented reference baseline, or create a separate learning branch for an independent single-cycle version. List decoded instructions, reset PC, memory latency and stopping mechanism. Run the reference tests before editing it. Preserve any newly created baseline and its results separately.

Research: read the RV32I register, immediate and memory sections. Answer: which behavior belongs to the ISA and which belongs to your execution environment?

Deliverable: an executable baseline and a one-page contract. Gate: you can run a five-instruction program and explain every register/memory change. Proceed explicitly as a new implementation.

### Day 2 — Make the independent checker useful

Run `make test`. Inspect one generated `build/forwarding.hex` alongside `reference()` in `tests/run.py`. Hand-calculate ADD overflow, arithmetic right shift, signed versus unsigned comparison, JAL link values and signed-byte loads. Add at least two hand-calculated regression cases. The local oracle is not a replacement for reading the spec or an external architectural model.

Research question: could the reference and RTL both implement the same incorrect sign extension? Use independently calculated constants to break that correlation.

Deliverable: a test that would have caught a plausible wrong implementation. Gate: deliberately alter one expected result in your own test, observe a failure and restore it.

### Day 3 — Draw the pipeline registers

On paper, trace IF → ID → EX → MEM → WB. For each boundary list the PC, instruction, operands, destination, control bits and valid bit that must cross. In a learning branch, first pipeline independent instructions with NOP spacing. Compare retirement order and values to the single-cycle result.

Research question: why must the destination register and write-enable travel with the instruction? Deliverable: stage-by-stage trace. Gate: bubbles never change architectural state.

### Day 4 — Forwarding

Use the `forwarding` and `priority_x0` cases as starting points. Test rs1 and rs2 separately at distances one, two and three; add two writes to the same destination followed by a read. EX/MEM must beat MEM/WB when both match. Explain the same-edge WB-to-ID bypass.

Research question: which values exist early enough to bypass? Deliverable: a small dependency table and directed programs. Gate: ALU dependencies need no inserted NOPs, and writes to x0 are harmless.

### Day 5 — Load interlock and store dependencies

Run load → ALU, load → store data, load → store address, load → branch, and load → JALR programs. Count stall events. Under this project's combinational memory contract, an immediate load consumer needs one bubble; a nonconsumer must not stall. Immediate instruction bits that resemble rs2 are not a dependency.

Research question: why is forwarding the load's address wrong? Deliverable: a failing trace with the interlock temporarily disabled in a learning branch, then a passing trace after restoring it. Gate: the correct load data reaches each consumer; frozen PC/IF-ID and an invalid EX bubble are visible.

Weekend checkpoint: explain the memory contract without reading the RTL. A synchronous FPGA RAM cannot simply replace the testbench's asynchronous read.

## Week 2: control hazards, custom compute and coverage

### Day 6 — Branches, jumps and precise stopping

Test every conditional branch taken and untaken, a backward loop, JAL, JALR with bit zero set, misaligned targets and invalid instructions. Put a store and register write on the wrong path. Show they do not occur. A trap must let older work drain and discard younger work.

Research question: how many younger stages exist when EX redirects? Deliverable: trace with a wrong-path store absent. Gate: reference/RTL retirement order and all memory writes agree.

### Day 7 — Specify DOT4 before optimizing

Write the encoding and signed-lane math from [ARCHITECTURE.md](ARCHITECTURE.md) in your own words. Calculate `[1,2,3,4]·[1,1,1,1]`, all -128 lanes and mixed-sign cancellation by hand. Test a single active lane in each byte position. Other custom funct fields must trap.

Research question: why does the sum require more than 16 signed bits? Deliverable: instruction specification plus hand-calculated examples. Gate: the scalar oracle and RTL agree on extrema and lane order.

### Day 8 — Stress DOT4 and its pipeline interactions

Expand seeded random operands. In an additional exhaustive experiment, sweep all 65,536 signed-byte pairs in each isolated lane. `make dot4-sweep` is the reference version (`reports/dot4-sweep.json`); write yours before reading it. Add load → DOT4, DOT4 → DOT4, DOT4 → branch, DOT4 → store, both source ports and x0.

Research question: does the custom instruction reuse every hazard path correctly? Deliverable: seed/count/result report. Gate: no special software NOPs are required for DOT4.

### Day 9 — Measure coverage honestly

Run `make coverage`, inspect `reports/line-coverage.json`, then inspect the uncovered source point(s). Verilator instruments only a few dozen line/control points in this compact core (`total` in the report); the percentage is a narrow metric. It is not the fraction of all possible inputs tested. The separate functional bin plan covers instruction classes and branch outcomes. The reference's generated hazard cross (`tests/hazards.py`) is a separate plan.

Research question: what important bug could still survive 95% line coverage? Add a test for a missing scenario, not just to hit a line. Expand functional coverage with explicit hazard/operand crosses. Keep the original denominator and explain any revised plan. Deliverable: a coverage note with scope, numerator, denominator and limitations.

### Day 10 — Add invariants and external checks

Add simulator assertions for x0, no memory writes from invalid stages, PC/IF-ID stability during a stall, and younger instruction squash. Test reset while instructions are in flight. Use separate directed cases to check one-cycle stalls and absence of false stalls. The reference has these invariants in `tests/invariants.svh` and compares against Spike with `make isa-compare`. ACT4 and an RVFI adapter are still not integrated; investigate them using the official sources.

Research question: which failures cannot be detected by final register values alone? Deliverable: assertions and a negative test proving they fire. Gate: no unexplained failures in both simulators.

## Week 3: performance, implementation and a public artifact

### Day 11 — Establish a useful software baseline

Write a tiny scalar RV32I dot-product kernel with an explicit software signed multiply; RV32I has no MUL. Compare to DOT4 using identical packed inputs, output checks and included loop overhead. Count retired instructions, total cycles and stalls. Include packing and memory loads if they are part of the intended workload. Do not substitute a host Python timing or an RV32IM baseline.

Research question: do fewer instructions translate to fewer cycles for this workload? Deliverable: checked inputs/outputs and a cycle report for both kernels. Compare with the reference kernels in `scripts/bench.py` and `reports/benchmark.json`.

### Day 12 — Map and route

Run `make timing`. Inspect `build/synthesis.log`, `build/nextpnr.log` and `reports/implementation.json`. Explain each resource and the slowest internal path. The target is HX8K CT256, constraint 12 MHz, seed 1. The reported maximum is a post-route estimate under that placement, not a physical board measurement or a design optimized at that maximum target.

Research question: is the critical path the dot product or forwarding/decode? Deliverable: timing-path explanation. Gate: route completes with timing met at the requested constraint and no unaccounted optimization of core outputs.

### Day 13 — Run a controlled ablation

On a separate experiment branch, remove DOT4 or replace it with an explicitly trapping decode. Synthesize both configurations with identical shell, device, tool versions, constraints and seeds. Repeat with several seeds to see placement variability; keep the default reproducible run unchanged. Report resource delta and each configuration's own timing estimate. Convert cycles to estimated time only using the corresponding clock.

Research question: is the speedup worth the extra logic and possible clock reduction? Deliverable: matched baseline/extension report. `make ablation` and `reports/ablation.json` are the reference version. Do not call this an energy result without a power measurement/model.

### Day 14 — Optional board integration, or strengthen synthesis evidence

The open-source synthesis/route route already satisfies the project's no-board option. A physical demo is separate. Before buying a board, verify current availability, capacity, clock, supported open toolchain and programmer. This core uses most of an HX8K's logic in the measurement shell; do not assume a smaller iCE40 board fits.

For a board: replace the timing fixture with a real top, supply a board pin file and clock/reset circuit, adapt the memory interface for synchronous RAM, provide program loading and expose a signature/UART result. `rtl/board_top.sv` and [BOARD.md](BOARD.md) are the reference version; it has not run on hardware. Simulate that entire top before programming. Verify actual inputs/outputs and the configured hardware clock. Keep board costs and measured operation separate from synthesis estimates.

Without a board: reproduce from a clean clone, archive the raw timing report, investigate the critical path and review the unsupported behavior. Deliverable: reproducibility evidence or an actual board-demo procedure and observed result.

### Day 15 — Publish and prepare for technical discussion

Push the repository, check the GitHub Actions run and download its artifacts. Have someone follow the README from a clean environment. Record precisely which tests ran, their source revision/hashes and all limitations. Make a short demo showing one dependency trace, one DOT4 calculation and one critical-path report. Disclose which code was generated or assisted; claim the experiments and understanding you can demonstrate.

Use the recipient-specific guidance in [RESEARCH.md](RESEARCH.md) after verifying each full name. Link a real public artifact. For Das/Dreslinski, explain the measured compute/area tradeoff; for Austin, a verification finding; for Shahbaz/Chowdhury, a careful systems-evaluation connection. Do not imply this small core reproduces their labs' research.

## When to change the outreach sentence

For the current state, simulation and route only, use the exact outreach line in [RESEARCH.md](RESEARCH.md) and the numbers in the README's Results section. Say “estimated after place-and-route,” and name the coverage metric. Only say “running at X MHz” after a physical board runs a checked program at that clock ([BOARD.md](BOARD.md#recording-a-hardware-run)). Quote the workload speedup with its kernel and baseline. Never round a limited functional checklist into generic “test coverage.”

Before sending, you should be able to answer: why one load-use bubble, how forwarding priority works, what gets flushed, why DOT4 is signed, what the coverage denominator counts, what the timing shell excludes, and which observation would change your design decision.

## Debugging

- Retirement mismatch: the error names the program and first different retirement index. Inspect its `.hex` and rerun `vvp build/sim +program=build/NAME.hex` inside the tools container. PC/instruction identify the fault; earlier stores and producer instructions identify the dependency.
- Store mismatch with matching register values: inspect byte strobes, endianness, wrong-path execution and store data forwarding.
- Timeout: check branch offsets, target alignment and whether the EBREAK is reachable. Both model and RTL have bounded run limits.
- Coverage parser reports no points: inspect `build/merged.dat` and the installed Verilator version. Do not silently count testbench coverage as core coverage.
- Place/route failure: inspect capacity and the full nextpnr log. Lowering a requested frequency may meet a different constraint; record the new constraint and rerun instead of retaining the old headline.
- CI differs locally: compare tool versions, source hashes and seeds first. Docker rebuilds can receive newer distribution packages.
