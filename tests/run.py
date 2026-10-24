#!/usr/bin/env python3
"""Differential RTL regression against a sequential architectural model.

No RISC-V assembler required. Encoders generate machine words directly.
"""
import argparse
import hashlib
import json
import random
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'
MASK = 0xffffffff


def signed(n, bits=32):
    n &= (1 << bits) - 1
    return n - (1 << bits) if n & (1 << (bits - 1)) else n


def r(f3, rd, a, b, f7=0, op=0x33):
    return f7 << 25 | b << 20 | a << 15 | f3 << 12 | rd << 7 | op


def imm(f3, rd, a, n, op=0x13):
    return (n & 4095) << 20 | a << 15 | f3 << 12 | rd << 7 | op


def store(f3, a, b, n):
    return ((n & 4095) >> 5) << 25 | b << 20 | a << 15 | f3 << 12 | (n & 31) << 7 | 0x23


def branch(f3, a, b, n):
    return ((n >> 12) & 1) << 31 | ((n >> 5) & 63) << 25 | b << 20 | a << 15 | f3 << 12 | ((n >> 1) & 15) << 8 | ((n >> 11) & 1) << 7 | 0x63


def jal(rd, n):
    return ((n >> 20) & 1) << 31 | ((n >> 1) & 1023) << 21 | ((n >> 11) & 1) << 20 | ((n >> 12) & 255) << 12 | rd << 7 | 0x6f


R_NAMES = ['add', 'sll', 'slt', 'sltu', 'xor', 'srl', 'or', 'and']
I_NAMES = ['addi', 'slli', 'slti', 'sltiu', 'xori', 'srli', 'ori', 'andi']
B_NAMES = {0: 'beq', 1: 'bne', 4: 'blt', 5: 'bge', 6: 'bltu', 7: 'bgeu'}
L_NAMES = {0: 'lb', 1: 'lh', 2: 'lw', 4: 'lbu', 5: 'lhu'}
S_NAMES = {0: 'sb', 1: 'sh', 2: 'sw'}


M_NAMES = ['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu']
CSR_NAMES = {1: 'csrrw', 2: 'csrrs', 3: 'csrrc', 5: 'csrrwi', 6: 'csrrsi', 7: 'csrrci'}
ECALL, EBREAK, MRET, WFI = 0x00000073, 0x00100073, 0x30200073, 0x10500073
IRQ_ADDR = 0x3ffc
# mcause code and mip bit for each tb interrupt line, in priority order (external, software, timer).
IRQ_LINES = ((2, 11), (0, 3), (1, 7))
# An enabled, pending interrupt must be taken within this many retirements of becoming visible.
IRQ_LATENCY = 4


def muldiv(f3, a, b):
    sa, sb = signed(a), signed(b)
    if f3 < 4:
        x = sa if f3 in (1, 2) else a
        y = sb if f3 == 1 else b
        product = x * y
        return product if f3 == 0 else product >> 32
    if b == 0:
        return MASK if f3 in (4, 5) else a
    if f3 in (4, 6):
        if sa == -2**31 and sb == -1:
            return sa if f3 == 4 else 0
        q = abs(sa) // abs(sb) * (1 if (sa < 0) == (sb < 0) else -1)
        return q if f3 == 4 else sa - q * sb
    return a // b if f3 == 5 else a % b


def reference(program, memory=None, dot4=True, limit=20000, mext=False, zicsr=False, intr_at=()):
    """Sequential model. Trace records are (pc, ins, dest, value, trap, intr).

    With zicsr, traps enter mtvec and the run ends at EBREAK. intr_at maps each trace index where the RTL
    took an interrupt to the mcause it reported. The model checks that cause was enabled and pending, either
    now or before the latest instruction (the bench updates the lines one cycle after the store), takes it
    there, and fails if an enabled, pending interrupt goes untaken for IRQ_LATENCY retirements.
    """
    regs = [0] * 32
    memory = bytearray(memory or 16384)
    csr = dict(mie_bit=0, mpie=0, mie=0, mtvec=0, mscratch=0, mepc=0, mcause=0, mtval=0)
    pc = 0
    trace, writes, bins = [], [], set()
    waiting, line_store, lines_before = 0, False, 0

    def mip():
        lines = memory[IRQ_ADDR] & 7 if zicsr else 0
        return sum(1 << bit for line, bit in IRQ_LINES if lines >> line & 1)

    def enter(cause, tval, epc):
        csr.update(mepc=epc, mcause=cause, mtval=tval, mpie=csr['mie_bit'], mie_bit=0)
        base = csr['mtvec'] & ~3
        return (base + 4 * (cause & 15)) & MASK if cause >> 31 and csr['mtvec'] & 1 else base

    for _ in range(limit):
        ins = program[pc // 4] if pc // 4 < len(program) else 0x13
        enabled = csr['mie'] if csr['mie_bit'] else 0
        pending = mip() & enabled
        # The lines change one cycle after their store, so right after it the RTL may still act on the old lines,
        # but always under the current MIE and mie.
        seen = [pending] + ([lines_before & enabled] if line_store else [])
        if len(trace) in intr_at:
            code = intr_at[len(trace)]
            assert code >> 31 and any(code & 31 == next((bit for _, bit in IRQ_LINES if s >> bit & 1), None) for s in seen), \
                f'interrupt {code:#x} taken at retirement {len(trace)} (pc {pc:#x}) while not the highest enabled pending cause'
            trace.append((pc, ins, 0, 0, 1, 1))
            bins.add(f'interrupt:{code & 31}')
            pc = enter(code, 0, pc)
            waiting, line_store = 0, False
            continue
        waiting = waiting + 1 if pending else 0
        lines_before, stores_before = mip(), len(writes)
        assert waiting <= IRQ_LATENCY, f'enabled interrupt pending for {waiting} retirements without being taken (pc {pc:#x})'
        op, rd, f3 = ins & 127, (ins >> 7) & 31, (ins >> 12) & 7
        ra, rb, f7 = (ins >> 15) & 31, (ins >> 20) & 31, ins >> 25
        a, b = regs[ra], regs[rb]
        ii = signed(ins >> 20, 12)
        si = signed(((ins >> 25) << 5) | ((ins >> 7) & 31), 12)
        bi = signed(((ins >> 31) << 12) | (((ins >> 7) & 1) << 11) | (((ins >> 25) & 63) << 5) | (((ins >> 8) & 15) << 1), 13)
        ji = signed(((ins >> 31) << 20) | (((ins >> 12) & 255) << 12) | (((ins >> 20) & 1) << 11) | (((ins >> 21) & 1023) << 1), 21)
        nxt, value, dest, trap, name = (pc + 4) & MASK, 0, 0, False, None
        cause, tval = 2, ins
        if op == 0x33 and mext and f7 == 1:
            dest, value, name = rd, muldiv(f3, a, b), M_NAMES[f3]
        elif op in (0x13, 0x33):
            rhs = ii & MASK if op == 0x13 else b
            shamt = rb if op == 0x13 else b & 31
            legal = True
            if f3 == 0:
                legal = op == 0x13 or f7 in (0, 32)
                value = a - rhs if op == 0x33 and f7 == 32 else a + rhs
            elif f3 == 1:
                legal = f7 == 0
                value = a << shamt
            elif f3 == 2:
                value = int(signed(a) < signed(rhs))
                legal = op == 0x13 or f7 == 0
            elif f3 == 3:
                value = int(a < rhs)
                legal = op == 0x13 or f7 == 0
            elif f3 == 4:
                value = a ^ rhs
                legal = op == 0x13 or f7 == 0
            elif f3 == 5:
                legal = f7 in (0, 32)
                value = signed(a) >> shamt if f7 == 32 else a >> shamt
            elif f3 == 6:
                value = a | rhs
                legal = op == 0x13 or f7 == 0
            else:
                value = a & rhs
                legal = op == 0x13 or f7 == 0
            trap = not legal
            name = (I_NAMES if op == 0x13 else R_NAMES)[f3]
            if f7 == 32 and f3 == 5:
                name = 'srai' if op == 0x13 else 'sra'
            if op == 0x33 and f7 == 32 and f3 == 0:
                name = 'sub'
            dest = rd
        elif op == 0x37:
            dest, value, name = rd, ins & 0xfffff000, 'lui'
        elif op == 0x17:
            dest, value, name = rd, pc + (ins & 0xfffff000), 'auipc'
        elif op in (0x6f, 0x67):
            dest, value, name = rd, pc + 4, 'jal' if op == 0x6f else 'jalr'
            nxt = (pc + ji) & MASK if op == 0x6f else (a + ii) & 0xfffffffe
            if op == 0x67 and f3 != 0:
                trap = True
            elif nxt & 3:
                trap, cause, tval = True, 0, nxt
        elif op == 0x63:
            if f3 not in B_NAMES:
                trap = True
            else:
                cond = {0: a == b, 1: a != b, 4: signed(a) < signed(b), 5: signed(a) >= signed(b), 6: a < b, 7: a >= b}[f3]
                name = B_NAMES[f3]
                bins.add(name + (':taken' if cond else ':not_taken'))
                if cond:
                    nxt = (pc + bi) & MASK
                    if nxt & 3:
                        trap, cause, tval = True, 0, nxt
        elif op in (0x03, 0x23):
            load = op == 3
            names = L_NAMES if load else S_NAMES
            if f3 not in names:
                trap = True
            else:
                name = names[f3]
                size = 1 << (f3 & 3)
                addr = (a + (ii if load else si)) & MASK
                if addr % size:
                    trap, cause, tval = True, 4 if load else 6, addr
                else:
                    assert addr + size <= len(memory), 'test generator memory range'
                    if load:
                        dest = rd
                        value = int.from_bytes(memory[addr:addr + size], 'little', signed=f3 < 4)
                    else:
                        for offset in range(size):
                            byte = (b >> (8 * offset)) & 255
                            memory[addr + offset] = byte
                            writes.append((addr + offset, byte))
        elif op == 0x0b and dot4:
            trap = f3 != 0 or f7 != 0
            dest, value, name = rd, sum(signed(a >> (8 * k), 8) * signed(b >> (8 * k), 8) for k in range(4)), 'dot4'
        elif op == 0x0f:
            trap = f3 != 0  # reserved fm values, FENCE.TSO included, act as a plain FENCE
            name = 'fence'
        elif op == 0x73 and ins in (ECALL, EBREAK):
            trap = True
            cause, tval = (11, 0) if ins == ECALL else (3, pc)
            name = 'ecall' if ins == ECALL else 'ebreak'
        elif op == 0x73 and zicsr and ins == MRET:
            nxt, name = csr['mepc'], 'mret'
            csr.update(mie_bit=csr['mpie'], mpie=1)
        elif op == 0x73 and zicsr and ins == WFI:
            name = 'wfi'
        elif op == 0x73 and zicsr and f3 in CSR_NAMES:
            address = ins >> 20
            readable = {0x300: (csr['mie_bit'] << 3) | (csr['mpie'] << 7) | 0x1800,
                        0x301: 0x40000100 | (0x1000 if mext else 0) | (0x800000 if dot4 else 0), 0x304: csr['mie'], 0x305: csr['mtvec'], 0x310: 0,
                        0x340: csr['mscratch'], 0x341: csr['mepc'], 0x342: csr['mcause'], 0x343: csr['mtval'], 0x344: mip(),
                        0xf11: 0, 0xf12: 0, 0xf13: 0, 0xf14: 0, 0xf15: 0}
            src = ra if f3 & 4 else a
            write = f3 & 3 == 1 or ra != 0
            if address not in readable or (write and address >> 10 == 3):
                trap = True
            else:
                old = readable[address]
                new = {1: src, 2: old | src, 3: old & ~src & MASK}[f3 & 3]
                dest, value, name = rd, old, CSR_NAMES[f3]
                if write:
                    if address == 0x300:
                        csr.update(mie_bit=new >> 3 & 1, mpie=new >> 7 & 1)
                    elif address == 0x304:
                        csr['mie'] = new & 0x888
                    elif address == 0x305:
                        csr['mtvec'] = new & ~2 & MASK
                    elif address == 0x341:
                        csr['mepc'] = new & ~3 & MASK
                    elif address in (0x340, 0x342, 0x343):
                        csr[{0x340: 'mscratch', 0x342: 'mcause', 0x343: 'mtval'}[address]] = new
        else:
            trap = True
        if trap:
            dest, value = 0, 0
            bins.add('trap')
            if zicsr:
                bins.add(f'exception:{cause}')
        else:
            bins.add(name)
        value &= MASK
        if dest:
            regs[dest] = value
        else:
            value = 0
        trace.append((pc, ins, dest, value, int(trap), 0))
        line_store = any(addr == IRQ_ADDR for addr, _ in writes[stores_before:])
        if trap and (not zicsr or ins == EBREAK):
            return trace, writes, bins
        pc = enter(cause, tval & MASK, pc) if trap else nxt
    raise AssertionError('reference timeout')


def suite():
    end = [0x00100073]
    # Consecutive dependencies exercise both forwarding sources and WB/ID bypass.
    yield 'forwarding', [imm(0, 1, 0, 7), imm(0, 2, 1, 1), r(0, 3, 2, 1), imm(0, 1, 3, 2), r(0, 4, 1, 3), 0x13, 0x13, r(0, 5, 4, 1)] + end
    yield 'priority_x0', [imm(0, 1, 0, 1), imm(0, 1, 1, 2), r(0, 2, 1, 1), imm(0, 0, 2, 99), r(0, 3, 0, 2)] + end
    for f3 in range(8):
        for f7 in ([0, 32] if f3 in (0, 5) else [0]):
            yield f'alu_{f3}_{f7}', [0x800000b7, imm(0, 2, 0, -1), r(f3, 3, 1, 2, f7)] + end
        for n in (0, 1, 31, -1, -2048, 2047):
            if f3 in (1, 5):
                n &= 31
            yield f'imm_{f3}_{n}', [imm(0, 1, 0, -42), imm(f3, 2, 1, n)] + end
    yield 'srai', [imm(0, 1, 0, -128), imm(5, 2, 1, 0x403)] + end
    yield 'upper', [0x123450b7, 0xfffff117, r(0, 3, 1, 2), 0x0ff0000f] + end
    yield 'fence_tso', [imm(0, 1, 0, 5), 0x8330000f, imm(0, 2, 1, 1)] + end
    for f3 in L_NAMES:
        for offset in range(0, 4, 1 << (f3 & 3)):
            yield f'load_{f3}_{offset}', [0x80ff80b7, imm(0, 1, 1, 127), store(2, 0, 1, 128), imm(f3, 2, 0, 128 + offset, 3), r(0, 3, 2, 1), store(2, 0, 3, 136)] + end
    for f3 in S_NAMES:
        for offset in range(0, 4, 1 << f3):
            yield f'store_{f3}_{offset}', [imm(0, 1, 0, -12), store(f3, 0, 1, 128 + offset), imm(2, 2, 0, 128, 3), store(2, 0, 2, 136)] + end
    # Include data-to-branch, data-to-JALR, load-to-store, and wrong-path side effects.
    for f3 in B_NAMES:
        for av, bv in ((1, 1), (-1, 1), (1, -1)):
            yield f'branch_{f3}_{av}_{bv}', [imm(0, 1, 0, av), imm(0, 2, 0, bv), branch(f3, 1, 2, 12), store(2, 0, 1, 128), imm(0, 3, 0, 99), imm(0, 4, 0, 42)] + end
    yield 'jal', [jal(1, 12), store(2, 0, 1, 128), 0xffffffff, imm(0, 2, 1, 3)] + end
    yield 'jalr', [imm(0, 1, 0, 17), imm(0, 2, 1, 0, 0x67), store(2, 0, 1, 128), 0xffffffff, r(0, 3, 2, 1)] + end
    yield 'backward_loop', [imm(0, 1, 0, 5), imm(0, 1, 1, -1), branch(1, 1, 0, -4)] + end
    for bits in (0, 0x7f7f7f7f, 0x80808080, 0xff017f80):
        setup = [((bits + 0x800) & 0xfffff000) | 0xb7, imm(0, 1, 1, signed(bits & 4095, 12))]
        yield f'dot_{bits:x}', setup + [r(0, 2, 1, 1, op=0x0b), r(0, 3, 2, 1), store(2, 0, 1, 128), imm(2, 4, 0, 128, 3), r(0, 5, 4, 1, op=0x0b)] + end
    faults = [0xffffffff, 0, r(1, 1, 1, 1, op=0x0b), r(0, 1, 1, 1, 1), imm(1, 1, 0, 32), imm(0, 1, 0, 0, 0x67) | 0x1000, imm(3, 1, 0, 0, 3), store(3, 0, 1, 0), imm(2, 1, 0, 1, 3), store(2, 0, 1, 1), imm(1, 1, 0, 1, 3), store(1, 0, 1, 1), jal(1, 2), branch(0, 0, 0, 2), imm(0, 1, 0, 2, 0x67), 0x00000073, 0x00100073]
    for num, fault in enumerate(faults):
        yield f'trap_{num}', [imm(0, 1, 0, 7), store(2, 0, 1, 128), fault, store(2, 0, 1, 132), imm(0, 3, 0, 99)] + end
    for seed in range(20):
        rng = random.Random(seed)
        p = [imm(0, reg, 0, rng.randint(-2048, 2047)) for reg in range(1, 16)]
        for _ in range(300):
            rd, a, b, f3 = rng.randrange(16), rng.randrange(16), rng.randrange(16), rng.randrange(8)
            choice = rng.randrange(6)
            if choice == 0:
                p.append(r(f3, rd, a, b, rng.choice([0, 32]) if f3 in (0, 5) else 0))
            elif choice == 1:
                p.append(imm(f3, rd, a, rng.randrange(32) if f3 in (1, 5) else rng.randint(-2048, 2047)))
            elif choice == 2:
                p.append(r(0, rd, a, b, op=0x0b))
            elif choice == 3:
                size = rng.randrange(3)
                p.append(store(size, 0, b, 256 + (rng.randrange(32) << size)))
            elif choice == 4:
                lf = rng.choice(list(L_NAMES))
                p.append(imm(lf, rd, 0, 256 + (rng.randrange(32) << (lf & 3)), 3))
            else:
                p.extend([branch(rng.choice(list(B_NAMES)), a, b, 8), imm(0, rd, a, 1)])
        yield f'random_{seed}', p + end
    import hazards
    yield from hazards.suite()


def csr(f3, rd, rs1, address):
    return address << 20 | rs1 << 15 | f3 << 12 | rd << 7 | 0x73


MSTATUS, MISA, MIE, MTVEC, MSTATUSH, MSCRATCH, MEPC, MCAUSE, MTVAL, MIP = 0x300, 0x301, 0x304, 0x305, 0x310, 0x340, 0x341, 0x342, 0x343, 0x344
HANDLER, COMMON, LOG = 0x3000, 0x3080, 0x2000
# Extended programs keep x26..x31 for the handler: x27 log pointer, x29 = 0x4000 for the interrupt-line store.
PROLOGUE = [29 << 7 | 4 << 12 | 0x37, 27 << 7 | 2 << 12 | 0x37, 30 << 7 | 3 << 12 | 0x37, csr(1, 0, 30, MTVEC)]
RAISE = 28


def handler():
    """Vector table at HANDLER, shared body at COMMON. Logs mcause, mepc, mtval and mstatus, then skips the
    faulting instruction or clears every interrupt line, and returns with MRET."""
    words = {HANDLER + 4 * slot: jal(0, COMMON - HANDLER - 4 * slot) for slot in (0, 3, 7, 11)}
    body = [csr(2, 30, 0, MCAUSE), store(2, 27, 30, 0), csr(2, 31, 0, MEPC), store(2, 27, 31, 4),
            csr(2, 31, 0, MTVAL), store(2, 27, 31, 8), csr(2, 31, 0, MSTATUS), store(2, 27, 31, 12),
            imm(0, 27, 27, 16), branch(4, 30, 0, 20),
            csr(2, 31, 0, MEPC), imm(0, 31, 31, 4), csr(1, 0, 31, MEPC), MRET,
            store(2, 29, 0, -4), MRET]
    words.update({COMMON + 4 * k: w for k, w in enumerate(body)})
    return words


def with_handler(body):
    program = PROLOGUE + body + [EBREAK]
    assert len(program) * 4 <= HANDLER, 'program overlaps the trap handler'
    image = program + [0x13] * (max(handler()) // 4 + 1 - len(program))
    for address, word in handler().items():
        image[address // 4] = word
    return image


def li(rd, value):
    import hazards
    return hazards.li(rd, value & MASK)


def raise_lines(lines):
    return [imm(0, RAISE, 0, lines), store(2, 29, RAISE, -4)]


def extended_suite():
    values = [0, 1, -1, 7, -3, -2**31, 2**31 - 1]
    for f3, name in enumerate(M_NAMES):
        body = []
        for x in values:
            for y in values:
                body += li(1, x) + li(2, y) + [r(f3, 3, 1, 2, 1)]
        yield f'm_{name}', with_handler(body)
    yield 'm_hazards', with_handler(
        li(1, 6) + li(2, -7) + [r(0, 3, 1, 2, 1), r(0, 4, 3, 3), r(0, 5, 3, 4, 1), store(2, 0, 5, 128), imm(2, 6, 0, 128, 3),
                                r(4, 7, 6, 1, 1), branch(1, 7, 0, 8), imm(0, 8, 0, 99), r(6, 9, 7, 2, 1), r(1, 10, 9, 9, 1),
                                r(5, 11, 10, 1, 1), r(7, 12, 11, 2, 1), store(2, 0, 12, 132), branch(0, 0, 0, 8), r(0, 13, 1, 1, 1),
                                jal(0, 8), r(4, 14, 1, 1, 1), r(0, 0, 1, 2, 1), r(3, 15, 0, 0, 1), r(4, 15, 1, 0, 1), r(6, 14, 1, 0, 1),
                                imm(2, 13, 0, 128, 3), r(0, 13, 13, 13, 1), r(0, 4, 13, 13)])
    body = []
    for address in (MSCRATCH, MEPC, MCAUSE, MTVAL, MSTATUS, MIE, MIP, MISA, MSTATUSH):
        body += li(2, 0xa5a5f00f) + li(4, 0x0ff0) + li(6, 0x00ff00f3)
        body += [csr(1, 1, 2, address), csr(2, 3, 4, address), csr(3, 5, 6, address), csr(5, 7, 21, address),
                 csr(6, 8, 10, address), csr(7, 9, 5, address), csr(2, 10, 0, address), csr(1, 0, 0, address)]
    body += li(2, 0x3003) + [csr(1, 1, 2, MTVEC), csr(2, 3, 0, MTVEC)] + li(2, HANDLER) + [csr(1, 0, 2, MTVEC)]
    body += [csr(2, n, 0, address) for n, address in zip(range(11, 16), (0xf11, 0xf12, 0xf13, 0xf14, 0xf15))]
    yield 'csr_access', with_handler(body)
    yield 'csr_illegal', with_handler([csr(1, 0, 1, 0xf11), csr(2, 1, 0, 0x7c0), csr(4, 1, 0, MSCRATCH), csr(2, 1, 0, 0xf14),
                                       csr(6, 2, 0, 0xf14), csr(6, 3, 1, 0xf14), csr(3, 4, 0, MISA), 0x10200073, WFI,
                                       csr(2, 5, 0, MCAUSE), csr(2, 6, 0, MTVAL)])
    faults = [0xffffffff, 0, r(1, 1, 1, 1, op=0x0b), r(0, 1, 1, 1, 1 << 5 | 1), imm(1, 1, 0, 32), imm(0, 1, 0, 0, 0x67) | 0x1000,
              imm(3, 1, 0, 0, 3), store(3, 0, 1, 0), imm(2, 1, 0, 1, 3), store(2, 0, 1, 1), imm(1, 1, 0, 1, 3), store(1, 0, 1, 1),
              jal(1, 2), branch(0, 0, 0, 2), imm(0, 1, 0, 2, 0x67), ECALL, 0x10200073]
    for num, fault in enumerate(faults):
        yield f'exception_{num}', with_handler([imm(0, 1, 0, 7), store(2, 0, 1, 128), fault, store(2, 0, 1, 132), imm(0, 3, 0, 99)])
    yield 'mret_stack', with_handler([csr(6, 0, 8, MSTATUS), ECALL, csr(2, 1, 0, MSTATUS), csr(7, 0, 8, MSTATUS), ECALL, csr(2, 2, 0, MSTATUS)])
    enable = li(1, 0x888) + [csr(1, 0, 1, MIE), csr(6, 0, 8, MSTATUS)]
    for lines in range(1, 8):
        yield f'interrupt_{lines}', with_handler(enable + raise_lines(lines) + [imm(0, 2, 2, 1)] * 6 + [csr(2, 3, 0, MCAUSE)])
    yield 'interrupt_vectored', with_handler(li(2, HANDLER | 1) + [csr(1, 0, 2, MTVEC)] + enable +
                                             sum((raise_lines(lines) + [imm(0, 2, 2, 1)] * 4 for lines in (1, 2, 4, 6, 7)), []) + [ECALL, 0xffffffff])
    yield 'interrupt_masked', with_handler(li(1, 0x888) + [csr(1, 0, 1, MIE)] + raise_lines(5) + [0x13] * 3 +
                                           [csr(2, 3, 0, MIP), csr(7, 0, 8, MIE)] + [0x13] * 4 + [csr(6, 0, 8, MSTATUS)] +
                                           [imm(0, 2, 2, 1)] * 4 + li(1, 0x800) + [csr(2, 0, 1, MIE)] + [imm(0, 2, 2, 1)] * 4)
    yield 'interrupt_during_md', with_handler(enable + li(1, -12345) + li(2, 77) + raise_lines(4) + [r(4, 3, 1, 2, 1), r(6, 4, 1, 2, 1)] +
                                              raise_lines(2) + [r(1, 5, 1, 2, 1), r(0, 6, 5, 3)] + [imm(0, 2, 2, 1)] * 4)
    # The handler rewrites x31, so an M operation cut off by an interrupt must restart on the new value.
    yield 'interrupt_md_operand', with_handler(enable + li(31, 12345) + raise_lines(4) + [r(0, 5, 31, 31, 1), r(4, 6, 31, 5, 1)] +
                                               [imm(0, 2, 2, 1)] * 4)
    # Disabling interrupts right after raising a line: the RTL must not take it once MIE is clear.
    yield 'interrupt_disabled_after_raise', with_handler(enable + raise_lines(4) + [csr(7, 0, 8, MSTATUS)] + [imm(0, 2, 2, 1)] * 4 +
                                                         [csr(6, 0, 8, MSTATUS)] + [imm(0, 2, 2, 1)] * 4)
    yield 'interrupt_after_mret', with_handler(enable[:-1] + raise_lines(1) + [ECALL] + [imm(0, 2, 2, 1)] * 4)
    for seed in range(30):
        rng = random.Random(5000 + seed)
        body = [imm(0, reg, 0, rng.randint(-2048, 2047)) for reg in range(1, 16)] + enable
        for _ in range(300):
            rd, a, b, f3 = rng.randrange(16), rng.randrange(16), rng.randrange(16), rng.randrange(8)
            choice = rng.randrange(12)
            if choice == 0:
                body.append(r(f3, rd, a, b, rng.choice([0, 32]) if f3 in (0, 5) else 0))
            elif choice == 1:
                body.append(imm(f3, rd, a, rng.randrange(32) if f3 in (1, 5) else rng.randint(-2048, 2047)))
            elif choice == 2:
                body.append(r(0, rd, a, b, op=0x0b))
            elif choice == 3:
                size = rng.randrange(3)
                body.append(store(size, 0, b, 256 + (rng.randrange(32) << size)))
            elif choice == 4:
                lf = rng.choice(list(L_NAMES))
                body.append(imm(lf, rd, 0, 256 + (rng.randrange(32) << (lf & 3)), 3))
            elif choice == 5:
                body.extend([branch(rng.choice(list(B_NAMES)), a, b, 8), imm(0, rd, a, 1)])
            elif choice in (6, 7):
                body.append(r(f3, rd, a, b, 1))
            elif choice == 8:
                body.append(csr(rng.choice(list(CSR_NAMES)), rd, a, rng.choice([MSCRATCH, MTVAL, MCAUSE])))
            elif choice == 9:
                body.append(rng.choice([ECALL, 0xffffffff, imm(2, rd, 0, 2, 3), csr(6 + rng.randrange(2), 0, 8, MSTATUS)]))
            elif choice == 10:
                body.extend(raise_lines(rng.randrange(1, 8)))
            else:
                body.extend(li(RAISE, rng.choice([0x8, 0x80, 0x800, 0x888, 0x88, 0x808])) + [csr(1, 0, RAISE, MIE)])
        yield f'extended_random_{seed}', with_handler(body)


def check(name, program, command, dot4=True, mext=False, zicsr=False, plusargs=()):
    """Run one program on a simulator command; raise AssertionError on any divergence from reference()."""
    path = BUILD / f'{name}.hex'
    path.write_text(''.join(f'{word:08x}\n' for word in program))
    coverage = BUILD / f"{name}{'-waits' if plusargs else ''}{'-extended' if zicsr else ''}.dat"
    proc = subprocess.run(command + [f'+program={path}', f'+coverage={coverage}', *plusargs], capture_output=True, text=True)
    if proc.returncode:
        raise AssertionError(f'{name}: simulator failed: {proc.stdout[-600:]}{proc.stderr[-600:]}')
    observed, writes, intr_at, cause = [], [], {}, None
    for line in proc.stdout.splitlines():
        fields = line.split()
        if fields and fields[0] == 'IRQ':
            cause = int(fields[1], 16)
        elif fields and fields[0] == 'RET':
            observed.append(tuple(int(n, 16) for n in fields[1:]))
            if observed[-1][5]:
                intr_at[len(observed) - 1] = cause
        elif fields and fields[0] == 'STORE':
            writes.append(tuple(int(n, 16) for n in fields[1:]))
    try:
        expected, expected_writes, bins = reference(program, dot4=dot4, mext=mext, zicsr=zicsr, intr_at=intr_at, limit=60000)
    except AssertionError as error:
        raise AssertionError(f'{name}: {error}') from None
    if observed != expected:
        for index in range(max(len(expected), len(observed))):
            exp = expected[index] if index < len(expected) else None
            obs = observed[index] if index < len(observed) else None
            if exp != obs:
                raise AssertionError(f'{name} retire {index}: expected {exp}, observed {obs}')
    assert writes == expected_writes, (name, 'store mismatch', writes, expected_writes)
    return expected, bins, proc.stdout


WAITS = 96  # each memory ready is withheld with probability 96/256 in the wait-state pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--verilator', action='store_true')
    parser.add_argument('--no-dot4', action='store_true', help='check the DOT4=0 core, where custom-0 must trap')
    parser.add_argument('--extended', action='store_true', help='check the MEXT=1 ZICSR=1 core with the extended programs')
    args = parser.parse_args()
    BUILD.mkdir(exist_ok=True)
    mext = zicsr = args.extended
    params = dict(DOT4=int(not args.no_dot4), MEXT=int(mext), ZICSR=int(zicsr))
    sim = BUILD / ('sim-extended' if args.extended else 'sim-nodot4' if args.no_dot4 else 'sim')
    if not args.verilator:
        subprocess.run(['iverilog', '-g2012', '-s', 'tb', *(f'-Ptb.{k}={v}' for k, v in params.items()), '-o', str(sim),
                        'rtl/rv32_core.sv', 'tests/tb.sv'], cwd=ROOT, check=True)
    command = [str(BUILD / ('obj_dir_extended' if args.extended else 'obj_dir') / 'Vtb')] if args.verilator else ['vvp', str(sim)]
    import hazards
    hit, cases, retired, stalls, flushes = set(), 0, 0, 0, 0
    cross_hit, hazard_programs, invariant_cycles, waited_cycles, excluded = set(), 0, 0, 0, []
    logs = []
    programs = list(suite())
    if args.extended:
        # A non-EBREAK trap enters the handler under ZICSR, and these programs install none.
        kept = [(n, p) for n, p in programs if reference(p)[0][-1][1] == EBREAK]
        excluded = sorted(set(n for n, _ in programs) - set(n for n, _ in kept))
        programs = kept + list(extended_suite())
    for name, program in programs:
        for waits in (0, WAITS):
            plusargs = [f'+waits={waits}', f'+wait_seed={hashlib.sha256(name.encode()).hexdigest()[:8]}'] if waits else []
            expected, bins, stdout = check(name, program, command, dot4=not args.no_dot4, mext=mext, zicsr=zicsr, plusargs=plusargs)
            lines = stdout.splitlines()
            invariant_cycles += sum(int(line.split()[1]) for line in lines if line.startswith('INVARIANTS '))
            if waits:
                waited_cycles += sum(int(line.split()[1]) for line in lines if line.startswith('CYCLES '))
                continue
            hit |= bins
            cross_hit |= hazards.cross_bins(program, expected)
            hazard_programs += name.startswith('hazard_')
            cases += 1
            retired += len(expected)
            stalls += lines.count('STALL')
            flushes += lines.count('FLUSH')
            logs.append(f'PASS {name}: {len(expected)} retired, and again with wait states')
    required = set(R_NAMES + I_NAMES + ['sub', 'sra', 'srai', 'lui', 'auipc', 'jal', 'jalr', 'dot4', 'fence', 'trap'] + list(L_NAMES.values()) + list(S_NAMES.values()))
    required |= {n + outcome for n in B_NAMES.values() for outcome in (':taken', ':not_taken')}
    if args.extended:
        required |= set(M_NAMES) | set(CSR_NAMES.values()) | {'mret', 'wfi'}
        required |= {f'exception:{c}' for c in (0, 2, 3, 4, 6, 11)} | {f'interrupt:{c}' for c in (3, 7, 11)}
    # Instruction bins and branch outcome bins are deliberately a fixed, small plan.
    if args.no_dot4:
        required.discard('dot4')
    covered = hit & required
    report = dict(test_cases=cases, retired_instructions=retired, random_seeds=20 + 30 * args.extended, load_use_stall_cycles=stalls, redirects_and_trap_flushes=flushes, functional_bins_hit=len(covered), functional_bins_total=len(required), functional_coverage_percent=round(100 * len(covered) / len(required), 2), missing_bins=sorted(required - hit), coverage_definition='Named instruction classes, both outcomes of each branch, and trap notification' + (', M operations, CSR forms, MRET, WFI, each exception cause and each interrupt cause' if args.extended else '') + '; not RTL line/toggle coverage or ISA certification.', bins=sorted(required))
    report.update(
        wait_states=dict(withheld_probability=f'{WAITS}/256 per port per cycle', programs=cases, cycles=waited_cycles,
                         method='Every program runs a second time with imem_ready and dmem_ready withheld at random from a per-program seeded LFSR. '
                                'The retirement and store streams must match the same reference trace as the run without wait states.'),
        hazard_programs=hazard_programs,
        hazard_cross_bins_hit=len(cross_hit & set(hazards.ALL_BINS)),
        hazard_cross_bins_total=len(hazards.ALL_BINS),
        hazard_cross_missing=sorted(set(hazards.ALL_BINS) - cross_hit),
        hazard_cross_definition='Measured on the sequential reference trace of every program. producer>consumer.operand:dN = the newest writer of a consumer source register retired N instructions earlier (7 producer classes x 14 consumer operand slots x N=1..3); x0:producer>read:dN = an x0-writing producer N instructions before a read of x0; redirect:transfer:event = squashed wrong-path or first target instruction depends on the transfer or its recent producers.',
        invariant_cycles_checked=invariant_cycles,
        invariants='tests/invariants.svh: x0 constant, register writes only from valid non-trap WB, every store/load strobe matched to the retirement of the same instruction (no squashed-path memory access), a data request held stable until ready, retirement PC follows program order and instruction memory except after a trap record or MRET, stall holds IF/ID and inserts one bubble, flush squashes IF/ID and EX, stall and flush exclusive, no fetch after halt.',
        related_reports=['reports/dot4-sweep.json', 'reports/isa-compare.json', 'reports/formal.json'])
    if args.extended:
        report.update(configuration='DOT4=1 MEXT=1 ZICSR=1', base_programs_excluded=excluded,
                      base_programs_excluded_reason='Each ends in a trap other than EBREAK. Under ZICSR=1 that trap enters mtvec, and these programs install no handler; extended exception_* programs cover the same faults with one.',
                      interrupt_check=f'The bench drives the three interrupt lines from bits 0..2 of a store to {IRQ_ADDR:#x}, one cycle after the store. '
                                      f'Each interrupt the RTL takes must be enabled and pending in the reference model at that point (or before the latest instruction), '
                                      f'with the highest-priority pending cause, and no enabled pending interrupt may stay untaken for more than {IRQ_LATENCY} retirements.')
    report['simulator'] = 'Verilator' if args.verilator else 'Icarus Verilog'
    report['source_sha256'] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT / 'rtl/rv32_core.sv', ROOT / 'tests/tb.sv', ROOT / 'tests/invariants.svh', ROOT / 'tests/run.py', ROOT / 'tests/hazards.py']}
    report['dot4_enabled'] = not args.no_dot4
    report_path = (ROOT / 'reports' / 'verification-extended.json' if args.extended else
                   BUILD / 'verification-nodot4.json' if args.no_dot4 else ROOT / 'reports' / 'verification.json')
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    (BUILD / ('regression-extended.log' if args.extended else 'regression-nodot4.log' if args.no_dot4 else 'regression.log')).write_text('\n'.join(logs) + '\n')
    assert not required - hit, report
    # DOT4 producer/consumer bins cannot occur when custom-0 traps.
    assert args.no_dot4 or not report['hazard_cross_missing'], report['hazard_cross_missing']
    assert invariant_cycles > 0, 'testbench invariants did not run'
    assert stalls > 0 and flushes > 0
    print(json.dumps({k: v for k, v in report.items() if k != 'bins'}, indent=2))


if __name__ == '__main__':
    main()
