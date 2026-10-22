// Renders the post in headless Chromium at each width, checks layout, and saves page slices to build/figures/post/.
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, rmSync} from 'node:fs';

const root = new URL('../../../', import.meta.url);
const page = new URL('output/figures/post/index.html', root).href;
const dir = new URL('build/figures/post/', root);
mkdirSync(dir, {recursive: true});
const port = 9400 + Math.floor(Math.random() * 400);
const profile = `/tmp/post-shoot-${port}`;
const chrome = spawn('/usr/bin/chromium', ['--headless', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], {stdio: 'ignore'});

const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  target = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()).then(l => l.find(t => t.type === 'page')).catch(() => null);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, {once: true}));
let id = 0;
const pending = new Map();
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, msg => (msg.error ? reject(Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
  ws.send(JSON.stringify({id: n, method, params}));
});
const evaluate = async expr => (await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true})).result.value;

const failures = [];
for (const [name, width] of [['desktop', 1440], ['mobile', 375]]) {
  await send('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: width < 600});
  await send('Page.navigate', {url: page});
  await sleep(900);
  const info = await evaluate(`(async () => {
    await document.fonts.ready;
    const over = [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => el.tagName + '.' + el.className).slice(0, 5);
    return {height: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth, over,
      anton: document.fonts.check('40px "Rahil Display"'), plex: document.fonts.check('16px "Rahil Plex"'),
      links: [...document.querySelectorAll('a')].map(a => a.getAttribute('href'))};
  })()`);
  if (info.scrollWidth > width) failures.push(`${name}: page scrolls sideways (${info.scrollWidth}px): ${info.over.join(', ')}`);
  if (!info.anton || !info.plex) failures.push(`${name}: embedded fonts did not load`);
  const slice = 1800;
  for (let y = 0, i = 1; y < info.height; y += slice, i++) {
    const shot = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true, clip: {x: 0, y, width, height: Math.min(slice, info.height - y), scale: 1}});
    writeFileSync(new URL(`${name}-${i}.png`, dir), Buffer.from(shot.data, 'base64'));
  }
  console.log(`${name}: ${width}px wide, ${info.height}px tall, fonts ${info.anton && info.plex ? 'loaded' : 'MISSING'}, ${info.links.length} links`);
  if (name === 'desktop') console.log('links:', [...new Set(info.links)].join(' '));
}

// Keyboard: tab through the page and record what receives focus.
await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
await send('Page.navigate', {url: page});
await sleep(600);
const order = [];
for (let i = 0; i < 6; i++) {
  await send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
  await send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
  order.push(await evaluate(`document.activeElement.textContent.trim().slice(0, 30) + ' outline=' + getComputedStyle(document.activeElement).outlineStyle`));
}
console.log('tab order:', order.join(' | '));

ws.close();
chrome.kill();
await sleep(300);
rmSync(profile, {recursive: true, force: true});
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
