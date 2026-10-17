# Research and experiment workflow

Researched 2026-10-17. This document separates established source material from proposed experiments. A planned experiment is not a measured result. The two-to-three-week schedule is an educational scope estimate, not evidence of completed hardware or standards certification.

## Sources to read before each implementation stage

1. **Architectural behavior:** use the [RISC-V ISA manuals](https://docs.riscv.org/reference/isa/index.html) and [unprivileged specification](https://riscv.github.io/riscv-isa-manual/snapshot/spec/) as the authority for arithmetic, immediates, branches, loads/stores and instruction encodings. Keep an explicit supported-instruction list and execution-environment contract. Document traps, alignment, memory boundaries and unsupported extensions rather than assuming a passing arithmetic program establishes full RV32I compatibility.
2. **Pipeline mechanisms:** Brown's [five-stage CPU teaching notes](https://cs.brown.edu/courses/csci1952y/2024/notes/pipelined_cpu.html) explain forwarding, load-use dependencies, stalls and flushes. They are a pedagogical reference, not the ISA specification. Their branch-resolution stage need not match this project's implementation; derive flush behavior from the actual stage in the RTL.
3. **Custom encoding:** the [official opcode map](https://docs.riscv.org/reference/isa/_attachments/riscv-unprivileged.pdf) reserves custom-0 through custom-3 for custom extensions. [GNU assembler's RISC-V formats](https://sourceware.org/binutils/docs/as/RISC_002dV_002dFormats.html) document `.insn r opcode7, funct3, funct7, rd, rs1, rs2`, allowing a prototype without a compiler backend change.
4. **Coverage:** [Verilator's simulation guide](https://verilator.org/guide/latest/simulating.html) distinguishes line, toggle, expression and user coverage. [Its command reference](https://verilator.org/guide/latest/exe_verilator.html) documents the coverage flags. Pin the installed tool version because supported coverage modes can differ.
5. **Physical implementation:** [Yosys synth_ecp5](https://yosyshq.readthedocs.io/projects/yosys/en/v0.48/cmd/synth_ecp5.html) maps RTL to ECP5 resources; [nextpnr](https://github.com/YosysHQ/nextpnr) supplies timing-driven FPGA place and route. Choose a concrete supported device, package and speed grade before interpreting timing. Equivalent iCE40 flows are also supported by nextpnr, but capacity and multiplier mapping must be checked rather than assumed.
6. **Independent verification:** [riscv-formal](https://github.com/YosysHQ/riscv-formal) provides formal testbenches and ISA descriptions; an [RVFI interface](https://github.com/YosysHQ/riscv-formal/blob/main/docs/source/rvfi.rst) connects a retiring core to them. Merely emitting a retirement trace is not integration with this framework.
7. **Architectural test integration:** the current official [Architectural Certification Tests repository](https://github.com/riscv/riscv-arch-test) uses ACT4, replacing deprecated RISCOF. It requires DUT configuration, platform macros, a linker script and a runner for generated ELF files. The repository explicitly says these tests do not replace processor verification. Pin a commit when integrating; older tutorials may describe a different framework.

## Define the custom instruction precisely

Proposed project-specific operation: `DOT4 rd, rs1, rs2` computes

```
rd = sum(signed8(rs1[8*i +: 8]) * signed8(rs2[8*i +: 8]), i=0..3)
```

The least-significant byte is lane zero. Each byte is independently interpreted as a signed two's-complement integer. Sign-extend products before summation, then return the signed sum in a 32-bit register. There is no accumulator, saturation, rounding or memory side effect. The sum lies in [-65024, 65536], so a signed 18-bit sum is sufficient; use wider intermediates for clarity. Writes to x0 must be discarded.

This is a proposed ISA contract, not a ratified RISC-V dot-product extension. Reserve one exact custom opcode/funct combination, publish its binary format, reject other combinations, and test the decoder independently. A GNU `.insn` wrapper can encode it; a hand-coded assembler in the testbench is useful but is a separate thing from a normal software toolchain.

## Research spread across the build

For each stage, keep a dated entry containing **question → source → hypothesis → controlled experiment → raw artifacts → observation → next decision**. Save the exact command, source commit, tool versions, test seed and failures. A negative result is useful evidence.

### Days 1–3: establish a reproducible baseline

Question: what does the existing core actually implement? Read the ISA sections for each decoded operation and compare them with the RTL. Hypothesis: isolated instructions behave correctly before pipeline interactions are introduced. Run arithmetic edge cases, x0 writes, immediate sign extension, shifts, signed/unsigned comparisons, byte/halfword loads and stores, branch directions, JAL/JALR, and documented failure cases. Record the current memory latency assumptions and simulation stopping mechanism. Preserve baseline source and results before changing the architecture.

Decision gate: every supported operation has an expected result and a reproducible test. If the original draft is unavailable, label a replacement as a new implementation rather than a verified continuation of the draft.

### Days 4–7: pipeline and hazards

Question: can independent instructions overlap while dependent instructions preserve architectural behavior? Hypothesis: forwarding handles available ALU results; a one-cycle load-use interlock suffices only under the chosen fixed-latency memory contract.

Experiments: test both source operands at dependency distances 1, 2 and 3; competing writers to the same destination; load-to-ALU, load-to-branch, load-to-JALR, store address and store data; WB-to-ID coincidence; x0 false dependencies; and immediate fields whose bits resemble register indices. Check that the newest valid producer wins. A load address must never be forwarded as loaded data.

Test taken and untaken branches, both jump forms, back-to-back redirections and a redirect coincident with a younger dependency. Put a register write and a store on the wrong path and prove neither commits. Instrument valid bits and assert that bubbles cannot write registers or memory. Record cycles, retired instructions, stalls and flushes separately. Compare retirement behavior against an independently implemented sequential model; compare selected standard programs against a separately maintained ISA model when integration is available.

Decision gate: traces and architectural state agree, with directed evidence for each hazard category. Forwarding alone does not establish correctness.

### Days 8–10: custom compute and software usefulness

Question: does packed arithmetic improve this workload after accounting for clock and area? Hypothesis: DOT4 reduces instruction count but its multiplier/adder path may lower the achievable clock.

Experiments: an independent scalar signed-byte oracle; all 65,536 byte operand pairs placed in each lane separately; randomized packed inputs; all -128, all 127, mixed signs, cancellation and lane-order checks. Exercise dependent DOT4 chains, loads feeding either input, and DOT4 feeding stores/branches/ALU instructions. Test invalid encodings.

Build identical small vector kernels with a pure RV32I software implementation and DOT4. Keep input/output values, memory layout and included loop overhead fixed. RV32I excludes multiply, so the scalar baseline needs a documented software multiplication routine; a C expression silently compiled for RV32IM is not a valid RV32I comparison. Report total cycles and useful outputs per second using each configuration's own measured timing estimate. Include packing and memory traffic when claiming end-to-end benefit.

### Days 11–13: verification evidence

Question: what does a reported percentage actually measure? Hypothesis: directed hazard tests plus seeded randomized programs will expose missed interactions more effectively than collecting instruction names alone.

Measure RTL line coverage and branch/expression coverage if the installed simulator supports them, with exact numerator, denominator, source scope and exclusions. Keep functional coverage as a separate checklist crossing operation classes, operand boundaries and hazard scenarios. A custom functional checklist, Python code coverage and RTL line coverage are different metrics. Set 95% as a target for a named metric, never as an assumed property of the core. Explain uncovered behavior instead of deleting difficult cases to improve the headline. Report test pass counts separately; 100% passing tests is not 100% coverage.

Add assertions for x0, valid-controlled side effects, redirect squashing, stall stability and forwarding priority. As a stretch goal, integrate ACT4 or RVFI formal checks and state exactly which configuration/properties passed. Do not call local randomized simulation certification or formal proof.

### Days 14–17: synthesize and place/route

Question: what implementation cost and timing does the custom unit add? Hypothesis: multiplier mapping and critical path, rather than instruction count, determine the useful speedup.

Run baseline and DOT4-enabled configurations through the same target, toolchain, constraints and seeds. Preserve synthesis resource reports, placement/routing logs, maximum-frequency estimates and timing failures. Publish LUTs, flip-flops, RAM blocks and DSP blocks separately; a generic cell count is not an FPGA LUT count or silicon area in square millimeters. State memory sizes, inferred implementation and whether memory/peripherals are included. Keep inputs and observable outputs alive so optimization cannot discard the datapath.

Yosys-only synthesis establishes mapping/resource estimates, not a routed clock speed. A nextpnr timing estimate is not a physical board measurement. Report the constrained clock and achieved timing status separately. An FPGA board demonstration additionally needs board pin constraints, clock/reset treatment, a program-loading path and an observable pass/fail or serial output. Do not claim board operation from a generated netlist.

### Days 18–21: reproduce, explain and publish

Question: can another person reproduce the claims from a clean clone? Have a clean environment run the documented commands; resolve missing dependencies and preserve logs as release artifacts. Publish source, license, test instructions, custom instruction contract, limitations and metrics provenance. A README headline should link to the exact report supporting every number.

Before outreach, replace placeholders only with measurements. Suitable synthesis-only wording is: “A five-stage educational RV32I-subset core with a custom signed-byte dot product; [measured metric]% RTL line coverage and [measured frequency] MHz estimated after place and route on [device].” Use “RV32I” without “subset” only when the supported behavior and execution environment justify it. Use “running at” for demonstrated hardware operation and describe what ran.

## Connecting this artifact to the five emails

The surnames in the request do not fully identify people. The following are plausible Michigan matches, **not confirmation of the intended recipients**. Verify full names before personalizing outreach. The connections below are interpretations of the cited research interests, not statements that a lab requested this project or that the core reproduces its research.

- **Reetuparna Das:** her [research page](https://web.eecs.umich.edu/~reetudas/research.html) describes in-memory computing, precision-health accelerators and heterogeneous microarchitecture. A measured custom-instruction tradeoff demonstrates introductory hardware/software co-design. A four-byte dot product in a CPU execute stage is not in-memory computing, a genome accelerator or a replica of her lab's architecture.
- **Ronald Dreslinski:** his [Michigan profile](https://eecs.engin.umich.edu/people/dreslinski-ronald/) lists energy-efficient architectures, near-threshold design and experimental 3D chips. Report throughput versus mapped resources and explain the tradeoff. Frequency and area alone do not measure energy, near-threshold operation or 3D integration.
- **Todd Austin:** his [Michigan profile](https://eecs.engin.umich.edu/people/austin-todd/) lists architecture, robust/secure design, verification and performance analysis. Hazard assertions, independent checking and a reproducible failure-to-fix case are relevant evidence of engineering care; code coverage alone is not proof of reliability or security.
- **Muhammad Shahbaz:** his [Michigan profile](https://eecs.engin.umich.edu/people/shahbaz-muhammad/) lists systems, networks and architecture interacting with ML. A clearly specified extension and workload evaluation can show systems thinking. A standalone scalar pipeline does not demonstrate programmable-network or distributed-ML research; avoid that claim without corresponding experiments.
- **Mosharaf Chowdhury:** his [Michigan profile](https://eecs.engin.umich.edu/people/chowdhury-mosharaf/) lists systems for AI, networked systems and cloud computing. Reproducible evaluation and a candid bottleneck analysis transfer well as skills. This core is an indirect fit; it does not establish experience with cloud scheduling, distributed training or energy optimization.

One strong repository can support several conversations, but each email should explain a different, truthful technical connection and link one concrete artifact. Keep the original question, observed result and limitation in that paragraph rather than copying a single sweeping lab-fit claim to all five people.
