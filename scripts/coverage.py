#!/usr/bin/env python3
"""Count Verilator line instrumentation points for the core, without exclusions."""
import gzip
import hashlib
import json
import subprocess
import re
from pathlib import Path

points = {}
for line in Path('build/merged.dat').read_text().splitlines():
    if not line.startswith('C '):
        continue
    fields = dict(re.findall(r'\x01([^\x01\x02]+)\x02([^\x01\x02]*)', line.split("'")[1]))
    if fields.get('f') != 'rtl/rv32_core.sv' or fields.get('page') != 'v_line/rv32_core':
        continue
    key = (fields['l'], fields.get('o', ''))
    points[key] = points.get(key, 0) + int(line.rsplit(' ', 1)[1])
if not points:
    raise SystemExit('No core coverage points found; inspect Verilator format/version')
hit = sum(count > 0 for count in points.values())
report = dict(metric='Verilator line instrumentation points', scope='rtl/rv32_core.sv only; no exclusions', hit=hit, total=len(points), percent=round(100 * hit / len(points), 2), uncovered=[list(key) for key, count in points.items() if not count])
report['tool'] = subprocess.run(['verilator', '--version'], capture_output=True, text=True, check=True).stdout.strip()
report['rtl_sha256'] = hashlib.sha256(Path('rtl/rv32_core.sv').read_bytes()).hexdigest()
Path('reports/line-coverage.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))

if report['percent'] < 95:
    raise SystemExit('Core line-instrumentation coverage is below the 95% target')

Path('reports/raw').mkdir(exist_ok=True)
Path('reports/raw/line-coverage.dat.gz').write_bytes(gzip.compress(Path('build/merged.dat').read_bytes(), mtime=0))
