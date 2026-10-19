# Five-stage RV32I core with DOT4

An educational SystemVerilog execution core with IF/ID/EX/MEM/WB stages, operand forwarding, a load-use interlock, EX-stage branch/jump flushing and a custom four-lane signed INT8 dot product. Includes an independent sequential Python checker, a Spike comparison, Icarus/Verilator regressions, coverage, a DOT4 benchmark, open-source FPGA mapping/route, an iCE40 board image and GitHub Actions.

**Measured:** 252 programs pass in Icarus and Verilator against a local reference model. The core matches Spike on 39/39 RV32I tests from riscv-arch-test 3.10.0. Generated hazard programs hit 327/327 hazard-cross bins, an RTL sweep checks all 262,144 isolated DOT4 lane pairs, and the checkers catch 23/23 deliberate RTL bugs. On an int8 dot-product kernel, DOT4 is 5.3× faster than the strongest pure-RV32I version after its clock cost. The post-route estimate on iCE40 HX8K is **35.76 MHz median over five route seeds** (33.85–37.08 MHz). **No physical board run has been performed.**

This project started from a placeholder README; there was no earlier core draft. The current implementation was generated with assistant support. See the [execution contract and limitations](docs/ARCHITECTURE.md).

## Run it

**Build everything:** `make all` (or just `make`). This runs the RTL verification and route, exports every textbook and slide deck, builds the visual lab, verifies the artifacts and creates `output/riscv-project.zip`. See [requirements and complete build guide](docs/BUILD_ALL.md). Open [the project entry point](output/START-HERE.html) after building.

For the RTL-only flow:

```sh
docker build -t rv32-tools .
docker run --rm -v "$PWD:/work" rv32-tools make test lint coverage timing
```

Or install the tools from `Dockerfile` and run `make test lint coverage timing` natively. Reports regenerate under `reports/`; detailed logs and programs appear under `build/`. The coverage target requires a C++ compiler. See the [step-by-step build guide](docs/BUILD_GUIDE.md) for setup and debugging.

## Results and what they mean

Measured with Icarus 12.0, Verilator 5.020, Spike (riscv-isa-sim `5a760667`), Yosys 0.33 and nextpnr-ice40 0.6, on the checked-in RTL. Source hashes are in each report. These numbers come from simulation and from a registered measurement shell, not from a board. The textbooks, slides and visual lab read the same reports at build time through `scripts/textbook/metrics.mjs`, and the textbook build fails if this README disagrees with them.

Verification:

- **Correctness:** 252 directed, random and generated hazard programs pass in both simulators. 11,924 retired instruction records and all byte writes match the local reference model. 20 deterministic random seeds. Testbench invariants (`tests/invariants.svh`) check x0, register writes, memory strobes, stall and flush on every one of 14,906 cycles. A second run checks the programs against a DOT4=0 core, where custom-0 must trap. [Verification report](reports/verification.json)
- **External reference:** 39/39 RV32I tests from riscv-arch-test 3.10.0, the last RISCOF-format release, produce the same signature as Spike, and 50 random programs match Spike's commit log on every retirement. A local runner drives both. This is not ACT4 and not certification, and Spike is the only external reference. [ISA comparison report](reports/isa-compare.json)
- **Hazard cross:** 108 generated programs hit 327/327 bins: 7 producer classes × 14 consumer operand slots × distance 1–3, plus x0 and wrong-path bins. [Verification report](reports/verification.json)
- **DOT4 sweep:** all 262,144 isolated signed lane pairs run through the full core in both simulators and match a scalar oracle. All 1,024 custom-0 encodings run from reset; the 1,023 unsupported ones trap with no side effect. Multi-lane sums are covered by directed and random programs, not exhaustively. [DOT4 sweep report](reports/dot4-sweep.json)
- **Mutants:** 23/23 single-bug edits to the RTL are caught by the checker each one targets: invariants, hazard programs or Spike signatures. [Mutation report](reports/mutation.json)
- **RTL coverage:** 37/38 core line instrumentation points = 97.37%, no exclusions. The unhit point is the invalid branch-funct3 default. This is Verilator's instrumentation metric, not 97.37% of possible behavior or architectural certification. [Line coverage report](reports/line-coverage.json)
- **Functional plan:** 46/46 instruction/branch-outcome/trap bins hit, separate from the hazard cross. [Bin definitions](reports/verification.json)

Performance and implementation:

- **DOT4 speedup:** for a 256-element int8 dot product, DOT4 takes 585 cycles. The strongest pure-RV32I kernel, a quarter-square table multiply, takes 3,403 cycles, and the shift-and-add baseline takes 14,589. Each cycle count is divided by its own core's median post-route Fmax (DOT4=1 against DOT4=0), so the speedup includes the clock DOT4 costs: 5.3× over quarter-square (4.7–5.7× pairing extreme seeds) and 22.6× over shift-and-add. The cycle counts come from Icarus simulation. The table baseline also uses 2 KiB of data memory that DOT4 does not. [Benchmark report](reports/benchmark.json), [ablation report](reports/ablation.json)
- **DOT4 cost:** against the same core built with DOT4=0, the unit adds 18% logic cells and costs 9% of median Fmax. [Ablation report](reports/ablation.json)
- **Mapped area:** 3,935 LUT4 primitives and 1,692 flip-flops; after packing, 5,497/7,680 iCE40 logic cells (71.6%). Zero block RAMs; the device has no hard DSPs. These are FPGA resources, not ASIC area. [Implementation report](reports/implementation.json)
- **Timing:** 35.76 MHz median internal post-route estimate over nextpnr seeds 1–5, range 33.85–37.08 MHz, for the `make timing` netlist. The official seed-1 report is 33.85 MHz. The 12 MHz constraint passes on every seed. The shell includes registered I/O and an observation register and excludes program/data memories and peripherals. Package pins and external I/O timing are unconstrained. This is a post-route estimate, not a tested board clock. A single seed can move by several MHz with no logic change, so quote the median and range. [Implementation report](reports/implementation.json), [raw nextpnr report](reports/raw/timing.json), [route log](reports/raw/nextpnr.log), [compressed synthesis log](reports/raw/synthesis.log.gz)
- **Board image:** `make board` builds a bitstream for the Lattice iCE40-HX8K Breakout with the program and data memories in block RAM. A self-test program checks its signature against the reference model and reports on the LEDs and UART. The self-test passes in RTL simulation, and the image routes at 36.92 MHz post-route against the board's 12 MHz oscillator. It has not run on a board. [Board guide](docs/BOARD.md), [board report](reports/board.json)

A line percentage alone is weak evidence: this compact source has only 38 instrumented points. The stronger evidence is ordered retirement and memory-write checking, the Spike comparison, and the mutants each checker catches. Still open: a physical board run, formal verification (riscv-formal with RVFI), ACT4 integration, and CSRs with privileged traps.

## Custom instruction

`DOT4 rd, rs1, rs2` uses custom-0 (`opcode=0x0b`, `funct3=0`, `funct7=0`):

```
rd = Σ signed8(rs1.byte[i]) × signed8(rs2.byte[i]), i = 0..3
```

The result is a signed 32-bit sum, without accumulation or saturation. All other custom-0 function combinations trap. It participates in ordinary forwarding and load-use handling. GNU assembler encoding: `.insn r 0x0b, 0, 0, a0, a1, a2`. [Full contract](docs/ARCHITECTURE.md)

## Scope

The core implements base integer arithmetic/control flow and byte/halfword/word memory operations. It assumes separate, combinational-read instruction and data memories. ECALL, EBREAK, illegal encodings and misalignment halt through a local trap record. There is no privileged trap handler, interrupt support, CSR implementation or memory wait-state protocol. The board image meets the combinational-read contract by clocking block RAM on the falling edge; it has not been validated on hardware. FENCE is a no-op under the stated single-hart ordered-memory contract; FENCE.I is absent.

## Learn, research and extend

**[Eight-part Anatomy visual lab](output/visual-lab/index.html)** — interactive instruments, checked RTL cycle traces, DOT4 calculator, verification comparator and current synthesis evidence. [Open/run guide](docs/visual-lab/README.md) · [Detailed build plan](docs/visual-lab/BUILD_PLAN.md).

The reset regression checks pending memory requests, pipeline clearing and restart, including reset during a load-use stall, a taken-branch redirect and a trap drain. Run `make reset-test`; requests are suppressed immediately while reset is asserted.

**[Eight hands-on build textbooks](docs/textbook/series/README.md)** — 114 pages across the project parts, with separate PDF/HTML volumes, implementation steps, runnable labs, debugging and research exercises. The books read their measured numbers from `reports/` when they are built. [Download the complete collection](output/textbook/riscv-build-textbooks.zip).

**[A Core You Can Explain: illustrated textbook](docs/textbook/README.md)** — 35 pages, interactive pipeline and DOT4 examples, worked answers, runnable labs and a 14-slide review deck.

- **[Two-day build sprint](docs/TWO_DAY_BUILD.md):** the original October 17–18 plan, with hands-on tests, research questions and a reproducible finish.
- [Longer build guide](docs/BUILD_GUIDE.md): optional deeper work after the sprint.
- [Research workflow and primary sources](docs/RESEARCH.md): questions spread across the work, plus qualified connections to Das, Dreslinski, Austin, Shahbaz and Chowdhury.
- [Architecture](docs/ARCHITECTURE.md): pipeline, memory contract, traps and DOT4 encoding.
- [Board guide](docs/BOARD.md): building, flashing and recording a first hardware run.
- [Experiment log](docs/EXPERIMENT_LOG.md): dated results, including the Spike comparison and the DOT4 benchmark, and a reusable lab-note template.

A truthful outreach line for the current, simulation-and-route-only state is:

> “A pipelined RV32I core with a custom int8 dot-product instruction that is 5.3× faster on a dot-product kernel after its clock cost, verified against Spike on the RV32I architecture tests, ~36 MHz post-route on iCE40 HX8K.”

Use “running at X MHz” only after a real board executes a checked program at that clock; [the board guide](docs/BOARD.md#recording-a-hardware-run) lists what to record first. Verify the recipient identities and understand the implementation before presenting it as personal research experience. MIT licensed.
