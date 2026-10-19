#!/usr/bin/env python3
"""Compare the RTL with Spike, an external RISC-V ISA simulator.

1. riscv-arch-test 3.10.0 RV32I tests, assembled with the RISC-V GNU toolchain, run on
   Spike and on the RTL (Icarus and Verilator); signatures must match word for word.
2. Seeded random RV32I programs (no DOT4, no PC-derived values) run on Spike with a
   commit log; every retired PC, instruction word, register write and store byte must
   match the RTL retirement stream.
Runs inside the rv32-tools image (Spike, riscv64-unknown-elf-gcc, pinned arch-test).
"""
import argparse
import hashlib
import json
import random
import re
import subprocess
from pathlib import Path

from run import imm, r, store, branch, jal, B_NAMES, L_NAMES

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build' / 'isa'
SUITE = Path('/opt/riscv-arch-test/riscv-test-suite')
SPIKE_BASE = 0x80000000
SPIKE = ['spike', '--isa=rv32i', f'-m{SPIKE_BASE:#x}:0x800000']
GCC = ['riscv64-unknown-elf-gcc', '-march=rv32i', '-mabi=ilp32', '-static', '-mcmodel=medany', '-fvisibility=hidden',
       '-nostdlib', '-nostartfiles', '-DXLEN=32', '-DTEST_CASE_1=True']
DATA = 0x80010000
RANDOM_SEEDS = 50
# Every exclusion needs a reason; an empty table means every RV32I test in the pinned suite runs.
EXCLUDED = {}
SOURCES = ['rtl/rv32_core.sv', 'tests/isa/arch_tb.sv', 'tests/invariants.svh', 'tests/isa_compare.py',
           'tests/isa/dut/model_test.h', 'tests/isa/dut/link.ld', 'tests/isa/spike/model_test.h', 'tests/isa/spike/link.ld']


def sh(*command, **kwargs):
    return subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True, **kwargs).stdout


def build(source, target, elf):
    sh(*GCC, '-T', f'tests/isa/{target}/link.ld', '-I', f'tests/isa/{target}', '-I', str(SUITE / 'env'), str(source), '-o', str(elf))


def symbols(elf):
    return {name: int(addr, 16) for addr, _, name in (line.split() for line in sh('riscv64-unknown-elf-nm', str(elf)).splitlines() if len(line.split()) == 3)}


def image(elf):
    binary = elf.with_suffix('.bin')
    sh('riscv64-unknown-elf-objcopy', '-O', 'binary', str(elf), str(binary))
    data = binary.read_bytes()
    data += bytes(-len(data) % 4)
    hexfile = elf.with_suffix('.hex')
    hexfile.write_text(''.join(f'{int.from_bytes(data[i:i + 4], "little"):08x}\n' for i in range(0, len(data), 4)))
    return hexfile


def compile_rtl(simulators, core='rtl/rv32_core.sv', out=BUILD):
    if 'icarus' in simulators:
        sh('iverilog', '-g2012', '-s', 'arch_tb', '-o', str(out / 'icarus'), core, 'tests/isa/arch_tb.sv')
    if 'verilator' in simulators:
        sh('verilator', '--binary', '--timing', '-Wno-fatal', '-Wno-lint', '-Wno-style', '--top-module', 'arch_tb',
           '--Mdir', str(out / 'verilator'), core, 'tests/isa/arch_tb.sv')


def rtl(simulator, args, out=BUILD):
    command = ['vvp', str(out / 'icarus')] if simulator == 'icarus' else [str(out / 'verilator' / 'Varch_tb')]
    proc = subprocess.run(command + args, cwd=ROOT, capture_output=True, text=True)
    if proc.returncode or 'HALT' not in proc.stdout:
        raise AssertionError(f'{simulator} {args}: {proc.stdout[-2000:]}{proc.stderr[-2000:]}')
    return proc.stdout


def arch_tests(simulators, out=BUILD):
    results = []
    for source in sorted((SUITE / 'rv32i_m' / 'I' / 'src').glob('*.S')):
        name = source.stem
        if name in EXCLUDED:
            results.append(dict(test=name, status='excluded', reason=EXCLUDED[name]))
            continue
        spike_elf, dut_elf = BUILD / f'{name}.spike.elf', BUILD / f'{name}.dut.elf'
        build(source, 'spike', spike_elf)
        build(source, 'dut', dut_elf)
        reference = BUILD / f'{name}.spike.sig'
        sh(*SPIKE, f'+signature={reference}', '+signature-granularity=4', str(spike_elf))
        expected = reference.read_text().split()
        sym = symbols(dut_elf)
        assert (sym['end_signature'] - sym['begin_signature']) // 4 == len(expected), name
        hexfile = image(dut_elf)
        for simulator in simulators:
            observed_file = out / f'{name}.{simulator}.sig'
            rtl(simulator, out=out, args=[f'+image={hexfile}', f'+halt={sym["rvmodel_halt"]:x}', f'+sig_begin={sym["begin_signature"]:x}',
                            f'+sig_end={sym["end_signature"]:x}', f'+signature={observed_file}'])
            observed = observed_file.read_text().split()
            if observed != expected:
                first = next(i for i, (a, b) in enumerate(zip(observed + [''] * len(expected), expected)) if a != b)
                raise AssertionError(f'{name} {simulator}: signature word {first} is {observed[first:first + 1]}, Spike {expected[first]}')
        results.append(dict(test=name, status='pass', signature_words=len(expected),
                            signature_sha256=hashlib.sha256(reference.read_bytes()).hexdigest()))
        print(f'PASS {name}: {len(expected)} signature words match Spike in {", ".join(simulators)}')
    return results


def random_program(seed):
    """Like the regression's random programs, minus DOT4, with data addressed from x16."""
    rng = random.Random(1000 + seed)
    p = [((DATA >> 12) << 12) | 16 << 7 | 0x37]
    p += [imm(0, reg, 0, rng.randint(-2048, 2047)) for reg in range(1, 16)]
    for _ in range(300):
        rd, a, b, f3 = rng.randrange(16), rng.randrange(16), rng.randrange(16), rng.randrange(8)
        choice = rng.randrange(7)
        if choice == 0:
            p.append(r(f3, rd, a, b, rng.choice([0, 32]) if f3 in (0, 5) else 0))
        elif choice == 1:
            n = rng.randrange(32) | (rng.choice([0, 0x400]) if f3 == 5 else 0) if f3 in (1, 5) else rng.randint(-2048, 2047)
            p.append(imm(f3, rd, a, n))
        elif choice == 2:
            p.append((rng.randrange(1 << 20) << 12) | rd << 7 | 0x37)
        elif choice == 3:
            size = rng.randrange(3)
            p.append(store(size, 16, b, rng.randrange(64) << size))
        elif choice == 4:
            lf = rng.choice(list(L_NAMES))
            p.append(imm(lf, rd, 16, rng.randrange(64) << (lf & 3), 3))
        elif choice == 5:
            p.extend([branch(rng.choice(list(B_NAMES)), a, b, 8), imm(0, rd, a, 1)])
        else:
            p.extend([jal(0, 8), imm(0, rd, a, 1)])
    return p


def spike_commits(log, halt):
    commits = []
    for line in log.splitlines():
        match = re.match(r'core\s+0: 3 0x([0-9a-f]+) \(0x([0-9a-f]+)\)(.*)', line)
        if not match:
            continue
        pc, insn = int(match[1], 16), int(match[2], 16)
        if pc < SPIKE_BASE or pc >= halt:
            continue
        rest = match[3].split()
        write = (int(rest[0][1:]), int(rest[1], 16)) if rest and re.fullmatch(r'x\d+', rest[0]) else (0, 0)
        stored = []
        if insn & 127 == 0x23:
            at = rest.index('mem')
            addr, value = int(rest[at + 1], 16), int(rest[at + 2], 16)
            stored = [(addr + k, (value >> (8 * k)) & 255) for k in range(1 << ((insn >> 12) & 3))]
        commits.append(((pc - SPIKE_BASE, insn) + (write if write[0] else (0, 0)), stored))
    return commits


def random_programs(simulators):
    results = []
    for seed in range(RANDOM_SEEDS):
        name = f'random_{seed}'
        source = BUILD / f'{name}.S'
        words = random_program(seed)
        source.write_text('#include "model_test.h"\n.section .text.init\n.globl rvtest_entry_point\nrvtest_entry_point:\n'
                          + ''.join(f'.word 0x{w:08x}\n' for w in words) + 'RVMODEL_HALT\n.data\nRVMODEL_DATA_BEGIN\n.word 0\nRVMODEL_DATA_END\n')
        spike_elf, dut_elf = BUILD / f'{name}.spike.elf', BUILD / f'{name}.dut.elf'
        build(source, 'spike', spike_elf)
        build(source, 'dut', dut_elf)
        halt = symbols(spike_elf)['rvmodel_halt']
        log = subprocess.run(SPIKE + ['-l', '--log-commits', str(spike_elf)], cwd=ROOT, capture_output=True, text=True, check=True).stderr
        commits = spike_commits(log, halt)
        expected = [c for c, _ in commits]
        expected_stores = [s for _, stores in commits for s in stores]
        assert len(expected) > 300, (name, len(expected))
        hexfile = image(dut_elf)
        for simulator in simulators:
            out = rtl(simulator, [f'+image={hexfile}', f'+halt={symbols(dut_elf)["rvmodel_halt"]:x}', '+trace'])
            observed, stores = [], []
            for line in out.splitlines():
                fields = line.split()
                if fields[:1] == ['RET'] and fields[5] == '0':
                    observed.append(tuple(int(n, 16) for n in fields[1:5]))
                elif fields[:1] == ['STORE']:
                    stores.append(tuple(int(n, 16) for n in fields[1:]))
            for index, (exp, obs) in enumerate(zip(expected + [None] * len(observed), observed + [None] * len(expected))):
                if exp != obs:
                    raise AssertionError(f'{name} {simulator} retirement {index}: Spike {exp}, RTL {obs}')
            assert stores == expected_stores, (name, simulator, 'store stream differs from Spike')
        results.append(dict(program=name, retired=len(expected), store_bytes=len(expected_stores)))
        print(f'PASS {name}: {len(expected)} retirements, {len(expected_stores)} store bytes match Spike in {", ".join(simulators)}')
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--simulators', default='icarus,verilator')
    args = parser.parse_args()
    simulators = args.simulators.split(',')
    BUILD.mkdir(parents=True, exist_ok=True)
    compile_rtl(simulators)
    arch = arch_tests(simulators)
    rand = random_programs(simulators)
    passed = [t for t in arch if t['status'] == 'pass']
    report = dict(
        scope='External reference comparison against Spike. This is not ACT4 and not RISC-V certification: the tests are the pinned '
              'riscv-arch-test 3.10.0 RISCOF-era RV32I suite, run by a local runner with this repository\'s model headers, and Spike is the only reference.',
        reference=dict(simulator='Spike (riscv-isa-sim)', commit=Path('/opt/spike/COMMIT').read_text().strip(), isa='rv32i',
                       version=subprocess.run(['spike', '--help'], capture_output=True, text=True).stderr.splitlines()[0]),
        arch_test=dict(release=Path('/opt/riscv-arch-test/VERSION').read_text().strip(), suite='riscv-test-suite/rv32i_m/I',
                       tests_total=len(arch), tests_passed=len(passed), tests_excluded=[t for t in arch if t['status'] == 'excluded'],
                       signature_words_compared=sum(t['signature_words'] for t in passed),
                       method='Each test is assembled twice from the same source: linked at 0x80000000 with a tohost halt for Spike, and at 0 with an ECALL halt for the core. '
                              'The core must reach the ECALL halt with no earlier trap; its memory between begin_signature and end_signature must equal Spike\'s +signature dump.',
                       results=arch),
        random_commit_log=dict(programs=len(rand), retirements_compared=sum(x['retired'] for x in rand),
                               store_bytes_compared=sum(x['store_bytes'] for x in rand),
                               method='Seeded random programs of 300 operations (ALU register/immediate, LUI, loads, stores, taken/not-taken branches, JAL over one instruction) with no DOT4 '
                                      'and no AUIPC or link values, because Spike runs the code at 0x80000000 and the core at 0. Data lives at 0x80010000 in both. '
                                      'Spike --log-commits supplies the expected PC (offset), instruction word, register write and store bytes for every retirement.',
                               results=rand),
        simulators=simulators,
        toolchain=subprocess.run(['riscv64-unknown-elf-gcc', '--version'], capture_output=True, text=True).stdout.splitlines()[0],
        source_sha256={p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in SOURCES})
    (ROOT / 'reports' / 'isa-compare.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'PASS arch-test: {len(passed)}/{len(arch)} RV32I tests; random: {len(rand)} programs, '
          f'{report["random_commit_log"]["retirements_compared"]} retirements match Spike')


if __name__ == '__main__':
    main()
