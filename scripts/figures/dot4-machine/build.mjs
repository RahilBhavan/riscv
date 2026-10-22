// Builds output/figures/dot4-machine/index.html: two Colorfigures figures (the DOT4 unit, the HX8K board)
// embedded as srcdoc iframes in one offline page. Every measured number is read from reports/*.json here.
//   node scripts/figures/dot4-machine/build.mjs [--debug]
// --debug also writes each figure as a standalone page to build/figures/dot4-machine/debug/.
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {metrics} from '../../textbook/metrics.mjs';

const here = new URL('./', import.meta.url).pathname;
const root = new URL('../../../', import.meta.url).pathname;
const read = p => readFileSync(join(root, p), 'utf8');
const fail = msg => { throw Error(`dot4-machine build: ${msg}`); };

const json = name => JSON.parse(read(`reports/${name}.json`));
const need = (name, data, path) => {
  const v = path.split('.').reduce((o, k) => o?.[k], data);
  if (v === undefined || v === null) fail(`reports/${name}.json has no ${path}; regenerate it with make`);
  return v;
};
const ablation = json('ablation'), board = json('board');
const ab = path => need('ablation', ablation, path), bd = path => need('board', board, path);

// The page claims the model mirrors these RTL lines; stop if they change.
const core = read('rtl/rv32_core.sv');
for (const line of [
  'dot = dot + ($signed(a[lane*8 +: 8]) * $signed(b[lane*8 +: 8]));',
  "7'h0b: begin wr=1; result=dot; legal=DOT4 && funct3==0 && funct7==0; end",
  'reg signed [31:0] dot;',
]) if (!core.includes(line)) fail(`rtl/rv32_core.sv no longer contains "${line}"; recheck model.mjs`);

const boardTop = read('rtl/board_top.sv');
const rtlParam = name => {
  const m = boardTop.match(new RegExp(`parameter integer ${name} = (\\d+)`));
  if (!m) fail(`rtl/board_top.sv has no parameter ${name}`);
  return +m[1];
};
for (const line of ['assign leds[2] = pass;', 'assign leds[3] = fail;',
  'assign leds[7:4] = fail ? cause : pass ? passes[PASS_LED_BIT +: 4] : 4\'b0;',
  'assign leds[0] = heartbeat[HEARTBEAT_BIT];', 'assign leds[1] = retired[RETIRE_LED_BIT];'])
  if (!boardTop.includes(line)) fail(`rtl/board_top.sv no longer contains "${line}"; recheck the LED model`);

const variant = v => ({
  logicCells: ab(`variants.${v}.logic_cells.median`),
  available: ab(`variants.${v}.logic_cells_available`),
  fmax: ab(`variants.${v}.fmax_mhz.median`),
  fmaxMin: ab(`variants.${v}.fmax_mhz.min`),
  fmaxMax: ab(`variants.${v}.fmax_mhz.max`),
});
const util = k => ({used: bd(`utilization.${k}.used`), available: bd(`utilization.${k}.available`)});
const DATA = {
  cost: {
    seeds: ab('seeds').length,
    on: variant('dot4_1'),
    off: variant('dot4_0'),
    shipped: {logicCells: ab('variants.dot4_1_default_flow.logic_cells.median'), fmax: ab('variants.dot4_1_default_flow.fmax_mhz.median').toFixed(2)},
    deltaCells: ab('delta_dot4_on_minus_off.median_logic_cells'),
    deltaFmax: ab('delta_dot4_on_minus_off.median_fmax_mhz'),
    cellPct: metrics.speedup.logicCellCost,
    fmaxPct: metrics.speedup.fmaxCost,
    device: 'iCE40 HX8K CT256',
  },
  board: {
    name: bd('board'),
    tested: bd('board_tested'),
    clockMHz: bd('constraint_mhz'),
    fmax: bd('fmax_mhz'),
    lc: util('ICESTORM_LC'), ram: util('ICESTORM_RAM'), io: util('SB_IO'), pll: util('ICESTORM_PLL'), gb: util('SB_GB'),
    signature: bd('self_test.expected_signature'),
    retiredPerPass: bd('self_test.retired_per_pass'),
    rtl: {heartbeatBit: rtlParam('HEARTBEAT_BIT'), retireBit: rtlParam('RETIRE_LED_BIT'),
      passBit: rtlParam('PASS_LED_BIT'), watchdogBits: rtlParam('WATCHDOG_BITS'), porBits: rtlParam('POR_BITS')},
  },
};
if (DATA.board.tested !== false) fail('reports/board.json says board_tested is not false; update the "not yet run on hardware" labels');

const model = readFileSync(join(here, 'model.mjs'), 'utf8').replace(/^export /gm, '');
const tmp = mkdtempSync(join(tmpdir(), 'dot4-machine-'));
const figure = name => {
  const src = readFileSync(join(here, `${name}.fig.html`), 'utf8')
    .replace('/*__MODEL__*/', () => model)
    .replace('/*__DATA__*/', () => `const FIGDATA = ${JSON.stringify(DATA)};`);
  writeFileSync(join(tmp, `${name}.html`), src);
  execFileSync('python3', [join(here, 'vendor/scripts/build.py'), join(tmp, `${name}.html`), join(tmp, `${name}.out.html`)], {stdio: 'pipe'});
  let html = readFileSync(join(tmp, `${name}.out.html`), 'utf8');
  const q = 'new URLSearchParams(location.search)';
  if (!html.includes(q)) fail('colorfigures core no longer reads location.search');
  html = html.replaceAll(q, 'new URLSearchParams(window.FIG_Q ?? location.search)')
    .replaceAll('—', '-')
    .replace('</head>', '<style>html,body{height:auto!important}body>header{display:none!important}</style></head>')
    .replace('</body>', `<script>(() => { const send = () => parent !== window && parent.postMessage({fig: ${JSON.stringify(name)}, type: 'height', h: document.documentElement.scrollHeight}, '*');
  new ResizeObserver(send).observe(document.body); addEventListener('load', send); setTimeout(send, 400); })();</script></body>`);
  return html;
};
const figs = {dot4: figure('dot4'), board: figure('board')};
rmSync(tmp, {recursive: true, force: true});

const fmt = n => n.toLocaleString('en-US');
const page = readFileSync(join(here, 'page.html'), 'utf8')
  .replace('/*__MODEL__*/', () => model)
  .replace('/*__DATA__*/', () => `const FIGDATA = ${JSON.stringify(DATA)};\nconst FIGS = ${JSON.stringify(figs).replaceAll('</', '<\\/')};`)
  .replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
    const v = path.split('.').reduce((o, k) => o?.[k], DATA);
    if (v === undefined) fail(`page.html asks for {{${path}}}, which is not in DATA`);
    return typeof v === 'number' ? fmt(v) : String(v);
  });
if (/—/.test(page.replace(/<script[\s\S]*?<\/script>/g, ''))) fail('page.html contains an em dash');

const out = join(root, 'output/figures/dot4-machine');
mkdirSync(out, {recursive: true});
writeFileSync(join(out, 'index.html'), page);
if (process.argv.includes('--debug')) {
  const dbg = join(root, 'build/figures/dot4-machine/debug');
  mkdirSync(dbg, {recursive: true});
  for (const [k, v] of Object.entries(figs)) writeFileSync(join(dbg, `${k}.html`), v);
}
console.log(`wrote ${join(out, 'index.html')} (${Math.round(page.length / 1024)} KiB)`);
