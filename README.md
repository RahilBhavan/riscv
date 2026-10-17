# Five-stage RV32I core with DOT4

An educational SystemVerilog execution core with IF/ID/EX/MEM/WB stages, operand forwarding, a load-use interlock, EX-stage branch/jump flushing and a custom four-lane signed INT8 dot product. Includes an independent sequential Python checker, Icarus/Verilator regressions, coverage, open-source FPGA mapping/route, and GitHub Actions.

**Measured:** 97.37% core line-instrumentation coverage (37/38 Verilator points), 144 passing programs / 7,358 checked retired instructions, and **34.74 MHz estimated internal Fmax** after place-and-route on iCE40 HX8K CT256. The 12 MHz timing constraint passed. **No physical board run has been performed.**

This project started from a placeholder README; there was no earlier core draft. The current implementation was generated with assistant support. See the [execution contract and limitations](docs/ARCHITECTURE.md).

## Run it

```sh
docker build -t rv32-tools .
docker run --rm -v "$PWD:/work" rv32-tools make test lint coverage timing
```

Or install the tools from `Dockerfile` and run `make test lint coverage timing` natively. Reports regenerate under `reports/`; detailed logs and programs appear under `build/`. The coverage target requires a C++ compiler. See the [step-by-step build guide](docs/BUILD_GUIDE.md) for setup and debugging.

## Results and what they mean

Measured with Icarus 12.0, Verilator 5.020, Yosys 0.33 and nextpnr-ice40 0.6, on the checked-in RTL. Source hashes are in the reports. These numbers describe a small local regression and a registered core measurement shell.

- **Correctness:** 144 directed/random programs pass in both simulators; 7,358 retired instruction records and all byte writes match the local reference. Twenty deterministic random seeds. [Verification report](reports/verification.json)
- **RTL coverage:** 37/38 core line instrumentation points = 97.37%, no exclusions. The unhit point is the invalid branch-funct3 default. This is Verilator's instrumentation metric, not 97.37% of possible behavior or architectural certification. [Line coverage report](reports/line-coverage.json)
- **Functional plan:** 46/46 instruction/branch-outcome/trap bins hit. This narrow checklist does not cover every operand or hazard cross. [Bin definitions](reports/verification.json)
- **Mapped area:** 3,962 LUT4 primitives and 1,692 flip-flops; after packing, 5,554/7,680 iCE40 logic cells (72.3%). Zero block RAMs; the device has no hard DSPs. These are FPGA resources, not ASIC area. [Implementation report](reports/implementation.json)
- **Timing:** 34.74 MHz estimated internal maximum; constraint 12 MHz, route seed 1. Includes registered I/O/observation shell, excludes program/data memories and peripherals. Package pins and external I/O timing are unconstrained. This is a post-route estimate, not a tested board clock. [Raw nextpnr report](reports/raw/timing.json), [route log](reports/raw/nextpnr.log), [compressed synthesis log](reports/raw/synthesis.log.gz)

A line percentage alone is weak evidence: this compact source has only 38 instrumented points. The stronger local evidence is ordered retirement and memory-write checking across dependent and wrong-path programs. External ISA-model comparison, ACT4, formal verification, exhaustive DOT4 sweeps and workload speedup experiments remain additional work.

## Custom instruction

`DOT4 rd, rs1, rs2` uses custom-0 (`opcode=0x0b`, `funct3=0`, `funct7=0`):

```
rd = Σ signed8(rs1.byte[i]) × signed8(rs2.byte[i]), i = 0..3
```

The result is a signed 32-bit sum, without accumulation or saturation. All other custom-0 function combinations trap. It participates in ordinary forwarding and load-use handling. GNU assembler encoding: `.insn r 0x0b, 0, 0, a0, a1, a2`. [Full contract](docs/ARCHITECTURE.md)

## Scope

The core implements base integer arithmetic/control flow and byte/halfword/word memory operations. It assumes separate, combinational-read instruction and data memories. ECALL, EBREAK, illegal encodings and misalignment halt through a local trap record. There is no privileged trap handler, interrupt support, CSR implementation, memory wait-state protocol or validated FPGA board top. Synchronous block RAM needs an interface change. FENCE is a no-op under the stated single-hart ordered-memory contract; FENCE.I is absent.

## Learn, research and extend

**[A Core You Can Explain: illustrated textbook](docs/textbook/README.md)** — 35 pages, interactive pipeline and DOT4 examples, worked answers, runnable labs and a 14-slide review deck.

- **[Today-and-tomorrow build sprint](docs/TWO_DAY_BUILD.md):** the active October 17–18 plan, with hands-on tests, research questions and a reproducible finish.
- [Longer build guide](docs/BUILD_GUIDE.md): optional deeper work after the sprint.
- [Research workflow and primary sources](docs/RESEARCH.md): questions spread across the work, plus qualified connections to Das, Dreslinski, Austin, Shahbaz and Chowdhury.
- [Architecture](docs/ARCHITECTURE.md): pipeline, memory contract, traps and DOT4 encoding.
- [Experiment log](docs/EXPERIMENT_LOG.md): initial evidence, open experiments and a reusable lab-note template.

A truthful synthesis-only outreach line is:

> “An educational five-stage RV32I core with a custom dot-product instruction, 97.37% Verilator line-instrumentation coverage, and a 34.74 MHz post-route internal timing estimate on iCE40 HX8K.”

Use “running at X MHz” only after a real board executes a checked program at that clock. Verify the recipient identities and understand the implementation before presenting it as personal research experience. MIT licensed.
