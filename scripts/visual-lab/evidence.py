#!/usr/bin/env python3
"""Export real pipeline snapshots only after checking architectural results."""
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT/'build/visual-lab'
BUILD.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('labs',ROOT/'docs/textbook/series/labs/run_labs.py')
labs=importlib.util.module_from_spec(spec)
spec.loader.exec_module(labs)
def run(args):
    return subprocess.run(args,cwd=ROOT,check=True,capture_output=True,text=True).stdout
run(['iverilog','-g2012','-s','tb','-o',str(BUILD/'sim'),'rtl/rv32_core.sv','tests/tb.sv'])
traces={}
for name in ['decode_add','pipeline_spaced','forward_priority','load_store','branch_flush','dot_mixed']:
    words,*_=labs.programs()[name]
    program=BUILD/(name+'.hex')
    program.write_text(''.join(f'{word:08x}\n' for word in words))
    output=run(['vvp',str(BUILD/'sim'),'+program='+str(program),'+trace'])
    expected,writes,_=labs.model.reference(words)
    actual=[tuple(int(v,16) for v in line.split()[1:]) for line in output.splitlines() if line.startswith('RET ')]
    stores=[tuple(int(v,16) for v in line.split()[1:]) for line in output.splitlines() if line.startswith('STORE ')]
    assert actual==expected and stores==writes,name
    frames=[]
    for line in output.splitlines():
        if not line.startswith('TRACE '): continue
        v=line.split()[1:]
        frames.append(dict(cycle=int(v[0]),stages=[{'pc':int(v[1+2*i],16),'valid':bool(int(v[2+2*i],16))} for i in range(5)],stall=bool(int(v[11],16)),flush=bool(int(v[12],16)),a=int(v[13],16),b=int(v[14],16)))
    traces[name]={'words':words,'frames':frames,'retirements':len(actual),'stores':len(stores),'checked':True}
    (BUILD/(name+'.log')).write_text(output)
report={'scope':'Icarus RTL snapshots at falling edges; displayed stages describe the interval before the next rising edge. IF is fetch address, ID=f, EX=x, MEM=m, WB=w. Stall/flush apply at the next rising edge. Retirement interface is registered after WB.','source_sha256':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in ['rtl/rv32_core.sv','tests/tb.sv','tests/run.py']},'traces':traces}
(ROOT/'reports/visual-traces.json').write_text(json.dumps(report,indent=2)+'\n')
print('PASS 6 RTL traces: retirement and byte stores agree with sequential oracle')
