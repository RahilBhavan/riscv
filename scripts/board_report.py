#!/usr/bin/env python3
"""Summarize a board build into reports/<stem>.json and fail if memories left block RAM."""
import hashlib
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

stem, target_mhz = sys.argv[1], float(sys.argv[2])
build = Path('build/board')
timing = json.loads((build / f'{stem}-timing.json').read_text())
cells = Counter(c['type'] for c in json.loads((build / f'{stem}.json').read_text())['modules']['board_top']['cells'].values())
bram = {name: n for name, n in cells.items() if name.startswith('SB_RAM40_4K')}
# 2048x32 program ROM (bits [1:0] are constant 11 and fold away) plus 1024x32 data RAM.
assert sum(bram.values()) >= 23, f'memories did not map to block RAM: {bram}'
assert not any(name.startswith('$mem') for name in cells), 'unmapped memory cell left in netlist'
(clock, fmax), = timing['fmax'].items()
assert fmax['achieved'] >= target_mhz, f'{clock} achieved {fmax["achieved"]:.2f} MHz < {target_mhz} MHz'
program = (build / 'board_program.vh').read_text()
critical = [{'from': p['from'], 'to': p['to'], 'delay_ns': round(sum(s['delay'] for s in p['path']), 2)} for p in timing['critical_paths']]

report = {
    'board': 'Lattice iCE40-HX8K Breakout Board (ICE40HX8K-B-EVN), iCE40HX8K CT256',
    'design': f'board_top ({stem}): core, 8 KiB program ROM and 4 KiB data RAM in falling-edge block RAM, signature checker, LEDs, UART',
    'board_tested': False,
    'constraint_mhz': target_mhz,
    'seed': 1,
    'clock': clock,
    'fmax_mhz': round(fmax['achieved'], 2),
    'critical_paths': critical,
    'note': 'nextpnr reports one critical path per clock pair; rising-to-falling block-RAM paths are budgeted at half a period and are included in fmax_mhz.',
    'utilization': timing['utilization'],
    'block_ram_cells': bram,
    'flip_flops': sum(n for name, n in cells.items() if name.startswith('SB_DFF')),
    'luts': cells['SB_LUT4'],
    'synthesis_primitives': dict(sorted(cells.items())),
    'self_test': {
        'expected_signature': re.search(r"EXPECTED_SIGNATURE = 32'h(\w+)", program)[1],
        'retired_per_pass': int(re.search(r'RETIRED_PER_PASS = (\d+)', program)[1]),
    },
    'bitstream_sha256': hashlib.sha256((build / f'{stem}.bin').read_bytes()).hexdigest(),
    'rtl_sha256': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(Path('rtl').glob('*.sv'))},
    # nextpnr writes its version to stderr on some distributions.
    'tools': {cmd[0]: (lambda r: (r.stdout + r.stderr).strip())(subprocess.run(cmd, capture_output=True, text=True, check=True))
              for cmd in (['yosys', '-V'], ['nextpnr-ice40', '--version'])},
}
Path('reports', f'{stem}.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: report[k] for k in ('clock', 'fmax_mhz', 'block_ram_cells', 'utilization')}, indent=2))
