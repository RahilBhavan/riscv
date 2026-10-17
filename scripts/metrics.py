#!/usr/bin/env python3
import gzip
import hashlib
import shutil
from collections import Counter
import json
import subprocess
from pathlib import Path

raw = json.loads(Path('build/timing.json').read_text())
cells = Counter(cell['type'] for cell in json.loads(Path('build/core.json').read_text())['modules']['timing_top']['cells'].values())
report = {
    'target': 'Lattice iCE40 HX8K, CT256',
    'design': 'timing_top: core plus registered input/observation shell; excludes memories and peripherals',
    'constraint_mhz': 12,
    'seed': 1,
    'board_tested': False,
    'io_constraints': 'Unconstrained package I/O; registered shell, no external timing closure',
    'fmax': raw['fmax'],
    'utilization': raw['utilization'],
    'synthesis_primitives': dict(sorted(cells.items())),
    'flip_flops': sum(count for name, count in cells.items() if name.startswith('SB_DFF')),
    'rtl_sha256': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(Path('rtl').glob('*.sv'))},
    'tools': {cmd[0]: subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.strip() for cmd in (['yosys', '-V'], ['nextpnr-ice40', '--version'])},
}
# nextpnr writes its version to stderr on some distributions.
report['tools']['nextpnr-ice40'] = subprocess.run(['nextpnr-ice40', '--version'], capture_output=True, text=True, check=True).stderr.strip() or report['tools']['nextpnr-ice40']
Path('reports/implementation.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))

Path('reports/raw').mkdir(exist_ok=True)
for name in ('timing.json', 'nextpnr.log'):
    shutil.copyfile('build/' + name, 'reports/raw/' + name)
Path('reports/raw/synthesis.log.gz').write_bytes(gzip.compress(Path('build/synthesis.log').read_bytes(), mtime=0))
