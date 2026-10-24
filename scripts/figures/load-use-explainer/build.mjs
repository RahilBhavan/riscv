// Builds output/figures/load-use-explainer/index.html from reports/*.json, rtl/rv32_core.sv and the RTL-rule model.
// Run: node scripts/figures/load-use-explainer/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { simulate, tryIt, CASES, disasm, fields, usesRegs, STAGES, TRY_VALUE } from './model.mjs';

const root = new URL('../../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const report = name => JSON.parse(read(`reports/${name}.json`));
const need = (data, path, source) => {
  const value = path.split('.').reduce((v, k) => v?.[k], data);
  if (value === undefined) throw Error(`${source} has no ${path}; regenerate it with make`);
  return value;
};
const fail = message => { throw Error(message); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Evidence.
const tracesReport = report('visual-traces');
const traceScope = need(tracesReport, 'scope', 'reports/visual-traces.json');
const bench = report('benchmark');
const identity = need(bench, 'cycle_identity', 'reports/benchmark.json');
const runs = need(bench, 'runs', 'reports/benchmark.json');
const verification = report('verification');
const regressionStalls = need(verification, 'load_use_stall_cycles', 'reports/verification.json');
const regressionPrograms = need(verification, 'test_cases', 'reports/verification.json');
const mutants = need(report('mutation'), 'results', 'reports/mutation.json');
if (!/cycles = retired \+ load_use_stalls \+ 2 \* flushes \+ 3/.test(identity)) fail(`benchmark cycle_identity changed: "${identity}"`);

// RTL excerpts and the line numbers the page cites, found by the text on each line.
const rtl = read('rtl/rv32_core.sv').split('\n');
const at = marker => {
  const index = rtl.findIndex(line => line.includes(marker));
  if (index < 0) fail(`rtl/rv32_core.sv no longer contains "${marker}"`);
  return index + 1;
};
const L = {
  forward: at('Newest producer wins'), wbRs1: at('if (rs1 == w_rd) a = w_result;'), memIf: at('if (m_valid && m_write && !m_load'),
  memRs1: at('if (rs1 == m_rd) a = m_result;'), fop: at('wire [6:0] f_op'), hazard: at('wire hazard = f_valid && x_valid && ld'),
  event: at('assign stall_event ='), redirect: at('if(redirect || fault) begin'), stall: at('end else if(hazard) begin'),
  bypass: at('WB-to-ID bypass'), load: at("7'h03: begin"), clear: at('if (trap || irq) begin wr=0'),
};
const span = (from, to) => ({ from, lines: rtl.slice(from - 1, to) });
const code = {
  forward: span(L.forward, L.forward + 11),
  hazard: span(L.fop, L.hazard + 1),
  event: span(L.event, L.event + 1),
  priority: span(L.redirect, L.stall + 1),
};

// Pipeline charts. Rows are instructions by PC; cells say which stage holds that PC in each cycle.
const label = (words, pc) => pc / 4 < words.length ? disasm(words[pc / 4]) : 'nop (past end)';
const xreg = n => `x${n}`;

function chart(words, frames) {
  const pcs = [...new Set(frames.flatMap(f => f.stages.filter(s => s.valid).map(s => s.pc)))].sort((a, b) => a - b);
  const rowOf = pc => pcs.indexOf(pc);
  const grid = pcs.map(() => frames.map(() => null));
  frames.forEach((f, c) => f.stages.forEach((s, stage) => {
    if (!s.valid) return;
    const held = c > 0 && frames[c - 1].stages[stage].valid && frames[c - 1].stages[stage].pc === s.pc;
    grid[rowOf(s.pc)][c] = { text: STAGES[stage], kind: held ? 'held' : 'run' };
  }));
  const bubbles = [];
  frames.forEach((f, c) => {
    if (f.stall) {
      const path = [2, 3, 4].map((stage, k) => frames[c + 1 + k] && !frames[c + 1 + k].stages[stage].valid ? [c + 1 + k, STAGES[stage]] : null);
      if (path.some(p => !p)) fail(`cycle ${f.cycle}: a stall must push an empty slot through EX, MEM and WB`);
      bubbles.push(path);
    }
    if (f.flush && frames[c + 1]) [0, 1].forEach(stage => {
      if (f.stages[stage].valid) grid[rowOf(f.stages[stage].pc)][c + 1] = { text: '×', kind: 'flushed' };
    });
  });
  const rows = pcs.map((pc, r) => ({ pc, label: label(words, pc), cells: grid[r] }));
  bubbles.forEach(path => rows.push({ pc: null, label: 'bubble', cells: frames.map((_, c) => {
    const hit = path.find(([col]) => col === c);
    return hit ? { text: hit[1], kind: 'bubble' } : null;
  }) }));
  return { rows, rowOf };
}

// Explains one cycle in plain words, from the model's view of the same cycle.
function annotate(words, frames, rowOf) {
  const name = pc => label(words, pc).split(' ')[0];
  return frames.map((f, c) => {
    const [, id, ex] = f.stages;
    const notes = [], marks = [];
    const exInsn = ex.valid ? words[ex.pc / 4] : null;
    if (f.flush && f.fault) notes.push(`${name(ex.pc)} traps in EX. The two younger instructions, in IF and ID, are thrown away (marked ×) and fetch stops. The EBREAK and older instructions still finish.`);
    else if (f.flush) notes.push(`${name(ex.pc)} is taken in EX. The two younger instructions, in IF and ID, are thrown away (marked ×) and fetch restarts at the target.`);
    if (f.stall) {
      const { rd } = fields(words[ex.pc / 4]);
      notes.push(`Stall. ${name(id.pc)} in ID needs ${xreg(rd)}, and the ${name(ex.pc)} in EX has only computed an address. Its data arrives at the end of MEM, one cycle too late. IF and ID hold, and an empty slot (a bubble) goes into EX.`);
    }
    if (c > 0 && frames[c - 1].stall) notes.push(`The bubble is in EX and does nothing. The load moved on to MEM and is reading memory now. ${name(id.pc)} waits in ID one more cycle.`);
    if (exInsn !== null && !f.flush) {
      const { rs1, rs2 } = fields(exInsn), uses = usesRegs(exInsn);
      [[uses.rs1, rs1, f.a, f.aFrom], [uses.rs2, rs2, f.b, f.bFrom]].forEach(([used, reg, value, from], k) => {
        if (!used || reg === 0 || (k === 1 && reg === rs1 && uses.rs1)) return;
        if (from === 'MEM' || from === 'WB') {
          const src = from === 'MEM' ? 3 : 4;
          marks.push({ row: rowOf(f.stages[src].pc), col: c, kind: 'src' }, { row: rowOf(ex.pc), col: c, kind: 'dst' });
          let note = `${name(ex.pc)} in EX gets ${xreg(reg)} = ${value}, forwarded from ${from}.`;
          if (from === 'MEM' && f.wb?.rd === reg) note += ` WB also holds a new ${xreg(reg)} (${f.wb.value}), but the newer value in MEM wins.`;
          if (from === 'WB' && f.mem === null && c > 1 && frames[c - 2].stall) note += ' That is the loaded value, one cycle after the stall.';
          notes.push(note);
        }
      });
    }
    const next = frames[c + 1];
    if (id.valid && next && next.stages[2].valid && next.stages[2].pc === id.pc) {
      const { rs1, rs2 } = fields(words[id.pc / 4] ?? 0x13), uses = usesRegs(words[id.pc / 4] ?? 0x13);
      const bypassed = [[uses.rs1, rs1, next.aFrom], [uses.rs2, rs2, next.bFrom]].find(([u, r, from]) => u && r !== 0 && from === 'bypass');
      if (bypassed) {
        marks.push({ row: rowOf(f.stages[4].pc), col: c, kind: 'src' }, { row: rowOf(id.pc), col: c, kind: 'dst' });
        notes.push(`${name(id.pc)} reads ${xreg(bypassed[1])} in ID while WB writes it. Both happen at the same clock edge, so the WB-to-ID bypass (lines ${L.bypass}-${L.bypass + 4}) hands over ${f.wb.value} directly.`);
      }
    }
    if (!notes.length) notes.push(f.stages.slice(1).some(s => s.valid) ? 'No hazard. Every instruction moves one stage forward.' : f.stages[0].valid ? 'The pipeline is filling. Only fetch is busy.' : 'The pipeline is empty. The program is over.');
    return { cycle: f.cycle, stall: f.stall, flush: f.flush, marks, note: notes.join(' ') };
  });
}

function traceView(name) {
  const trace = need(tracesReport, `traces.${name}`, 'reports/visual-traces.json');
  const run = simulate(trace.words);
  if (run.frames.length !== trace.frames.length) fail(`${name}: model and RTL disagree on cycle count`);
  trace.frames.forEach((rtlFrame, i) => {
    const { cycle, stages, stall, flush, a, b } = run.frames[i];
    if (JSON.stringify({ cycle, stages, stall, flush, a, b }) !== JSON.stringify(rtlFrame)) fail(`${name} cycle ${rtlFrame.cycle}: model and RTL disagree`);
  });
  const frames = trace.frames.map((f, i) => ({ ...run.frames[i], ...f }));
  const { rows, rowOf } = chart(trace.words, frames);
  return { name, program: trace.words.map(disasm), rows, frames: annotate(trace.words, frames, rowOf), retired: trace.retirements };
}

const fp = traceView('forward_priority');
const ls = traceView('load_store');
fp.start = fp.frames.findIndex(f => f.marks.length && f.note.includes('newer value in MEM wins'));
ls.start = ls.frames.findIndex(f => f.stall);
if (fp.start < 0 || ls.start < 0) fail('traces no longer show MEM priority and a load-use stall');
const lsTrace = tracesReport.traces.load_store;
const lsStall = ls.frames[ls.start].cycle;
const lsFlush = ls.frames.find(f => f.flush).cycle;
const lsStalls = lsTrace.frames.filter(f => f.stall).length, lsFlushes = lsTrace.frames.filter(f => f.flush).length;
if (lsTrace.frames.length !== lsTrace.retirements + lsStalls + 2 * lsFlushes + 3) fail('load_store trace breaks the cycle identity');
const fpFrame = tracesReport.traces.forward_priority.frames[fp.start];
const fpWb = simulate(tracesReport.traces.forward_priority.words).frames[fp.start].wb ?? fail('forward_priority: no WB value at the priority cycle');

// The "try it" grid: every answer is a model run.
const where = { MEM: 'forwarded from MEM', WB: 'forwarded from WB', bypass: 'handed over in ID by the WB-to-ID bypass', regfile: 'read from the register file' };
const short = { MEM: 'from MEM', WB: 'from WB', bypass: 'bypass in ID', regfile: 'register file' };
const cases = Object.fromEntries(CASES.map(([producer, distance]) => {
  const run = tryIt(producer, distance);
  const frames = run.frames;
  const { rows, rowOf } = chart(run.words, frames);
  const notes = annotate(run.words, frames, rowOf);
  const focus = notes.findIndex(n => n.marks.some(m => m.kind === 'dst' && rows[m.row].pc === 4 * distance));
  if (focus < 0) fail(`try-it ${producer}/${distance}: no forwarding found`);
  return [`${producer}-${distance}`, {
    program: run.words.map(disasm), rows, frames: notes, focus,
    stalls: run.stalls, source: run.source, cycles: frames.length, retired: run.retired, flushes: run.flushes,
    verdict: run.stalls ? `Stalls ${run.stalls} cycle.` : 'No stall.',
    detail: `addi x6, x5, 1 gets x5 = ${run.operand}, ${where[run.source]}.`,
    short: `${run.stalls ? `${run.stalls} stall, then` : 'No stall,'} ${short[run.source]}`,
  }];
}));

// uses_rs1 example: lui puts immediate bits where rs1 would be.
const LUI_IMM = 0x30;
const lui = ((LUI_IMM << 12) | (7 << 7) | 0x37) >>> 0;
const luiRun = simulate([((0x80 << 20) | (fields(lui).rs1 << 7) | (2 << 12) | 0x03) >>> 0, lui, 0x00100073]);
if (luiRun.stalls !== 0 || fields(lui).rs1 !== 6) fail('lui example must not stall');

// Cost: the largest DOT4 run is the worked example.
const allZero = runs.every(r => need(r, 'stalls', 'benchmark run') === 0);
const example = runs.filter(r => r.kernel === 'dot4' && r.dataset === 'uniform').reduce((a, b) => b.n > a.n ? b : a);
const ex = Object.fromEntries(['n', 'cycles', 'retired', 'stalls', 'flushes'].map(k => [k, need(example, k, 'benchmark dot4 run')]));
if (ex.cycles !== ex.retired + ex.stalls + 2 * ex.flushes + 3) fail('benchmark worked example breaks the identity');
const usesMutants = mutants.filter(m => /^no_load_use_stall_for_/.test(m.mutant));
if (!usesMutants.length || usesMutants.some(m => !m.killed)) fail('expected killed uses_rs mutants in reports/mutation.json');
const bubbleMutant = mutants.find(m => m.mutant === 'stall_without_bubble') ?? fail('stall_without_bubble mutant missing');

// Page.
const fonts = ['Anton-Regular', 'IBMPlexSans-Regular', 'IBMPlexSans-SemiBold'].map((n, i) =>
  `@font-face{font-family:${i ? 'LearningSans' : 'Anton'};font-weight:${i === 2 ? 600 : 400};font-display:swap;src:url(data:font/woff2;base64,${readFileSync(new URL(`docs/textbook/fonts/${n}.woff2`, root)).toString('base64')}) format('woff2')}`).join('');

const codeBlock = ({ from, lines }, hot = []) => `<pre class="code" tabindex="0"><code>${lines.map((line, i) =>
  `<span class="ln${hot.includes(from + i) ? ' hot' : ''}"><i>${from + i}</i>${esc(line.replace(/^ {4}/, ''))}</span>`).join('')}</code></pre>`;

const stepper = (id, view, caption) => `
<figure class="trace" id="${id}" data-trace="${id}">
  <div class="trace-head"><b>RTL trace <code>${view.name}</code></b><span class="muted">${view.program.length} instructions · ${view.frames.length} cycles</span></div>
  <div class="chart-scroll"><table class="chart" aria-describedby="${id}-note"></table></div>
  <div class="controls">
    <button type="button" data-step="-1" aria-label="Previous cycle">← Prev</button>
    <label class="slider">Cycle <output data-cycle></output><input type="range" min="1" max="${view.frames.length}" step="1" aria-label="Cycle"></label>
    <button type="button" data-step="1" aria-label="Next cycle">Next →</button>
  </div>
  <p class="note" id="${id}-note" aria-live="polite"></p>
  <figcaption>${caption}</figcaption>
</figure>`;

const summaryRows = ['alu', 'load'].map(p => `<tr><th scope="row">${p === 'alu' ? 'ALU op writes x5' : 'Load writes x5'}</th>${[1, 2, 3].map(d => {
  const k = cases[`${p}-${d}`];
  return `<td class="${k.stalls ? 'hit' : ''}"><a href="#try" data-case="${p}-${d}">${esc(k.short)}</a></td>`;
}).join('')}</tr>`).join('');


const defs = k => `<defs><marker id="ah-${k}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="currentColor"/></marker><marker id="fw-${k}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L8 4L0 8z" class="fwd-head"/></marker></defs>`;
const STAGE_INFO = [['IF', 'fetch', 'pc'], ['ID', 'decode, read registers', 'f_'], ['EX', 'ALU, branch, address', 'x_'], ['MEM', 'data memory', 'm_'], ['WB', 'write register', 'w_']];

const wideFigure = (() => {
  const w = 128, gap = 22, y = 46, h = 64, x = i => 10 + i * (w + gap), mid = i => x(i) + w / 2;
  const boxes = STAGE_INFO.map(([n, what, reg], i) => `<rect x="${x(i)}" y="${y}" width="${w}" height="${h}" rx="3" class="box"/><text x="${x(i) + 10}" y="${y + 25}" class="stage">${n}</text><text x="${x(i) + 10}" y="${y + 48}" class="small">${what}</text><text x="${x(i) + w - 10}" y="${y + 25}" class="reg" text-anchor="end">${reg}</text>`).join('');
  const flow = STAGE_INFO.slice(1).map((_, i) => `<line x1="${x(i) + w}" y1="${y + h / 2}" x2="${x(i + 1) - 2}" y2="${y + h / 2}" class="flow" marker-end="url(#ah-w)"/>`).join('');
  const ready = (i, text) => `<line x1="${x(i) + w + gap / 2}" y1="${y - 8}" x2="${x(i) + w + gap / 2}" y2="${y + h + 8}" class="ready"/><text x="${x(i) + w + gap / 2}" y="${y - 14}" text-anchor="middle" class="small ready-t">${text}</text>`;
  const back = (fromX, toX, lift, text) => `<path d="M${fromX} ${y + h} V${y + h + lift} H${toX} V${y + h + 3}" class="fwd" marker-end="url(#fw-w)"/><text x="${(fromX + toX) / 2}" y="${y + h + lift + 16}" text-anchor="middle" class="small">${text}</text>`;
  return `<svg class="wide" viewBox="0 0 760 248" role="img" aria-label="Five stages left to right. An ALU result is ready at the end of EX. Load data is ready at the end of MEM. Results travel back from MEM to EX, from WB to EX, and from WB to ID.">${defs('w')}${boxes}${flow}${ready(2, 'ALU result ready')}${ready(3, 'load data ready')}${back(mid(3), mid(2) + 20, 22, 'MEM → EX · line ${L.memRs1}')}${back(mid(4) - 20, mid(2) - 20, 64, 'WB → EX · line ${L.wbRs1}')}${back(mid(4) + 20, mid(1), 106, 'WB → ID bypass · lines ${L.bypass + 1}-${L.bypass + 4}')}</svg>`;
})();

const tallFigure = (() => {
  const x = 84, w = 246, h = 62, gap = 30, y = i => 8 + i * (h + gap), mid = i => y(i) + h / 2;
  const gets = { 1: 'gets: WB bypass, l. 174-177', 2: 'gets: MEM l. 46, WB l. 42' };
  const boxes = STAGE_INFO.map(([n, what, reg], i) => `<rect x="${x}" y="${y(i)}" width="${w}" height="${h}" rx="3" class="box"/><text x="${x + 10}" y="${y(i) + 24}" class="stage">${n}</text><text x="${x + 62}" y="${y(i) + 23}" class="small">${what}</text><text x="${x + w - 10}" y="${y(i) + 23}" class="reg" text-anchor="end">${reg}</text>${gets[i] ? `<text x="${x + 62}" y="${y(i) + 46}" class="small fwd-t">${gets[i]}</text>` : ''}`).join('');
  const flow = STAGE_INFO.slice(1).map((_, i) => `<line x1="${x + 24}" y1="${y(i) + h}" x2="${x + 24}" y2="${y(i + 1) - 2}" class="flow" marker-end="url(#ah-t)"/>`).join('');
  const ready = (i, text) => `<text x="${x + 40}" y="${y(i) + h + gap / 2 + 4}" class="small ready-t">▲ ${text}</text>`;
  const back = (fromY, toY, xb) => `<path d="M${x} ${fromY} H${xb} V${toY} H${x - 3}" class="fwd" marker-end="url(#fw-t)"/>`;
  return `<svg class="tall" viewBox="0 0 340 450" role="img" aria-label="Five stages top to bottom. An ALU result is ready at the end of EX. Load data is ready at the end of MEM. EX receives values from MEM and WB. ID receives the WB value through the bypass.">${defs('t')}${boxes}${flow}${ready(2, 'ALU result ready')}${ready(3, 'load data ready')}${back(mid(3), mid(2) + 9, 64)}${back(mid(4) - 9, mid(2) - 9, 44)}${back(mid(4) + 9, mid(1), 24)}</svg>`;
})();

const fpX1 = fields(tracesReport.traces.forward_priority.words[0]);
const pct = (a, b) => Math.round(100 * a / b);
const data = { fp, ls, cases, start: 'load-1' };

const css = `${fonts}
:root{--canvas:#111214;--surface:#1a1b1e;--ink:#F5F5EF;--muted:#B7B8B1;--line:#424348;--accent:#FFE500;--accent-text:#FFE500;--on-accent:#111214;--cell:#26272b;--now:#2e2f34;--display:Anton,Impact,sans-serif;--body:LearningSans,Arial,sans-serif;--mono:ui-monospace,'DejaVu Sans Mono',Menlo,monospace;color-scheme:dark light}
@media (prefers-color-scheme:light){:root{--canvas:#F5F5EF;--surface:#FFFFFF;--ink:#111214;--muted:#52545A;--line:#C6C7BF;--accent-text:#6B5F00;--cell:#E9E9E2;--now:#DCDCD3}}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--canvas);color:var(--ink);font:17px/1.6 var(--body)}
a{color:var(--accent-text);text-underline-offset:3px}::selection{background:var(--accent);color:var(--on-accent)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
button,input{font:inherit}button{min-height:40px;padding:6px 14px;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:3px;cursor:pointer}button:hover{border-color:var(--accent)}
.wrap{max-width:780px;margin:0 auto;padding:0 20px}.wide-wrap{max-width:980px;margin:0 auto;padding:0 20px}
header{border-top:6px solid var(--accent);padding:40px 0 8px}.eyebrow{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
h1{font:400 clamp(40px,7vw,72px)/1.04 var(--display);margin:16px 0 18px;text-wrap:balance;letter-spacing:.3px}
h2{font:400 clamp(30px,4.6vw,42px)/1.12 var(--display);margin:0 0 16px;text-wrap:balance}
h2 .n{color:var(--accent-text);margin-right:.35em}
.dek{font-size:20px;line-height:1.5;margin:0 0 24px}
section{padding:48px 0 8px;border-top:1px solid var(--line);margin-top:40px}
p{margin:0 0 16px}code,pre,dt,.chart,.sum{font-variant-ligatures:none;font-feature-settings:"liga" 0,"calt" 0}code{font-family:var(--mono);font-size:.86em}
.muted{color:var(--muted)}
.toc{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:14px;margin:18px 0 0;padding:0;list-style:none;counter-reset:t}.toc li{counter-increment:t}.toc li::before{content:counter(t) ". ";color:var(--muted)}
table.summary{border-collapse:collapse;width:100%;font-size:15px;font-variant-numeric:tabular-nums;margin:8px 0}
.summary th,.summary td{text-align:left;padding:10px 10px 10px 0;border-bottom:1px solid var(--line);vertical-align:top}
.summary thead th{font-weight:400;color:var(--muted);font-size:13px}.summary tbody th{font-weight:600}
.summary td a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line)}.summary td a:hover{border-color:var(--accent)}
.summary td.hit a{background:var(--accent);color:var(--on-accent);padding:2px 6px;border:0;font-weight:600}
.caption,figcaption{font-size:14px;color:var(--muted);line-height:1.5;margin-top:10px}
figure{margin:24px 0}
.stagefig{color:var(--ink)}.stagefig svg{width:100%;height:auto;display:block}.stagefig .tall{display:none;max-width:420px}
.box{fill:var(--surface);stroke:var(--line)}.stage{font:400 22px var(--display);fill:currentColor}.small{font-size:12.5px;fill:var(--muted)}.reg{font:13px var(--mono);fill:var(--muted)}
.flow{stroke:currentColor;stroke-width:1.4}.fwd{fill:none;stroke:var(--accent);stroke-width:2}.fwd-head{fill:var(--accent)}.fwd-t{fill:var(--accent-text)}
.ready{stroke:var(--muted);stroke-width:1}.ready-t{fill:var(--ink);font-weight:600}
@media (prefers-color-scheme:light){.fwd{stroke:#111214}.fwd-head{fill:#111214}}
.trace{background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:16px;margin:24px 0}
.trace-head{display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px 16px;font-size:14px;margin-bottom:10px}
.chart-scroll{overflow-x:auto}
table.chart{border-collapse:separate;border-spacing:2px;font:12px/1 var(--mono);font-variant-numeric:tabular-nums}
.chart th{font-weight:400;color:var(--muted);padding:4px 2px;text-align:center;min-width:34px}
.chart th.lab{text-align:left;padding-right:10px;color:var(--ink);white-space:nowrap;min-width:0;position:sticky;left:0;background:var(--surface);z-index:1}
.chart tr.bubble th.lab{color:var(--muted);font-style:italic}
.chart td{height:28px;text-align:center;padding:0 2px;border-radius:2px;color:var(--ink)}
.chart td.run{background:var(--cell)}
.chart td.held{background:transparent;box-shadow:inset 0 0 0 1px var(--accent-text);color:var(--accent-text)}
.chart td.bubble{box-shadow:inset 0 0 0 1px var(--line);color:var(--muted)}
.chart td.flushed{color:var(--muted)}
.chart .now{background-color:var(--now)}.chart td.run.now{background:var(--line)}
.chart td.src{background:var(--accent)!important;color:var(--on-accent)!important;font-weight:600}
.chart td.dst{box-shadow:inset 0 0 0 2px var(--accent-text);font-weight:600}
.chart thead th.now{color:var(--ink);font-weight:600}
.controls{display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap}
.slider{display:flex;align-items:center;gap:10px;font-size:14px;flex:1;min-width:160px}.slider output{font-variant-numeric:tabular-nums;min-width:2ch;font-weight:600}.slider input{flex:1;accent-color:var(--accent)}
.note{min-height:3.2em;margin:12px 0 0;font-size:16px}
pre.code{background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:12px 0;overflow-x:auto;font:13px/1.65 var(--mono);margin:18px 0}
pre.code .ln{display:block;padding:0 14px 0 0;white-space:pre}pre.code .ln i{display:inline-block;width:3.6em;padding-right:1em;text-align:right;color:var(--muted);font-style:normal;user-select:none}
pre.code .hot{background:var(--now)}pre.code .hot i{color:var(--accent-text)}
dl.terms{display:grid;grid-template-columns:minmax(0,15em) 1fr;gap:12px 18px;margin:18px 0}dl.terms dt{font-family:var(--mono);font-size:14px;overflow-wrap:anywhere}dl.terms dd{margin:0}
.try{background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:16px}
fieldset{border:0;margin:0 0 12px;padding:0}legend{font-size:14px;color:var(--muted);margin-bottom:6px}
.seg{display:flex;flex-wrap:wrap;gap:6px}.seg label{position:relative}.seg input{position:absolute;opacity:0;inset:0}
.seg span{display:block;padding:8px 14px;border:1px solid var(--line);border-radius:3px;cursor:pointer;font-size:15px;min-height:40px}
.seg input:checked+span{background:var(--accent);color:var(--on-accent);border-color:var(--accent);font-weight:600}.seg input:focus-visible+span{outline:3px solid var(--accent);outline-offset:2px}
.verdict{font:400 34px/1.1 var(--display);margin:14px 0 4px}.verdict.stall{color:var(--accent-text)}
.mini{border-collapse:collapse;font-size:15px;margin:12px 0}.mini th,.mini td{border-bottom:1px solid var(--line);padding:8px 14px 8px 0;text-align:left;vertical-align:top}.mini thead th{color:var(--muted);font-weight:400;font-size:13px}
.formula{font:400 clamp(22px,4vw,30px)/1.3 var(--display);margin:12px 0 18px;letter-spacing:.3px}
.sum{font-family:var(--mono);font-size:15px;font-variant-numeric:tabular-nums;background:var(--surface);border-left:3px solid var(--accent);padding:12px 14px;margin:14px 0;overflow-x:auto;white-space:nowrap}
header.wrap{padding-top:36px;padding-bottom:8px}section.wrap{padding-top:44px;padding-bottom:8px}footer{margin-top:56px;border-top:1px solid var(--line);padding:24px 0 48px;font-size:14px;color:var(--muted)}
@media (max-width:640px){body{font-size:16px}.dek{font-size:18px}.stagefig .wide{display:none}.stagefig .tall{display:block}dl.terms{grid-template-columns:1fr;gap:4px}dl.terms dd{margin-bottom:12px}.trace,.try{padding:12px;margin-left:-8px;margin-right:-8px}table.chart{font-size:10.5px;border-spacing:1px}.chart th{min-width:20px;padding:3px 0}.chart td{height:26px;padding:0}.chart th.lab{padding-right:4px;font-size:10px}.controls .slider{order:-1;flex-basis:100%}.controls button{flex:1}.verdict{font-size:28px}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}`;

const body = `
<header class="wrap">
  <div class="eyebrow">RV32I five-stage core · data hazards</div>
  <h1>A load makes the next instruction wait one cycle. Nothing else does.</h1>
  <p class="dek">This core sends results back to earlier stages, so an instruction that needs a fresh value almost never waits. The one exception is a load whose value the very next instruction reads. Its data does not exist yet.</p>
  <table class="summary" aria-describedby="sum-cap">
    <thead><tr><th scope="col">The instruction that reads x5 comes…</th><th scope="col">next (1 apart)</th><th scope="col">2 apart</th><th scope="col">3 apart</th></tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>
  <p class="caption" id="sum-cap">Six cases, each run through a model of the RTL rules in <code>rtl/rv32_core.sv</code>. The model replays all ${Object.keys(tracesReport.traces).length} recorded RTL traces cycle by cycle. Select a case to see it in section 5.</p>
  <ol class="toc"><li><a href="#stages">Five stages</a></li><li><a href="#alu">ALU forwarding</a></li><li><a href="#load">The load stall</a></li><li><a href="#rule">The rule in code</a></li><li><a href="#try">Try it</a></li><li><a href="#flush">Flush versus stall</a></li><li><a href="#cost">The cost</a></li></ol>
</header>

<main>
<section id="stages" class="wrap">
  <h2><span class="n">1</span>Five stages, one instruction in each</h2>
  <p>A pipeline works like an assembly line. Every clock cycle, each instruction moves one stage to the right, so up to five instructions are in flight at once.</p>
  <p>A <b>register</b> is one of 32 storage slots inside the CPU, named x0 to x31. x0 always reads zero. The <b>register file</b> holds them. An instruction reads its source registers (rs1, rs2) in ID and writes its destination register (rd) in WB.</p>
  <figure class="stagefig wide-wrap" style="padding:0">${wideFigure}${tallFigure}
    <figcaption>The five stages. The code on the right of each box is the name prefix of that stage's pipeline registers in the RTL. The yellow lines are forwarding paths. Each one carries a result back to an instruction that needs it before WB has written it.</figcaption>
  </figure>
  <p>A <b>data hazard</b> happens when an instruction needs a register that an older instruction has not written yet. The older instruction is still in the pipeline. There are two fixes. <b>Forwarding</b> takes the value from the stage where it already exists. A <b>stall</b> makes the younger instruction wait a cycle. Forwarding is free, and a stall costs a cycle.</p>
  <p>The key fact is in the figure. An ALU result exists at the end of EX. A load's data exists only at the end of MEM, one stage later.</p>
</section>

<section id="alu" class="wrap">
  <h2><span class="n">2</span>An ALU result forwards from MEM with no stall</h2>
  <p>An ALU instruction computes its result in EX. One cycle later that result sits in the MEM stage register <code>m_result</code>. The next instruction is now in EX and needs the value at the start of this cycle. The forwarding logic copies <code>m_result</code> straight into EX, so nobody waits.</p>
  ${stepper('fp', fp, `Real Icarus simulation of <code>rtl/rv32_core.sv</code> from <code>reports/visual-traces.json</code>. Rows are instructions and columns are clock cycles. A yellow cell sends a value, and an outlined cell receives it. In cycle ${fp.frames[fp.start].cycle}, two older instructions both hold a new x${fpX1.rd}. The add takes ${fpFrame.a} from MEM, not ${fpWb.value} from WB.`)}
  <p>When two older instructions both write the same register, the newer one must win. The RTL checks WB first and then MEM, so a MEM match overwrites a WB match:</p>
  ${codeBlock(code.forward, [L.memIf, L.memIf + 1, L.memIf + 2])}
</section>

<section id="load" class="wrap">
  <h2><span class="n">3</span>A load's data arrives one stage too late</h2>
  <p>A load uses EX only to add up its address. The data memory returns the value during MEM, so the value exists only at the end of MEM. The next instruction needs it at the start of its own EX, which is that same cycle. The value is not there yet.</p>
  <p>So the core holds the next instruction in ID for one cycle and sends an empty slot, a <b>bubble</b>, into EX. One cycle later the load is in WB, its data sits in <code>w_result</code>, and the waiting instruction takes it from there.</p>
  ${stepper('ls', ls, `Real RTL trace. <code>lw x2</code> is followed right away by <code>sw x2</code>, which needs x2 as the data to store. Cycle ${lsStall} is the stall. IF and ID repeat (outlined), and the bubble row shows the empty slot moving through EX, MEM and WB.`)}
  <p>Why not forward from MEM, as with an ALU result? In MEM, <code>m_result</code> holds the load's address, not its data. Line 45 skips loads (<code>!m_load</code>), so an address can never pass for data. The stall already keeps a consumer out of EX while its load is in MEM, so this term is a second guard.</p>
</section>

<section id="rule" class="wrap">
  <h2><span class="n">4</span>The stall rule, term by term</h2>
  <p>The whole rule is five lines. The hazard check looks at two stages: the instruction in EX (fields of <code>x_insn</code>) and the instruction behind it in ID (fields of <code>f_insn</code>).</p>
  ${codeBlock(code.hazard, [L.hazard, L.hazard + 1])}
  <dl class="terms">
    <dt>f_valid &amp;&amp; x_valid</dt><dd>Both slots hold real instructions. A bubble or a flushed slot never causes a stall.</dd>
    <dt>ld</dt><dd>The instruction in EX is a load. Only loads can stall, because every other result is ready by the end of EX.</dd>
    <dt>!trap</dt><dd>A load that traps writes nothing, so there is nothing to wait for. Line 112 also clears <code>ld</code> on a trap, so this is a second guard.</dd>
    <dt>x_insn[11:7] != 0</dt><dd>The load's rd is not x0. Writes to x0 are thrown away, so nothing can depend on them.</dd>
    <dt>f_insn[19:15] == x_insn[11:7]</dt><dd>The rs1 field of the instruction in ID names the load's rd. The same check on bits 24:20 covers rs2.</dd>
    <dt>uses_rs1, uses_rs2</dt><dd>The instruction in ID really reads that register. See below.</dd>
  </dl>
  <p><b>Why uses_rs1 and uses_rs2 exist.</b> Bits 19:15 name a register only in some instruction formats. In <code>lui</code> and <code>jal</code> those bits are part of an immediate. For example, <code>${disasm(lui)}</code> has the bits of x${fields(lui).rs1} in its rs1 field. Without <code>uses_rs1</code>, it would stall after <code>lw x${fields(lui).rs1}</code> for no reason. With it, the model runs that pair with ${luiRun.stalls} stalls. Lines 115-116 list the opcodes that read each register. Stores and branches read rs2. So does DOT4, the custom instruction.</p>
  <p>The list must also be complete. A missing entry would let a real dependency through without a stall. The mutation test in <code>reports/mutation.json</code> deletes entries one at a time, and the tests caught each one: ${usesMutants.map(m => `<code>${esc(m.mutant)}</code> (caught by <code>${esc(m.by)}</code>)`).join(', ')}. The mutant <code>${esc(bubbleMutant.mutant)}</code>, a stall without a bubble, was caught too: "${esc(bubbleMutant.message)}".</p>
</section>

<section id="try" class="wrap">
  <h2><span class="n">5</span>Try it</h2>
  <p>Pick what writes x5 and how far behind it the reader <code>addi x6, x5, 1</code> sits. Empty slots are filled with <code>nop</code>. The answer and the chart come from the model of the RTL rules, not a recorded trace.</p>
  <div class="try" id="tryit">
    <fieldset><legend>Producer</legend><div class="seg">
      <label><input type="radio" name="producer" value="alu"><span>ALU op: <code>addi x5, x0, ${TRY_VALUE}</code></span></label>
      <label><input type="radio" name="producer" value="load"><span>Load: <code>lw x5, 128(x0)</code></span></label>
    </div></fieldset>
    <fieldset><legend>Distance (instructions apart)</legend><div class="seg">
      ${[1, 2, 3].map(d => `<label><input type="radio" name="distance" value="${d}"><span>${d}</span></label>`).join('')}
    </div></fieldset>
    <p class="verdict" aria-live="polite" data-verdict></p>
    <p data-detail></p>
    <figure class="trace" data-trace="try" style="margin:12px 0 0">
      <div class="trace-head"><b>Model run</b><span class="muted" data-runinfo></span></div>
      <div class="chart-scroll"><table class="chart" aria-describedby="try-note"></table></div>
      <div class="controls">
        <button type="button" data-step="-1" aria-label="Previous cycle">← Prev</button>
        <label class="slider">Cycle <output data-cycle></output><input type="range" min="1" step="1" aria-label="Cycle"></label>
        <button type="button" data-step="1" aria-label="Next cycle">Next →</button>
      </div>
      <p class="note" id="try-note" aria-live="polite"></p>
    </figure>
  </div>
  <p class="caption">At distance 3 the reader is in ID while the producer is in WB. The register file is written at the same clock edge as it is read, so a separate WB-to-ID bypass (lines ${L.bypass}-${L.bypass + 4}) hands the value over. Past distance 3, the register file already holds the value.</p>
</section>

<section id="flush" class="wrap">
  <h2><span class="n">6</span>When a flush and a stall meet, the flush wins</h2>
  <p>A <b>flush</b> throws away the two instructions behind the one in EX: the one in ID, and the one being fetched in IF. In the RTL, clearing <code>f_valid</code> and <code>x_valid</code> means neither one ever enters EX. A flush happens when a branch or jump is taken in EX, because those two were fetched from the wrong place. It also happens when an instruction traps. The clock-edge logic checks the flush first:</p>
  ${codeBlock(code.priority, [L.redirect, L.stall, L.stall + 1])}
  <table class="mini">
    <thead><tr><th scope="col">Flush (redirect or fault)</th><th scope="col">Hazard</th><th scope="col">What happens at the clock edge</th></tr></thead>
    <tbody>
      <tr><td>no</td><td>no</td><td>Everything moves one stage forward.</td></tr>
      <tr><td>no</td><td>yes</td><td>Stall: IF and ID hold, and a bubble goes into EX.</td></tr>
      <tr><td>yes</td><td>no</td><td>Flush: the instructions in IF and ID are thrown away. On a branch, fetch restarts at the target.</td></tr>
      <tr><td>yes</td><td>yes</td><td>Same as the row above. The stall is ignored.</td></tr>
    </tbody>
  </table>
  <p>The order is right because the instruction waiting in ID is on the wrong path. Holding it for one cycle would waste that cycle, since the flush removes it anyway. The stall counter follows the same rule, so a lost cycle is never counted twice:</p>
  ${codeBlock(code.event, [L.event])}
  <p>In this core the last row cannot happen. Both signals look at the one instruction in EX. A hazard needs a load that does not trap, and a load is never a taken branch (lines ${L.load}-${L.load + 6} and ${L.clear}). A model test checks this against random instruction words. The order still matters. If a later change let the two overlap, the flush would still win. You can see a flush in the trace in section 3: EBREAK traps in EX in cycle ${lsFlush}.</p>
</section>

<section id="cost" class="wrap">
  <h2><span class="n">7</span>The cost, one cycle at a time</h2>
  <p><code>reports/benchmark.json</code> states the cycle count of every benchmark run as one sum:</p>
  <p class="formula">cycles = retired + stalls + 2 × flushes + 3</p>
  <p>Each retired instruction costs one cycle. Each load-use stall adds one. Each flush adds two, for the two thrown-away instructions. The 3 is fixed: the pipeline fills for five cycles before the first instruction retires, and the flush of the final EBREAK already accounts for two of them.</p>
  <p><b>Worked example.</b> The DOT4 kernel on ${ex.n} elements, read from the report:</p>
  <p class="sum">${ex.retired} + ${ex.stalls} + 2 × ${ex.flushes} + 3 = ${ex.cycles} cycles</p>
  <p>The flushes cost ${2 * ex.flushes} cycles, ${pct(2 * ex.flushes, ex.cycles)}% of the run. They come from the taken loop branch, plus the final EBREAK.${allZero ? ` Stalls cost nothing: every one of the ${runs.length} benchmark runs reports 0 stalls, because no load in those kernels is read by the very next instruction.` : ''}</p>
  <p>The same sum holds for the trace in section 3: ${lsTrace.retirements} + ${lsStalls} + 2 × ${lsFlushes} + 3 = ${lsTrace.frames.length} cycles, and there you can count each cycle by hand. The ${regressionPrograms} regression programs trigger the stall on purpose, ${regressionStalls} times in total (<code>reports/verification.json</code>).</p>
</section>
</main>

<footer class="wrap">
  <p>Every number on this page is read from <code>reports/*.json</code> or computed from <code>rtl/rv32_core.sv</code> when the page is built. Charts in sections 2 and 3 are RTL snapshots: ${esc(traceScope)}</p>
  <p>The try-it charts come from a JavaScript model of the RTL rules. Its test replays all ${Object.keys(tracesReport.traces).length} RTL traces cycle by cycle, with stages, stall, flush and the EX operands, and checks the stall rule for every case shown. Simulation only. This core has not run on hardware.</p>
  <p>Rebuild: <code>node scripts/figures/load-use-explainer/build.mjs</code>. Test: <code>node --test scripts/figures/load-use-explainer/</code>. Fonts: Anton and IBM Plex Sans, SIL OFL.</p>
</footer>`;

const client = `
const DATA = ${JSON.stringify(data)};
const STEPPERS = {};
function stepper(fig) {
  const table = fig.querySelector('table.chart'), range = fig.querySelector('input[type=range]');
  const out = fig.querySelector('[data-cycle]'), note = fig.querySelector('.note');
  let view = null, col = 0, cells = [], heads = [];
  function draw(v) {
    view = v; table.textContent = '';
    const thead = table.createTHead().insertRow();
    const corner = document.createElement('th'); corner.className = 'lab'; corner.scope = 'col'; corner.textContent = 'Cycle'; thead.append(corner);
    heads = v.frames.map(f => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = f.cycle; thead.append(th); return th; });
    const tbody = table.createTBody();
    cells = v.rows.map(row => {
      const tr = tbody.insertRow(); if (row.pc === null) tr.className = 'bubble';
      const th = document.createElement('th'); th.className = 'lab'; th.scope = 'row'; th.textContent = row.label; tr.append(th);
      return row.cells.map(c => { const td = tr.insertCell(); if (c) { td.textContent = c.text; td.className = c.kind; } return td; });
    });
    range.max = v.frames.length;
  }
  function go(i) {
    col = Math.max(0, Math.min(view.frames.length - 1, i));
    heads.forEach((h, k) => h.classList.toggle('now', k === col));
    cells.forEach(r => r.forEach((td, k) => { td.classList.toggle('now', k === col); td.classList.remove('src', 'dst'); }));
    const f = view.frames[col];
    f.marks.forEach(m => cells[m.row][m.col].classList.add(m.kind));
    range.value = col + 1; out.textContent = f.cycle;
    note.textContent = f.note;
    fig.querySelector('[data-step="-1"]').disabled = col === 0;
    fig.querySelector('[data-step="1"]').disabled = col === view.frames.length - 1;
    const now = heads[col], box = table.parentElement;
    if (now.offsetLeft + now.offsetWidth > box.scrollLeft + box.clientWidth || now.offsetLeft < box.scrollLeft + 120) box.scrollLeft = Math.max(0, now.offsetLeft - box.clientWidth / 2);
    saveHash();
  }
  fig.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => go(col + Number(b.dataset.step))));
  range.addEventListener('input', () => go(range.value - 1));
  return { draw, go, get col() { return col; } };
}
let ready = false;
function saveHash() {
  if (!ready) return;
  const p = new URLSearchParams({ fp: STEPPERS.fp.col + 1, ls: STEPPERS.ls.col + 1, try: current(), t: STEPPERS.try.col + 1 });
  history.replaceState(null, '', '#' + p);
}
const tryEl = document.getElementById('tryit');
const current = () => tryEl.querySelector('[name=producer]:checked').value + '-' + tryEl.querySelector('[name=distance]:checked').value;
function showCase(key, col) {
  const [p, d] = key.split('-');
  tryEl.querySelector('[name=producer][value=' + p + ']').checked = true;
  tryEl.querySelector('[name=distance][value="' + d + '"]').checked = true;
  const c = DATA.cases[key];
  const v = tryEl.querySelector('[data-verdict]'); v.textContent = c.verdict; v.classList.toggle('stall', c.stalls > 0);
  tryEl.querySelector('[data-detail]').textContent = c.detail;
  tryEl.querySelector('[data-runinfo]').textContent = c.cycles + ' cycles = ' + c.retired + ' retired + ' + c.stalls + ' stalls + 2 × ' + c.flushes + ' flush + 3';
  STEPPERS.try.draw(c); STEPPERS.try.go(col ?? c.focus);
}
document.querySelectorAll('[data-trace]').forEach(fig => STEPPERS[fig.dataset.trace] = stepper(fig));
const h = new URLSearchParams(location.hash.slice(1));
const num = (k, d) => { const n = parseInt(h.get(k), 10); return Number.isFinite(n) ? n - 1 : d; };
STEPPERS.fp.draw(DATA.fp); STEPPERS.fp.go(num('fp', DATA.fp.start));
STEPPERS.ls.draw(DATA.ls); STEPPERS.ls.go(num('ls', DATA.ls.start));
showCase(DATA.cases[h.get('try')] ? h.get('try') : DATA.start, h.has('t') ? num('t', 0) : undefined);
ready = true;
tryEl.addEventListener('change', () => showCase(current()));
document.querySelectorAll('[data-case]').forEach(a => a.addEventListener('click', () => showCase(a.dataset.case)));
`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Why a load needs one stall cycle, and why nothing else does</title>
<meta name="description" content="How the five-stage RV32I core in rtl/rv32_core.sv forwards results, and why only a load followed by its use stalls.">
<style>${css}</style></head>
<body>${body}
<script>${client}</script>
</body></html>
`;

if (/—/.test(body)) fail('page text contains an em dash');
const outDir = new URL('output/figures/load-use-explainer/', root);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL('index.html', outDir), html);
console.log(`wrote output/figures/load-use-explainer/index.html (${(html.length / 1024).toFixed(0)} KB)`);
