# Build sprint: October 17–18, 2026

This is the original sprint plan. The reference has since added a Spike comparison, a generated hazard cross, an RTL DOT4 sweep, a DOT4 benchmark and ablation, and an HX8K board image. The [README](../README.md) has the current numbers; the plan below points there instead of repeating them.

There is no earlier draft. Start here. The public repository already contains an assistant-generated reference implementation and measured reports. Your two-day goal is to run it, understand the main mechanisms, make and verify your own changes, and explain the evidence. Budget about 10–12 focused hours across today and tomorrow. Designing and independently verifying a complete processor from a blank file is a larger project, especially if synchronous RTL is new.

Use the open-source synthesis route for this deadline. A physical board demo is optional later. The reference now has an HX8K Breakout image ([BOARD.md](BOARD.md)) that has not run on hardware yet. The current measurements establish a working reference, not that you personally designed or verified every part.

## Today — bring it up and understand the pipeline (4–5 hours)

### 1. Run the reference — 45–60 minutes

From the repository directory:

```sh
git switch -c learning/two-day-core
docker build -t rv32-tools .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools make test lint
```

Open `rtl/rv32_core.sv`, `tests/tb.sv` and `tests/run.py`. Read the memory contract in [ARCHITECTURE.md](ARCHITECTURE.md). Save the command and result in [EXPERIMENT_LOG.md](EXPERIMENT_LOG.md).

Research question: what is supplied by the testbench, and what is actually implemented in the core? Identify the instruction memory, data memory, register file and retirement checker. Gate: the regression passes and you can locate each component.

### 2. Trace five instructions — 60 minutes

Read the pipeline reference linked in [RESEARCH.md](RESEARCH.md), then trace this program through IF, ID, EX, MEM and WB on paper:

```asm
addi x1, x0, 7
addi x2, x1, 1
add  x3, x2, x1
sw   x3, 128(x0)
ebreak
```

The expected results are x1=7, x2=8, x3=15 and memory word 128=15. Map each instruction to the existing `forwarding` test. Use the actual cycle order in the RTL, including when the registered retirement output appears.

Research question: why does the consumer need a value before its producer writes the register file? Gate: explain both forwarding sources and why the newer producer wins.

### 3. Add your first two tests — 90 minutes

In `suite()` in `tests/run.py`, add a small named program for each case using the existing encoders:

- Load immediately followed by a store using the loaded value: initialize a word, load it into a register, store that register elsewhere, and end with EBREAK.
- Taken branch with a store on the wrong path: the wrong-path address must remain untouched.

Before running them, write the expected register values, memory writes and control-flow path by hand. Run `make test lint` through the tools container. The existing checker compares every retirement and byte write.

Research question: why is a load address unsuitable for forwarding as loaded data, and which younger stages must a taken branch discard? Gate: both tests pass and you can explain why each would catch a specific hazard bug. These are architectural-result tests; separately checking exact stall counts is a later improvement.

### 4. Explain and test DOT4 — 45–60 minutes

Read the DOT4 contract in [ARCHITECTURE.md](ARCHITECTURE.md), then calculate `0x01020304 DOT4 0x01010101 = 10`. Also calculate the all--128 case: four products of 16384 sum to 65536. Add a mixed-sign case with a hand-calculated answer and a dependent consumer. Use `r(0, rd, rs1, rs2, op=0x0b)` to encode DOT4 in the local test generator.

Research question: how does each byte become signed, and why is a signed 16-bit result insufficient? Gate: explain the encoding, lane interpretation, result range and how DOT4 uses ordinary hazard handling.

Commit your tests and notes. Tonight's stopping point is a passing regression plus an explanation of forwarding, one load-use bubble, branch flushing and DOT4. Do not expand into a compiler backend or board wiring tonight.

## Tomorrow — collect evidence and finish the artifact (5–7 hours)

### 5. Reproduce coverage — 45–60 minutes

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools make coverage
```

Inspect `reports/line-coverage.json` and `reports/verification.json`. The README lists the reference line instrumentation figure and the separate functional and hazard-cross plans, read from these same reports. Your additional tests change program and retirement counts. Record your own regenerated results.

Research question: what bug could survive high line coverage? Write one example. Gate: distinguish passing-test count, line instrumentation coverage and functional bins; do not describe the percentage as exhaustive correctness.

### 6. Reproduce FPGA mapping and timing — 60–90 minutes

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools make timing
```

Read `reports/implementation.json`, `build/synthesis.log` and `build/nextpnr.log`. Find logic-cell use, LUTs, flip-flops, the requested 12 MHz constraint and achieved internal timing estimate. Inspect the reported slowest path instead of assuming DOT4 is the bottleneck.

Research question: what does this estimate exclude? Gate: explain that the registered shell excludes memories/peripherals and has unconstrained external I/O. Compare your seed-1 result with the README; route estimates move with the seed, and none of them is measured board operation.

### 7. One controlled experiment — 90–120 minutes

Choose one, finish it, and preserve the before/after evidence:

- Verification focus: add an explicit invalid branch-funct3 instruction test and show that it retires as a trap and suppresses a following store. Check whether the previously uncovered control point becomes covered. Explain the defect it would detect; the percentage is secondary.
- Architecture focus: in a separate temporary worktree, deliberately disable one forwarding source. Predict the first failing program, observe the mismatch, and explain it. Keep the working implementation on your learning branch; retain the failure log as evidence.

Research question: did the observation match your prediction? Gate: a short experiment entry with input, command, result and explanation. The reference's DOT4 benchmark and ablation came after the sprint; do not present them as your sprint results.

### 8. Reproduce, document and demonstrate — 90–120 minutes

Run `make test lint coverage timing` through the tools container after your final changes. Update the README's program counts, coverage and resource/timing numbers from the regenerated reports; link the evidence. Commit your source/tests/notes/reports and push your learning branch. If you merge it into main, check GitHub Actions passes there as well.

Make a three-minute demonstration: one forwarding/load-use example, one wrong-path store that does not happen, one DOT4 result, and the timing/area report. Explain one remaining limitation. Mention the reference implementation and your specific additions when discussing the work.

Gate: another person can follow the commands and you can explain the results without reading a prepared claim.

## Completion by tomorrow

You have a public, reproducible educational five-stage core with hazard handling, DOT4, your added tests, your experiment notes and open-source FPGA implementation evidence. No board purchase is required. A defensible outreach description names the measured coverage metric and calls frequency a post-route estimate.

If setup or debugging consumes the available time, prioritize passing tests and understanding the pipeline. Use the existing measured reports as reference results until you reproduce them yourself. A two-day deadline does not turn unperformed experiments into completed work. The [longer guide](BUILD_GUIDE.md) covers external ISA checks, stronger assertions, workload benchmarks and board integration. The reference has since built each of these, so you can reproduce them and compare your results.
