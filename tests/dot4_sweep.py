#!/usr/bin/env python3
"""Exhaustive isolated-lane DOT4 sweep and custom-0 encoding check in Icarus and Verilator.

The RTL bench checks each case against a scalar product as it retires. This script
recomputes the ordered result checksum from a separate Python scalar oracle.
"""
import hashlib
import json
import subprocess
import time
from pathlib import Path

from run import imm, r, branch, signed

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build' / 'dot4'
SOURCES = ['rtl/rv32_core.sv', 'tests/dot4_tb.sv', 'tests/invariants.svh']


def sweep_program():
    shift, a, b, x, y, bound, lanes = 10, 11, 12, 14, 15, 17, 18
    return [
        imm(0, bound, 0, 128), imm(0, lanes, 0, 32), imm(0, shift, 0, 0),
        imm(0, a, 0, -128),                                      # lane loop
        imm(7, x, a, 255), r(1, x, x, shift), imm(0, b, 0, -128),  # a loop
        imm(7, y, b, 255), r(1, y, y, shift), r(0, 16, x, y, op=0x0b), imm(0, b, b, 1), branch(4, b, bound, -16),
        imm(0, a, a, 1), branch(4, a, bound, -36),
        imm(0, shift, shift, 8), branch(4, shift, lanes, -48),
        0x00100073,
    ]


def oracle_checksum():
    checksum = 0
    for lane in range(4):
        for a in range(-128, 128):
            for b in range(-128, 128):
                checksum = ((checksum ^ (a * b & 0xffffffff)) * 16777619) & 0xffffffff
    return checksum


def field(text, key):
    return next(word.split('=')[1] for line in text.splitlines() for word in line.split() if word.startswith(key + '='))


def simulate(simulator, args):
    if simulator == 'icarus':
        command = ['vvp', str(BUILD / 'icarus')]
    else:
        command = [str(BUILD / 'verilator' / 'Vdot4_tb')]
    start = time.monotonic()
    proc = subprocess.run(command + args, capture_output=True, text=True, cwd=ROOT)
    if proc.returncode != 0 or 'INVARIANT FAILED' in proc.stdout:
        raise SystemExit(f'{simulator} {args} failed:\n{proc.stdout[-3000:]}\n{proc.stderr[-3000:]}')
    return proc.stdout, round(time.monotonic() - start, 1)


def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    program = BUILD / 'sweep.hex'
    program.write_text(''.join(f'{word:08x}\n' for word in sweep_program()))
    subprocess.run(['iverilog', '-g2012', '-s', 'dot4_tb', '-o', str(BUILD / 'icarus'), *SOURCES[:2]], cwd=ROOT, check=True)
    subprocess.run(['verilator', '--binary', '--timing', '-Wno-fatal', '-Wno-lint', '-Wno-style', '--top-module', 'dot4_tb',
                    '--Mdir', str(BUILD / 'verilator'), *SOURCES[:2]], cwd=ROOT, check=True, capture_output=True)
    expected = oracle_checksum()
    results = {}
    for simulator in ('verilator', 'icarus'):
        sweep, sweep_seconds = simulate(simulator, ['+sweep', f'+program={program}'])
        encodings, encoding_seconds = simulate(simulator, ['+encodings'])
        cases, checksum = int(field(sweep, 'cases')), int(field(sweep, 'checksum'), 16)
        assert cases == 262144 and checksum == expected, (simulator, cases, hex(checksum), hex(expected))
        assert field(encodings, 'encodings') == '1024' and field(encodings, 'trapped') == '1023' and field(encodings, 'executed') == '1'
        results[simulator] = dict(sweep_cases=cases, sweep_cycles=int(field(sweep, 'cycles')), checksum=f'{checksum:08x}',
                                  sweep_seconds=sweep_seconds, custom0_encodings=1024, custom0_trapped=1023,
                                  custom0_executed=1, encoding_seconds=encoding_seconds)
        print(f'PASS {simulator}: {cases} DOT4 lane cases, checksum {checksum:08x}; 1023/1023 invalid custom-0 encodings trapped')
    report = dict(
        scope='Every signed byte pair (65,536) in each of the four DOT4 lanes with the other lanes zero: 262,144 DOT4 instructions executed by the full core. '
              'Each retirement is compared with a scalar product of the expected bytes (tests/dot4_tb.sv), the forwarded EX operands are checked per case, '
              'and the ordered checksum is compared with an independent Python scalar oracle. All 1,024 custom-0 funct3/funct7 combinations run from reset; '
              'only funct3=0/funct7=0 executes, the other 1,023 trap with no register or store side effect. Multi-lane sums are covered by directed and random programs, not exhaustively.',
        oracle_checksum=f'{expected:08x}', simulators=results,
        source_sha256={p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in SOURCES + ['tests/dot4_sweep.py']})
    (ROOT / 'reports' / 'dot4-sweep.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
