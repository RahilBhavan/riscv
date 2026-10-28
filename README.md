# Five-stage RV32I core with DOT4: an educational SystemVerilog CPU checked against Spike in simulation

[![Build complete project](https://github.com/RahilBhavan/riscv/actions/workflows/verify.yml/badge.svg)](https://github.com/RahilBhavan/riscv/actions/workflows/verify.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![The five-stage pipeline view of the visual lab at cycle 4 of a recorded RTL trace: four stage carriers hold valid instructions and the fifth is still empty](docs/images/visual-lab-pipeline.png)

This is a five-stage (IF/ID/EX/MEM/WB) RV32I core in SystemVerilog with forwarding, a load-use interlock, EX-stage branch flushing and a custom signed int8 dot-product instruction, DOT4. Parameters add the M extension (MEXT), Zicsr with machine-mode traps and interrupts (ZICSR), and both memory ports take a ready handshake for wait states; the defaults keep the RV32I+DOT4 core described below. The repository checks the core in Icarus and Verilator against a Python reference model and against Spike, runs riscv-formal bounded model checks on its RVFI trace, and maps it to a Lattice iCE40 HX8K with Yosys and nextpnr. All results come from simulation and place-and-route. The FPGA figures are estimates, **36.05 MHz median over five route seeds** (34.63–37.60 MHz), and no board has run the core.

## Results

Measured on the checked-in RTL with Icarus 12.0, Verilator 5.020, Spike (riscv-isa-sim `5a760667`), Yosys 0.33 and nextpnr-ice40 0.6. Each report records the SHA-256 of the sources it measured. [`docs/RESULTS.md`](docs/RESULTS.md) has the method and limits behind every row.

| Check | Result | Source |
| --- | --- | --- |
| Correctness | 253 directed, random and generated hazard programs pass in both simulators; 11,928 retired instruction records match the reference model over 20 deterministic random seeds | `reports/verification.json` |
| Extended core (MEXT=1 ZICSR=1) | 309 programs pass, with and without wait states; 71/71 functional bins | `reports/verification-extended.json` |
| Spike comparison | 39/39 RV32I tests from riscv-arch-test 3.10.0 match; the extended core matches 62/62 tests. Not certification | `reports/isa-compare.json` |
| Formal | 45/45 riscv-formal checks pass on the default core and 53/53 on the extended core (bounded, not unbounded proofs) | `reports/formal.json` |
| Mutants | The targeted checkers catch 38/38 single-bug RTL edits | `reports/mutation.json` |
| DOT4 speedup | 5.2× over a quarter-square kernel after its clock cost (585 against 3,403 cycles for 256 int8 elements) | `reports/benchmark.json` |
| Area | 5,539/7,680 iCE40 logic cells (72.1%) | `reports/implementation.json` |
| Timing estimate | 36.05 MHz median over five route seeds (34.63–37.60 MHz); post-route estimate, no board has run | `reports/implementation.json` |

## How it works

- `rtl/rv32_core.sv` is the core. EX takes operands from EX/MEM, then MEM/WB, then ID/EX. A load followed directly by a consumer stalls one cycle. Taken branches and jumps resolve in EX and squash the two younger stages. ECALL, EBREAK, illegal encodings and misaligned accesses halt through a local trap record. With ZICSR=1 they enter `mtvec` instead, and interrupts enter between instructions.
- With MEXT=1, an iterative unit computes each M operation while EX holds for 34 cycles. Either memory port can hold the pipeline by withholding `ready`; [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) gives the interface contract.
- DOT4 uses custom-0 (`opcode=0x0b`, `funct3=0`, `funct7=0`): `rd = Σ signed8(rs1.byte[i]) × signed8(rs2.byte[i])` for `i = 0..3`, with no accumulation or saturation. The GNU assembler form is `.insn r 0x0b, 0, 0, a0, a1, a2`.
- `tests/run.py` generates the programs, runs them on `tests/tb.sv` and compares every retirement and byte write with its own sequential model. `tests/isa_compare.py`, `tests/dot4_sweep.py` and `tests/mutants.py` add Spike, the lane sweep and the mutants. `scripts/formal.py` runs riscv-formal with `formal/wrapper.sv`.
- `rtl/timing_top.sv` and `rtl/timing_top_extended.sv` are the registered shells for synthesis and route. `rtl/board_top.sv` is the board image.
- `scripts/build.sh` (`make all`) runs the RTL steps in Docker, then builds the textbooks, visual lab, figures and release ZIP from `reports/`.

## Interactive figures

Each page is self-contained and reads its numbers from `reports/` and its cycle-by-cycle behaviour from the RTL traces in `reports/visual-traces.json`. They are hosted at [rahilbhavan.com/riscv](https://rahilbhavan.com/riscv) and also work offline from a clone. `make figures` rebuilds them, and `make publish-site SITE=<website checkout>` copies them into the site.

- [Pipeline machine](https://rahilbhavan.com/riscv/pipeline-machine): the five stages as an isometric machine. Step six recorded traces and watch stalls, flushes and forwarding.
- [Why a load stalls](https://rahilbhavan.com/riscv/load-use-explainer): a stepped explainer of the load-use interlock, with a "try it" model checked against the traces.
- [DOT4 machine](https://rahilbhavan.com/riscv/dot4-machine): edit the eight lane bytes and follow them through the multipliers and adder tree. It also plays the board self-test, which has only run in simulation.
- [Evidence charts](https://rahilbhavan.com/riscv/evidence): cycles, speedup after clock cost, Fmax per seed, area and hazard coverage. Static SVG copies are in `output/figures/evidence/svg/`.
- [Write-up](https://rahilbhavan.com/riscv/post) and a [20-second video](https://rahilbhavan.com/riscv/video/riscv.mp4) (`make figure-video`).

## Run it

You need Docker. The `Dockerfile` pins Ubuntu 24.04 and its Icarus, Verilator, Yosys and nextpnr-ice40 packages, builds Spike from a pinned commit and fetches riscv-arch-test 3.10.0 by checksum. No credentials are needed.

```sh
git clone https://github.com/RahilBhavan/riscv.git
cd riscv
docker build -t rv32-tools .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools make test lint reset-test
```

`make test` runs the regression in Icarus with DOT4=1, with DOT4=0 and on the MEXT=1 ZICSR=1 core, each program also with random wait states. On 2026-10-24, 253 programs pass in each default-core run, and lint and `make reset-test` are clean. No physical board has run. `make test` writes only to `build/`; `make coverage` also rewrites the committed `reports/verification*.json` and `reports/raw/regression*.log`. [`docs/RESULTS.md`](docs/RESULTS.md) records the full `make all` rerun of 2026-10-25.

The other evidence targets use the same image:

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools \
	make coverage timing timing-extended isa-compare dot4-sweep mutants bench ablation board-sim board
```

riscv-formal runs in a second image layered on the first, with a pinned OSS CAD Suite and riscv-formal commit. The full run takes about six minutes on a 32-thread host:

```sh
docker build -f formal/Dockerfile --build-arg TOOLS=rv32-tools -t rv32-formal .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work rv32-formal make formal
```

`make all` runs everything, then builds the textbooks, visual lab, interactive figures and `output/riscv-project.zip`. It also needs Node.js 22 or newer, Chromium and Poppler on the host. See [`docs/BUILD_ALL.md`](docs/BUILD_ALL.md), then open [`output/START-HERE.html`](output/START-HERE.html).

## Repository layout

- `rtl/`: the core, the timing shells and the board top.
- `formal/`: the riscv-formal wrapper, check depths and image.
- `tests/`: testbenches, invariants, program generators, the Spike comparison, the DOT4 sweep and the mutants.
- `scripts/`: report, benchmark and ablation scripts, and the textbook, visual-lab and release builders.
- `reports/`: checked-in JSON reports and raw route and synthesis logs.
- `board/`: pin constraints for the iCE40-HX8K Breakout.
- `docs/`: architecture, build guides, research workflow, experiment log, textbook sources and the visual-lab plan.
- `output/`: built textbooks, visual lab, interactive figures, start page and release ZIP.
- `assets/`: the project icon.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): pipeline, hazards, memory contract, traps, DOT4 encoding and measurement boundary.
- [Build the whole project](docs/BUILD_ALL.md): requirements, build order and outputs of `make all`.
- [Extended build and research guide](docs/BUILD_GUIDE.md): a 15-day path to rebuild the datapath, design experiments and earn claims you can defend.
- [Research and experiment workflow](docs/RESEARCH.md): primary sources for each stage and how to keep proposed experiments apart from results.
- [Two-day build sprint](docs/TWO_DAY_BUILD.md): the original October 17–18 plan.
- [Board guide](docs/BOARD.md): build, flash and record a first hardware run.
- [Experiment log](docs/EXPERIMENT_LOG.md): dated results, including the Spike comparison, benchmark and ablation.
- [Illustrated textbook](docs/textbook/README.md) and [build series](docs/textbook/series/README.md): a 35-page overview and eight volumes of 114 pages.
- [Visual lab](docs/visual-lab/README.md): open and rebuild the eight-part interactive lab.
- [Documentation index](docs/README.md): every file in `docs/`.

## Sources

- **riscv-arch-test 3.10.0** from [riscv-non-isa/riscv-arch-test](https://github.com/riscv-non-isa/riscv-arch-test), fetched by tag and checked against a SHA-256 in the `Dockerfile`.
- **Spike** from [riscv-isa-sim](https://github.com/riscv-software-src/riscv-isa-sim) commit `5a760667bf0d0ab893173b9eeff9c109c8d7dd9a`, also checked against a SHA-256.
- **riscv-formal** commit `c992aa61` and **OSS CAD Suite** 2026-10-24, checked against SHA-256s in `formal/Dockerfile`.
- **Tools** from Ubuntu 24.04 packages. The implementation, ablation, board, line-coverage and ISA-comparison reports record their versions.

The regression programs are generated in Python and use no external data.

## Scope and limits

- This is independent educational work. It is not affiliated with RISC-V International, Lattice or any lab named in the docs.
- The project started from a placeholder README with no earlier core draft. The implementation was generated with assistant support.
- All FPGA timing figures are post-route estimates. No board has run the core (`board_tested: false` in `reports/board.json`).
- The core assumes separate instruction and data memories that answer in the cycle `ready` is high, with at most one outstanding request per port. ZICSR=1 adds machine mode only: no user mode, delegation, counters (`mcycle`, `minstret`) or PMP. In simulation the interrupt lines change only when a store completes. FENCE is a no-op, and FENCE.I is absent.
- The formal checks are bounded, exclude CSR instructions and check M arithmetic only through Spike. The project has no ACT4 integration and no certification.
- The board image and the published figures use the default core. The extended core has not been built into a board image.
- The DOT4 speedup covers one kernel. The table baseline also uses 2 KiB of data memory that DOT4 does not.
- `reports/raw/regression.log` and `reports/raw/regression-extended.log` are written by the same `tests/run.py` runs as `reports/verification.json` and `reports/verification-extended.json`. `scripts/textbook/check-readme.mjs` checks that each holds one PASS line per program counted there.

## License

MIT. See [LICENSE](LICENSE). It covers this project's code, not riscv-arch-test or Spike.

Part of [Rahil Bhavan's projects](https://github.com/RahilBhavan).
