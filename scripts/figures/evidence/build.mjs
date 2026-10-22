// Builds output/figures/evidence/index.html and one standalone SVG per figure from reports/*.json.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {C, checkPalette} from './palette.mjs';
import {cycles, speedup, fmax, hazards, checks} from './model.mjs';
import {esc, count, cyclesFigure, speedupFigure, fmaxFigure, areaFigure, hazardFigure, tableFigure, tableRows} from './figures.mjs';

const root = new URL('../../../', import.meta.url);
const out = new URL('output/figures/evidence/', root);
mkdirSync(new URL('svg/', out), {recursive: true});
const paletteReport = checkPalette();

const f = (n, d) => n.toFixed(d);
const [off, on, shipped] = fmax.variants;
const headline = speedup.baselines[0].rows.at(-1);
const shift = speedup.baselines[1].rows.at(-1);
const nMax = cycles.sizes.at(-1);
const extremeShift = cycles.extremes.find(e => e.kernel === 'rv32i_shift');
const routes = fmax.variants.flatMap(v => v.seeds);

const table = (head, rows) => `<details><summary>Data table</summary><div class="scroll"><table><thead><tr>${head.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;

const FIGURES = [
  {id: 'cycles', source: 'reports/benchmark.json, Icarus RTL simulation', draw: cyclesFigure,
    caption: `Compare the vertical gaps: on a log axis an equal gap is an equal ratio, and the gaps stay nearly constant as n grows. Cycle counts from ${esc(cycles.simulator.split(' (')[0])} simulation of the RTL, uniform random int8 data (seed ${cycles.seed}), counted from reset release through the final EBREAK. Shift-and-add cost depends on the data: with extreme values at n = ${extremeShift.n} the LW version takes ${count(extremeShift.cycles)} cycles. Both axes are log scale because cycles span ${f(Math.log10(Math.max(...cycles.series.flatMap(s => s.points.map(p => p.cycles))) / Math.min(...cycles.series.flatMap(s => s.points.map(p => p.cycles)))), 1)} decades.`,
    table: () => table(['Kernel', ...cycles.sizes.map(n => `n = ${n}`)], cycles.series.map(s => [s.name, ...s.points.map(p => count(p.cycles))]))},
  {id: 'speedup', source: 'reports/ablation.json, cycles from Icarus, Fmax post-route estimates on iCE40 HX8K', draw: speedupFigure,
    caption: `Cycles alone overstate the gain, because the DOT4 multiplier lengthens the critical path. Each cycle count is divided by its own core's median post-route Fmax, so the filled dot is wall time on the estimated clock. Against shift-and-add the n = ${shift.n} figure is ${f(shift.median, 1)}×. The quarter-square kernel also reads a 2 KiB table that DOT4 does not need. These are post-route estimates; the core has not run on hardware.`,
    table: () => table(['Baseline', 'n', 'Cycles only', 'After clock cost', 'Seed range'], speedup.baselines.flatMap(b => b.rows.map(r => [b.name, String(r.n), `${f(r.cycles, 2)}×`, `${f(r.median, 2)}×`, `${f(r.min, 2)}× to ${f(r.max, 2)}×`])))},
  {id: 'fmax', source: 'reports/ablation.json, nextpnr post-route estimates on iCE40 HX8K, no board run', draw: fmaxFigure,
    caption: `Compare the two yellow medians. DOT4 on and off are the same flow with only the DOT4 parameter changed. The shipped netlist has the same logic as DOT4 on but synthesizes ${fmax.netlistSpread.lut4} more LUT4 and routes ${f(fmax.netlistSpread.mhz, 2)} MHz differently: that is tool noise, not design. Quote the median, ${f(shipped.median, 2)} MHz for the shipped netlist, not one seed. All ${routes.length} routes clear the 12 MHz constraint. Post-route estimates on iCE40 HX8K; no board run.`,
    table: () => table(['Netlist', ...fmax.seeds.map(s => `Seed ${s}`), 'Median'], fmax.variants.map(v => [`${v.name} (${v.detail})`, ...v.seeds.map(s => f(s.mhz, 2)), f(v.median, 2)]))},
  {id: 'area', source: 'reports/ablation.json, yosys and nextpnr on iCE40 HX8K', draw: areaFigure,
    caption: `The yellow segment is the DOT4 unit: four signed 8×8 multipliers and an adder tree built from LUTs, since the iCE40 has no hard DSP blocks. Bars start at zero; the outline is the whole device. The count covers the core and its registered timing shell, not program or data memory.`,
    table: () => table(['Netlist', 'Logic cells', 'Share of 7,680'.replace('7,680', count(off.available)), 'LUT4'], fmax.variants.map(v => [`${v.name} (${v.detail})`, count(v.cells), `${f(100 * v.cells / v.available, 1)}%`, count(v.lut4)]))},
  {id: 'hazards', source: 'reports/verification.json, bin names from tests/hazards.py', draw: hazardFigure,
    caption: `One panel per producer. Rows are the consumer slot that reads the register; columns are how many instructions later it reads (1 to 3). A filled square is a bin some generated program hit; an empty outline would be a miss, and there are ${hazards.missing.length}. The report stores the hit count and the list of missing bins, not a per-bin count, so the grid can show hit or miss but not how often. Bin names come from tests/hazards.py, whose hash matches the one recorded in the report.`,
    table: () => table(['Panel', 'Bins hit', 'Bins'], [
      ...hazards.cross.map(g => [`Producer ${g.producer}`, String(g.cells.flat().filter(b => b.hit).length), String(g.cells.flat().length)]),
      ['Writes to x0', String(hazards.x0.flat().filter(b => b.hit).length), String(hazards.x0.flat().length)],
      ['Redirects', String(hazards.redirect.flat().filter(b => b.hit).length), String(hazards.redirect.flat().length)],
      ['Total', String(hazards.hit), String(hazards.total)]])},
];

const W_WIDE = 720, W_NARROW = 344;
const sections = FIGURES.map((fig, i) => {
  const wide = fig.draw({id: fig.id, exported: false}, W_WIDE);
  const narrow = fig.draw({id: fig.id, exported: false}, W_NARROW);
  writeFileSync(new URL(`svg/${i + 1}-${fig.id}.svg`, out), fig.draw({id: fig.id, exported: true, source: fig.source}, W_WIDE).svg);
  return `<section id="${fig.id}" aria-labelledby="${fig.id}-h"><p class="num">Figure ${i + 1}</p><h2 id="${fig.id}-h">${esc(wide.title)}</h2><figure><div class="plot wide">${wide.svg}</div><div class="plot narrow">${narrow.svg}</div><figcaption>${fig.caption}</figcaption></figure>${fig.table()}</section>`;
});

const tableSvg = tableFigure({id: 'checks', exported: true, source: 'reports/verification.json, isa-compare.json, mutation.json, dot4-sweep.json, line-coverage.json'}, W_WIDE);
writeFileSync(new URL('svg/6-checks.svg', out), tableSvg.svg);
const checkRows = tableRows();
sections.push(`<section id="checks" aria-labelledby="checks-h"><p class="num">Figure 6</p><h2 id="checks-h">${esc(tableSvg.title)}</h2><div class="scroll"><table class="checks"><thead><tr><th scope="col">Result</th><th scope="col">Check</th><th scope="col">What was compared</th></tr></thead><tbody>${checkRows.map(r => `<tr><td class="res">${esc(r.result)}</td><th scope="row">${esc(r.check)}</th><td>${esc(r.scope)}</td></tr>`).join('')}</tbody></table></div></section>`);

const fonts = [['Anton', 'Anton-Regular', 400], ['LearningSans', 'IBMPlexSans-Regular', 400], ['LearningSans', 'IBMPlexSans-SemiBold', 600]]
  .map(([family, file, weight]) => `@font-face{font-family:${family};font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${readFileSync(new URL(`docs/textbook/fonts/${file}.woff2`, root)).toString('base64')}) format('woff2')}`).join('');

const css = `${fonts}
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;background:${C.bg};color:${C.ink};font:17px/1.55 LearningSans,Arial,sans-serif}
a{color:${C.accent};text-underline-offset:3px}
:focus-visible{outline:3px solid ${C.accent};outline-offset:3px}
main{max-width:800px;margin:0 auto;padding:40px 24px 64px}
header .eyebrow{font-size:13px;letter-spacing:.12em;color:${C.secondary};margin:0}
h1{font:clamp(44px,8vw,76px)/1.02 Anton,Impact,sans-serif;margin:12px 0 16px;letter-spacing:.01em}
.dek{max-width:680px;margin:0 0 8px}
.limits{color:${C.secondary};font-size:15px;max-width:680px}
section{border-top:1px solid ${C.line};padding-top:28px;margin-top:44px}
.num{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:${C.secondary};margin:0 0 6px}
h2{font-size:24px;line-height:1.25;font-weight:600;margin:0 0 20px;max-width:720px}
figure{margin:0}
.plot svg{display:block;width:100%;height:auto;max-width:720px;overflow:visible}
.plot.narrow{display:none}
figcaption{color:${C.secondary};font-size:15px;margin-top:16px;max-width:680px}
details{margin-top:14px;font-size:15px}summary{cursor:pointer;color:${C.secondary}}summary:hover{color:${C.ink}}
.scroll{overflow-x:auto}
table{border-collapse:collapse;font-variant-numeric:tabular-nums;margin-top:10px;width:100%}
th,td{text-align:left;padding:8px 14px 8px 0;border-bottom:1px solid ${C.line};vertical-align:top}
thead th{color:${C.secondary};font-weight:400;font-size:14px}
tbody th{font-weight:600}
table.checks{font-size:15px}table.checks td.res{font-weight:600;font-size:18px;white-space:nowrap}table.checks td:last-child{color:${C.secondary}}
.m{cursor:default;outline:none}.m:focus-visible>*:not(title){outline:none}
.m:hover circle:not([fill=transparent]),.m:focus circle:not([fill=transparent]){stroke:${C.accent};stroke-width:2}
.m:focus>rect[fill=transparent]{stroke:${C.accent};stroke-width:2;fill:none}
.c:hover rect{stroke:${C.ink};stroke-width:2}
#tip{position:fixed;z-index:10;pointer-events:none;background:${C.surface};border:1px solid ${C.axis};border-radius:4px;padding:8px 11px;font-size:14px;line-height:1.4;max-width:300px;font-variant-numeric:tabular-nums;box-shadow:0 4px 18px #0008}
#tip[hidden]{display:none}#tip b{display:block;font-size:16px}#tip span{display:block;color:${C.secondary}}
footer{border-top:1px solid ${C.line};margin-top:48px;padding-top:18px;font-size:14px;color:${C.secondary}}
footer code{font-size:13px;overflow-wrap:anywhere}
@media (max-width:600px){main{padding:28px 16px 48px}.plot.wide{display:none}.plot.narrow{display:block}h2{font-size:21px}table.checks td.res{font-size:16px;white-space:normal}table.checks thead{display:none}table.checks tr{display:grid;grid-template-columns:1fr;border-bottom:1px solid ${C.line};padding:8px 0}table.checks td,table.checks th{border:0;padding:2px 0}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`;

// Tooltip: hover or keyboard focus on any .m mark shows its exact values. Escape hides it.
const js = `
const tip=document.getElementById('tip');
function show(el){const parts=el.dataset.tip.split('|');tip.replaceChildren();parts.forEach((p,i)=>{const n=document.createElement(i===1?'b':'span');n.textContent=p;tip.append(n);});tip.hidden=false;
const r=el.getBoundingClientRect(),t=tip.getBoundingClientRect();let x=r.left+r.width/2-t.width/2,y=r.top-t.height-10;
if(y<8)y=r.bottom+10;x=Math.max(8,Math.min(innerWidth-t.width-8,x));tip.style.left=x+'px';tip.style.top=y+'px';}
function hide(){tip.hidden=true;}
document.addEventListener('pointerover',e=>{const m=e.target.closest('.c')||e.target.closest('.m');if(m&&m.dataset.tip)show(m);});
document.addEventListener('pointerout',e=>{const m=e.target.closest('.m');if(m&&!m.contains(e.relatedTarget))hide();});
document.addEventListener('focusin',e=>{const m=e.target.closest('.m');m&&m.dataset.tip?show(m):hide();});
document.addEventListener('focusout',hide);
document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});
addEventListener('scroll',()=>{const a=document.activeElement;a&&a.classList&&a.classList.contains('m')?show(a):hide();},{passive:true});`;

const dek = `A five-stage RV32I core with one custom instruction, DOT4, that multiplies four signed bytes and sums them. Five figures and one table, each built from the JSON reports the regression writes.`;
const limits = `Cycle counts come from RTL simulation. Fmax and area are post-route estimates for iCE40 HX8K; the core has not run on a physical board. The Spike comparison uses riscv-arch-test ${esc(checks.archRelease)}; it is not certification. Hover or tab to any mark for its exact value.`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evidence: RV32I core with DOT4</title><style>${css}</style></head><body><main><header><p class="eyebrow">RV32I + DOT4 / EVIDENCE</p><h1>DOT4 is ${f(headline.median, 1)}× faster after its clock cost.</h1><p class="dek">${dek}</p><p class="limits">${limits}</p></header>${sections.join('')}<footer>Sources: <code>reports/benchmark.json</code>, <code>reports/ablation.json</code>, <code>reports/verification.json</code>, <code>reports/isa-compare.json</code>, <code>reports/mutation.json</code>, <code>reports/dot4-sweep.json</code>, <code>reports/line-coverage.json</code>, bin names from <code>tests/hazards.py</code>. Rebuild with <code>node scripts/figures/evidence/build.mjs</code>.</footer></main><div id="tip" aria-hidden="true" hidden></div><script>${js}</script></body></html>`;
writeFileSync(new URL('index.html', out), html);
console.log(paletteReport.join('\n'));
console.log(`wrote ${new URL('index.html', out).pathname} and ${FIGURES.length + 1} SVGs`);
