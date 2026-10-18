# Architecture and execution contract

This is a new educational implementation created with assistant support in this workspace. The user confirmed there is no earlier draft; the project started from a placeholder README.

## Five stages

1. IF: `pc` addresses a combinational instruction memory; IF/ID holds `f_pc`, `f_insn`, `f_valid`.
2. ID: asynchronous register-file reads and a same-edge WB bypass feed ID/EX (`x_*`).
3. EX: ALU, address generation, comparisons, jumps and DOT4. EX/MEM holds `m_*`.
4. MEM: combinational data-memory read or byte-enabled write. MEM/WB holds `w_*`.
5. WB: writes the register file and emits a registered retirement record.

Reset is synchronous and active high. Reset PC is zero. All registers reset to zero for deterministic experiments; x0 remains zero. External memories do not reset through the core. A new instruction can enter on every cycle when no hazard or redirect intervenes. The trace appears after the WB edge; it is a local verification interface, not a complete RVFI implementation.

## Hazards

EX operands select EX/MEM non-load results first, then MEM/WB results, then ID/EX values. Both operands use this selection, including store data, branch operands and JALR bases. A load address is never a forwarding result. A load immediately followed by a consumer freezes PC and IF/ID, inserts one invalid EX bubble and lets older work advance. This works only with the combinational data-memory interface below.

WB-to-ID bypass handles a register read coinciding with its write edge. x0 does not create a dependency. Decode checks whether each instruction really uses rs1/rs2, so immediate fields do not cause false stalls. Taken branches and jumps resolve in EX, squash both younger stages, and resume fetching at the target. An EX trap similarly squashes younger work, halts fetch and lets older instructions drain before the fault record retires.

## Instruction behavior

Implemented integer operations: LUI, AUIPC, JAL, JALR; BEQ, BNE, BLT, BGE, BLTU, BGEU; LB, LH, LW, LBU, LHU; SB, SH, SW; ADDI, SLTI, SLTIU, XORI, ORI, ANDI, SLLI, SRLI, SRAI; ADD, SUB, SLL, SLT, SLTU, XOR, SRL, SRA, OR, AND. Base FENCE is a no-op under this in-order, single-hart, strongly ordered memory contract. FENCE.I, CSRs, multiplication/division, compressed instructions, interrupts, privileged state and virtual memory are absent.

ECALL and EBREAK emit a trap record and halt. Unsupported encodings and misaligned data accesses/taken instruction targets also emit a trap and halt without the faulting operation's register/memory side effect. This interface supplies no trap cause, trap-vector entry, recovery or privilege implementation. Reassert reset to resume. The fetch address must always have a valid instruction response from the environment. There is no access-fault handshake.

These limitations are why the public description says **educational RV32I execution core**, not certified full-system processor. Neither ACT4 nor riscv-formal has been integrated. The Python oracle was written independently of the RTL but is maintained in this same project; both could share a mistaken interpretation of the ISA.

## Memory contract

- Harvard ports: separate instruction and data interfaces; no shared-port arbitration.
- No ready/valid, wait states, caches or outstanding transactions.
- `imem_addr` is a byte address; `imem_rdata` is valid combinationally for that address.
- `dmem_addr` is an aligned word address, `dmem_read` marks a valid load, `dmem_rdata` contains the little-endian aligned word combinationally.
- Stores use four byte strobes and lane-shifted write data, sampled on the rising edge. The core traps on unaligned halfword/word accesses.
- A store completes in MEM; a following load sees the updated contents. The environment must implement that ordering.
- Tests supply 16 KiB each of instruction/data space. The testbench wraps addresses; generated programs stay in range. No address-wrap test is a proof of access-fault behavior.
- FPGA block RAM generally has synchronous reads. Attaching it directly violates this contract. Adding memory wait states/pipeline alignment is future work, required before a typical board integration.

## DOT4 custom instruction

```
31        25 24    20 19    15 14  12 11     7 6       0
0000000      rs2      rs1      000     rd       0001011
```

`rd = sum(int8(rs1[8*i +: 8]) * int8(rs2[8*i +: 8]), i=0..3)`.

Each lane is signed independently. The four products sum into a signed 32-bit result. There is no accumulator, rounding or saturation. The result range is -65024 through 65536. x0 discards the result. Other funct3/funct7 combinations of custom-0 trap. Example: `0x01020304 DOT4 0x01010101 = 10`.

GNU assembly can encode it as `.insn r 0x0b, 0, 0, a0, a1, a2` (destination first). The extension is project-specific; stock compilers and ISA models do not know its semantics. The combinational four-multiplier unit shares the EX cycle, which may limit timing. An ordinary RV32I multiply is a software operation, so a fair baseline must not silently use the M extension.

## Implementation measurement

`timing_top` registers external instruction/load inputs and folds all core outputs into an observable rotating XOR register to preserve the logic through synthesis. This is a measurement shell. It contains no instruction/data memory, clock generator, UART, bootloader or board pins. Its instruction input is deliberately arbitrary: timing analysis evaluates structural paths, not program correctness.

The target is an iCE40 HX8K CT256 with a 12 MHz constraint, seed 1 and unconstrained package I/O. The registered endpoints enable internal timing analysis. Placement and routing estimates are for this shell, including its registers, not a complete system. External input/output timing and reset distribution to a real board are not signed off. HX8K has no hard DSP blocks; DOT4 maps into logic. Resources are FPGA implementation resources, not ASIC silicon area.

## Reset boundary

Active-high synchronous reset clears architectural and pipeline state at the rising edge. `dmem_read` and `dmem_wstrb` are additionally gated combinationally by `!reset`, so a memory endpoint cannot observe a pending request while reset is asserted. Reset must meet the system clock timing requirements; this is not an asynchronous state reset. `make reset-test` checks pending load/store suppression, pipeline clearing and restart.
