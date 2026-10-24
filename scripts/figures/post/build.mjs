// Builds output/figures/post/index.html. Every measured number is read from reports/*.json here.
import {readFileSync, writeFileSync, mkdirSync, copyFileSync} from 'node:fs';
import {metrics} from '../../textbook/metrics.mjs';

const root = new URL('../../../', import.meta.url);
const here = new URL('./', import.meta.url);
const out = new URL('output/figures/post/', root);
const read = (url, enc = 'utf8') => readFileSync(url, enc);

const report = name => {
  const data = JSON.parse(read(new URL(`reports/${name}.json`, root)));
  return path => {
    const value = path.split('.').reduce((v, k) => v?.[k], data);
    if (value === undefined) throw Error(`reports/${name}.json has no ${path}; regenerate it with make`);
    return value;
  };
};
const must = (ok, message) => { if (!ok) throw Error(message); };
const near = (a, b, tol, what) => must(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

const bench = report('benchmark');
const ablation = report('ablation');
const mutation = report('mutation');
const board = report('board');
const implementation = report('implementation');

const count = n => n.toLocaleString('en-US');
const mhz = n => n.toFixed(2);
const pct = (part, whole) => (100 * part / whole).toFixed(0);

// Throughput rows for the largest N, as the README and metrics.mjs quote them.
const largest = ablation('throughput').reduce((a, b) => (b.n > a.n ? b : a));
const on = ablation('variants.dot4_1');
const off = ablation('variants.dot4_0');
const shipped = ablation('variants.dot4_1_default_flow');
const kernelText = bench('kernels');
const tableMatch = /(\d+)-word table \((\d+) bytes\)/.exec(kernelText.rv32i_qsquare);
must(tableMatch, 'benchmark.kernels.rv32i_qsquare no longer names its table size');

const kernels = [
  {id: 'rv32i_shift', name: 'RV32I shift-and-add', note: 'word loads, shift-and-add multiply', core: off},
  {id: 'rv32i_lb', name: 'RV32I byte loads + shift-and-add', note: 'LB loads, shift-and-add multiply', core: off},
  {id: 'rv32i_qsquare', name: 'RV32I quarter-square', note: 'strongest pure RV32I kernel', core: off},
  {id: 'dot4', name: 'DOT4', note: 'one DOT4 and one ADD per four elements', core: on},
].map(k => {
  const row = largest[k.id];
  must(row?.cycles, `ablation throughput row n=${largest.n} has no ${k.id}`);
  const fmax = k.core.fmax_mhz.median;
  const micros = row.cycles / fmax;
  near(1e6 / micros, row.dot_products_per_s, 1, `${k.id} dot products per second`);
  return {...k, cycles: row.cycles, fmax, micros};
});
const byId = Object.fromEntries(kernels.map(k => [k.id, k]));
const dot = byId.dot4, qs = byId.rv32i_qsquare, shift = byId.rv32i_shift;

const cycleRatio = qs.cycles / dot.cycles;
const clockRatio = on.fmax_mhz.median / off.fmax_mhz.median;
const speed = largest.speedup_vs_rv32i_qsquare;
near(cycleRatio * clockRatio, speed.clock_adjusted_median, 0.01, 'clock-adjusted speedup');
near(shift.micros / dot.micros, largest.speedup_vs_rv32i_shift.clock_adjusted_median, 0.01, 'shift speedup');
must(speed.clock_adjusted_median.toFixed(1) === metrics.speedup.vsQsquare, 'speedup disagrees with metrics.mjs');

// The cycle identity, checked on the DOT4 run that the post quotes.
const dotRun = bench('runs').find(r => r.kernel === 'dot4' && r.n === largest.n && r.dataset === 'uniform');
must(dotRun, `benchmark.runs has no uniform dot4 run at n=${largest.n}`);
must(dotRun.retired + dotRun.stalls + 2 * dotRun.flushes + 3 === dotRun.cycles, 'cycle identity fails for dot4 run');
must(dotRun.cycles === dot.cycles, 'benchmark and ablation disagree on DOT4 cycles');

const cells = ablation('delta_dot4_on_minus_off.median_logic_cells');
const fmaxDrop = -ablation('delta_dot4_on_minus_off.median_fmax_mhz');
const sameLogicSpread = ablation('same_logic_netlist_spread.median_fmax_mhz');
const rangesSeparate = on.fmax_mhz.max < off.fmax_mhz.min;
const officialFmax = Object.values(implementation('fmax'))[0].achieved;
const officialIsSlowest = officialFmax === shipped.fmax_mhz.min;

const sra = mutation('results').find(r => r.mutant === 'sra_is_logical');
const sraMatch = sra && /^(\S+) .*signature word \d+ is \['([0-9a-f]+)'\], Spike ([0-9a-f]+)/.exec(sra.by);
must(sra?.killed && sraMatch, 'mutation report no longer has the sra_is_logical signature message');
must(board('board_tested') === false, 'board.json says the board was tested; rewrite the "not done yet" section');

// Toy numbers for the quarter-square illustration, computed rather than typed.
const ta = 7, tb = -3;
const qsq = x => Math.floor(x * x / 4);
must(qsq(ta + tb) - qsq(ta - tb) === ta * tb, 'quarter-square illustration is wrong');

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const repo = 'https://github.com/RahilBhavan/riscv';
const site = 'https://rahilbhavan.com/riscv';
const reportLink = name => `<a href="${repo}/blob/main/reports/${name}.json">${name}.json</a>`;
const m = metrics;

// Figure 1: time per dot product, bars on a zero baseline.
const maxMicros = Math.max(...kernels.map(k => k.micros));
const barRows = kernels.map(k => {
  const width = 100 * k.micros / maxMicros;
  near(width / k.micros, 100 / maxMicros, 1e-9, 'bar scale');
  const tone = k.id === 'dot4' ? 'accent' : k.id === 'rv32i_qsquare' ? 'ink' : 'quiet';
  return `<div class="bar-row">
    <div class="bar-label"><strong>${k.name}</strong><span>${count(k.cycles)} cycles at ${mhz(k.fmax)} MHz</span></div>
    <div class="bar-track"><span class="bar ${tone}" style="width:${width.toFixed(2)}%"></span><span class="bar-value">${k.micros.toFixed(1)} µs</span></div>
  </div>`;
}).join('');

// Figure 2: Fmax per route seed. A position encoding, so the axis starts near the data and says so.
const lo = Math.floor(Math.min(shipped.fmax_mhz.min, on.fmax_mhz.min, off.fmax_mhz.min)) - 1;
const hi = Math.ceil(Math.max(off.fmax_mhz.max, on.fmax_mhz.max, shipped.fmax_mhz.max)) + 1;
const pos = v => (100 * (v - lo) / (hi - lo)).toFixed(2);
const stripRow = (label, sub, variant, tone) => `<div class="strip-row">
    <div class="strip-label"><strong>${label}</strong><span>${sub}</span></div>
    <div class="strip-track" role="img" aria-label="${label}: seeds ${variant.seeds.map(s => `${s.seed} ${mhz(s.fmax_mhz)}`).join(', ')} MHz; median ${mhz(variant.fmax_mhz.median)} MHz">
      <span class="strip-range" style="left:${pos(variant.fmax_mhz.min)}%;width:${(pos(variant.fmax_mhz.max) - pos(variant.fmax_mhz.min)).toFixed(2)}%"></span>
      ${variant.seeds.map(s => `<span class="dot ${tone}" style="left:${pos(s.fmax_mhz)}%" title="seed ${s.seed}: ${mhz(s.fmax_mhz)} MHz"></span>`).join('')}
      <span class="median" style="left:${pos(variant.fmax_mhz.median)}%"><span>${mhz(variant.fmax_mhz.median)}</span></span>
    </div>
  </div>`;
const ticks = [];
for (let t = Math.ceil(lo / 2) * 2; t <= hi; t += 2) ticks.push(`<span style="left:${pos(t)}%">${t}</span>`);

const css = [
  `@font-face{font-family:'Rahil Display';src:url(data:font/woff2;base64,${read(new URL('docs/textbook/fonts/Anton-Regular.woff2', root), 'base64')}) format('woff2');font-weight:400;font-display:swap}`,
  `@font-face{font-family:'Rahil Plex';src:url(data:font/woff2;base64,${read(new URL('docs/textbook/fonts/IBMPlexSans-Regular.woff2', root), 'base64')}) format('woff2');font-weight:400;font-display:swap}`,
  `@font-face{font-family:'Rahil Plex';src:url(data:font/woff2;base64,${read(new URL('docs/textbook/fonts/IBMPlexSans-SemiBold.woff2', root), 'base64')}) format('woff2');font-weight:600;font-display:swap}`,
  ':root{' + Object.entries(JSON.parse(read(new URL('vendor/tokens.json', here))).color)
    .map(([k, v]) => `--color-${k}:${v.$value}`).join(';') + ';--radius-panel:12px}',
  read(new URL('vendor/components.css', here)),
  read(new URL('post.css', here)),
].join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>I built a RISC-V core and measured what one custom instruction costs</title>
<meta name="description" content="A five-stage RV32I core with one custom int8 dot-product instruction: ${m.speedup.vsQsquare}x faster than the strongest pure RV32I kernel after its clock cost, for ${m.speedup.logicCellCost}% more logic cells.">
<style>${css}</style>
</head>
<body>
<a class="skip" href="#main">Skip to the post</a>
<div class="page">
<header class="site-header">
  <span class="brand">Rahil Bhavan</span>
  <nav class="nav" aria-label="Project">
    <a href="${repo}">Repo</a>
    <a href="#explore">Interactive figures</a>
  </nav>
</header>
<main id="main">
<article>
<header class="hero post-hero">
  <p class="issue-line">Build Notes · RISC-V core · Draft</p>
  <h1>I built a RISC-V core and measured what one custom instruction costs</h1>
  <p class="dek">A small five-stage RV32I processor, one extra instruction for int8 dot products, and a question I could actually measure. Does the instruction pay for the area and clock speed it takes?</p>
  <p class="status-line">Simulation and post-route estimates only. The core has not run on a physical board yet.</p>
</header>

<section class="story" aria-labelledby="answer">
  <h2 id="answer">Short answer</h2>
  <div class="body">
    <p>On a ${m.speedup.n}-element int8 dot product, the custom instruction is <strong>${m.speedup.vsQsquare}× faster</strong> than the strongest pure RV32I kernel, after counting the clock speed it costs. It takes ${m.speedup.logicCellCost}% more logic cells and ${m.speedup.fmaxCost}% of the median clock. Against the naive baseline it looks like ${m.speedup.vsShift}×. Most of this post is about why the smaller number is the right one.</p>
  </div>
  <figure class="figure wide-figure" aria-labelledby="fig-time-title">
    <p class="fig-title" id="fig-time-title">Time for one ${m.speedup.n}-element dot product. Shorter is better.</p>
    <div class="bars">${barRows}</div>
    <figcaption>Each bar is simulated cycles divided by its core's median post-route clock over nextpnr seeds ${m.fmax.seeds}. RV32I kernels run on the core built without DOT4. DOT4 runs on the core built with it. The comparison that matters is the yellow bar against the black one. Estimates from Icarus simulation and nextpnr, not board measurements. Source: ${reportLink('ablation')}, ${reportLink('benchmark')}.</figcaption>
  </figure>
</section>

<section class="story" aria-labelledby="why">
  <h2 id="why">Why build one, and how</h2>
  <div class="body">
    <p>The project asks a question with a number at the end: what does it cost to add hardware for one specific job? Answering it means understanding how a pipeline handles one instruction that needs the result of the one right before it.</p>
    <p>One thing up front. <strong>I built this with an AI coding assistant.</strong> The repo started as a placeholder README in October 2026. The RTL, tests and build flow were generated with its help. So this isn't a "look what I designed from scratch" post. It's about reading the core, measuring it and trying to break it. The <a href="${repo}#readme">README</a> says the same thing.</p>
  </div>
</section>

<section class="story" aria-labelledby="pipeline">
  <h2 id="pipeline">Five stages, three ways to get it wrong</h2>
  <div class="body">
    <p>The core has the textbook five stages: fetch, decode, execute, memory and writeback. A new instruction can start every cycle. The hard part is that up to five instructions are in flight at once, and some need results that haven't reached the register file yet.</p>
    <ul class="plain-list">
      <li><strong>Forwarding.</strong> If an instruction needs a value the one before it just computed, execute takes it straight from the memory or writeback stage. When both have it, the newer one wins.</li>
      <li><strong>Load-use stall.</strong> A load's data only exists at the end of the memory stage. If the very next instruction needs it, the core holds fetch and decode for one cycle and lets a bubble through.</li>
      <li><strong>Branch flush.</strong> Branches resolve in execute. The core keeps fetching the next address, so a taken branch or jump throws away the two instructions behind it. That's two lost cycles.</li>
    </ul>
    <p>Those rules account for every cycle. The benchmark checks this identity on every run:</p>
    <pre class="code">${esc(bench('cycle_identity').replace(/ for every run$/, ''))}</pre>
    <p>For the ${m.speedup.n}-element DOT4 kernel that's ${count(dotRun.retired)} + ${count(dotRun.stalls)} + 2 × ${count(dotRun.flushes)} + 3 = ${count(dotRun.cycles)} cycles.</p>
    <p class="see-also">See it cycle by cycle from real RTL traces in the <a href="${site}/pipeline-machine">pipeline machine</a> and the <a href="${site}/load-use-explainer">load-use explainer</a>.</p>
  </div>
</section>

<section class="story" aria-labelledby="dot4">
  <h2 id="dot4">One extra instruction</h2>
  <div class="body">
    <p>RV32I has no multiply instruction at all. DOT4 treats each 32-bit register as four signed 8-bit numbers, multiplies them lane by lane and adds the four products.</p>
    <pre class="code">dot4 rd, rs1, rs2
rd = a0·b0 + a1·b1
   + a2·b2 + a3·b3</pre>
    <p>It lives in custom-0, the opcode space RISC-V leaves for extensions (opcode 0x0b, funct3 0, funct7 0). Every other custom-0 encoding traps. The four 8×8 multiplies and their adder tree fit inside the existing execute stage, so DOT4 forwards and stalls like any other instruction. Int8 dot products are the inner loop of a lot of quantized ML inference, which made this a reasonable thing to try.</p>
    <p class="see-also">Try your own bytes in the <a href="${site}/dot4-machine">DOT4 machine</a>.</p>
  </div>
</section>

<section class="story" aria-labelledby="measure">
  <h2 id="measure">What it buys, and what it costs</h2>
  <div class="body">
    <p>Counting cycles isn't enough. Extra logic in execute can lengthen the slowest path through the chip, which lowers the maximum clock. So the same core was built twice, once with DOT4 and once without, and both were routed for an iCE40 HX8K FPGA.</p>

    <h3>The baseline decides the headline</h3>
    <p>Without a multiply instruction, RV32I code multiplies in software. The benchmark first specified the classic shift-and-add loop, the one libgcc uses. Against that, DOT4 is ${m.speedup.vsShift}× faster. That number is real, but it flatters DOT4, because shift-and-add is slow.</p>
    <p>So the benchmark also has a quarter-square kernel. It turns a multiply into two table lookups and a subtraction:</p>
    <pre class="code">a·b = ⌊(a+b)²/4⌋ − ⌊(a−b)²/4⌋</pre>
    <div class="illustration">
      <p class="tag">Illustration, toy numbers</p>
      <p>a = ${ta}, b = ${tb}. ⌊(${ta + tb})²/4⌋ = ${qsq(ta + tb)}. ⌊(${ta - tb})²/4⌋ = ${qsq(ta - tb)}. ${qsq(ta + tb)} − ${qsq(ta - tb)} = ${ta * tb}, which is ${ta} × ${tb}.</p>
    </div>
    <p>With a ${tableMatch[1]}-word table of squares, it's the fastest pure RV32I kernel in the benchmark: ${count(qs.cycles)} cycles, against ${count(shift.cycles)} for shift-and-add. It's the honest baseline because it's the one DOT4 actually has to beat. It also uses ${count(Number(tableMatch[2]))} bytes of data memory that DOT4 doesn't, and this comparison doesn't charge it for that.</p>

    <h3>Counting the clock</h3>
    <table class="calc">
      <caption class="sr-only">How the ${m.speedup.vsQsquare}× speedup is computed</caption>
      <tbody>
        <tr><th scope="row">Fewer cycles</th><td>${count(qs.cycles)} ÷ ${count(dot.cycles)}</td><td>${cycleRatio.toFixed(2)}×</td></tr>
        <tr><th scope="row">Slower clock</th><td>${mhz(on.fmax_mhz.median)} ÷ ${mhz(off.fmax_mhz.median)} MHz</td><td>${clockRatio.toFixed(3)}</td></tr>
        <tr class="total"><th scope="row">Faster in time</th><td>${cycleRatio.toFixed(2)} × ${clockRatio.toFixed(3)}</td><td>${speed.clock_adjusted_median.toFixed(2)}×</td></tr>
      </tbody>
    </table>
    <p>Rounded, that's ${m.speedup.vsQsquare}×. Pairing the slowest and fastest route seeds of each build gives ${m.speedup.vsQsquareMin}× to ${m.speedup.vsQsquareMax}×.</p>

    <h3>The cost</h3>
    <table class="data">
      <caption>Same core with DOT4 off and on. Median over nextpnr seeds ${m.fmax.seeds}, iCE40 HX8K.</caption>
      <thead><tr><th scope="col">Resource</th><th scope="col">Off</th><th scope="col">On</th><th scope="col">Change</th></tr></thead>
      <tbody>
        <tr><th scope="row">Logic cells</th><td>${count(off.logic_cells.median)}</td><td>${count(on.logic_cells.median)}</td><td>+${count(cells)} (+${m.speedup.logicCellCost}%)</td></tr>
        <tr><th scope="row">LUT4s</th><td>${count(off.lut4)}</td><td>${count(on.lut4)}</td><td>+${count(on.lut4 - off.lut4)}</td></tr>
        <tr><th scope="row">Flip-flops</th><td>${count(off.flip_flops)}</td><td>${count(on.flip_flops)}</td><td>${on.flip_flops === off.flip_flops ? 'none' : count(on.flip_flops - off.flip_flops)}</td></tr>
        <tr><th scope="row">Clock (MHz)</th><td>${mhz(off.fmax_mhz.median)}</td><td>${mhz(on.fmax_mhz.median)}</td><td>−${fmaxDrop.toFixed(2)} (−${m.speedup.fmaxCost}%)</td></tr>
      </tbody>
    </table>
    <p>These are FPGA logic cells, not chip area. The HX8K has no hard multiplier blocks, so DOT4's four multipliers are built from ordinary logic. No flip-flops are added because DOT4 finishes inside the existing execute cycle.</p>

    <h3>One route seed is noise</h3>
    <p>Place and route starts from a random seed. Same logic, different seed, different clock. On the shipped build the five seeds ranged from ${m.fmax.min} to ${m.fmax.max} MHz.${officialIsSlowest ? ` The official seed-${m.fmax.officialSeed} report happens to be the slowest of the five.` : ''} That's why the headline is the median, <strong>${m.fmax.median} MHz</strong>, and not whichever seed ran first.</p>
  </div>
  <figure class="figure wide-figure" aria-labelledby="fig-seed-title">
    <p class="fig-title" id="fig-seed-title">Post-route clock estimate (MHz) for each of five nextpnr seeds</p>
    <div class="strip">
      ${stripRow('No DOT4', 'compared build', off, 'ink')}
      ${stripRow('DOT4', 'compared build', on, 'accent')}
      ${stripRow('DOT4, shipped', 'make timing, headline', shipped, 'quiet')}
      <div class="strip-row axis-row"><div></div><div class="strip-axis" aria-hidden="true">${ticks.join('')}</div></div>
    </div>
    <figcaption>Dots are seeds, the tick is the median. The axis runs ${lo} to ${hi} MHz, not from zero, because position is what's compared here. ${rangesSeparate ? 'The DOT4 and no-DOT4 ranges do not overlap, so the clock cost is bigger than seed noise. ' : 'The DOT4 and no-DOT4 ranges overlap, so part of the clock cost is within seed noise. '}The two compared builds set the DOT4 parameter the same way. Setting it differently changed the netlist of identical logic and moved the median by ${sameLogicSpread.toFixed(1)} MHz, which is why the shipped build sits apart. Source: ${reportLink('ablation')}.</figcaption>
  </figure>
</section>

<section class="story" aria-labelledby="verify">
  <h2 id="verify">How it was checked</h2>
  <div class="body">
    <ul class="plain-list">
      <li><strong>${m.regression.programs} programs</strong> (directed, random and generated) pass in both Icarus and Verilator. All ${m.regression.retired} retired instructions and every byte written to memory match a separate Python reference model.</li>
      <li><strong>Spike.</strong> The core matches the standard RISC-V ISA simulator on ${m.spike.archPassed}/${m.spike.archTotal} RV32I tests from riscv-arch-test ${m.spike.archRelease}, plus ${m.spike.randomPrograms} random programs compared retirement by retirement. That's an external check, not certification.</li>
      <li><strong>Hazard bins.</strong> A generator wrote ${m.regression.hazardPrograms} programs to cover every producer, consumer and distance from one to three instructions: ${m.regression.hazardBinsHit}/${m.regression.hazardBinsTotal} bins hit.</li>
      <li><strong>DOT4 sweep.</strong> All ${m.dot4Sweep.cases} single-lane input pairs run through the full core and match a scalar oracle. Sums across several lanes are covered by directed and random programs, not exhaustively.</li>
      <li><strong>Mutants.</strong> ${m.mutants.killed} of ${m.mutants.total} deliberate single-bug edits to the RTL are caught by the check meant to catch them. For example, making SRA shift in zeros instead of copying the sign bit makes the ${esc(sraMatch[1])} test write <code>${sraMatch[2]}</code> where Spike writes <code>${sraMatch[3]}</code>.</li>
    </ul>
    <p>The mutants test the tests. A passing suite says little until it has been seen to fail on a real bug.</p>
    <p class="see-also">All of it as charts on the <a href="${site}/evidence">evidence page</a>.</p>
  </div>
</section>

<section class="story" aria-labelledby="open">
  <h2 id="open">What isn't done yet</h2>
  <div class="body">
    <ul class="plain-list">
      <li><strong>No hardware run.</strong> A board image for the iCE40-HX8K Breakout builds, and its self-test passes in simulation. It routes at ${mhz(board('fmax_mhz'))} MHz post-route against the board's ${count(board('constraint_mhz'))} MHz oscillator. It has not run on a board yet, so every clock number here is an estimate.</li>
      <li><strong>Formal checks are bounded.</strong> riscv-formal's checks pass to 20 cycles from reset, but they leave out CSR instructions, and the newer ACT4 tests aren't integrated. Spike is the only reference simulator.</li>
      <li><strong>The extras aren't in these numbers.</strong> A ZICSR=1 build adds machine-mode traps and interrupts, and MEXT=1 adds a multiplier that takes 34 cycles per operation. The board image and every figure here use the default core.</li>
      <li><strong>No hardware multiply baseline.</strong> The M extension now exists, but I haven't run the dot-product benchmark against it.</li>
    </ul>
    <p class="question">Next test: flash the board, run the self-test at ${count(board('constraint_mhz'))} MHz and check the signature against simulation. Then run the benchmark on the MEXT=1 core and see how much of the ${m.speedup.vsQsquare}× survives a real multiply.</p>
  </div>
</section>

<section class="story" id="explore" aria-labelledby="explore-title">
  <h2 id="explore-title">Explore it</h2>
  <ul class="link-list">
    <li><a href="${site}/pipeline-machine">Pipeline machine</a><span>Step through real RTL traces, stage by stage.</span></li>
    <li><a href="${site}/load-use-explainer">Load-use explainer</a><span>Why a load costs one bubble, and when.</span></li>
    <li><a href="${site}/dot4-machine">DOT4 machine</a><span>Four byte lanes, four products, one sum.</span></li>
    <li><a href="${site}/evidence">Evidence</a><span>Speedup, cost, seeds and verification as charts.</span></li>
    <li><a href="${site}/video/riscv.mp4">Video</a><span>The short version.</span></li>
    <li><a href="${repo}">Source on GitHub</a><span>RTL, tests, reports and the full README.</span></li>
  </ul>
  <p class="sources">Reports: ${['benchmark', 'ablation', 'implementation', 'isa-compare', 'verification', 'dot4-sweep', 'mutation', 'board'].map(reportLink).join(', ')}.</p>
</section>
</article>
</main>
<footer class="footer">
  <p>Draft for Rahil's review, agent-drafted from the project's reports. Not published. Every number on this page is read from <code>reports/*.json</code> when the page is built (RTL sha256 ${esc(ablation('rtl_sha256')['rtl/rv32_core.sv'].slice(0, 12))}). Fonts: Anton and IBM Plex Sans, SIL Open Font License.</p>
</footer>
</div>
</body>
</html>
`;

must(!/—/.test(html.replace(/<style>[\s\S]*?<\/style>/, '')), 'em dash in page text');
mkdirSync(out, {recursive: true});
writeFileSync(new URL('index.html', out), html);
copyFileSync(new URL('docs/textbook/fonts/Anton-LICENSE.txt', root), new URL('Anton-LICENSE.txt', out));
copyFileSync(new URL('docs/textbook/fonts/LICENSE.txt', root), new URL('IBMPlexSans-LICENSE.txt', out));
console.log(`wrote output/figures/post/index.html (${(html.length / 1024).toFixed(0)} KiB)`);
