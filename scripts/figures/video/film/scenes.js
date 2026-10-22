// riscv.mp4 · square · 20 s · 96 BPM = 8 bars. DATA is prepended by build.mjs from reports/*.json.
// The pipeline clock is the music clock: one trace cycle per beat. The camera pushes into EX,
// four int8 lanes multiply and sum into one register, and that register floods the frame for the drop.

const C = {
  bg: FILM.bg, ink: '#F5F5EF', acc: '#FFE500', box: '#1b1c20', edge: '#2e3036', tile: '#2a2c32', muted: '#8d8f96',
};

const S = {
  line2: bars(1), push: bars(2), lanes: bars(2.25), mul: bars(2.75), sum: bars(3),
  grow: bars(3.6), still: bars(3.9), drop: bars(4), spike: bars(5.5), end: bars(6.5), url: bars(7),
};
const QC_AT = [0, S.line2 + 0.4, S.push + 0.4, S.mul + 0.3, S.sum + 0.6, S.grow + 0.4, S.drop + 0.1, S.drop + 1.6, S.spike + 1.9, DUR - 1 / FPS];

// ── trace timing: the last cycle (DOT4 in EX) lands on S.line2, one cycle per beat before it
const CYC = DATA.cycles, LAST = CYC.length - 1;
const CYC_T = CYC.map((_, i) => S.line2 - (LAST - i) * BEAT);

// ── type
const DISP = { font: 'Big Shoulders', weight: 700 }, MONO = { font: 'Geist Mono', weight: 400 }, MONOB = { font: 'Geist Mono', weight: 700 };
const SANS = { font: 'Instrument Sans', weight: 400 };

// ── layout
const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'];
const BW = 170 * U, BH = 160 * U, BG = (SAFE.wc - 5 * BW) / 4, PY = CY + 150 * U;
const stageX = (s) => CX - SAFE.wc / 2 + BW / 2 + s * (BW + BG);
const EX_RECT = { x: stageX(2) - BW / 2, y: PY - BH / 2, w: BW, h: BH };
const HOOK_LINES = ['I BUILT A RISC-V CPU.', 'AND GAVE IT ONE', 'NEW INSTRUCTION.'];
let HS = 120 * U;
const LANE_W = 176 * U, LANE_H = 116 * U, LANE_GAP = 22 * U, LABEL_W = 110 * U;
const GRID_X0 = CX - (LABEL_W + 4 * LANE_W + 3 * LANE_GAP) / 2 + LABEL_W;
const laneX = (col) => GRID_X0 + LANE_W / 2 + col * (LANE_W + LANE_GAP);
const ROW_Y = [SAFE.y0 + 300 * U, SAFE.y0 + 440 * U, SAFE.y0 + 610 * U];
const SUM_RECT = { w: 470 * U, h: 124 * U };
SUM_RECT.x = CX - SUM_RECT.w / 2; SUM_RECT.y = SAFE.y0 + 740 * U;

async function setup() {
  HS = Math.min(124 * U, ...HOOK_LINES.map((l) => fitSize(l, 124 * U, SAFE.wc, { ...DISP, tracking: -0.01 })));
}

// lanes shown MSB first (lane 3 on the left), the way the bytes sit in the register
const COLS = [3, 2, 1, 0];
const hexByte = (v) => (v & 255).toString(16).padStart(2, '0');

// ───────────────────────────────────────────── shared pieces
function rvPop(lt, f = 2.6, z = 0.5) { return lt <= 0 ? 0 : spring(lt, f, z); }
function rvBox(x, y, w, h, r, fill, stroke, lw) { roundRect(x - w / 2, y - h / 2, w, h, r, fill, stroke, lw); }
function rvCentered(str, x, y, size, o) { return text(str, x, y + capH(size, o) / 2, size, { ...o, align: 'center' }); }

// ───────────────────────────────────────────── 01 · pipeline (real dot_mixed cycles)
function cycleState(t) {
  const i = clamp(Math.floor((t + 0.2 - CYC_T[0]) / BEAT), 0, LAST);
  const u = eOutQuint(seg(t, CYC_T[i] - 0.2, CYC_T[i] + 0.12));
  return { i, prev: Math.max(0, i - 1), u: i === 0 ? 1 : u };
}
function pipelineTiles(t) {
  const { i, prev, u } = cycleState(t), a = CYC[prev].stages, b = CYC[i].stages;
  const pcs = new Set([...a, ...b].filter((p) => p !== null));
  pcs.forEach((pc) => {
    const sa = a.indexOf(pc), sb = b.indexOf(pc);
    const xa = sa >= 0 ? stageX(sa) : stageX(0) - BW - BG, xb = sb >= 0 ? stageX(sb) : stageX(4) + BW + BG;
    const x = lerp(xa, xb, i === prev ? 1 : u), al = sa < 0 ? u : sb < 0 ? 1 - u : 1;
    const isDot = pc === DATA.dotPc, inEx = isDot && sb === 2;
    const bump = 1 + 0.08 * (isDot ? pulse(t, S.line2, 0.35) : 0);
    withT({ x, y: PY + 8 * U, alpha: al, scale: bump }, () => {
      rvBox(0, 0, BW - 26 * U, 92 * U, 14 * U, isDot ? C.acc : C.tile);
      rvCentered(DATA.names[pc], 0, 0, 29 * U, { ...(isDot ? MONOB : MONO), color: isDot ? C.bg : C.ink });
    });
    if (inEx && u > 0.5) glow(x, PY, 170 * U, C.acc, 0.18 * clamp((t - S.line2 + 0.1) * 4), 'lighter');
  });
}
function scenePipeline(t) {
  const { i } = cycleState(t), exHot = clamp((t - S.line2 + 0.1) * 5);
  const o = { ...DISP, tracking: -0.01 };
  const y1 = SAFE.y0 + HS * 1.0, y2 = y1 + HS * 1.02, y3 = y2 + HS * 1.02;
  reveal(HOOK_LINES[0], CX, y1, HS, seg(t, -0.5, 0.15), { ...o, align: 'center', mode: 'rise', color: C.ink });
  const acc = (w) => (w === 'ONE' || w === 'NEW' || w === 'INSTRUCTION.' ? C.acc : C.ink);
  reveal(HOOK_LINES[1], CX, y2, HS, seg(t, S.line2 - 0.12, S.line2 + 0.3), { ...o, align: 'center', mode: 'mask', colorOf: acc });
  reveal(HOOK_LINES[2], CX, y3, HS, seg(t, S.line2 - 0.02, S.line2 + 0.4), { ...o, align: 'center', mode: 'mask', colorOf: acc });

  STAGES.forEach((name, s) => {
    const hot = s === 2 ? exHot : 0;
    rvBox(stageX(s), PY, BW, BH, 22 * U, C.box, mixHex(C.edge, C.acc, hot), (2 + 2 * hot) * U);
    text(name, stageX(s), PY - BH / 2 - 22 * U, 28 * U, { ...MONOB, align: 'center', color: s === 2 ? mixHex(C.muted, C.acc, hot) : C.muted, tracking: 0.08 });
  });
  pipelineTiles(t);
  const ly = PY + BH / 2 + 74 * U;
  text(`cycle ${CYC[i].cycle}`, SAFE.x0 + 10 * U, ly, 30 * U, { ...MONO, color: C.ink, tabular: true });
  text('real Icarus RTL trace', SAFE.x1 - 10 * U, ly, 30 * U, { ...MONO, color: C.muted, align: 'right' });
}

// ───────────────────────────────────────────── 02 · four lanes inside EX
function laneCell(col, row, value, lt, hot) {
  const p = rvPop(lt); if (p <= 0) return;
  withT({ x: laneX(col), y: ROW_Y[row], scale: lerp(0.6, 1, p), alpha: clamp(p * 3) }, () => {
    rvBox(0, 0, LANE_W, LANE_H, 18 * U, hot ? C.acc : C.tile);
    rvCentered(String(value), 0, -10 * U, 50 * U, { ...MONOB, color: hot ? C.bg : C.ink });
    if (row < 2) text('0x' + hexByte(value), 0, 42 * U, 22 * U, { ...MONO, align: 'center', color: C.muted });
  });
}
function sceneLanes(lt) {
  rect(-60 * U, -60 * U, W + 120 * U, H + 120 * U, C.box);
  const mul = S.mul - S.lanes, sum = S.sum - S.lanes;
  reveal('FOUR MULTIPLIES. ONE INSTRUCTION.', CX, SAFE.y0 + 74 * U, fitSize('FOUR MULTIPLIES. ONE INSTRUCTION.', 84 * U, SAFE.wc, DISP), seg(lt, 0.05, 0.5), { ...DISP, align: 'center', mode: 'rise', color: C.ink });
  rvCentered(DATA.dotText, CX, SAFE.y0 + 150 * U, 40 * U, { ...MONOB, color: C.acc });

  const lx = GRID_X0 - LABEL_W / 2 - 10 * U;
  [DATA.regA, DATA.regB].forEach((r, row) => { if (lt > 0.1 + row * 0.3) rvCentered(r, lx, ROW_Y[row], 40 * U, { ...MONOB, color: C.muted }); });
  if (lt > mul) rvCentered('×', lx, ROW_Y[2], 56 * U, { ...MONOB, color: C.acc });
  COLS.forEach((lane, col) => {
    laneCell(col, 0, DATA.a[lane], lt - 0.12 - col * 0.07, false);
    laneCell(col, 1, DATA.b[lane], lt - 0.42 - col * 0.07, false);
    const du = eOutQuint(seg(lt, mul - 0.16, mul + 0.05));
    if (du > 0) line(laneX(col), ROW_Y[1] + LANE_H / 2 + 6 * U, laneX(col), ROW_Y[2] - LANE_H / 2 - 6 * U, C.acc, 4 * U, du);
    laneCell(col, 2, DATA.products[lane], lt - mul, true);
  });
  const ringU = seg(lt, mul, mul + 0.45);
  if (ringU > 0 && ringU < 1) COLS.forEach((_, col) => ringStroke(laneX(col), ROW_Y[2], lerp(60, 150, eOutQuint(ringU)) * U, rgba(C.acc, 1 - ringU), 4 * U));

  const cu = eOutQuint(seg(lt, sum - 0.25, sum + 0.02)), sx = CX, sy = SUM_RECT.y + SUM_RECT.h / 2;
  if (cu > 0) COLS.forEach((_, col) => {
    const p0 = [laneX(col), ROW_Y[2] + LANE_H / 2 + 8 * U], p3 = [sx + (col - 1.5) * 60 * U, SUM_RECT.y - 6 * U];
    drawOn(bez(p0, [p0[0], p0[1] + 50 * U], [p3[0], p3[1] - 50 * U], p3, 24), cu, C.acc, 4 * U);
  });
  if (lt > S.grow - S.lanes) return;
  const sp = rvPop(lt - sum, 2.4, 0.42);
  if (sp > 0) {
    withT({ x: sx, y: sy, scale: lerp(0.5, 1, sp) * (1 + 0.06 * pulse(lt, sum, 0.3)), alpha: clamp(sp * 3) }, () => {
      rvBox(0, 0, SUM_RECT.w, SUM_RECT.h, 22 * U, C.acc);
      rvCentered(`${DATA.regD} = ${counter(0, DATA.sum, eOutQuint(seg(lt, sum, sum + 0.35)))}`, 0, 0, 60 * U, { ...MONOB, color: C.bg, tabular: true });
    });
    text('matches the RTL trace', sx, SUM_RECT.y + SUM_RECT.h + 54 * U, 28 * U, { ...MONO, align: 'center', color: C.muted, alpha: clamp((lt - sum - 0.4) * 4) });
  }
}
// the x3 box grows until it is the whole frame: the drop's yellow ground
function growSum(t) {
  const g = eInOutExpo(seg(t, S.grow, S.still));
  const w = lerp(SUM_RECT.w, W + 40 * U, g), h = lerp(SUM_RECT.h, H + 40 * U, g), y = lerp(SUM_RECT.y + SUM_RECT.h / 2, CY, g);
  rvBox(CX, y, w, h, lerp(22, 0, g) * U, C.acc);
  if (g < 0.5) rvCentered(`${DATA.regD} = ${DATA.sum}`, CX, y, 60 * U, { ...MONOB, color: C.bg, alpha: 1 - g * 2 });
}

// ───────────────────────────────────────────── 03 · drop: the payoff number
function sceneDrop(lt) {
  rect(-60 * U, -60 * U, W + 120 * U, H + 120 * U, C.acc);
  const slam = eOutQuint(seg(lt, 0, 0.22)), num = `${DATA.speedup}x`;
  const ns = fitSize(num, 420 * U, SAFE.wc, { ...DISP, tracking: -0.03 });
  withT({ x: CX, y: CY - 40 * U, scale: lerp(1.5, 1, slam) * (1 + 0.02 * Math.sin(lt * 1.3)), alpha: clamp(lt * 12 + 0.2) }, () =>
    text(num, 0, capH(ns, DISP) / 2, ns, { ...DISP, align: 'center', color: C.bg, tracking: -0.03 }));
  const l1 = 'FASTER ON AN INT8 DOT PRODUCT', s1 = fitSize(l1, 72 * U, SAFE.wc, DISP);
  reveal(l1, CX, CY + 240 * U, s1, seg(lt, BEAT - 0.1, BEAT + 0.3), { ...DISP, align: 'center', mode: 'mask', color: C.bg });
  reveal('after clock cost, vs the best pure RV32I kernel', CX, CY + 312 * U, 32 * U, seg(lt, 2 * BEAT - 0.1, 2 * BEAT + 0.3), { ...SANS, align: 'center', mode: 'fade', color: C.bg });
}

// ───────────────────────────────────────────── 04 · Spike
const CELL = 54 * U, CELL_GAP = 14 * U, CELL_COLS = 13;
function sceneSpike(lt) {
  const n = DATA.archTotal, rows = Math.ceil(n / CELL_COLS);
  const gw = CELL_COLS * CELL + (CELL_COLS - 1) * CELL_GAP, gx = CX - gw / 2, gy = SAFE.y0 + 500 * U;
  const filled = (i) => seg(lt, 0.2 + i * 0.035, 0.32 + i * 0.035);
  const shown = Array.from({ length: n }, (_, i) => i).filter((i) => i < DATA.archPassed && filled(i) >= 1).length;
  const bs = 250 * U, by = SAFE.y0 + 260 * U, mid = CX + 10 * U;
  const ap = clamp(lt * 8);
  text(String(shown), mid - 16 * U, by, bs, { ...DISP, align: 'right', color: shown === DATA.archPassed ? C.acc : C.ink, alpha: ap });
  text(`/${n}`, mid - 4 * U, by, bs, { ...DISP, align: 'left', color: C.ink, alpha: ap });
  reveal('RV32I TESTS MATCH SPIKE', CX, by + 140 * U, fitSize('RV32I TESTS MATCH SPIKE', 80 * U, SAFE.wc, DISP), seg(lt, 0.1, 0.5), { ...DISP, align: 'center', mode: 'rise', color: C.ink });
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / CELL_COLS), c = i % CELL_COLS, f = i < DATA.archPassed ? eOutBack(filled(i)) : 0;
    const x = gx + c * (CELL + CELL_GAP), y = gy + r * (CELL + CELL_GAP);
    roundRect(x, y, CELL, CELL, 10 * U, C.box, C.edge, 2 * U);
    if (f > 0) withT({ x: x + CELL / 2, y: y + CELL / 2, scale: f }, () => roundRect(-CELL / 2, -CELL / 2, CELL, CELL, 10 * U, C.acc));
  }
  const cy = gy + rows * (CELL + CELL_GAP) + 70 * U;
  text(`riscv-arch-test ${DATA.archRelease}. Not certification.`, CX, cy, 30 * U, { ...MONO, align: 'center', color: C.muted, alpha: clamp((lt - 1.2) * 4) });
}

// ───────────────────────────────────────────── END · echoes the hook; also the poster
function sceneEnd(lt) {
  const mw = 112 * U, mh = 64 * U, mg = 14 * U, mx0 = CX - (5 * mw + 4 * mg) / 2 + mw / 2, my = SAFE.y0 + 70 * U;
  STAGES.forEach((name, s) => {
    const p = rvPop(lt - 0.05 - s * 0.06); if (p <= 0) return;
    withT({ x: mx0 + s * (mw + mg), y: my, scale: lerp(0.6, 1, p), alpha: clamp(p * 3) }, () => {
      rvBox(0, 0, mw, mh, 12 * U, s === 2 ? C.acc : C.box, s === 2 ? null : C.edge, 2 * U);
      rvCentered(name, 0, 0, 26 * U, { ...MONOB, color: s === 2 ? C.bg : C.muted, tracking: 0.06 });
    });
  });
  const ts = Math.min(190 * U, fitSize('INSTRUCTION.', 190 * U, SAFE.wc, { ...DISP, tracking: -0.02 }));
  const ty1 = SAFE.y0 + 150 * U + ts * 0.9, ty2 = ty1 + ts * 0.98;
  reveal('ONE NEW', CX, ty1, ts, seg(lt, 0.05, 0.45), { ...DISP, align: 'center', mode: 'mask', color: C.ink, tracking: -0.02 });
  reveal('INSTRUCTION.', CX, ty2, ts, seg(lt, 0.15, 0.55), { ...DISP, align: 'center', mode: 'mask', color: C.acc, tracking: -0.02 });
  reveal('A 5-stage RV32I core, plus DOT4', CX, ty2 + 86 * U, 38 * U, seg(lt, BEAT, BEAT + 0.4), { ...SANS, align: 'center', mode: 'fade', color: C.ink });

  const ul = lt - (S.url - S.end), up = rvPop(ul, 2.4, 0.5);
  if (up > 0) withT({ x: CX, y: ty2 + 190 * U, scale: lerp(0.7, 1, up), alpha: clamp(up * 3) }, () => {
    const fs = 40 * U, w = textW(DATA.url, fs, MONOB) + 80 * U;
    rvBox(0, 0, w, 84 * U, 42 * U, C.ink);
    const n = Math.round(DATA.url.length * eOutQuint(clamp(ul / 0.5)));
    text(DATA.url.slice(0, n), -w / 2 + 40 * U, capH(fs, MONOB) / 2, fs, { ...MONOB, color: C.bg });
  });
  text('Results from simulation and post-route estimates. Not run on a board yet.', CX, SAFE.y1 - 6 * U, 27 * U, { ...SANS, align: 'center', color: C.muted, alpha: clamp((ul - 0.4) * 4), maxW: SAFE.wc });
}

// ───────────────────────────────────────────── camera + frame
function drawFilm(t) {
  if (t >= S.end) return sceneEnd(t - S.end);
  if (t >= S.spike) return sceneSpike(t - S.spike);
  if (t >= S.drop) return camera({ shake: 14 * U * pulse(t, S.drop, 0.35), seed: 'drop' }, () => sceneDrop(t - S.drop));
  if (t >= S.lanes) {
    camera({ shake: 6 * U * pulse(t, S.mul, 0.25), seed: 'mul' }, () => sceneLanes(t - S.lanes));
    if (t >= S.grow) growSum(t);
    return;
  }
  const into = (u) => eInQuart(u) - 0.04 * Math.sin(Math.PI * clamp(u / 0.35));
  const cam = t >= S.push ? camFit(EX_RECT, seg(t, S.push, S.lanes), { x: CX, y: CY, zoom: 1 }, 'fill', into) : { x: CX, y: CY, zoom: 1 };
  camera(cam, () => scenePipeline(t));
  const fade = sstep(0.75, 1, seg(t, S.push, S.lanes));
  if (fade > 0) rect(0, 0, W, H, rgba(C.box, fade));
}
function frame(t) {
  const fast = t > S.push + 0.3 && t < S.lanes;
  if (fast) motionBlur(drawFilm, t, 10, 0.6); else drawFilm(t);
  flash(pulse(t, S.drop, 0.18) * 0.5, '#ffffff');
  if (t > S.spike - 0.3 && t < S.spike) wipe(eInOutExpo(seg(t, S.spike - 0.3, S.spike)), 'up', C.bg);
  flash(pulse(t, S.end, 0.16) * 0.25, C.ink);
}
