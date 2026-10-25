# Architecture and execution contract

This document describes the pipeline, hazards, instruction behavior, machine mode, memory contract, DOT4 encoding and FPGA measurement boundary of `rtl/rv32_core.sv`.

## Parameters

| Parameter | Default | Effect |
|---|---|---|
| `DOT4` | 1 | Adds the custom-0 dot-product unit. With 0, custom-0 traps. |
| `MEXT` | 0 | Adds MUL, MULH, MULHSU, MULHU, DIV, DIVU, REM and REMU on an iterative unit. |
| `ZICSR` | 0 | Adds the Zicsr instructions, machine-mode trap entry, MRET, WFI and three interrupt inputs. With 0, a trap halts the core. |
| `RESET_PC` | 0 | Address of the first fetch. |

The published figures, board image and visual traces use the defaults. `reports/verification-extended.json`, the `extended` section of `reports/isa-compare.json`, `reports/formal.json` and `reports/implementation-extended.json` cover MEXT=1 ZICSR=1.

This is a new educational implementation created with assistant support in this workspace. The user confirmed there is no earlier draft; the project started from a placeholder README.

## Five stages

1. IF: `pc` addresses a combinational instruction memory; IF/ID holds `f_pc`, `f_insn`, `f_valid`.
2. ID: asynchronous register-file reads and a same-edge WB bypass feed ID/EX (`x_*`).
3. EX: ALU, address generation, comparisons, jumps and DOT4. EX/MEM holds `m_*`.
4. MEM: combinational data-memory read or byte-enabled write. MEM/WB holds `w_*`.
5. WB: writes the register file and emits a registered retirement record.

Reset is synchronous and active high. The first fetch is at `RESET_PC`. All registers reset to zero for deterministic experiments; x0 remains zero. External memories do not reset through the core. A new instruction can enter on every cycle when no hazard or redirect intervenes. The trace appears after the WB edge. Under `RISCV_FORMAL` the core also drives an RVFI trace (no CSR fields) for riscv-formal; simulation and synthesis omit it.

## Hazards

EX operands select EX/MEM non-load results first, then MEM/WB results, then ID/EX values. Both operands use this selection, including store data, branch operands and JALR bases. A load address is never a forwarding result. A load immediately followed by a consumer freezes PC and IF/ID, inserts one invalid EX bubble and lets older work advance. A data request that is not ready holds the whole pipeline, and an unfinished M operation holds EX and the stages behind it; while held, EX refreshes its operands from the forwarding network so values written back during the hold are not lost.

WB-to-ID bypass handles a register read coinciding with its write edge. x0 does not create a dependency. Decode checks whether each instruction really uses rs1/rs2, so immediate fields do not cause false stalls. Taken branches and jumps resolve in EX, squash both younger stages, and resume fetching at the target. An EX trap similarly squashes younger work, halts fetch and lets older instructions drain before the fault record retires.

## Instruction behavior

Implemented integer operations: LUI, AUIPC, JAL, JALR; BEQ, BNE, BLT, BGE, BLTU, BGEU; LB, LH, LW, LBU, LHU; SB, SH, SW; ADDI, SLTI, SLTIU, XORI, ORI, ANDI, SLLI, SRLI, SRAI; ADD, SUB, SLL, SLT, SLTU, XOR, SRL, SRA, OR, AND. Base FENCE is a no-op under this in-order, single-hart, strongly ordered memory contract; reserved `fm` values, FENCE.TSO included, act as a plain FENCE. MEXT=1 adds the M operations; each holds EX for 34 cycles: one to start, 32 that each produce one result bit, and one to hand the result on. FENCE.I, compressed instructions, user and supervisor modes and virtual memory are absent.

With ZICSR=0, ECALL and EBREAK emit a trap record and halt. Unsupported encodings and misaligned data accesses/taken instruction targets also emit a trap and halt without the faulting operation's register/memory side effect. Reassert reset to resume. The fetch address must always have a valid instruction response from the environment. There is no access-fault handshake.

## Machine mode (ZICSR=1)

The core runs in machine mode only. CSRRW, CSRRS, CSRRC and their immediate forms read and write these CSRs; any other address, a write to a read-only CSR, and funct3=4 are illegal instructions.

| CSR | Behavior |
|---|---|
| `mstatus` (0x300) | MIE and MPIE are writable; MPP reads as 3; other bits read 0. |
| `misa` (0x301) | Read-only: RV32, I, M when MEXT=1, and X (non-standard extension) when DOT4=1. |
| `mie` (0x304), `mip` (0x344) | MSIE/MTIE/MEIE are writable; `mip` shows the three interrupt inputs and ignores writes. |
| `mtvec` (0x305) | Direct (mode 0) or vectored (mode 1); bit 1 reads 0. |
| `mscratch`, `mcause`, `mtval` (0x340, 0x342, 0x343) | Fully writable. |
| `mepc` (0x341) | Bits 1:0 read 0. |
| `mstatush` (0x310), `mvendorid`, `marchid`, `mimpid`, `mhartid`, `mconfigptr` | Read 0. |

Every trap is taken in EX. An exception writes `mepc` (the faulting instruction), `mcause`, `mtval` (the instruction word for an illegal instruction, the PC for EBREAK, the address for a misaligned access or target, 0 for ECALL), copies MIE to MPIE, clears MIE and jumps to `mtvec`. The trap record still retires with `retire_trap` set, then the handler's instructions. MRET restores MIE from MPIE, sets MPIE and jumps to `mepc`. WFI is a no-op.

An interrupt is taken when `mstatus.MIE` is set and an enabled input is pending, before the instruction in EX, which then retires as a record with `retire_trap` and `retire_intr` set and no effect. External (cause 11) wins over software (3), which wins over timer (7). Vectored mode adds 4×cause to the base for interrupts. An M operation that has started is not interrupted; the interrupt waits for it to finish. There are no counters: `mcycle`, `minstret`, `mcountinhibit` and the user-level `cycle`/`instret` are illegal, so start-up code that reads them traps. CSR writes take effect at the EX edge, so the next instruction sees them; no instruction older than EX can trap or change a CSR.

These limitations are why the public description says **educational RV32I execution core**, not certified full-system processor. The Python oracle was written independently of the RTL but is maintained in this same project, so both could share a mistaken reading of the ISA. External references narrow that risk. `make isa-compare` runs the riscv-arch-test 3.10.0 suites and seeded random programs on both the core and Spike, then compares signatures and commit logs (`reports/isa-compare.json`). `make formal` runs riscv-formal's bounded checks on the RVFI trace (`reports/formal.json`). Spike is the only reference simulator, the suites are the older RISCOF-format release, not ACT4, and the formal checks are bounded and exclude CSR instructions. In simulation the interrupt lines change only when a store to the bench's interrupt register completes, so interrupts arriving during a stall or flush are covered only by the formal checks, which do not check the CSR values they write.

## Memory contract

- Harvard ports: separate instruction and data interfaces; no shared-port arbitration.
- Each port has a ready input. The instruction port presents `imem_addr` while `imem_valid` is high and accepts `imem_rdata` at a rising edge where `imem_ready` is high; the core may move `imem_addr` to a new target before then, so an instruction read must have no side effects. A data request (`dmem_read` or nonzero `dmem_wstrb`) stays unchanged until a rising edge where `dmem_ready` is high, and a store is written at that edge. Tie both ready inputs high for the original single-cycle contract.
- No caches or outstanding transactions; each port has at most one request.
- `imem_addr` is a byte address; `imem_rdata` is valid combinationally for that address when ready.
- `dmem_addr` is an aligned word address, `dmem_read` marks a valid load, `dmem_rdata` contains the little-endian aligned word combinationally when ready.
- Stores use four byte strobes and lane-shifted write data. The core traps on unaligned halfword/word accesses.
- A store completes in MEM; a following load sees the updated contents. The environment must implement that ordering.
- Tests supply 16 KiB each of instruction/data space. The testbench wraps addresses; generated programs stay in range. No address-wrap test is a proof of access-fault behavior.
- FPGA block RAM generally has synchronous reads. `rtl/board_top.sv` clocks its block RAM on the falling edge and ties ready high, which meets the contract with no core change and leaves half a clock period for each memory path ([BOARD.md](BOARD.md)). A ready handshake would let a memory take whole cycles instead; the board image does not use it.

## DOT4 custom instruction

```
31        25 24    20 19    15 14  12 11     7 6       0
0000000      rs2      rs1      000     rd       0001011
```

`rd = sum(int8(rs1[8*i +: 8]) * int8(rs2[8*i +: 8]), i=0..3)`.

Each lane is signed independently. The four products sum into a signed 32-bit result. There is no accumulator, rounding or saturation. The result range is -65024 through 65536. x0 discards the result. Other funct3/funct7 combinations of custom-0 trap. Example: `0x01020304 DOT4 0x01010101 = 10`.

The `DOT4` module parameter (default 1) can remove the unit; with `DOT4=0`, custom-0 traps like any unsupported encoding. `make test` checks both settings, and `make bench ablation` measures what the unit buys and costs (see EXPERIMENT_LOG.md).

GNU assembly can encode it as `.insn r 0x0b, 0, 0, a0, a1, a2` (destination first). The extension is project-specific; stock compilers and ISA models do not know its semantics. The combinational four-multiplier unit shares the EX cycle, which may limit timing. An ordinary RV32I multiply is a software operation, so a fair baseline must not silently use the M extension.

## Implementation measurement

`timing_top` measures the default core with ready tied high. `timing_top_extended` measures the MEXT=1 ZICSR=1 core and drives the ready and interrupt inputs from registered pins, so synthesis keeps that logic. Both register external instruction/load inputs and folds all core outputs into an observable rotating XOR register to preserve the logic through synthesis. This is a measurement shell. It contains no instruction/data memory, clock generator, UART, bootloader or board pins; `rtl/board_top.sv` is the separate board top that has them. Its instruction input is deliberately arbitrary: timing analysis evaluates structural paths, not program correctness.

The target is an iCE40 HX8K CT256 with a 12 MHz constraint and unconstrained package I/O. `make timing` routes with seed 1. `make ablation` repeats the route over seeds 1 to 5 for DOT4=1 and DOT4=0, because a single seed can move the estimate by several MHz with no logic change. The registered endpoints enable internal timing analysis. Placement and routing estimates are for this shell, including its registers, not a complete system. External input/output timing and reset distribution to a real board are not signed off. HX8K has no hard DSP blocks; DOT4 maps into logic. Resources are FPGA implementation resources, not ASIC silicon area.

## Reset boundary

Active-high synchronous reset clears architectural and pipeline state at the rising edge. `dmem_read` and `dmem_wstrb` are additionally gated combinationally by `!reset`, so a memory endpoint cannot observe a pending request while reset is asserted. Reset must meet the system clock timing requirements; this is not an asynchronous state reset. `make reset-test` checks pending load/store suppression, pipeline clearing and restart.
