#!/usr/bin/env python3
"""Verify the complete project artifacts, then package an offline source release."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
from zipfile import ZipFile, ZIP_DEFLATED

ROOT=Path(__file__).resolve().parents[2]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def load(path):
    return json.loads((ROOT/path).read_text())

def require(condition, message):
    if not condition:
        raise SystemExit(message)

def verify():
    core=sha(ROOT/'rtl/rv32_core.sv')
    for report,key in [('reports/verification.json','source_sha256'),('reports/visual-traces.json','source_sha256'),('reports/implementation.json','rtl_sha256'),('reports/dot4-sweep.json','source_sha256'),('reports/isa-compare.json','source_sha256'),('reports/mutation.json','source_sha256')]:
        for path,digest in load(report)[key].items():
            require(sha(ROOT/path)==digest,f'Stale source in {report}: {path}')
    coverage=load('reports/line-coverage.json')
    require(coverage['rtl_sha256']==core,'Stale line coverage')
    require(coverage['percent']>=95,'Core line coverage below 95%')
    verification=load('reports/verification.json')
    require(verification['test_cases']>=144 and not verification['missing_bins'],'Regression/bin report incomplete')
    require(not verification['hazard_cross_missing'] and verification['invariant_cycles_checked']>0,'Hazard cross or invariants incomplete')
    dot4=load('reports/dot4-sweep.json')
    require(all(r['sweep_cases']==262144 and r['custom0_trapped']==1023 for r in dot4['simulators'].values()) and len(dot4['simulators'])==2,'DOT4 sweep incomplete')
    isa=load('reports/isa-compare.json')
    require(isa['arch_test']['tests_passed']+len(isa['arch_test']['tests_excluded'])==isa['arch_test']['tests_total'] and isa['random_commit_log']['programs']>0,'Spike comparison incomplete')
    mutation=load('reports/mutation.json')
    require(mutation['killed']==mutation['mutants'],'A mutant survived its checker')
    teaching=load('build/learning-series/results.json')
    require(len(teaching['unit_benches'])==2 and len(teaching['core_programs'])==14 and all(x['passed'] for x in teaching['core_programs']),'Teaching labs incomplete')
    require('PASS pending store reset' in (ROOT/'build/project/rtl.log').read_text(),'Pending-memory reset test did not pass in the full build')
    manifest=load('output/visual-lab/manifest.json')
    require(manifest['rtl_sha256']==core and len(manifest['views'])==8,'Visual lab missing views/current source')
    traces=load('reports/visual-traces.json')['traces']
    require(len(traces)==6 and all(t['checked'] and t['frames'] for t in traces.values()),'Missing checked RTL traces')
    implementation=load('reports/implementation.json')
    require(all(v['achieved']>=v['constraint'] for v in implementation['fmax'].values()),'Timing constraint failed')
    pdfs=[('output/textbook/riscv-textbook.pdf',35),('output/textbook/riscv-review-slides.pdf',14)]
    for book in load('output/textbook/series/catalog.json')['volumes']:
        pdfs.append(('output/textbook/series/'+book['id']+'.pdf',book['pages']))
    require(len(pdfs)==10,'Expected eight books, overview and review deck')
    documents=[]
    for name,expected in pdfs:
        path=ROOT/name
        require(path.is_file(),f'Missing {name}')
        info=subprocess.run(['pdfinfo',str(path)],check=True,capture_output=True,text=True).stdout
        match=re.search(r'^Pages:\s+(\d+)',info,re.M)
        require(match is not None and int(match[1])==expected,f'Unexpected page count for {name}')
        text=subprocess.run(['pdftotext',str(path),'-'],check=True,capture_output=True,text=True).stdout
        pages=text.split('\f')
        require(len(pages)>=expected and all(p.strip() for p in pages[:expected]),f'Blank/unreadable pages in {name}')
        require(path.with_suffix('.html').is_file(),f'Missing HTML companion for {name}')
        documents.append({'path':name,'pages':expected,'sha256':sha(path)})
    with ZipFile(ROOT/'output/textbook/riscv-build-textbooks.zip') as archive:
        require(archive.testzip() is None,'Corrupt textbook archive')
        for doc in documents[2:]:
            filename='series/'+Path(doc['path']).name
            require(filename in archive.namelist() and hashlib.sha256(archive.read(filename)).hexdigest()==doc['sha256'],f'Stale textbook archive member: {filename}')
    # Check generated navigation targets against the actual tree, not only a manifest.
    for html in [ROOT/'output/START-HERE.html',ROOT/'output/textbook/series/index.html']:
        if not html.exists():
            require(html.name=='START-HERE.html',f'Missing {html}')
            continue
        for href in re.findall(r'href="([^"]+)"',html.read_text()):
            if href.startswith(('https:','http:','#','data:')):continue
            require((html.parent/href.split('#')[0]).is_file(),f'Broken local link in {html.name}: {href}')
    return {'scope':'Complete local build: RTL regression, teaching/reset tests, lint, coverage, synthesis/route, ten PDF/HTML documents, visual models and eight-view lab. No board execution.','rtl_sha256':core,'verification':{'programs':verification['test_cases'],'retirement_records':verification['retired_instructions'],'line_coverage_percent':coverage['percent'],'hazard_cross_bins':verification['hazard_cross_bins_total'],'arch_tests_matching_spike':isa['arch_test']['tests_passed'],'spike_random_retirements':isa['random_commit_log']['retirements_compared'],'dot4_lane_cases':262144,'mutants_killed':mutation['killed']},'implementation':{'target':implementation['target'],'internal_fmax_mhz':next(iter(implementation['fmax'].values()))['achieved'],'lut4':implementation['synthesis_primitives']['SB_LUT4'],'flip_flops':implementation['flip_flops'],'packed_logic_cells':implementation['utilization']['ICESTORM_LC']['used'],'board_tested':implementation['board_tested']},'implementation_artifacts':[{'path':p,'sha256':sha(ROOT/p)} for p in ['build/core.json','build/core.asc','build/timing.json','build/merged.dat']],'documents':documents,'visual_views':len(manifest['views']),'checked_trace_programs':len(traces)}

def landing(report):
    m=report['implementation'];v=report['verification']
    fonts=''.join('@font-face{font-family:'+family+';src:url(data:font/woff2;base64,'+base64.b64encode((ROOT/'docs/textbook/fonts'/name).read_bytes()).decode()+')}' for name,family in [('Anton-Regular.woff2','Anton'),('IBMPlexSans-Regular.woff2','LearningSans')])
    return f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RISC-V project — start here</title><style>{fonts}body{{max-width:820px;margin:48px auto;padding:0 22px;background:#111214;color:#f5f5ef;font:18px/1.6 LearningSans,Arial,sans-serif}}h1{{font:clamp(42px,7vw,68px)/1.1 Anton,sans-serif}}a{{color:#ffe500;text-underline-offset:4px}}li{{margin:14px 0}}code{{overflow-wrap:anywhere}}small{{color:#b7b8b1}}:focus-visible{{outline:3px solid #ffe500;outline-offset:4px}}</style><body><small>RAHIL / A STUDENT TRYNNA LEARN</small><h1>BUILD A RISC-V CORE.</h1><p>The complete source, learning library and measured evidence for a five-stage RV32I core with signed DOT4.</p><ol><li><a href="visual-lab/index.html">Explore the eight-part interactive Anatomy lab</a></li><li><a href="textbook/series/index.html">Read the eight implementation textbooks</a> — 114 pages</li><li><a href="textbook/riscv-textbook.pdf">Read the illustrated overview</a> — 35 pages</li><li><a href="textbook/riscv-review-slides.html">Present the 14-slide review</a></li><li><a href="../docs/visual-lab/BUILD_PLAN.md">Follow the detailed build and research plan</a></li><li><a href="../docs/BUILD_ALL.md">Reproduce the complete build</a></li><li><a href="../reports/release.json">Inspect the release evidence</a></li></ol><p>{v['programs']} passing programs · {v['retirement_records']:,} checked retirements · {v['line_coverage_percent']}% core line instrumentation.</p><p>{m['internal_fmax_mhz']:.2f} MHz internal post-route estimate on HX8K; {m['lut4']:,} LUT4 and {m['flip_flops']:,} flip-flops. This includes the registered measurement shell and excludes memories, peripherals and external board timing. No physical board run.</p><p>From the repository root, run <code>make all</code>. To browse locally, run <code>python3 -m http.server 8878</code> and open <code>http://localhost:8878/output/START-HERE.html</code>.</p><small>The books preserve the earlier synthesis baseline. Current results appear here and in the reports. Scripts, fonts and mechanisms are embedded in the HTML lessons; keep the folder layout for local links.</small></body></html>'''

def package():
    roots=['rtl','tests','scripts','docs','reports','output/textbook','output/visual-lab','.github']
    files=[ROOT/p for p in ['Makefile','Dockerfile','README.md','LICENSE','.gitignore','.dockerignore','output/START-HERE.html']]
    for directory in roots:
        files.extend(p for p in (ROOT/directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc')
    # Preserve the actual mapped design and evidence, not just source and books.
    files.extend(ROOT/p for p in ['build/core.json','build/core.asc','build/timing.json','build/merged.dat','build/project/tools.log','build/project/rtl.log','build/project/learning.log','build/learning-series/results.json'])
    for name in load('reports/visual-traces.json')['traces']:
        files.extend(ROOT/'build/visual-lab'/(name+suffix) for suffix in ['.hex','.log'])
    target=ROOT/'output/riscv-project.zip'
    with ZipFile(target,'w',compression=ZIP_DEFLATED) as archive:
        for path in sorted(set(files)):
            archive.write(path,'riscv/'+str(path.relative_to(ROOT)))
    with ZipFile(target) as archive:
        require(archive.testzip() is None,'Corrupt project archive')
        for required in ['rtl/rv32_core.sv','scripts/build.sh','output/START-HERE.html','reports/release.json','output/visual-lab/index.html','docs/BUILD_ALL.md','build/core.json','build/core.asc','build/merged.dat','build/project/rtl.log','build/learning-series/results.json']:
            require('riscv/'+required in archive.namelist(),f'Missing release member: {required}')
    print(f'PASS complete release: {target.relative_to(ROOT)} ({target.stat().st_size:,} bytes)')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only',action='store_true')
    args=parser.parse_args()
    report=verify()
    if args.check_only:
        require(load('reports/release.json')==report,'Release manifest differs from current artifacts; rerun make all')
    else:
        (ROOT/'reports/release.json').write_text(json.dumps(report,indent=2)+'\n')
        (ROOT/'output/START-HERE.html').write_text(landing(report))
        verify()
        package()
    print(f"PASS {len(report['documents'])} PDFs / {sum(d['pages'] for d in report['documents'])} total pages; eight visual parts; matching current-source evidence")
