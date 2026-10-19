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


def reference(program, memory=None, dot4=True, limit=20000):
    regs = [0] * 32
    memory = bytearray(memory or 16384)
    pc = 0
    trace, writes, bins = [], [], set()
    for _ in range(limit):
        ins = program[pc // 4] if pc // 4 < len(program) else 0x13
        op, rd, f3 = ins & 127, (ins >> 7) & 31, (ins >> 12) & 7
        ra, rb, f7 = (ins >> 15) & 31, (ins >> 20) & 31, ins >> 25
        a, b = regs[ra], regs[rb]
        ii = signed(ins >> 20, 12)
        si = signed(((ins >> 25) << 5) | ((ins >> 7) & 31), 12)
        bi = signed(((ins >> 31) << 12) | (((ins >> 7) & 1) << 11) | (((ins >> 25) & 63) << 5) | (((ins >> 8) & 15) << 1), 13)
        ji = signed(((ins >> 31) << 20) | (((ins >> 12) & 255) << 12) | (((ins >> 20) & 1) << 11) | (((ins >> 21) & 1023) << 1), 21)
        nxt, value, dest, trap, name = (pc + 4) & MASK, 0, 0, False, None
        if op in (0x13, 0x33):
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
            trap = bool(nxt & 3) or (op == 0x67 and f3 != 0)
        elif op == 0x63:
            if f3 not in B_NAMES:
                trap = True
            else:
                cond = {0: a == b, 1: a != b, 4: signed(a) < signed(b), 5: signed(a) >= signed(b), 6: a < b, 7: a >= b}[f3]
                name = B_NAMES[f3]
                bins.add(name + (':taken' if cond else ':not_taken'))
                if cond:
                    nxt = (pc + bi) & MASK
                    trap = bool(nxt & 3)
        elif op in (0x03, 0x23):
            load = op == 3
            names = L_NAMES if load else S_NAMES
            if f3 not in names:
                trap = True
            else:
                name = names[f3]
                size = 1 << (f3 & 3)
                addr = (a + (ii if load else si)) & MASK
                trap = bool(addr % size)
                if not trap:
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
            trap = f3 != 0 or ins >> 28 != 0
            name = 'fence'
        else:
            trap = True
        if trap:
            dest, value = 0, 0
            bins.add('trap')
        else:
            bins.add(name)
        value &= MASK
        if dest:
            regs[dest] = value
        else:
            value = 0
        trace.append((pc, ins, dest, value, int(trap)))
        if trap:
            return trace, writes, bins
        pc = nxt
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


def check(name, program, command, dot4=True):
    """Run one program on a simulator command; raise AssertionError on any divergence from reference()."""
    path = BUILD / f'{name}.hex'
    path.write_text(''.join(f'{word:08x}\n' for word in program))
    expected, expected_writes, bins = reference(program, dot4=dot4)
    proc = subprocess.run(command + [f'+program={path}', '+coverage=' + str(BUILD / (name + '.dat'))], capture_output=True, text=True)
    if proc.returncode:
        raise AssertionError(f'{name}: simulator failed: {proc.stdout[-600:]}{proc.stderr[-600:]}')
    observed, writes = [], []
    for line in proc.stdout.splitlines():
        fields = line.split()
        if fields and fields[0] == 'RET':
            observed.append(tuple(int(n, 16) for n in fields[1:]))
        elif fields and fields[0] == 'STORE':
            writes.append(tuple(int(n, 16) for n in fields[1:]))
    if observed != expected:
        for index in range(max(len(expected), len(observed))):
            exp = expected[index] if index < len(expected) else None
            obs = observed[index] if index < len(observed) else None
            if exp != obs:
                raise AssertionError(f'{name} retire {index}: expected {exp}, observed {obs}')
    assert writes == expected_writes, (name, 'store mismatch', writes, expected_writes)
    return expected, bins, proc.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--verilator', action='store_true')
    parser.add_argument('--no-dot4', action='store_true', help='check the DOT4=0 core, where custom-0 must trap')
    args = parser.parse_args()
    BUILD.mkdir(exist_ok=True)
    sim = BUILD / ('sim-nodot4' if args.no_dot4 else 'sim')
    if not args.verilator:
        subprocess.run(['iverilog', '-g2012', '-s', 'tb', f'-Ptb.DOT4={int(not args.no_dot4)}', '-o', str(sim), 'rtl/rv32_core.sv', 'tests/tb.sv'], cwd=ROOT, check=True)
    command = [str(BUILD / 'obj_dir' / 'Vtb')] if args.verilator else ['vvp', str(sim)]
    import hazards
    hit, cases, retired, stalls, flushes = set(), 0, 0, 0, 0
    cross_hit, hazard_programs, invariant_cycles = set(), 0, 0
    logs = []
    for name, program in suite():
        expected, bins, stdout = check(name, program, command, dot4=not args.no_dot4)
        lines = stdout.splitlines()
        hit |= bins
        cross_hit |= hazards.cross_bins(program, expected)
        hazard_programs += name.startswith('hazard_')
        invariant_cycles += sum(int(line.split()[1]) for line in lines if line.startswith('INVARIANTS '))
        cases += 1
        retired += len(expected)
        stalls += lines.count('STALL')
        flushes += lines.count('FLUSH')
        logs.append(f'PASS {name}: {len(expected)} retired')
    required = set(R_NAMES + I_NAMES + ['sub', 'sra', 'srai', 'lui', 'auipc', 'jal', 'jalr', 'dot4', 'fence', 'trap'] + list(L_NAMES.values()) + list(S_NAMES.values()))
    required |= {n + outcome for n in B_NAMES.values() for outcome in (':taken', ':not_taken')}
    # Instruction bins and branch outcome bins are deliberately a fixed, small plan.
    if args.no_dot4:
        required.discard('dot4')
    covered = hit & required
    report = dict(test_cases=cases, retired_instructions=retired, random_seeds=20, load_use_stall_cycles=stalls, redirects_and_trap_flushes=flushes, functional_bins_hit=len(covered), functional_bins_total=len(required), functional_coverage_percent=round(100 * len(covered) / len(required), 2), missing_bins=sorted(required - hit), coverage_definition='Named instruction classes, both outcomes of each branch, and trap notification; not RTL line/toggle coverage or ISA certification.', bins=sorted(required))
    report.update(
        hazard_programs=hazard_programs,
        hazard_cross_bins_hit=len(cross_hit & set(hazards.ALL_BINS)),
        hazard_cross_bins_total=len(hazards.ALL_BINS),
        hazard_cross_missing=sorted(set(hazards.ALL_BINS) - cross_hit),
        hazard_cross_definition='Measured on the sequential reference trace of every program. producer>consumer.operand:dN = the newest writer of a consumer source register retired N instructions earlier (7 producer classes x 14 consumer operand slots x N=1..3); x0:producer>read:dN = an x0-writing producer N instructions before a read of x0; redirect:transfer:event = squashed wrong-path or first target instruction depends on the transfer or its recent producers.',
        invariant_cycles_checked=invariant_cycles,
        invariants='tests/invariants.svh: x0 constant, register writes only from valid non-trap WB, every store/load strobe matched to the retirement of the same instruction (no squashed-path memory access), retirement PC follows program order and instruction memory, stall holds IF/ID and inserts one bubble, flush squashes IF/ID and EX, stall and flush exclusive, no fetch after halt.',
        related_reports=['reports/dot4-sweep.json', 'reports/isa-compare.json'])
    report['simulator'] = 'Verilator' if args.verilator else 'Icarus Verilog'
    report['source_sha256'] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT / 'rtl/rv32_core.sv', ROOT / 'tests/tb.sv', ROOT / 'tests/invariants.svh', ROOT / 'tests/run.py', ROOT / 'tests/hazards.py']}
    report['dot4_enabled'] = not args.no_dot4
    report_path = BUILD / 'verification-nodot4.json' if args.no_dot4 else ROOT / 'reports' / 'verification.json'
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    (BUILD / ('regression-nodot4.log' if args.no_dot4 else 'regression.log')).write_text('\n'.join(logs) + '\n')
    assert not required - hit, report
    # DOT4 producer/consumer bins cannot occur when custom-0 traps.
    assert args.no_dot4 or not report['hazard_cross_missing'], report['hazard_cross_missing']
    assert invariant_cycles > 0, 'testbench invariants did not run'
    assert stalls > 0 and flushes > 0
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
