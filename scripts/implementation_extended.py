#!/usr/bin/env python3
"""Area and post-route timing estimate of the MEXT=1 ZICSR=1 core on iCE40 HX8K.

Same tools and nextpnr options as `make timing`, through rtl/timing_top_extended.sv, over the
ablation's five route seeds. Writes reports/implementation-extended.json. No board was run.
"""
import hashlib
import json
import statistics
import subprocess
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'build' / 'implementation-extended'
SEEDS = (1, 2, 3, 4, 5)
SOURCES = ['rtl/rv32_core.sv', 'rtl/timing_top_extended.sv', 'scripts/implementation_extended.py']


def route(seed):
    report = OUT / f'timing-seed{seed}.json'
    with open(OUT / f'nextpnr-seed{seed}.log', 'w') as log:
        subprocess.run(['nextpnr-ice40', '--hx8k', '--package', 'ct256', '--json', str(OUT / 'core.json'),
                        '--asc', str(OUT / f'core-seed{seed}.asc'), '--pcf-allow-unconstrained', '--freq', '12',
                        '--seed', str(seed), '--report', str(report)], stdout=log, stderr=subprocess.STDOUT, check=True)
    raw = json.loads(report.read_text())
    (fmax,) = raw['fmax'].values()
    return dict(seed=seed, fmax_mhz=round(fmax['achieved'], 2), logic_cells=raw['utilization']['ICESTORM_LC']['used'],
                logic_cells_available=raw['utilization']['ICESTORM_LC']['available'])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    subprocess.run(['yosys', '-ql', str(OUT / 'synthesis.log'), '-p', 'read_verilog -sv rtl/rv32_core.sv rtl/timing_top_extended.sv; '
                    f'synth_ice40 -top timing_top_extended -json {OUT}/core.json; stat'], cwd=ROOT, check=True)
    cells = Counter(c['type'] for c in json.loads((OUT / 'core.json').read_text())['modules']['timing_top_extended']['cells'].values())
    with ThreadPoolExecutor(len(SEEDS)) as pool:
        seeds = list(pool.map(route, SEEDS))
    fmax = [s['fmax_mhz'] for s in seeds]
    report = dict(
        what='Post-route estimate of the MEXT=1 ZICSR=1 core through the registered measurement shell rtl/timing_top_extended.sv on iCE40 HX8K (ct256), '
             '12 MHz constraint. FPGA resources, not ASIC area. No board was run. The shell keeps ready and the interrupt lines as registered '
             'inputs; like timing_top it excludes memories, peripherals and external I/O timing.',
        lut4=cells['SB_LUT4'], flip_flops=sum(n for t, n in cells.items() if t.startswith('SB_DFF')), carry=cells['SB_CARRY'],
        logic_cells=seeds[0]['logic_cells'], logic_cells_available=seeds[0]['logic_cells_available'],
        logic_cell_percent=round(100 * seeds[0]['logic_cells'] / seeds[0]['logic_cells_available'], 1),
        fmax_mhz=dict(min=min(fmax), median=statistics.median(fmax), max=max(fmax)), seeds=seeds,
        meets_12mhz_every_seed=min(fmax) >= 12,
        tools=dict(yosys=subprocess.run(['yosys', '-V'], capture_output=True, text=True).stdout.strip(),
                   nextpnr=subprocess.run(['nextpnr-ice40', '--version'], capture_output=True, text=True).stderr.strip() or
                   subprocess.run(['nextpnr-ice40', '--version'], capture_output=True, text=True).stdout.strip()),
        source_sha256={p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in SOURCES})
    (ROOT / 'reports' / 'implementation-extended.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('lut4', 'flip_flops', 'logic_cells', 'logic_cell_percent', 'fmax_mhz')}))


if __name__ == '__main__':
    main()
