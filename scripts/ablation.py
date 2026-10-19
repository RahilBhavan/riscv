#!/usr/bin/env python3
"""DOT4 area/timing ablation through the `make timing` flow, then clock-adjusted throughput.

Each configuration is synthesized once (Yosys is deterministic) and placed and
routed with several nextpnr seeds, because post-route Fmax moves with the seed.
Setting DOT4 with chparam re-derives the module, which by itself changes the
Yosys netlist, so the compared pair both use chparam. The unmodified default
flow is a third configuration: it must reproduce reports/implementation.json
and shows how far the same logic moves when only the synthesis entry differs.
Throughput multiplies reports/benchmark.json simulation cycles by each
configuration's median Fmax. All values are estimates; no board was run.
"""
import hashlib
import json
import statistics
import subprocess
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build' / 'ablation'
SEEDS = (1, 2, 3, 4, 5)
# name: (DOT4 value, set through chparam)
CONFIGS = {'dot4_1': (1, True), 'dot4_0': (0, True), 'dot4_1_default_flow': (1, False)}


def sha(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def synthesize(name):
    dot4, chparam = CONFIGS[name]
    out = BUILD / name
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run(['yosys', '-ql', str(out / 'synthesis.log'), '-p',
                    'read_verilog -sv rtl/rv32_core.sv rtl/timing_top.sv; ' + (f'chparam -set DOT4 {dot4} rv32_core; ' if chparam else '') +
                    
                    f'synth_ice40 -top timing_top -json {out}/core.json; stat'], cwd=ROOT, check=True)
    cells = Counter(cell['type'] for cell in json.loads((out / 'core.json').read_text())['modules']['timing_top']['cells'].values())
    return dict(lut4=cells['SB_LUT4'], flip_flops=sum(n for t, n in cells.items() if t.startswith('SB_DFF')),
                carry=cells['SB_CARRY'], synthesis_primitives=dict(sorted(cells.items())))


def route(name, seed):
    out = BUILD / name
    report = out / f'timing-seed{seed}.json'
    with open(out / f'nextpnr-seed{seed}.log', 'w') as log:
        subprocess.run(['nextpnr-ice40', '--hx8k', '--package', 'ct256', '--json', str(out / 'core.json'),
                        '--asc', str(out / f'core-seed{seed}.asc'), '--pcf-allow-unconstrained', '--freq', '12',
                        '--seed', str(seed), '--report', str(report)], stdout=log, stderr=subprocess.STDOUT, check=True)
    raw = json.loads(report.read_text())
    (fmax,) = raw['fmax'].values()
    return dict(seed=seed, fmax_mhz=fmax['achieved'], logic_cells=raw['utilization']['ICESTORM_LC']['used'])


def spread(values):
    return dict(min=min(values), median=statistics.median(values), max=max(values))


def main():
    bench = json.loads((ROOT / 'reports' / 'benchmark.json').read_text())
    assert bench['sources']['rtl/rv32_core.sv'] == sha('rtl/rv32_core.sv'), 'benchmark.json is stale: run make bench'
    with ThreadPoolExecutor(len(CONFIGS)) as pool:
        synth = dict(zip(CONFIGS, pool.map(synthesize, CONFIGS)))
    jobs = [(c, s) for c in CONFIGS for s in SEEDS]
    with ThreadPoolExecutor(len(jobs)) as pool:
        routes = dict(zip(jobs, pool.map(lambda job: route(*job), jobs)))
    variants = {}
    for c, (dot4, chparam) in CONFIGS.items():
        runs = [routes[c, s] for s in SEEDS]
        variants[c] = dict(
            dot4=dot4, chparam=chparam,
            **synth[c],
            logic_cells=spread([run['logic_cells'] for run in runs]),
            logic_cells_available=7680,
            fmax_mhz=spread([run['fmax_mhz'] for run in runs]),
            seeds=runs,
        )
    on, off, default = variants['dot4_1'], variants['dot4_0'], variants['dot4_1_default_flow']
    official = json.loads((ROOT / 'reports' / 'implementation.json').read_text())
    assert official['rtl_sha256']['rtl/rv32_core.sv'] == sha('rtl/rv32_core.sv'), 'implementation.json is stale: run make timing'
    (official_fmax,) = official['fmax'].values()
    assert (default['lut4'], default['flip_flops'], default['seeds'][0]['fmax_mhz']) == (
        official['synthesis_primitives']['SB_LUT4'], official['flip_flops'], official_fmax['achieved']), \
        'default-flow DOT4=1 seed 1 does not reproduce reports/implementation.json'

    throughput = []
    for row in bench['speedup']:
        if row['dataset'] != 'uniform':
            continue
        entry = dict(n=row['n'])
        for kernel, variant in (('dot4', on), ('rv32i_qsquare', off), ('rv32i_lb', off), ('rv32i_shift', off)):
            mhz = variant['fmax_mhz']
            cycles = row[f'cycles_{kernel}']
            entry[kernel] = dict(cycles=cycles, core='DOT4=1' if variant is on else 'DOT4=0',
                                 dot_products_per_s=round(mhz['median'] * 1e6 / cycles),
                                 macs_per_s=round(mhz['median'] * 1e6 * row['n'] / cycles))
            if kernel != 'dot4':
                # Range pairs the worst DOT4 seed with the best baseline seed, and the reverse.
                entry[f'speedup_vs_{kernel}'] = dict(
                    cycles=round(cycles / row['cycles_dot4'], 3),
                    clock_adjusted_median=round(cycles / row['cycles_dot4'] * on['fmax_mhz']['median'] / mhz['median'], 3),
                    clock_adjusted_min=round(cycles / row['cycles_dot4'] * on['fmax_mhz']['min'] / mhz['max'], 3),
                    clock_adjusted_max=round(cycles / row['cycles_dot4'] * on['fmax_mhz']['max'] / mhz['min'], 3))
        throughput.append(entry)

    report = dict(
        what='Post-route estimates for timing_top (core plus registered measurement shell) on iCE40 HX8K CT256; not board measurements.',
        flow='Same commands as make timing: synth_ice40, nextpnr-ice40 --hx8k --package ct256 --pcf-allow-unconstrained --freq 12. dot4_1 and dot4_0 set DOT4 with chparam; dot4_1_default_flow is make timing unchanged.',
        official_seed1_reproduced=True,
        seeds=list(SEEDS),
        variants=variants,
        delta_dot4_on_minus_off=dict(lut4=on['lut4'] - off['lut4'], flip_flops=on['flip_flops'] - off['flip_flops'],
                                     carry=on['carry'] - off['carry'],
                                     median_logic_cells=on['logic_cells']['median'] - off['logic_cells']['median'],
                                     median_fmax_mhz=round(on['fmax_mhz']['median'] - off['fmax_mhz']['median'], 3)),
        same_logic_netlist_spread=dict(lut4=on['lut4'] - default['lut4'], carry=on['carry'] - default['carry'],
                                       median_fmax_mhz=round(on['fmax_mhz']['median'] - default['fmax_mhz']['median'], 3)),
        throughput_definition='One output is one N-element int8 dot product. outputs/s = median Fmax / simulation cycles. Baselines run on dot4_0, DOT4 on dot4_1 (the chparam pair).',
        throughput=throughput,
        rtl_sha256={str(p.relative_to(ROOT)): sha(p.relative_to(ROOT)) for p in sorted((ROOT / 'rtl').glob('*.sv'))},
        benchmark_sources=bench['sources'],
        tools={'yosys': subprocess.run(['yosys', '-V'], capture_output=True, text=True).stdout.strip(),
               'nextpnr-ice40': subprocess.run(['nextpnr-ice40', '--version'], capture_output=True, text=True).stderr.strip()},
    )
    (ROOT / 'reports' / 'ablation.json').write_text(json.dumps(report, indent=2) + '\n')
    for name, v in variants.items():
        f = v['fmax_mhz']
        print(f"{name}: LUT4 {v['lut4']}  FF {v['flip_flops']}  LC median {v['logic_cells']['median']}  "
              f"Fmax min/median/max {f['min']:.2f}/{f['median']:.2f}/{f['max']:.2f} MHz")
    for entry in throughput:
        print(f"N={entry['n']:3}  " + '  '.join(f"{k}: {entry[f'speedup_vs_{k}']['clock_adjusted_median']}x" for k in ('rv32i_qsquare', 'rv32i_lb', 'rv32i_shift')))


if __name__ == '__main__':
    main()
