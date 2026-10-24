#!/usr/bin/env python3
"""Teaching examples checked in real Icarus simulation; separate from baseline metrics."""
import argparse
import importlib.util
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
BUILD = ROOT / 'build/learning-series'
spec = importlib.util.spec_from_file_location('core_tests', ROOT / 'tests/run.py')
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)
imm, store, branch, r = model.imm, model.store, model.branch, model.r
END = 0x00100073
NOP = 0x00000013


def constant(rd, n):
    return [((n + 0x800) & 0xfffff000) | (rd << 7) | 0x37,
            imm(0, rd, rd, model.signed(n & 4095, 12))]


def programs():
    # name -> (machine words, hand-computed final registers, hand-computed words,
    #          addresses that must never be written)
    return {
        'decode_add': ([imm(0,1,0,7),imm(0,2,0,3),r(0,3,1,2),END],{3:10},{},[]),
        'word_bytes': (constant(1,0x80ff007f)+[store(2,0,1,128),imm(0,3,0,131,3),imm(4,4,0,131,3),imm(5,5,0,130,3),END],{3:0xffffff80,4:128,5:0x80ff},{128:0x80ff007f},[]),
        'pipeline_spaced': ([imm(0,1,0,7),NOP,NOP,NOP,imm(0,2,0,3),NOP,NOP,NOP,r(0,3,1,2),END],{3:10},{},[]),
        'forward_priority': ([imm(0,1,0,5),imm(0,1,0,8),r(0,2,1,1),END],{2:16},{},[]),
        'wb_id': ([imm(0,1,0,7),imm(0,8,0,1),imm(0,9,0,2),r(0,2,1,1),END],{2:14},{},[]),
        'load_store': ([imm(0,1,0,9),store(2,0,1,128),imm(2,2,0,128,3),store(2,0,2,132),END],{2:9},{128:9,132:9},[]),
        'branch_flush': ([imm(0,1,0,7),branch(0,1,1,8),store(2,0,1,128),imm(0,2,0,42),END],{2:42},{},list(range(128,132))),
        'load_branch': ([imm(0,1,0,1),store(2,0,1,128),imm(2,2,0,128,3),branch(0,2,1,8),store(2,0,1,132),imm(0,3,0,42),END],{3:42},{128:1},list(range(132,136))),
        'load_jalr': ([imm(0,1,0,24),store(2,0,1,128),imm(2,2,0,128,3),imm(0,3,2,0,0x67),store(2,0,1,132),NOP,imm(0,4,3,1),END],{3:16,4:17},{128:24},list(range(132,136))),
        'dot_mixed': (constant(1,0x0102ff80)+constant(2,0x020304ff)+[r(0,3,1,2,op=0x0b),imm(0,4,3,1),END],{3:132,4:133},{},[]),
        'dot_load': (constant(1,0x01020304)+[store(2,0,1,128)]+constant(2,0x01010101)+[imm(2,3,0,128,3),r(0,4,3,2,op=0x0b),store(2,0,4,132),END],{4:10},{128:0x01020304,132:10},[]),
        'dot_extremes': (constant(1,0x80808080)+constant(2,0x7f7f7f7f)+[r(0,3,1,1,op=0x0b),r(0,4,1,2,op=0x0b),END],{3:65536,4:(-65024)&0xffffffff},{},[]),
        'illegal_branch': ([branch(2,0,0,8),store(2,0,0,128),END],{},{},list(range(128,132))),
        'misaligned_load': ([imm(2,1,0,1,3),store(2,0,0,128),END],{},{},list(range(128,132))),
    }


def run(command):
    result = subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
    if result.returncode:
        raise RuntimeError(f'{command}\n{result.stdout}\n{result.stderr}')
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', choices=sorted(programs()))
    parser.add_argument('--list', action='store_true')
    args = parser.parse_args()
    if args.list:
        print('\n'.join(programs()))
        return
    BUILD.mkdir(parents=True,exist_ok=True)
    units = []
    if not args.case:
        for top, source in [('rtl_basics_tb','rtl_basics.sv'),('single_cycle_tb','single_cycle.sv')]:
            executable = BUILD / top
            run(['iverilog','-g2012','-s',top,'-o',str(executable),str(Path(__file__).parent/source)])
            output = run(['vvp',str(executable)])
            (BUILD/(top+'.log')).write_text(output)
            print(output.strip())
            units.append(top)
    executable = BUILD / 'core-sim'
    run(['iverilog','-g2012','-s','tb','-o',str(executable),'rtl/rv32_core.sv','tests/tb.sv'])
    results = []
    for name,(words,registers,word_values,forbidden) in programs().items():
        if args.case and name != args.case:
            continue
        hex_path = BUILD / (name+'.hex')
        hex_path.write_text(''.join(f'{word:08x}\n' for word in words))
        expected,expected_writes,_ = model.reference(words)
        output = run(['vvp',str(executable),'+program='+str(hex_path)])
        observed = [tuple(int(n,16) for n in line.split()[1:]) for line in output.splitlines() if line.startswith('RET ')]
        writes = [tuple(int(n,16) for n in line.split()[1:]) for line in output.splitlines() if line.startswith('STORE ')]
        assert observed == expected,(name,'retirement mismatch',output)
        assert writes == expected_writes,(name,'write mismatch',output)
        final_regs = {0:0}
        for _,_,rd,value,trap,_ in observed:
            if rd and not trap:
                final_regs[rd] = value
        assert all(final_regs.get(rd,0)==value for rd,value in registers.items()),(name,final_regs)
        memory = dict(writes)
        for address,value in word_values.items():
            assert sum(memory.get(address+i,0) << (8*i) for i in range(4)) == value,(name,address)
        assert not any(address in forbidden for address,_ in writes),(name,'forbidden write')
        (BUILD/(name+'.log')).write_text(output)
        record = {'case':name,'retirement_records':len(observed),'stall_events':output.splitlines().count('STALL'),'flush_events':output.splitlines().count('FLUSH'),'passed':True}
        results.append(record)
        print('PASS',name)
    report = {'scope':'Supplemental teaching labs; not baseline coverage or certification','unit_benches':units,'core_programs':results}
    (BUILD/'results.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__ == '__main__':
    main()
