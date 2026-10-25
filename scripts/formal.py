#!/usr/bin/env python3
"""Run riscv-formal on the default and extended cores and write reports/formal.json.

Runs inside the rv32-formal image (pinned riscv-formal and OSS CAD Suite). Each check is a
bounded model check from reset to the depth in formal/<config>.cfg, not an unbounded proof.
Usage: formal.py [--jobs N] [--only REGEX]
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'build' / 'formal'
CONFIGS = ('base', 'extended')


def setup():
    shutil.rmtree(WORK, ignore_errors=True)
    shutil.copytree('/opt/riscv-formal', WORK / 'riscv-formal', ignore=shutil.ignore_patterns('cores'))
    core = WORK / 'riscv-formal' / 'cores' / 'rv32'
    core.mkdir(parents=True)
    for source in ('formal/wrapper.sv', 'rtl/rv32_core.sv', *(f'formal/{c}.cfg' for c in CONFIGS)):
        shutil.copy(ROOT / source, core)
    return core


def run(core, config, jobs, only):
    subprocess.run(['python3', '../../checks/genchecks.py', config], cwd=core, check=True, capture_output=True, text=True)
    checks = sorted(p.stem for p in (core / config).glob('*.sby') if re.search(only, p.stem))
    assert checks, f'no {config} checks match {only}'
    start = time.time()
    subprocess.run(['make', '-k', '-j', str(jobs), '-C', config, *checks], cwd=core, capture_output=True, text=True)
    results = []
    for check in checks:
        status_file = core / config / check / 'status'
        status = status_file.read_text().split()[0] if status_file.exists() else 'MISSING'
        results.append(dict(check=check, status=status))
        print(f'{status:7} {config} {check}', flush=True)
    return dict(checks=len(results), passed=sum(r['status'] == 'PASS' for r in results),
                seconds=round(time.time() - start), results=results)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--jobs', type=int, default=os.cpu_count())
    parser.add_argument('--only', default='.', help='regex selecting check names, for local iteration')
    args = parser.parse_args()
    core = setup()
    report = dict(
        scope='riscv-formal bounded model checks of the RVFI trace. Each check starts from reset and covers every input sequence up to its '
              'depth in cycles (formal/<config>.cfg); it is not an unbounded proof. Instruction words, load data, both ready signals and '
              'the interrupt lines are unconstrained. The extended core runs with RISCV_FORMAL_ALTOPS, so M operations are checked as '
              'riscv-formal\'s alternative add/sub-and-xor operations: this verifies their decode, operand forwarding and hold logic, '
              'not the multiply/divide arithmetic, which tests/isa_compare.py compares with Spike. CSR instructions report no RVFI CSR '
              'ports, so the csrw and csr_ill checks do not run; the extended regression and the privilege suite cover CSR behavior.',
        riscv_formal=Path('/opt/riscv-formal/COMMIT').read_text().strip(),
        oss_cad_suite=Path('/opt/oss-cad-suite/VERSION').read_text().split()[0],
        configurations={c: run(core, c, args.jobs, args.only) for c in CONFIGS},
        source_sha256={p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
                       for p in ['rtl/rv32_core.sv', 'formal/wrapper.sv', *(f'formal/{c}.cfg' for c in CONFIGS), 'scripts/formal.py']})
    if args.only == '.':
        (ROOT / 'reports' / 'formal.json').write_text(json.dumps(report, indent=2) + '\n')
    failed = [f"{c} {r['check']}" for c, v in report['configurations'].items() for r in v['results'] if r['status'] != 'PASS']
    assert not failed, f'formal checks did not pass: {failed}'
    print(json.dumps({c: {k: v[k] for k in ('checks', 'passed', 'seconds')} for c, v in report['configurations'].items()}))


if __name__ == '__main__':
    main()
