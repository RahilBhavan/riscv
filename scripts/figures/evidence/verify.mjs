// Renders the evidence page in headless Chromium over CDP: full-page screenshots at desktop and 375 px,
// a keyboard-focus tooltip check, a hover check, and text-overlap and horizontal-overflow checks.
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const root = new URL('../../../', import.meta.url);
const page = new URL('output/figures/evidence/index.html', root).href;
const shots = new URL('build/figures/evidence/', root);
mkdirSync(shots, {recursive: true});
const port = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'evidence-chromium-'));
const chrome = spawn('/usr/bin/chromium', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], {stdio: 'ignore'});

const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
}
if (!target) throw Error('chromium did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, {once: true}));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, m => m.error ? reject(Error(`${method}: ${m.error.message}`)) : resolve(m.result));
  ws.send(JSON.stringify({id, method, params}));
});
const evaluate = async expr => (await cdp('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true})).result.value;
const shot = async (name, full = true) => {
  const {data} = await cdp('Page.captureScreenshot', {format: 'png', captureBeyondViewport: full});
  writeFileSync(new URL(name, shots), Buffer.from(data, 'base64'));
};

const failures = [];
const audit = `(() => {
  const vis = el => { for (let e = el; e; e = e.parentElement) if (getComputedStyle(e).display === 'none') return false; return true; };
  const overlaps = [];
  for (const svg of document.querySelectorAll('svg')) {
    if (!vis(svg)) continue;
    const boxes = [...svg.querySelectorAll('text')].filter(t => t.textContent.trim()).map(t => ({t: t.textContent, r: t.getBoundingClientRect()}));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 1 && iy > 2) overlaps.push(boxes[i].t + ' / ' + boxes[j].t);
    }
    const sr = svg.getBoundingClientRect();
    for (const b of boxes) if (b.r.right > sr.right + 1 || b.r.left < sr.left - 1) overlaps.push('clipped: ' + b.t);
  }
  const small = [...document.querySelectorAll('svg text')].filter(t => vis(t) && t.textContent.trim()).map(t => parseFloat(getComputedStyle(t).fontSize) * t.closest('svg').getBoundingClientRect().width / t.closest('svg').viewBox.baseVal.width).filter(px => px < 11.5).length;
  return {overlaps, overflow: document.documentElement.scrollWidth - innerWidth, small, fonts: document.fonts.check('16px LearningSans')};
})()`;

for (const [label, width, height, mobile] of [['desktop', 1280, 900, false], ['mobile-375', 375, 812, true]]) {
  await cdp('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: mobile ? 2 : 1, mobile});
  await cdp('Page.navigate', {url: page});
  await sleep(900);
  const a = await evaluate(audit);
  if (a.overlaps.length) failures.push(`${label}: text overlaps ${JSON.stringify(a.overlaps)}`);
  if (a.overflow > 0) failures.push(`${label}: page scrolls sideways by ${a.overflow}px`);
  if (a.small) failures.push(`${label}: ${a.small} SVG labels render under 11.5px`);
  if (!a.fonts) failures.push(`${label}: embedded font not loaded`);
  await shot(`${label}.png`);
  const rects = await evaluate(`[...document.querySelectorAll('header, section')].map(s => { const r = s.getBoundingClientRect(); return {x: 0, y: r.top + scrollY, width: innerWidth, height: r.height + 20}; })`);
  for (const [i, clip] of rects.entries()) {
    const {data} = await cdp('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true, clip: {...clip, scale: 1}});
    writeFileSync(new URL(`${label}-part${i}.png`, shots), Buffer.from(data, 'base64'));
  }

  // Keyboard: tab to the first data mark and read the tooltip.
  await evaluate(`document.activeElement?.blur(); window.scrollTo(0,0)`);
  let tipText = '';
  for (let i = 0; i < 12 && !tipText; i++) {
    await cdp('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
    await cdp('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
    tipText = await evaluate(`document.activeElement.classList.contains('m') && !document.getElementById('tip').hidden ? document.getElementById('tip').textContent : ''`);
  }
  if (!tipText) failures.push(`${label}: Tab never reached a data mark with a visible tooltip`);
  await shot(`${label}-focus.png`, false);

  // Hover: move the pointer onto a seed dot in the Fmax strip.
  const pt = await evaluate(`(() => { const svg = [...document.querySelectorAll('#fmax svg')].find(s => s.getBoundingClientRect().width); svg.scrollIntoView({block: 'center'}); const r = svg.querySelector('.m circle[r="5"]').getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()`);
  await sleep(100);
  await cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: pt.x, y: pt.y});
  await sleep(100);
  const hoverText = await evaluate(`document.getElementById('tip').hidden ? '' : document.getElementById('tip').textContent`);
  if (!/MHz/.test(hoverText)) failures.push(`${label}: hovering an Fmax seed showed no MHz tooltip`);
  await shot(`${label}-hover.png`, false);
  console.log(`${label}: focus tip "${tipText}" | hover tip "${hoverText}" | small labels ${a.small}`);
}

ws.close();
chrome.kill();
rmSync(profile, {recursive: true, force: true});
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`screenshots in ${shots.pathname}`);
