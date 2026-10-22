// Each figure renders to an SVG string at a given width. Narrow layouts (W < 500) are drawn for phones, not scaled down.
import {C, SERIES} from './palette.mjs';
import {cycles, speedup, fmax, hazards, checks} from './model.mjs';

export const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export const count = n => n.toLocaleString('en-US');
const f = (n, d) => n.toFixed(d);
const pct = (a, b) => f(100 * a / b, 0);
const FONT = "LearningSans, 'IBM Plex Sans', Arial, Helvetica, sans-serif";

const text = (x, y, s, {size = 14, fill = C.ink, anchor = 'start', weight = 400, cls = ''} = {}) =>
  `<text x="${f(x, 1)}" y="${f(y, 1)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}"${weight !== 400 ? ` font-weight="${weight}"` : ''}${cls ? ` class="${cls}"` : ''}>${esc(s)}</text>`;
const line = (x1, y1, x2, y2, stroke, width = 1, extra = '') =>
  `<line x1="${f(x1, 1)}" y1="${f(y1, 1)}" x2="${f(x2, 1)}" y2="${f(y2, 1)}" stroke="${stroke}" stroke-width="${width}"${extra}/>`;

// A data mark: focusable with an exact-value tip on the page, a native <title> in the exported file.
const mark = (ctx, tip, inner, focusable = true) => ctx.exported
  ? `<g><title>${esc(tip.replaceAll('|', '. '))}</title>${inner}</g>`
  : `<g class="m"${focusable ? ` tabindex="0" role="img" aria-label="${esc(tip.replaceAll('|', '. '))}"` : ''} data-tip="${esc(tip)}">${inner}</g>`;

const wrapWords = (s, max) => s.split(' ').reduce((out, w) => {
  const last = out.at(-1);
  if (last && (last + ' ' + w).length <= max) out[out.length - 1] = last + ' ' + w; else out.push(w);
  return out;
}, []);

// The exported file stands alone in a README, so it carries its own margin, point-sentence title and source line.
const svg = (ctx, W, H, title, desc, body) => {
  const id = `${ctx.id}-${W}`;
  let w = W, h = H, inner = body;
  if (ctx.exported) {
    const pad = 24, heads = wrapWords(title, 64), top = pad + heads.length * 27 + 14;
    w = W + 2 * pad; h = top + H + 46;
    inner = `<rect width="${w}" height="${h}" fill="${C.bg}"/>` +
      heads.map((s, i) => text(pad, pad + 18 + i * 27, s, {size: 20, weight: 600})).join('') +
      `<g transform="translate(${pad},${top})">${body}</g>` +
      text(pad, h - pad + 4, `Source: ${ctx.source}`, {size: 12, fill: C.secondary});
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="${id}-t ${id}-d" font-family="${FONT}" style="font-variant-numeric:tabular-nums"><title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc>${inner}</svg>`;
};

// Pushes labels apart so neighbours keep a minimum gap, then pulls the block back inside [top, bottom].
const spread = (items, gap, top, bottom) => {
  const s = [...items].sort((a, b) => a.y - b.y);
  s.forEach((it, i) => { it.ly = i ? Math.max(it.y, s[i - 1].ly + gap) : Math.max(it.y, top); });
  const over = s.at(-1).ly - bottom;
  if (over > 0) for (let i = s.length - 1; i >= 0; i--) s[i].ly = Math.min(s[i].ly, (i === s.length - 1 ? bottom : s[i + 1].ly - gap));
  return s;
};

const largest = sizes => sizes.at(-1);

export function cyclesFigure(ctx, W) {
  const narrow = W < 500;
  const L = narrow ? 54 : 62, R = narrow ? 124 : 190, T = 40, plotH = narrow ? 250 : 290, B = 50;
  const H = T + plotH + B;
  const all = cycles.series.flatMap(s => s.points.map(p => p.cycles));
  const lo = Math.log10(Math.min(...all)) - 0.12, hi = Math.log10(Math.max(...all)) + 0.06;
  const y = c => T + plotH * (1 - (Math.log10(c) - lo) / (hi - lo));
  const ns = cycles.sizes, x0 = L + 14, x1 = W - R - 8;
  const x = n => x0 + (x1 - x0) * (Math.log2(n) - Math.log2(ns[0])) / (Math.log2(largest(ns)) - Math.log2(ns[0]));
  let body = '';
  for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) {
    const v = 10 ** k;
    body += line(L, y(v), W - R + 4, y(v), C.grid) + text(L - 8, y(v) + 4.5, count(v), {size: 13, fill: C.secondary, anchor: 'end'});
  }
  body += text(0, 18, 'Cycles, log scale', {size: 13, fill: C.secondary});
  body += line(x0, T + plotH + 8, x1, T + plotH + 8, C.axis);
  for (const n of ns) body += line(x(n), T + plotH + 8, x(n), T + plotH + 13, C.axis) + text(x(n), T + plotH + 29, String(n), {size: 13, fill: C.secondary, anchor: 'middle'});
  body += text((x0 + x1) / 2, H - 4, narrow ? 'Vector length n, log scale' : 'Vector length n (int8 elements per vector), log scale', {size: 13, fill: C.secondary, anchor: 'middle'});

  const n = largest(ns);
  const at = id => cycles.series.find(s => s.id === id).points.at(-1).cycles;
  const ratio = at('rv32i_qsquare') / at('dot4');
  const bx = x(n) - 16;
  body += line(bx, y(at('rv32i_qsquare')) + 6, bx, y(at('dot4')) - 6, C.ink) + line(bx - 4, y(at('rv32i_qsquare')) + 6, bx + 4, y(at('rv32i_qsquare')) + 6, C.ink) + line(bx - 4, y(at('dot4')) - 6, bx + 4, y(at('dot4')) - 6, C.ink);
  const my = (y(at('rv32i_qsquare')) + y(at('dot4'))) / 2;
  if (!narrow) body += text(bx - 8, my - 2, `${f(ratio, 1)}× fewer`, {anchor: 'end', weight: 600}) + text(bx - 8, my + 15, 'cycles', {anchor: 'end'});

  for (const s of cycles.series) {
    const color = SERIES[s.id];
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${f(x(p.n), 1)},${f(y(p.cycles), 1)}`).join('');
    body += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"${s.id === 'rv32i_lb' ? ' stroke-dasharray="6 4"' : ''}/>`;
    for (const p of s.points) {
      const tip = `${s.name}, n = ${p.n}|${count(p.cycles)} cycles|${count(p.retired)} retired, ${count(p.flushes)} flushes, ${count(p.stalls)} stalls`;
      body += mark(ctx, tip, `<circle cx="${f(x(p.n), 1)}" cy="${f(y(p.cycles), 1)}" r="12" fill="transparent"/><circle cx="${f(x(p.n), 1)}" cy="${f(y(p.cycles), 1)}" r="4" fill="${color}" stroke="${C.bg}" stroke-width="2"/>`);
    }
  }
  const labels = spread(cycles.series.map(s => ({s, y: y(s.points.at(-1).cycles)})), 36, T, T + plotH);
  const lx = W - R + 12;
  for (const {s, y: py, ly} of labels) {
    body += `<path d="M${f(x1 + 6, 1)},${f(py, 1)} L${f(lx - 4, 1)},${f(ly, 1)}" stroke="${SERIES[s.id]}" stroke-width="1.5" fill="none"${s.id === 'rv32i_lb' ? ' stroke-dasharray="3 2"' : ''}/>`;
    body += text(lx, ly - 2, narrow ? s.short : s.name, {weight: s.id === 'dot4' ? 600 : 400});
    body += text(lx, ly + 15, `${count(s.points.at(-1).cycles)} cycles`, {size: 13, fill: C.secondary});
    if (narrow && s.id === 'dot4') body += text(lx, ly + 33, `${f(ratio, 1)}× fewer than`, {size: 13, weight: 600}) + text(lx, ly + 50, 'quarter-square', {size: 13});
  }
  const title = `DOT4 needs ${f(ratio, 1)}× fewer cycles than the best RV32I kernel at n\u00a0=\u00a0${n}`;
  const desc = cycles.series.map(s => `${s.name}: ${s.points.map(p => `${count(p.cycles)} cycles at n = ${p.n}`).join(', ')}`).join('. ');
  return {svg: svg(ctx, W, H, title, desc, body), title};
}

export function speedupFigure(ctx, W) {
  const narrow = W < 500;
  const L = narrow ? 58 : 150, R = narrow ? 52 : 70, rowH = 26, groupGap = 18, keyH = 34;
  const groups = speedup.baselines;
  const all = groups.flatMap(g => g.rows.flatMap(r => [r.cycles, r.max]));
  const top = Math.ceil(Math.max(...all) / 5) * 5;
  const x = v => L + (W - L - R) * v / top;
  const plotTop = keyH + 8;
  let y = plotTop, body = '';
  const headline = groups[0].rows.at(-1);
  // Key, drawn with the marks it explains.
  body += `<circle cx="8" cy="14" r="4" fill="none" stroke="${C.gray1}" stroke-width="1.5"/>` + text(18, 19, 'cycles only', {size: 13, fill: C.secondary});
  const kx = narrow ? 112 : 130;
  body += `<circle cx="${kx}" cy="14" r="4.5" fill="${C.ink}"/>` + text(kx + 10, 19, 'after clock cost (median)', {size: 13, fill: C.secondary});
  if (!narrow) body += line(330, 14, 352, 14, C.ink) + line(330, 10, 330, 18, C.ink) + line(352, 10, 352, 18, C.ink) + text(360, 19, 'range over route seeds', {size: 13, fill: C.secondary});
  for (const g of groups) {
    body += text(0, y + 14, g.name, {size: 14, weight: 600, fill: C.ink});
    y += 22;
    for (const r of g.rows) {
      const cy = y + rowH / 2;
      const isHead = g === groups[0] && r === headline;
      const lab = `n = ${r.n}`;
      body += text(narrow ? 0 : L - 14, cy + 4.5, lab, {size: 13, fill: C.secondary, anchor: narrow ? 'start' : 'end'});
      const inner =
        `<rect x="${f(x(0), 1)}" y="${f(cy - rowH / 2, 1)}" width="${f(x(top) - x(0), 1)}" height="${rowH}" fill="transparent"/>` +
        line(x(r.min), cy, x(r.max), cy, C.ink, 1) + line(x(r.min), cy - 4, x(r.min), cy + 4, C.ink) + line(x(r.max), cy - 4, x(r.max), cy + 4, C.ink) +
        line(x(r.median), cy, x(r.cycles), cy, C.gray1, 1, ' stroke-dasharray="2 2"') +
        `<circle cx="${f(x(r.cycles), 1)}" cy="${f(cy, 1)}" r="4" fill="${C.bg}" stroke="${C.gray1}" stroke-width="1.5"/>` +
        `<circle cx="${f(x(r.median), 1)}" cy="${f(cy, 1)}" r="${isHead ? 5.5 : 4.5}" fill="${isHead ? C.accent : C.ink}" stroke="${C.bg}" stroke-width="1.5"/>`;
      const tip = `${g.name} vs DOT4, n = ${r.n}|${f(r.median, 2)}× after clock cost (median Fmax)|${f(r.cycles, 2)}× in cycles (${count(r.baseCycles)} vs ${count(r.dot4Cycles)})|Seed range ${f(r.min, 2)}× to ${f(r.max, 2)}×`;
      body += mark(ctx, tip, inner);
      body += text(x(Math.max(r.cycles, r.max)) + 8, cy + 4.5, `${f(r.median, 1)}×`, {size: isHead ? 14 : 13, weight: isHead ? 600 : 400, fill: isHead ? C.ink : C.secondary});
      y += rowH;
    }
    y += groupGap;
  }
  y -= groupGap;
  body += line(x(0), y + 6, x(top), y + 6, C.axis);
  for (let v = 0; v <= top; v += 5) body += line(x(v), y + 6, x(v), y + 11, C.axis) + text(x(v), y + 26, `${v}×`, {size: 13, fill: C.secondary, anchor: 'middle'});
  y += 56;
  const k = speedup.clock;
  const lines = narrow ? [
    'Why the dots move left:',
    `DOT4 core median Fmax ${f(k.on, 2)} MHz,`,
    `core without DOT4 ${f(k.off, 2)} MHz.`,
    `Every cycle ratio is multiplied by ${f(k.ratio, 3)}.`,
  ] : [
    `Why the dots move left: the DOT4 core routes at a median ${f(k.on, 2)} MHz, the core without DOT4 at ${f(k.off, 2)} MHz.`,
    `Each DOT4-core cycle is ${f(100 * (1 / k.ratio - 1), 1)}% longer, so every cycle ratio is multiplied by ${f(k.on, 2)} / ${f(k.off, 2)} = ${f(k.ratio, 3)}.`,
    `The range pairs the slowest DOT4 seed (${f(k.onMin, 2)} MHz) with the fastest DOT4=0 seed (${f(k.offMax, 2)} MHz), and the reverse.`,
  ];
  lines.forEach((s, i) => { body += text(0, y + i * 20, s, {size: 13, fill: i === 0 && narrow ? C.ink : C.secondary, weight: i === 0 && narrow ? 600 : 400}); });
  const H = y + (lines.length - 1) * 20 + 10;
  const title = `After its clock cost, DOT4 is ${f(headline.median, 1)}× faster than the best RV32I kernel at n\u00a0=\u00a0${headline.n}`;
  const desc = groups.map(g => `${g.name}: ${g.rows.map(r => `n = ${r.n}, ${f(r.cycles, 2)}× in cycles, ${f(r.median, 2)}× after clock cost`).join('; ')}`).join('. ');
  return {svg: svg(ctx, W, H, title, desc, body), title};
}

export function fmaxFigure(ctx, W) {
  const narrow = W < 500;
  const L = narrow ? 0 : 168, R = 16, rowH = narrow ? 84 : 58, T = 34;
  const vs = fmax.variants;
  const all = vs.flatMap(v => v.seeds.map(s => s.mhz));
  const lo = Math.floor(Math.min(...all)) - 1, hi = Math.ceil(Math.max(...all)) + 1;
  const left = narrow ? 8 : L;
  const x = v => left + (W - left - R) * (v - lo) / (hi - lo);
  let body = '';
  const [off, on] = vs;
  vs.forEach((v, i) => {
    const top = T + i * rowH;
    const cy = top + (narrow ? 58 : rowH / 2 + 4);
    if (narrow) body += text(0, top + 14, v.name, {weight: 600}) + text(v.name.length * 7.6 + 10, top + 14, v.detail, {size: 13, fill: C.secondary});
    else body += text(L - 16, cy - 3, v.name, {anchor: 'end', weight: 600}) + text(L - 16, cy + 14, v.detail, {size: 13, fill: C.secondary, anchor: 'end'});
    body += line(x(lo), cy, x(hi), cy, C.grid);
    const accent = v === off || v === on;
    body += line(x(v.median), cy - 12, x(v.median), cy + 12, accent ? C.accent : C.ink, 2.5);
    body += text(x(v.median), cy - 16, `median ${f(v.median, 2)}`, {size: 13, anchor: 'middle', fill: C.ink});
    for (const s of v.seeds) {
      const tip = `${v.name} (${v.detail}), seed ${s.seed}|${f(s.mhz, 2)} MHz post-route estimate|Median of ${v.seeds.length} seeds ${f(v.median, 2)} MHz`;
      body += mark(ctx, tip, `<circle cx="${f(x(s.mhz), 1)}" cy="${cy}" r="11" fill="transparent"/><circle cx="${f(x(s.mhz), 1)}" cy="${cy}" r="5" fill="${C.gray1}" stroke="${C.bg}" stroke-width="1.5"/>`);
    }
  });
  const axisY = T + vs.length * rowH + 2;
  body += line(x(lo), axisY, x(hi), axisY, C.axis);
  for (let v = lo + (lo % 2); v <= hi; v += 2) body += line(x(v), axisY, x(v), axisY + 5, C.axis) + text(x(v), axisY + 21, String(v), {size: 13, fill: C.secondary, anchor: 'middle'});
  body += text(narrow ? 0 : x(lo), axisY + 42, `Post-route Fmax estimate, MHz. Axis starts at ${lo} MHz.`, {size: 13, fill: C.secondary});
  const offY = T + (narrow ? 58 : rowH / 2 + 4), onY = offY + rowH;
  const delta = fmax.deltaMhz;
  const midY = (offY + onY) / 2;
  body += `<path d="M${f(x(off.median), 1)},${f(offY + 14, 1)} C${f(x(off.median), 1)},${f(midY, 1)} ${f(x(on.median), 1)},${f(midY, 1)} ${f(x(on.median), 1)},${f(onY - 30, 1)}" fill="none" stroke="${C.accent}" stroke-width="1.5"/>`;
  body += `<path d="M${f(x(on.median) - 4, 1)},${f(onY - 36, 1)} L${f(x(on.median), 1)},${f(onY - 29, 1)} L${f(x(on.median) + 4, 1)},${f(onY - 36, 1)}" fill="none" stroke="${C.accent}" stroke-width="1.5"/>`;
  body += text(Math.min(x(off.median) + 14, W - 124), midY + 4, `${f(delta, 2)} MHz (${pct(delta, off.median)}%)`.replaceAll('-', '−'), {weight: 600, anchor: 'start', size: 14});
  body += text(0, 16, `${vs.length} netlists x ${fmax.seeds.length} nextpnr seeds. Each dot is one seed.`, {size: 13, fill: C.secondary});
  const H = axisY + 52;
  const spreadMax = Math.max(...vs.map(v => v.max - v.min));
  const title = `DOT4 lowers median Fmax by ${f(-delta, 2)} MHz (${pct(-delta, off.median)}%); the route seed alone moves it up to ${f(spreadMax, 1)} MHz`;
  const desc = vs.map(v => `${v.name} (${v.detail}): ${v.seeds.map(s => `seed ${s.seed} ${f(s.mhz, 2)}`).join(', ')} MHz; median ${f(v.median, 2)}`).join('. ');
  return {svg: svg(ctx, W, H, title, desc, body), title, spreadMax};
}

export function areaFigure(ctx, W) {
  const narrow = W < 500;
  const L = narrow ? 0 : 168, R = narrow ? 8 : 24, rowH = narrow ? 64 : 50, T = 26, barH = 18;
  const vs = fmax.variants, cap = vs[0].available, [off, on] = vs;
  const left = narrow ? 0 : L;
  const x = v => left + (W - left - R) * v / cap;
  let body = '';
  vs.forEach((v, i) => {
    const top = T + i * rowH;
    const by = top + (narrow ? 24 : (rowH - barH) / 2);
    if (narrow) body += text(0, top + 14, v.name, {weight: 600}) + text(v.name.length * 7.6 + 10, top + 14, v.detail, {size: 13, fill: C.secondary});
    else body += text(L - 16, by + 7, v.name, {anchor: 'end', weight: 600}) + text(L - 16, by + 24, v.detail, {size: 13, fill: C.secondary, anchor: 'end'});
    let inner = `<rect x="${f(x(0), 1)}" y="${f(by, 1)}" width="${f(x(cap) - x(0), 1)}" height="${barH}" fill="none" stroke="${C.line}"/>`;
    if (v === on) inner += `<rect x="${f(x(0), 1)}" y="${f(by, 1)}" width="${f(x(off.cells) - x(0), 1)}" height="${barH}" fill="${C.gray1}"/><rect x="${f(x(off.cells) + 2, 1)}" y="${f(by, 1)}" width="${f(x(v.cells) - x(off.cells) - 2, 1)}" height="${barH}" fill="${C.accent}"/>`;
    else inner += `<rect x="${f(x(0), 1)}" y="${f(by, 1)}" width="${f(x(v.cells) - x(0), 1)}" height="${barH}" fill="${C.gray1}"/>`;
    const tip = `${v.name} (${v.detail})|${count(v.cells)} of ${count(cap)} logic cells (${f(100 * v.cells / cap, 1)}%)|${count(v.lut4)} LUT4 before packing`;
    body += mark(ctx, tip, inner);
    const label = `${count(v.cells)}  ${f(100 * v.cells / cap, 1)}%`;
    body += text(x(v.cells) + 8, by + 14, label, {size: 13});
    if (v === on) body += text((x(off.cells) + x(v.cells)) / 2, by - 6, `+${count(fmax.deltaCells)}`, {size: 13, weight: 600, anchor: 'middle'});
  });
  const axisY = T + vs.length * rowH;
  body += line(x(0), axisY, x(cap), axisY, C.axis);
  const step = narrow ? 2000 : 1000;
  for (let v = 0; v < cap; v += step) if (cap - v > step * 0.9) body += line(x(v), axisY, x(v), axisY + 5, C.axis) + text(x(v), axisY + 21, count(v), {size: 13, fill: C.secondary, anchor: v === 0 ? 'start' : 'middle'});
  body += line(x(cap), axisY, x(cap), axisY + 5, C.axis) + text(x(cap), axisY + 21, count(cap), {size: 13, fill: C.ink, anchor: 'end', weight: 600});
  const note = narrow ? ['iCE40 HX8K logic cells after packing.', `The outline is the device: ${count(cap)}.`] : [`iCE40 HX8K logic cells after packing. The outline is the device: ${count(cap)}.`];
  note.forEach((s, i) => { body += text(narrow ? 0 : x(0), axisY + 42 + i * 18, s, {size: 13, fill: C.secondary}); });
  const H = axisY + 52 + (note.length - 1) * 18;
  const title = `DOT4 adds ${count(fmax.deltaCells)} logic cells (${pct(fmax.deltaCells, off.cells)}% more); the shipped core fills ${f(100 * vs[2].cells / cap, 1)}% of the HX8K`;
  const desc = vs.map(v => `${v.name} (${v.detail}): ${count(v.cells)} of ${count(cap)} logic cells`).join('. ');
  return {svg: svg(ctx, W, H, title, desc, body), title};
}

const human = s => s.replaceAll('_', ' ');
const cap = s => s[0].toUpperCase() + s.slice(1);
export function hazardFigure(ctx, W) {
  const narrow = W < 500;
  const cell = 13, gap = 3, pitch = cell + gap;
  const labelW = 86, panelW = 3 * pitch + 10, perRow = narrow ? 4 : hazards.producers.length;
  const slots = hazards.slots;
  let body = '', y = 0;
  const square = (cx, cy, b, tip) => {
    const shape = b.hit
      ? `<rect x="${cx}" y="${cy}" width="${cell}" height="${cell}" rx="2" fill="${C.accent}"/>`
      : `<rect x="${cx + 0.75}" y="${cy + 0.75}" width="${cell - 1.5}" height="${cell - 1.5}" rx="2" fill="none" stroke="${C.secondary}" stroke-width="1.5"/>`;
    return ctx.exported ? shape : `<g class="m c" data-tip="${esc(tip + (b.hit ? '|hit' : '|MISSING'))}">${shape}</g>`;
  };
  const panel = (px, py, title, rows, cols, cellsOf, tipOf, keyTip, cp = pitch) => {
    let inner = text(px, py + 12, title, {size: 13, weight: 600});
    cols.forEach((c, j) => { inner += text(px + j * cp + cell / 2, py + 30, c, {size: 13, fill: C.secondary, anchor: 'middle'}); });
    rows.forEach((r, i) => cols.forEach((c, j) => { inner += square(px + j * cp, py + 36 + i * pitch, cellsOf(i, j), tipOf(i, j)); }));
    return mark(ctx, keyTip, `<rect x="${px - 4}" y="${py - 2}" width="${(cols.length - 1) * cp + cell + 8}" height="${40 + rows.length * pitch}" fill="transparent"/>${inner}`);
  };
  const hitIn = list => list.flat(2).filter(b => b.hit).length;
  const nTotal = list => list.flat(2).length;
  const ds = hazards.distances.map(String);
  for (let start = 0; start < hazards.producers.length; start += perRow) {
    const group = hazards.cross.slice(start, start + perRow);
    body += text(labelW - 8, y + 30, 'distance', {size: 13, fill: C.secondary, anchor: 'end'});
    slots.forEach((s, i) => { body += text(labelW - 8, y + 36 + i * pitch + 11, s, {size: 13, fill: C.secondary, anchor: 'end'}); });
    group.forEach((g, k) => {
      const px = labelW + k * panelW;
      body += panel(px, y, g.producer, slots, ds, (i, j) => g.cells[i][j], (i, j) => `${g.producer} writes, ${slots[i]} reads ${hazards.distances[j]} instruction${hazards.distances[j] > 1 ? 's' : ''} later`,
        `Producer ${g.producer}|${hitIn(g.cells)} of ${nTotal(g.cells)} bins hit|${slots.length} consumer slots x ${ds.length} distances`);
    });
    y += 40 + slots.length * pitch + 18;
  }
  // x0 and redirect panels.
  const x0Rows = hazards.producers, evRows = hazards.events.map(human);
  const x0Panel = (px, py) => {
    let s = text(px - 8, py + 30, 'distance', {size: 13, fill: C.secondary, anchor: 'end'});
    x0Rows.forEach((p, i) => { s += text(px - 8, py + 36 + i * pitch + 11, p, {size: 13, fill: C.secondary, anchor: 'end'}); });
    return s + panel(px, py, 'x0 reads', x0Rows, ds, (i, j) => hazards.x0[i][j], (i, j) => `${x0Rows[i]} writes x0, read ${hazards.distances[j]} later`,
      `Writes to x0, then a read of x0|${hitIn(hazards.x0)} of ${nTotal(hazards.x0)} bins hit`);
  };
  const rlabel = narrow ? 150 : 170;
  const redirectPanel = (px, py) => {
    let s = '';
    evRows.forEach((e, i) => { s += text(px - 8, py + 36 + i * pitch + 11, e, {size: 13, fill: C.secondary, anchor: 'end'}); });
    const p = panel(px, py, 'Redirects', evRows, hazards.transfers, (i, j) => hazards.redirect[j][i], (i, j) => `${hazards.transfers[j]}: ${evRows[i]}`,
      `Branch, jal and jalr redirects|${hitIn(hazards.redirect)} of ${nTotal(hazards.redirect)} bins hit|${hazards.events.length} events x ${hazards.transfers.length} transfers`, 34);
    return s + p;
  };
  if (narrow) {
    body += x0Panel(labelW, y); y += 40 + x0Rows.length * pitch + 18;
    body += redirectPanel(rlabel, y); y += 40 + evRows.length * pitch + 6;
  } else {
    body += x0Panel(labelW, y);
    body += redirectPanel(labelW + panelW + rlabel + 20, y);
    y += 40 + x0Rows.length * pitch + 6;
  }
  const W2 = narrow ? W : Math.max(W, labelW + perRow * panelW);
  const title = `Generated hazard programs hit all ${hazards.total} of ${hazards.total} producer, consumer and distance bins`;
  const desc = `${hazards.cross.length} producer panels of ${slots.length} consumer slots by distances ${hazards.distances.join(', ')}, plus ${nTotal(hazards.x0)} x0 bins and ${nTotal(hazards.redirect)} redirect bins. ${hazards.hit} hit, ${hazards.missing.length} missing.`;
  return {svg: svg(ctx, W2, y, title, desc, body), title};
}

export const tableRows = () => {
  const k = checks;
  return [
    {check: 'Programs against the Python reference model', result: `${count(k.programs)} pass`, scope: `${count(k.retired)} retired instructions, run in Icarus and ${k.simulator}. Invariants checked on ${count(k.invariantCycles)} cycles. ${k.binsHit}/${k.binsTotal} instruction-class bins hit.`},
    {check: 'Spike, riscv-arch-test ' + k.archRelease, result: `${k.archPassed}/${k.archTotal} tests`, scope: `${count(k.signatureWords)} signature words equal Spike. RV32I suite; not ACT4 and not certification.`},
    {check: 'Random programs against Spike', result: `${k.randomPrograms} programs`, scope: `${count(k.randomRetirements)} retirements and ${count(k.randomStoreBytes)} store bytes equal the Spike commit log.`},
    {check: 'Hazard cross bins', result: `${k.hazardHit}/${k.hazardTotal} hit`, scope: `${k.hazardPrograms} generated hazard programs. Figure 5 shows every bin.`},
    {check: 'Deliberate RTL bugs caught', result: `${k.mutantsKilled}/${k.mutants}`, scope: Object.entries(k.byChecker).map(([c, n]) => `${n} by ${c === 'isa' ? 'Spike tests' : c === 'hazard' ? 'hazard programs' : 'invariants'}`).join(', ') + '.'},
    {check: 'DOT4 lane sweep', result: `${count(k.sweepCases)} cases`, scope: `Every signed byte pair in each lane; checksum equal to the oracle in ${k.sweepSims.map(cap).join(' and ')}. Of ${count(k.encodings)} custom-0 encodings only DOT4 executes; the other ${count(k.trapped)} trap.`},
    {check: 'Core line coverage', result: `${f(k.linePercent, 2)}%`, scope: `${k.lineHit}/${k.lineTotal} ${k.lineTool} line points in rv32_core.sv. ${k.uncovered.length === 1 ? `Uncovered: line ${k.uncovered[0][0]} (${k.uncovered[0][1]} default).` : `${k.uncovered.length} uncovered.`}`},
  ];
};

export function tableFigure(ctx, W) {
  const rows = tableRows();
  const resW = 150;
  let body = text(0, 16, 'Result', {size: 13, fill: C.secondary}) + text(resW + 16, 16, 'Check and what was compared', {size: 13, fill: C.secondary});
  let y = 28;
  const wrap = (s, max) => { const out = []; let cur = ''; for (const w of s.split(' ')) { if ((cur + ' ' + w).trim().length > max) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } return [...out, cur]; };
  for (const r of rows) {
    body += line(0, y, W, y, C.line);
    const scope = wrap(r.scope, 72);
    body += text(0, y + 24, r.result, {size: 17, weight: 600});
    body += text(resW + 16, y + 22, r.check, {size: 14, weight: 600});
    scope.forEach((s, i) => { body += text(resW + 16, y + 42 + i * 18, s, {size: 13, fill: C.secondary}); });
    y += 34 + scope.length * 18 + 8;
  }
  body += line(0, y, W, y, C.line);
  const title = `Every check passes; ${checks.lineHit} of ${checks.lineTotal} core line points are covered`;
  return {svg: svg(ctx, W, y + 6, title, rows.map(r => `${r.check}: ${r.result}. ${r.scope}`).join(' '), body), title};
}
