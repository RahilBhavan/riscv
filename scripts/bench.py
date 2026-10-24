#!/usr/bin/env python3
"""Matched int8 dot-product kernels: pure RV32I software multiply versus DOT4.

Every kernel reads the same packed int8 vectors from the same addresses, loops
once per 32-bit word, and stores the int32 sum to the same address. Each run is
checked three ways: the stored word equals a plain Python dot product, and the
full retirement trace and byte-store stream equal the sequential reference
model in tests/run.py. Cycle counts come from RTL simulation, not hardware.
"""
import hashlib
import json
import random
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from run import MASK, imm, r, reference, signed, store, branch  # noqa: E402

BUILD = ROOT / 'build' / 'bench'
A_BASE, B_BASE, OUT = 0x1000, 0x2000, 0x100
# floor(x*x/4) words for x in -256..255 (a+b reaches -256), centred on x = 0.
SQUARES, SQUARES_CENTER = 0x3000, 0x3000 + 256 * 4
SIZES = (16, 64, 256)
MAX_CYCLES = 200000
EBREAK = 0x00100073
ZERO, S0, T0, T1, T2, T3, A0, A1, A2, T4, T5 = 0, 8, 5, 6, 7, 28, 10, 11, 12, 29, 30
LANE_A, LANE_B = (13, 14, 15, 16), (17, 18, 19, 20)


def lui(rd, upper):
    return upper << 12 | rd << 7 | 0x37


def branch_to(f3, a, b, label):
    return lambda pc, labels: branch(f3, a, b, labels[label] - pc)


def assemble(items):
    """Strings are labels; callables are branches resolved against them."""
    labels, pc = {}, 0
    for item in items:
        if isinstance(item, str):
            labels[item] = pc
        else:
            pc += 4
    words, pc = [], 0
    for item in items:
        if isinstance(item, str):
            continue
        words.append(item(pc, labels) if callable(item) else item)
        pc += 4
    return words


def prologue(n):
    return [lui(A0, A_BASE >> 12), lui(A1, B_BASE >> 12), imm(0, A2, A0, n), imm(0, S0, ZERO, 0), 'loop']


def epilogue():
    return [imm(0, A0, A0, 4), imm(0, A1, A1, 4), branch_to(1, A0, A2, 'loop'), store(2, ZERO, S0, OUT), EBREAK]


def soft_mac(tag):
    """s0 += t0 * t1 for sign-extended bytes, as libgcc's RV32I __mulsi3 loop.

    Negating both operands when the multiplier is negative keeps the
    multiplier in 0..128, so the loop runs at most 8 times and stops early
    once no set bits remain. Inlined to spare the baseline call overhead.
    """
    return [
        branch_to(5, T1, ZERO, f'pos{tag}'),
        r(0, T0, ZERO, T0, 32), r(0, T1, ZERO, T1, 32),
        f'pos{tag}', f'mul{tag}',
        imm(7, T2, T1, 1),
        branch_to(0, T2, ZERO, f'skip{tag}'),
        r(0, S0, S0, T0),
        f'skip{tag}',
        imm(1, T0, T0, 1), imm(5, T1, T1, 1),
        branch_to(1, T1, ZERO, f'mul{tag}'),
    ]


def rv32i_lb(n):
    body = []
    for lane in range(4):
        # Load the multiplier first so the sign test never waits on a load.
        body += [imm(0, T1, A1, lane, 3), imm(0, T0, A0, lane, 3)] + soft_mac(lane)
    return prologue(n) + body + epilogue()


def rv32i_shift(n):
    body = [imm(2, T5, A1, 0, 3), imm(2, T4, A0, 0, 3)]
    for lane in range(4):
        if lane < 3:
            up = 24 - 8 * lane
            body += [imm(1, T1, T5, up), imm(5, T1, T1, 0x400 | 24), imm(1, T0, T4, up), imm(5, T0, T0, 0x400 | 24)]
        else:
            body += [imm(5, T1, T5, 0x400 | 24), imm(5, T0, T4, 0x400 | 24)]
        body += soft_mac(lane)
    return prologue(n) + body + epilogue()


def rv32i_qsquare(n):
    """Quarter-square multiply: a*b = floor((a+b)^2/4) - floor((a-b)^2/4).

    a+b and a-b share parity, so the floors cancel exactly. All eight byte
    loads issue before any use, so no lane waits on a load.
    """
    body = [imm(0, LANE_A[k], A0, k, 3) for k in range(4)] + [imm(0, LANE_B[k], A1, k, 3) for k in range(4)]
    for x, y in zip(LANE_A, LANE_B):
        body += [r(0, T2, x, y), r(0, T3, x, y, 32), imm(1, T2, T2, 2), imm(1, T3, T3, 2),
                 r(0, T2, T2, T4), r(0, T3, T3, T4), imm(2, T2, T2, 0, 3), imm(2, T3, T3, 0, 3),
                 r(0, S0, S0, T2), r(0, S0, S0, T3, 32)]
    setup = [lui(T4, SQUARES_CENTER >> 12), imm(0, T4, T4, SQUARES_CENTER & 0xfff)]
    return setup + prologue(n) + body + epilogue()


def dot4(n):
    body = [imm(2, T0, A0, 0, 3), imm(2, T1, A1, 0, 3), imm(0, A0, A0, 4), imm(0, A1, A1, 4),
            r(0, T2, T0, T1, op=0x0b), r(0, S0, S0, T2), branch_to(1, A0, A2, 'loop'),
            store(2, ZERO, S0, OUT), EBREAK]
    return prologue(n) + body


KERNELS = {
    'rv32i_lb': ('RV32I: LB sign-extending byte loads, inlined shift-and-add multiply', rv32i_lb),
    'rv32i_shift': ('RV32I: LW per word, SLLI/SRAI byte sign extension, inlined shift-and-add multiply', rv32i_shift),
    'rv32i_qsquare': ('RV32I: LB byte loads, quarter-square multiply from a 512-word table (2048 bytes)', rv32i_qsquare),
    'dot4': ('DOT4: LW per word, one DOT4 and one ADD per four elements', dot4),
}


def datasets():
    rng = random.Random(2026)
    for n in SIZES:
        yield 'uniform', n, [rng.randint(-128, 127) for _ in range(n)], [rng.randint(-128, 127) for _ in range(n)]
    # Extremes exercise -128 * -128 and the longest multiply loops.
    yield 'extremes', 16, [-128, 127, -128, -1] * 4, [-128, -128, 127, -128] * 4


def memory_image(a, b):
    image = bytearray(16384)
    image[A_BASE:A_BASE + len(a)] = bytes(v & 255 for v in a)
    image[B_BASE:B_BASE + len(b)] = bytes(v & 255 for v in b)
    for x in range(-256, 256):
        image[SQUARES_CENTER + 4 * x:SQUARES_CENTER + 4 * x + 4] = (x * x // 4).to_bytes(4, 'little')
    return image


def simulate(sim, name, program, image):
    program_path, data_path = BUILD / f'{name}.hex', BUILD / f'{name}.data.hex'
    program_path.write_text(''.join(f'{w:08x}\n' for w in program))
    data_path.write_text(''.join(f'{v:02x}\n' for v in image))
    out = subprocess.run(['vvp', str(sim), f'+program={program_path}', f'+data={data_path}', f'+max_cycles={MAX_CYCLES}'],
                         capture_output=True, text=True, check=True).stdout.splitlines()
    records, writes, cycles = [], [], None
    for line in out:
        fields = line.split()
        if fields and fields[0] == 'RET':
            records.append(tuple(int(v, 16) for v in fields[1:]))
        elif fields and fields[0] == 'STORE':
            writes.append(tuple(int(v, 16) for v in fields[1:]))
        elif fields and fields[0] == 'CYCLES':
            cycles = int(fields[1])
    assert cycles is not None, f'{name}: simulation ended without a trap record'
    return dict(cycles=cycles, retired=len(records), stalls=out.count('STALL'), flushes=out.count('FLUSH')), records, writes


def stored_word(writes):
    data = {addr: byte for addr, byte in writes if OUT <= addr < OUT + 4}
    assert len(data) == 4, 'kernel did not store a full result word'
    return int.from_bytes(bytes(data[OUT + k] for k in range(4)), 'little')


def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    sims = {}
    for enabled in (1, 0):
        sims[enabled] = BUILD / f'sim-dot4-{enabled}'
        subprocess.run(['iverilog', '-g2012', '-s', 'tb', f'-Ptb.DOT4={enabled}', '-o', str(sims[enabled]),
                        'rtl/rv32_core.sv', 'tests/tb.sv'], cwd=ROOT, check=True)
    runs, overheads = [], set()
    for dataset, n, a, b in datasets():
        expected = sum(x * y for x, y in zip(a, b))
        image = memory_image(a, b)
        for kernel, (description, build) in KERNELS.items():
            program = assemble(build(n))
            name = f'{kernel}-{dataset}-{n}'
            ref_trace, ref_writes, _ = reference(program, image, limit=MAX_CYCLES)
            stats, records, writes = simulate(sims[1], name, program, image)
            assert records == ref_trace, f'{name}: retirement trace differs from reference model'
            assert writes == ref_writes, f'{name}: store stream differs from reference model'
            assert stored_word(writes) == expected & MASK, f'{name}: stored {signed(stored_word(writes))}, expected {expected}'
            # Cycles decompose into retirements, load-use bubbles and two squashed slots per redirect.
            overheads.add(stats['cycles'] - stats['retired'] - stats['stalls'] - 2 * stats['flushes'])
            off, off_records, _ = simulate(sims[0], name + '-nodot4', program, image)
            off_trace, _, _ = reference(program, image, dot4=False, limit=MAX_CYCLES)
            assert off_records == off_trace, f'{name}: DOT4=0 trace differs from reference model'
            if kernel == 'dot4':
                pc, insn, _, _, trap, _ = off_trace[-1]
                assert trap and insn & 127 == 0x0b and pc == program.index(insn) * 4, f'{name}: DOT4=0 core did not trap at the first DOT4'
                nodot4 = dict(traps_at_first_dot4=True, retired_including_trap=off['retired'])
            else:
                assert off == stats, f'{name}: DOT4=0 core changed base-ISA timing {off} != {stats}'
                nodot4 = dict(identical_cycles=True)
            runs.append(dict(kernel=kernel, dataset=dataset, n=n, result=expected, verified=True,
                             program_words=len(program), dot4_disabled_core=nodot4, **stats))
            print(f"{name:26} cycles={stats['cycles']:6} retired={stats['retired']:6} stalls={stats['stalls']:4} flushes={stats['flushes']:5} result={expected}")
    assert len(overheads) == 1, f'cycle accounting residual varies: {overheads}'
    speedups = []
    for dataset, n, _, _ in datasets():
        row = {run['kernel']: run for run in runs if run['dataset'] == dataset and run['n'] == n}
        speedups.append(dict(dataset=dataset, n=n, **{f'cycles_{k}': v['cycles'] for k, v in row.items()},
                             speedup_vs_rv32i_lb=round(row['rv32i_lb']['cycles'] / row['dot4']['cycles'], 3),
                             speedup_vs_rv32i_shift=round(row['rv32i_shift']['cycles'] / row['dot4']['cycles'], 3),
                             speedup_vs_rv32i_qsquare=round(row['rv32i_qsquare']['cycles'] / row['dot4']['cycles'], 3)))
    report = dict(
        what='Cycle counts of matched int8 dot-product kernels in Icarus RTL simulation of rv32_core; not board measurements.',
        memory_layout=dict(a_base=hex(A_BASE), b_base=hex(B_BASE), packing='4 signed int8 per little-endian word, lane 0 lowest byte', output=hex(OUT),
                           squares_table=f'{hex(SQUARES)}..{hex(SQUARES_CENTER + 255 * 4 + 3)}, present in every image, read only by rv32i_qsquare'),
        cycle_window='Falling edges from reset release through the EBREAK trap retirement, inclusive. Includes setup, loop overhead, pipeline fill and drain.',
        cycle_identity=f'cycles = retired + load_use_stalls + 2 * flushes + {overheads.pop()} for every run',
        verification='Stored word equals Python sum(a*b); retirement trace and byte stores equal tests/run.py reference model; DOT4=0 core gives identical RV32I cycle counts and traps at the first DOT4.',
        multiply='rv32i_shift and rv32i_lb: libgcc __mulsi3 shift-and-add loop, inlined; operands negated when the multiplier is negative so it runs at most 8 iterations and exits when no bits remain. Data dependent.',
        input_seed=2026,
        kernels={k: v[0] for k, v in KERNELS.items()},
        runs=runs,
        speedup=speedups,
        sources={p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in ['rtl/rv32_core.sv', 'tests/tb.sv', 'tests/run.py', 'scripts/bench.py']},
        simulator=subprocess.run(['iverilog', '-V'], capture_output=True, text=True).stdout.splitlines()[0],
    )
    (ROOT / 'reports' / 'benchmark.json').write_text(json.dumps(report, indent=2) + '\n')
    for row in speedups:
        print(f"{row['dataset']:8} N={row['n']:3}  DOT4 speedup {row['speedup_vs_rv32i_shift']}x shift, {row['speedup_vs_rv32i_lb']}x lb, {row['speedup_vs_rv32i_qsquare']}x qsquare")


if __name__ == '__main__':
    main()
