// Drives the built page in headless Chromium over CDP and checks the interactions a reader uses.
//   node scripts/figures/dot4-machine/drive.mjs [width]
// Exits non-zero on the first failed check. Screenshots go to build/figures/dot4-machine/.
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {dot4, pack} from './model.mjs';

const root = new URL('../../../', import.meta.url).pathname;
const page = `file://${root}output/figures/dot4-machine/index.html`;
const width = +(process.argv[2] || 1280);
const shots = join(root, 'build/figures/dot4-machine');
const profile = mkdtempSync(join(tmpdir(), 'dot4-drive-'));
const browser = spawn('chromium', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--hide-scrollbars', `--window-size=${width},900`, 'about:blank'], {stdio: 'ignore'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = (ok, what) => { if (!ok) { console.error(`FAIL ${what}`); cleanup(1); } console.log(`ok   ${what}`); };
const cleanup = code => { browser.kill(); rmSync(profile, {recursive: true, force: true}); process.exit(code); };

let port;
for (let i = 0; i < 100 && !port; i++) {
  const f = join(profile, 'DevToolsActivePort');
  if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0];
  else await sleep(100);
}
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({id, method, params})); });
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true});
  if (r.result.exceptionDetails) throw Error(`${expr}: ${r.result.exceptionDetails.text} ${r.result.exceptionDetails.exception?.description}`);
  return r.result.result.value;
};
const shot = async name => {
  const h = await evaluate('document.documentElement.scrollHeight');
  await send('Emulation.setDeviceMetricsOverride', {width, height: h, deviceScaleFactor: 1, mobile: width < 600});
  await sleep(400);
  const r = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true});
  writeFileSync(join(shots, `${name}.png`), Buffer.from(r.result.data, 'base64'));
};

await send('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: width < 600});
await send('Page.navigate', {url: page});
await sleep(2500);
const inFig = (id, expr) => evaluate(`document.getElementById('${id}').contentWindow.eval(${JSON.stringify(expr)})`);

check(!(await inFig('f-dot4', 'document.documentElement.dataset.errors || ""')), 'DOT4 figure has no script errors');
check(!(await inFig('f-board', 'document.documentElement.dataset.errors || ""')), 'board figure has no script errors');
check(await evaluate('document.body.scrollWidth <= innerWidth'), `no horizontal scroll at ${width}px`);
const frameFits = async id => evaluate(`(() => { const f = document.getElementById('${id}'); return Math.abs(f.clientHeight - f.contentDocument.documentElement.scrollHeight) <= 2; })()`);
check(await frameFits('f-dot4') && await frameFits('f-board'), 'each iframe is as tall as its figure');
console.log('     board viewBox', await inFig('f-board', `document.getElementById('fig').getAttribute('viewBox')`));

// edit lanes through the page's number inputs; figure and readouts must follow the model
const setLane = (reg, lane, v) => evaluate(`(() => { const n = document.querySelector('[aria-label="${reg} lane ${lane} value"]'); n.value = ${v}; n.dispatchEvent(new Event('input')); n.dispatchEvent(new Event('change')); })()`);
const cases = [
  [[-128, -128, -128, -128], [-128, -128, -128, -128]],
  [[-128, -128, -128, -128], [127, 127, 127, 127]],
  [[5, -6, 7, -8], [-100, 90, -80, 70]],
];
for (const [a, b] of cases) {
  for (let i = 0; i < 4; i++) { await setLane('rs1', i, a[i]); await setLane('rs2', i, b[i]); }
  await sleep(300);
  const want = dot4(pack(a), pack(b));
  const pageSum = await evaluate(`document.getElementById('sum').textContent.replace(/,/g, '')`);
  const figSt = await inFig('f-dot4', 'JSON.stringify(window.__st.a) + "|" + JSON.stringify(window.__st.b)');
  const figStat = await inFig('f-dot4', `document.querySelector('#stats .v').textContent`);
  check(+pageSum === want.sum && figSt === `${JSON.stringify(a)}|${JSON.stringify(b)}` && +figStat === want.sum,
    `lanes ${a} . ${b} give ${want.sum} on the page and in the figure`);
}
await shot(`drive-${width}-lanes`);

// figure buttons: an example picked in the figure updates the page's inputs
await inFig('f-dot4', `[...document.querySelectorAll('.act')].find(b => b.textContent.startsWith('Example')).click()`);
await inFig('f-dot4', `[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('Largest')).click()`);
await sleep(400);
check(await evaluate(`document.querySelector('[aria-label="rs1 lane 2 value"]').value`) === '-128', 'Example in the figure updates the page inputs');
await sleep(1500);
check(await inFig('f-dot4', 'window.__st.running') === true, 'Run DOT4 animation is under way');
await sleep(2500);
check(await evaluate(`document.getElementById('sum').textContent`) === '65,536', 'largest example reads 65,536');

// see-through and labels
await inFig('f-dot4', `document.getElementById('xrb').click(); document.getElementById('lblb').click()`);
await sleep(1200);
check(await inFig('f-dot4', `document.querySelectorAll('#fig .tag').length`) >= 6, 'see-through shows its labels');

// board: run the self-test, then a fault
await inFig('f-board', `[...document.querySelectorAll('.act')].find(b => b.textContent.startsWith('Run self-test')).click()`);
await sleep(3500);
check(await inFig('f-board', `document.querySelector('#stats .v').textContent`) === 'PASS', 'self-test shows PASS');
await inFig('f-board', `document.getElementById('xrb').click()`);
await sleep(1000);
await shot(`drive-${width}-pass`);
await inFig('f-board', `[...document.querySelectorAll('.act')].find(b => b.textContent.startsWith('Fault')).click()`);
await inFig('f-board', `[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('Trap')).click()`);
await sleep(600);
check(await inFig('f-board', `document.querySelector('#stats .v').textContent`) === 'FAIL c=2', 'trap fault shows FAIL c=2');
cleanup(0);
