// Drives the built page in headless Chromium over CDP: screenshots at desktop and 375px, and every interaction.
// Run: node scripts/figures/load-use-explainer/verify.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { tryIt, CASES } from './model.mjs';

const root = new URL('../../../', import.meta.url);
const page = new URL('output/figures/load-use-explainer/index.html', root).href;
const shots = new URL('build/figures/load-use-explainer/', root);
mkdirSync(shots, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
const chrome = spawn('/usr/bin/chromium', ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let err = '';
  chrome.stderr.on('data', d => { err += d; const m = err.match(/ws:\/\/[^\s]+/); if (m) resolve(m[0]); });
  chrome.on('exit', () => reject(Error(err)));
});
const targets = await (await fetch(wsUrl.replace('ws://', 'http://').replace(/\/devtools\/.*/, '/json'))).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const events = [];
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(Error(msg.error.message)) : resolve(msg.result); }
  else if (msg.method) events.push(msg);
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const settle = () => new Promise(r => setTimeout(r, 300));
await send('Runtime.enable');

async function open(width, hash = '') {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await send('Page.navigate', { url: 'about:blank' });
  await send('Page.navigate', { url: `${page}${hash}` });
  await new Promise(r => setTimeout(r, 900));
  await evaluate('document.fonts.ready.then(() => true)');
}
async function shoot(name, clipSelector) {
  const params = { format: 'png', captureBeyondViewport: true };
  if (clipSelector) {
    const rect = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(clipSelector)}).getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; })()`);
    params.clip = { ...rect, scale: 1 };
  } else {
    const { contentSize } = await send('Page.getLayoutMetrics');
    params.clip = { x: 0, y: 0, width: contentSize.width, height: contentSize.height, scale: 1 };
  }
  const { data } = await send('Page.captureScreenshot', params);
  writeFileSync(new URL(name, shots), Buffer.from(data, 'base64'));
}

const results = [];
const check = (ok, what) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };

for (const width of [1280, 375]) {
  await open(width);
  const errors = events.filter(e => e.method === 'Runtime.exceptionThrown');
  check(errors.length === 0, `${width}px: no script errors ${errors.map(e => e.params.exceptionDetails.exception?.description).join(' | ')}`);
  const overflow = await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  check(overflow <= 0, `${width}px: no horizontal page scroll (overflow ${overflow}px)`);
  const chartFits = await evaluate(`[...document.querySelectorAll('.chart-scroll')].map(b => b.scrollWidth - b.clientWidth)`);
  results.push(`INFO ${width}px: chart overflow inside scroll boxes ${JSON.stringify(chartFits)}`);
  await shoot(`page-${width}.png`);
  await shoot(`fig-ls-${width}.png`, '#ls');
  await shoot(`fig-stages-${width}.png`, '.stagefig');
  for (const sec of ['alu', 'rule', 'flush', 'cost']) await shoot(`section-${sec}-${width}.png`, `#${sec}`);
}

await open(1280);
for (const [producer, distance] of CASES) {
  await evaluate(`(() => { document.querySelector('[name=producer][value=${producer}]').click(); document.querySelector('[name=distance][value="${distance}"]').click(); })()`);
  const shown = await evaluate(`({ verdict: document.querySelector('[data-verdict]').textContent, detail: document.querySelector('[data-detail]').textContent, hash: location.hash })`);
  const run = tryIt(producer, distance);
  const wantStall = producer === 'load' && distance === 1;
  check(shown.verdict === (wantStall ? 'Stalls 1 cycle.' : 'No stall.') && run.stalls === (wantStall ? 1 : 0), `try ${producer} distance ${distance}: "${shown.verdict} ${shown.detail}"`);
  check(shown.hash.includes(`try=${producer}-${distance}`), `try ${producer}-${distance}: state saved in URL hash`);
}
await shoot('try-alu-1-1280.png', '#tryit');
await evaluate(`document.querySelector('[name=producer][value=load]').click(); document.querySelector('[name=distance][value="1"]').click()`);
await shoot('try-load-1-1280.png', '#tryit');

const before = await evaluate(`document.querySelector('#ls [data-cycle]').textContent`);
await evaluate(`document.querySelector('#ls [data-step="1"]').click()`);
const after = await evaluate(`({ cycle: document.querySelector('#ls [data-cycle]').textContent, note: document.querySelector('#ls .note').textContent })`);
check(Number(after.cycle) === Number(before) + 1, `load_store Next: cycle ${before} -> ${after.cycle}: "${after.note}"`);
await evaluate(`document.querySelector('#ls input[type=range]').focus()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
await settle();
const keyed = await evaluate(`({ cycle: document.querySelector('#ls [data-cycle]').textContent, note: document.querySelector('#ls .note').textContent, marks: document.querySelectorAll('#ls td.src').length })`);
check(Number(keyed.cycle) === Number(after.cycle) + 1, `load_store keyboard ArrowRight: cycle ${keyed.cycle}, ${keyed.marks} source mark: "${keyed.note}"`);
await shoot('fig-ls-forward-1280.png', '#ls');

await evaluate(`document.querySelector('[data-case="alu-3"]').click()`);
const linked = await evaluate(`document.querySelector('[data-verdict]').textContent + ' ' + document.querySelector('[data-detail]').textContent`);
check(/bypass/.test(linked), `summary table link alu-3 opens the case: "${linked}"`);

await open(375, '#try=load-2');
const restored = await evaluate(`document.querySelector('[data-detail]').textContent`);
check(/forwarded from WB\./.test(restored), `375px: hash #try=load-2 restores state: "${restored}"`);
await shoot('try-load-2-375.png', '#tryit');

await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
await open(1280);
await shoot('page-1280-light.png');
await shoot('section-load-1280-light.png', '#load');

console.log(results.join('\n'));
ws.close(); chrome.kill(); rmSync(profile, { recursive: true, force: true });
