# Sources and implementation reading notes

Researched October 17, 2026. These readings support the textbook; they are not evidence that the learner has built or measured a processor. External pages describe language, ISA and tools. The checked-in RTL describes this particular implementation. Report files describe one recorded experiment, subject to their source hashes and tool versions.

## Chapter map

| Learning topic | Read first | Apply it here |
| --- | --- | --- |
| Binary, hex, two's complement | RISC-V RV32I programmers' model, below | `signed()` in `tests/run.py`; `$signed` in the ALU and DOT4 |
| State, clock edges, RTL | Verilator BLKSEQ and COMBDLY diagnostics | Clocked block versus three combinational blocks in `rtl/rv32_core.sv` |
| RV32I encodings and execution | Official RV32I chapter and instruction listings | `op`, `funct3`, `funct7`, `imm_*` and the opcode case |
| Pipeline and performance | Brown five-stage notes, parts 1 and 3 | `f_*`, `x_*`, `m_*`, `w_*`, valid bits and retirement |
| Forwarding, stalling, flushing | Brown part 3; local timelines below | `a`, `b`, `hazard`, `redirect`, `fault` |
| Signed packed DOT4 | Official custom opcode map; GNU `.insn` formats | `dot` loop and custom-0 decoder |
| Verification and coverage | Verilator coverage manual | `tests/run.py`, `tests/tb.sv`, `scripts/coverage.py` |
| Synthesis and timing | Yosys synthesis manual; nextpnr documentation | `Makefile`, `rtl/timing_top.sv`, `scripts/metrics.py` |

## Primary readings

### R1. RISC-V International: RV32I Base Integer Instruction Set, version 2.1

[Official RV32I chapter, ISA release v20260120](https://docs.riscv.org/reference/isa/v20260120/unpriv/rv32.html).

Use the programmers' model, instruction formats, integer computation, control transfer and load/store sections. RV32I has 32 integer registers of 32 bits and a program counter; x0 reads zero. Signed integer interpretation is two's complement. R/I/S/U forms and B/J immediate variants explain the fields reconstructed by `imm_*`. Arithmetic keeps the low 32 bits. Signed and unsigned comparisons differ; byte/halfword loads may sign-extend or zero-extend. JALR clears target bit zero. This base configuration uses four-byte instruction alignment, so a taken target with bit one set still faults. The ISA defines architectural effects; it does not require five pipeline stages.

For a numerical exercise, derive an eight-bit negative value by subtracting 256 from an unsigned pattern whose top bit is set, then verify it with the repository's `signed(n, bits=8)`. This is a worked application of the representation, rather than an additional ISA instruction.

### R2. RISC-V International: instruction listings and custom opcode space

[Official opcode map and listings, ISA release v20260120](https://docs.riscv.org/reference/isa/v20260120/unpriv/rv-32-64g.html).

The major opcode map reserves custom-0 through custom-3 for custom extensions. Here custom-0 is `0x0b`. That allocation does not standardize DOT4: its function fields and behavior belong to this project. The register indices remain in ordinary R-format positions. Use the listings to independently check encoders; do not infer an encoding by copying the RTL decoder alone.

### R3. GNU Binutils: RISC-V instruction formats

[Assembler `.insn` formats](https://sourceware.org/binutils/docs/as/RISC_002dV_002dFormats.html).

The R-format directive orders fields as opcode, funct3, funct7, rd, rs1, rs2. Therefore `.insn r 0x0b, 0, 0, a0, a1, a2` encodes this project's instruction. Assembly emission alone provides no simulator semantics or compiler optimization support. A tool accepting the bytes has not verified the instruction's arithmetic.

### R4. Verilator: sequential and combinational assignment diagnostics

[BLKSEQ](https://verilator.org/guide/latest/warnings.html#blkseq) and [COMBDLY](https://verilator.org/guide/latest/warnings.html#combdly).

The official diagnostics recommend nonblocking assignments for sequential blocks to avoid races and discourage delayed assignments in combinational blocks. For this core, read every right-hand side in the rising-edge block from the pre-update state: `w_result <= ...` does not instantly change the `w_result` used by another statement at that edge. Defaults at the beginning of a combinational block avoid unintended retained state. A `reg` declaration by itself does not imply a physical flip-flop; the driving process determines storage. See the pipeline edge example below for the concrete consequence.

### R5. Brown CSCI1952y: five-stage CPU teaching notes

[Part 1: pipeline setup](https://browncs1952y.github.io/notes/pipelined_cpu_1.html) and [Part 3: data hazards](https://browncs1952y.github.io/notes/pipelined_cpu_3.html).

These first-party teaching notes explain forwarding, newest-result priority, load-use stalls and why a load address is not loaded data. They also discuss register-file read/write overlap and store-data dependencies. The central question is when a value is produced versus when a consumer needs it. Brown's branch implementation differs from this repository: use the local EX-resolution timeline, not a MEM-resolution diagram. Brown part 3 explicitly discusses a load-to-store case and alternative hardware; this RTL chooses a conservative interlock because store data is captured after EX.

### R6. Verilator: coverage analysis

[Official simulation and coverage manual](https://verilator.org/guide/latest/simulating.html#coverage-analysis).

Line coverage inserts counters at code-flow change points; it is not a count of every textual source line. Toggle coverage and user/property coverage measure different things. The repository enables `--coverage-line` and filters core points in `scripts/coverage.py`. A high percentage can coexist with incorrect arithmetic, missing hazard combinations or a shared oracle error. The checked-in percentage is therefore a scoped instrumentation result, not architectural certification or the probability that the core is correct.

### R7. YosysHQ: synthesis and implementation

[Yosys synthesis stages](https://yosyshq.readthedocs.io/projects/yosys/en/latest/using_yosys/synthesis/index.html), [platform synthesis commands](https://yosyshq.readthedocs.io/projects/yosys/en/latest/using_yosys/synthesis/synth.html), and [nextpnr project documentation](https://github.com/YosysHQ/nextpnr/blob/main/README.md).

Yosys transforms RTL toward implementation cells; nextpnr places and routes a target FPGA design. Those are separate steps. Cell counts depend on the target and mapping. Timing analysis belongs to the implemented netlist and its constraints. The repository's own measurement shell and limitations, below, determine what its report can claim; a tool result is not evidence of a physical board executing a program.

## Local implementation evidence

Read [the core](../../rtl/rv32_core.sv), [architecture contract](../ARCHITECTURE.md), [test generator and oracle](../../tests/run.py), [testbench](../../tests/tb.sv), [coverage parser](../../scripts/coverage.py), [timing shell](../../rtl/timing_top.sv), and [measurement parser](../../scripts/metrics.py). These files are authoritative for implementation-specific statements in this section. They are not external validation of themselves.

### Naming and edge discipline

`pc` addresses IF. `f_*` is the IF/ID register, so its instruction is in ID. `x_*` is ID/EX and feeds EX; `m_*` is EX/MEM and feeds MEM; `w_*` is MEM/WB and feeds WB. A stage is combinational work between register boundaries, not just a box named after its prefix.

The same rising edge can write the old `w_result` to a register and capture an ID operand. Nonblocking assignment means the ordinary read still sees the old register contents at that edge. The explicit WB-to-ID bypass supplies the intended value. Without it, spacing instructions several cycles apart can still expose a dependency error.

Invalid stages can contain leftover instruction bits. Treat valid bits as the authority for side effects. A bubble is `x_valid=0`, not necessarily an encoded ADDI x0,x0,0. EX/MEM forwarding overrides MEM/WB forwarding because it is the younger producer. Loads are excluded from EX/MEM forwarding because `m_result` is their address.

### Checked load/add/store timeline

Assume reset has completed; memories meet the documented combinational-read contract; x0 is zero. Let the program be `lw x1,0(x0); add x2,x1,x1; sw x2,4(x0)`. Columns describe stage activity during each interval; side effects occur at its closing rising edge.

| Instruction | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `lw x1,0(x0)` | IF | ID | EX | MEM | WB | — | — | — |
| `add x2,x1,x1` | — | IF | ID | ID held | EX | MEM | WB | — |
| `sw x2,4(x0)` | — | — | IF | IF held | ID | EX | MEM | WB |
| EX bubble | — | — | — | invalid | — | — | — | — |

At the end of C3, the load-use hazard holds PC and IF/ID and inserts the invalid EX slot. In C5 the load's MEM/WB result forwards to both ADD operands. In C6 the ADD's EX/MEM result forwards to the store's `b`; it is captured as `m_store`. The store writes memory at the end of C7; its local retirement record follows the WB edge at the end of C8. Stores therefore have a MEM side effect before their trace appears.

### Checked taken-branch timeline

For `beq x0,x0,target` fetched in C1, the branch is ID in C2 and EX in C3. During C3 there are two younger instructions: one in ID and one in IF. At the closing edge the core redirects PC and clears `f_valid` and `x_valid`.

| Instruction | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| taken branch | IF | ID | EX | MEM | WB | — | — | — |
| first wrong path | — | IF | ID, squash | — | — | — | — | — |
| second wrong path | — | — | IF, discard | — | — | — | — | — |
| target | — | — | — | IF | ID | EX | MEM | WB |

This is a two-cycle taken-control penalty relative to the next sequential instruction, assuming no other stall. The target is not fetched into IF/ID at the redirect edge: it is fetched during C4. A non-taken branch does not flush. Trap flushes also set `halted`, so they must not be counted as ordinary continuing branch penalties.

### Performance arithmetic

For N ordinary instructions entering an empty five-stage pipeline and draining it, the ideal interval count is N+4. Add one interval for each isolated load-use interlock and two for each taken EX redirect under this memory contract; interactions, traps and the chosen measurement window can change the accounting. CPI is counted cycles divided by the same window's retired instructions. Throughput approaches one instruction per cycle; a single instruction still crosses five stages. Compare runtime as instruction count × CPI × clock period, not MHz alone.

### DOT4 arithmetic and experiments

The local loop slices four independent signed eight-bit lanes and forms a signed 32-bit sum. Lane zero is bits 7:0. Each signed product lies from -16256 to 16384; summing four gives -65024 through 65536. An 18-bit signed container is sufficient for that range, while the ISA result occupies 32 bits. Derivation: -128×127=-16256 and -128×-128=16384. Do not use a signed 16-bit accumulator: the upper extreme overflows it.

Distinguish a packed signed lane from the whole register's signed interpretation. `0x80808080 DOT4 0x80808080` must produce 65536; all four lanes are -128. `0x80808080 DOT4 0x7f7f7f7f` must produce -65024. Test asymmetric lanes, zero, x0 destination, producer forwarding and load-use stalls. The custom instruction computes no bias or prior accumulator and has no saturation. Compare with a software routine with the same signed semantics; base RV32I has no hardware multiply instruction. A baseline using the M extension changes the comparison.

### Verification and measurement limits

The regression compares retirement records and memory writes against a local sequential model. That is stronger than only checking final registers, but RTL and checker can share a misunderstanding. Coverage thresholds use a small set of instrumented points; functional bins are a separate, narrow checklist. Retain the source hash, tool versions, exact commands, seeds and raw logs with each result.

`timing_top` registers external inputs and folds core outputs into an observation register. The timing target includes that shell, excludes instruction/data memories and peripherals, and leaves package I/O unconstrained. `make synth` and `make timing` synthesize different tops: comparing their areas as if the designs were identical is invalid. FPGA LUT/flip-flop/packed-cell counts are not ASIC area, power or energy. Re-run mapping and route after an RTL change before quoting new timing.

The core has no memory ready/valid handshake and assumes combinational reads. Typical synchronous FPGA block RAM cannot replace those inputs without a design change. Reset initializes all register-file entries, which also influences mapping. There is no board pinout, UART, boot flow, privileged trap recovery or external-memory timing closure. Illegal instructions and alignment faults halt through a local trace; this is not a full privileged RISC-V system. No synthesis timing estimate establishes a tested operating clock on a board.
