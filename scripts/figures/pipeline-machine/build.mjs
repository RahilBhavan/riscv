// node scripts/figures/pipeline-machine/build.mjs
// Writes output/figures/pipeline-machine/index.html: the five-stage pipeline as a conveyor machine,
// stepped cycle by cycle from the Icarus snapshots in reports/visual-traces.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as k from "./vendor/iso-kit.mjs";
import * as G from "./vendor/lathe.mjs";
import { tubePieces, tubeSvg } from "./vendor/tube.mjs";
import { STAGES, loadTraces } from "./model.mjs";

const ROOT = new URL("../../../", import.meta.url);
const HERE = new URL("./", import.meta.url);
const OUT = new URL("output/figures/pipeline-machine/", ROOT);

const DATA = loadTraces();
const TRACE_NAMES = Object.keys(DATA.traces);
const LABELS = { decode_add: "Decode and add", pipeline_spaced: "Spaced by nops", forward_priority: "Forward priority", load_store: "Load-use stall", branch_flush: "Branch flush", dot_mixed: "DOT4 mixed" };

// Lifetimes: where each cartridge first appears and how it leaves (into the cabinet from WB, or through a trapdoor).
for (const name of TRACE_NAMES) {
  const frames = DATA.traces[name].frames;
  const life = {};
  frames.forEach((frame, f) => frame.slots.forEach((slot, s) => {
    if (!slot) return;
    life[slot.id] ??= { birth: f, birthStage: s };
    Object.assign(life[slot.id], { last: f, lastStage: s });
  }));
  for (const [id, entry] of Object.entries(life)) {
    if (entry.last === frames.length - 1) { entry.exit = "stay"; continue; }
    const frame = frames[entry.last];
    if (frame.flush?.dropped.includes(Number(id))) entry.exit = "drop";
    else if (entry.lastStage === 4) entry.exit = "retire";
    else throw Error(`trace ${name}: cartridge ${id} leaves ${STAGES[entry.lastStage]} at cycle ${frame.cycle} without a flush or retirement`);
    if (entry.exit === "drop" && entry.lastStage > 1) throw Error(`trace ${name}: a flush dropped a cartridge from ${STAGES[entry.lastStage]}, which has no trapdoor`);
  }
  DATA.traces[name].life = life;
}

const W = 1000, H = 450;
const SP = 110;
const SX = [0, 1, 2, 3, 4].map((i) => i * SP);
const TOP = 14;
const CART = { x: -31, y: -18, w: 62, d: 36, r: 2.5 };
const CART_H = 18;
const BED = { x: -53, y: -26, w: 546, d: 52, r: 2 };
const BASE = { x: -172, y: -104, w: 782, d: 178, r: 8 };
const BASE_H = 10, FOOT_H = 5;
const GX = (SX[1] + SX[2]) / 2;
const GATE = { open: 36, closed: TOP + 0.2, h: 18 };
const HEAD = { z: 48, h: 14 };
const HOUSE_TOP = 74;
const CAB = { x: 505, y: -46, w: 82, d: 72, r: 3 };
const CAB_TOP = 102;
const HOLE = (s) => ({ x: SX[s] - 33.5, y: -20.5, w: 67, d: 41, r: 1 });
const RETIRE_X = CAB.x + CAB.w / 2;
const PIPES = {
  MEM: { r: 2.4, points: [[SX[3] - 12, -24, 65], [SX[3] - 12, -24, 86], [SX[2] + 12, -24, 86], [SX[2] + 12, -24, 65]] },
  WB: { r: 2.4, points: [[SX[4] - 12, -9, 65], [SX[4] - 12, -9, 106], [SX[2] - 12, -9, 106], [SX[2] - 12, -9, 65]] },
};

const P = k.fitProjection(
  [...k.boxCorners(BASE, -BASE_H - FOOT_H, 0), ...k.boxCorners(CAB, 0, CAB_TOP + 4), [SX[4] - 12, -9, 110], [SX[2] - 12, -9, 110], ...k.boxCorners({ x: -152, y: -30, w: 74, d: 60 }, 0, 70)],
  W, H, { pad: 14, azimuth: 64 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const slab = (plan, z, h, steps = 4, bevel = 0.5) => k.slabOf(plan, z, h, P, steps, bevel);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const poly = (points) => k.pathOf(points.map(at), true);

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(BASE, 26))) {
    out.push(S(k.cylinder(x, y, 8, -BASE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 6.2, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(slab(BASE, -BASE_H, BASE_H, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(BASE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(BASE, 11);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.55 }));
  const strip = { x: BED.x, y: BASE.y + BASE.d - 16, w: BED.w, d: 7, r: 1 };
  out.push(S(slab(strip, 0, 0.6, 3, 0), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 3, strip.x + strip.w - 3, SP / 10, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D(SX.map((x) => at([x, strip.y + 5.4, 0.6])), { size: 0.7, tone: "hi" }));
  const label = { x: CAB.x - 2, y: BASE.y + BASE.d - 22, w: 74, d: 14, r: 1.4 };
  out.push(S(slab(label, 0, 0.8, 4, 0), { tone: "mid", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.6), 0.8, P, 4), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([label.x + 5, label.y + 7.6], 0.8, P, "x"), "RV32I · 5 STAGE", { size: 3.6, tone: "lo" }));
  out.push(D([at([label.x + 2.6, label.y + 3, 0.8]), at([label.x + label.w - 2.6, label.y + label.d - 3, 0.8])], { size: 0.45 }));
  return out.join("");
}

// Instruction memory: a magazine of blank cartridges at the head of the line.
function magazine() {
  const out = [];
  const x0 = -152, x1 = -78, y0 = -30, d = 60;
  out.push(S(slab({ x: x0, y: y0, w: x1 - x0, d, r: 2.5 }, 0, 8, 4, 0.6), { tone: "mid" }));
  out.push(S(slab({ x: x0, y: y0, w: 5, d, r: 1.2 }, 8, 58, 3, 0.4), { tone: "mid" }));
  for (let i = 0; i < 6; i++) {
    const z = 8 + i * 9.6;
    out.push(S(slab({ x: x0 + 5.5, y: -18, w: x1 - x0 - 11, d: 36, r: 2 }, z, 9.2, 3, 0.4), { tone: "hi", crease: "lo" }));
    out.push(L(k.sideSeam({ x: x0 + 5.5, y: -18, w: x1 - x0 - 11, d: 36, r: 2 }, z + 4.6, P, 3), { tone: "faint" }));
  }
  out.push(S(slab({ x: x1 - 5, y: y0, w: 5, d, r: 1.2 }, 8, 58, 3, 0.4), { tone: "mid" }));
  out.push(S(slab({ x: x0 - 1, y: y0 - 1, w: x1 - x0 + 2, d: d + 2, r: 2.5 }, 66, 4, 4, 0.6), { tone: "mid" }));
  out.push(L(k.planOutline({ x: x0 + 8, y: y0 + 8, w: x1 - x0 - 16, d: d - 16, r: 2 }, 70, P, 4), { tone: "faint" }));
  out.push(D(k.corners({ x: x0 - 1, y: y0 - 1, w: x1 - x0 + 2, d: d + 2 }, 3.5).map(([x, y]) => at([x, y, 70])), { size: 0.45 }));
  const knob = [x1 - 14, y0 + d - 12];
  out.push(S(k.cylinder(knob[0], knob[1], 4.6, 70, 4, P, 28), { tone: "mid" }));
  out.push(L(k.knurl(knob[0], knob[1], 4.6, 70, 74, 28, P), { tone: "lo" }));
  return out.join("");
}

function housing(s) {
  const x = SX[s];
  const plan = { x: x - 26, y: -80, w: 52, d: 42, r: 3 };
  const out = [S(slab(plan, 0, HOUSE_TOP, 4, 0.8), { tone: "mid", inner: L(k.sideSeam(plan, 30, P, 4), { tone: "faint" }) })];
  const cap = k.insetPlan(plan, -1.2);
  out.push(S(slab(cap, HOUSE_TOP, 3, 4, 0.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(cap, 4), HOUSE_TOP + 3, P, 4), { tone: "faint" }));
  out.push(D(k.corners(cap, 3.2).map(([px, py]) => at([px, py, HOUSE_TOP + 3])), { size: 0.45 }));
  out.push(S(k.cylinder(x + 12, -62, 4.2, HOUSE_TOP + 3, 4, P, 24), { tone: "mid" }));
  out.push(L(k.knurl(x + 12, -62, 4.2, HOUSE_TOP + 3, HOUSE_TOP + 7, 24, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([x + 12, -62], [x + 15.4, -62], HOUSE_TOP + 7, P), { tone: "hi", free: "end" }));
  return out.join("");
}

function head(s) {
  const x = SX[s];
  const out = [];
  out.push(S(k.cylinder(x, -6, 8, 42, 6, P, 32), { tone: "mid" }));
  out.push(L(k.knurl(x, -6, 8, 42.6, 47.4, 36, P), { tone: "lo" }));
  out.push(S(k.cylinder(x, -6, 5, 36, 6, P, 28), { tone: "mid", crease: "none" }));
  out.push(L(k.sideArc(x, -6, 5, 39, P, 16), { tone: "faint" }));
  const plan = { x: x - 27, y: -38, w: 54, d: 60, r: 3 };
  out.push(S(slab(plan, HEAD.z, HEAD.h, 4, 0.8), { tone: "mid", inner: L(k.sideSeam(plan, HEAD.z + 3, P, 4), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(plan, 4), HEAD.z + HEAD.h, P, 4), { tone: "faint" }));
  out.push(D(k.corners(plan, 2.4).map(([px, py]) => at([px, py, HEAD.z + HEAD.h])), { size: 0.45 }));
  const plate = { x: x - 13, y: 22, w: 26, d: 1.1, r: 0.4 };
  out.push(S(slab(plate, HEAD.z + 3.8, 8.6, 2, 0), { tone: "hi", crease: "lo" }));
  out.push(k.faceTextSvg(k.sideMatrix([x, 23.1], HEAD.z + 5.6, P, "left"), STAGES[s], { size: 6.2, tone: "hi", anchor: "middle" }));
  return out.join("");
}

function drum(x) {
  const F = G.frameAlong([x, BED.y, 7], [0, 1, 0]);
  return S(G.disc(0, BED.d, 7, F, P), { tone: "mid", inner: L(G.arcOf(F, BED.d / 2, 7, P), { tone: "faint" }) }) +
    S(G.disc(BED.d, BED.d + 1.6, 3, F, P), { tone: "mid" });
}

function trapdoor(s) {
  const hole = HOLE(s);
  const ring = k.ringOf(hole, 2);
  const top = ring.map(([x, y]) => [x, y, TOP]);
  const id = `pm-hole-${s}`;
  const x0 = hole.x, x1 = hole.x + hole.w, y0 = hole.y;
  const wall = (a, b) => poly([[...a, TOP], [...b, TOP], [...b, TOP - 30], [...a, TOP - 30]]);
  const slats = [];
  for (let x = x0 + 6; x < x1 - 2; x += 10) slats.push(k.lineOnTop([x, hole.y], [x, hole.y + hole.d], TOP, P));
  return `<g class="pm-trap" data-trap="${s}">
<clipPath id="${id}"><path d="${poly(top)}"/></clipPath>
<g class="pm-trap-open" clip-path="url(#${id})"><path class="pm-pit" d="${poly(top)}"/><path class="pm-pit-wall" d="${wall([x0, y0], [x1, y0])}"/><path class="pm-pit-side" d="${wall([x0, y0], [x0, y0 + hole.d])}"/><path class="pm-flap" d="${poly([[x0 + 1.5, y0 + 1, TOP], [x1 - 1.5, y0 + 1, TOP], [x1 - 1.5, y0 + 1, TOP - 26], [x0 + 1.5, y0 + 1, TOP - 26]])}"/></g>
<g class="pm-trap-shut"><path class="iso-top pm-door" d="${poly(top)}"/>${L(slats.join(""), { tone: "faint" })}<path class="iso-line pm-door-edge" data-tone="lo" d="${poly(top)}"/>${D([at([x0 + 10, y0 + 1.6, TOP]), at([x1 - 10, y0 + 1.6, TOP])], { size: 0.6, tone: "mid" })}</g>
</g>`;
}

function bed() {
  const out = [drum(BED.x)];
  out.push(S(slab(BED, 0, TOP, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(BED, 6, P, 3), { tone: "faint" }) }));
  const holes = [0, 1].map(HOLE);
  const slats = [];
  for (let x = BED.x + 6; x < BED.x + BED.w - 4; x += 10) {
    if (holes.some((h) => x > h.x - 1 && x < h.x + h.w + 1)) continue;
    if (Math.abs(x - GX) < 5) continue;
    slats.push(k.lineOnTop([x, BED.y + 3], [x, BED.y + BED.d - 3], TOP, P));
  }
  out.push(L(slats.join(""), { tone: "faint" }));
  out.push(trapdoor(0), trapdoor(1));
  for (const [from, to] of [[BED.x, GX - 4], [GX + 4, BED.x + BED.w]]) {
    for (const y of [BED.y, BED.y + BED.d - 3]) {
      out.push(S(slab({ x: from, y, w: to - from, d: 3, r: 0.8 }, TOP, 3.4, 2, 0.3), { tone: "mid" }));
    }
    out.push(D([from + 5, to - 5].map((x) => at([x, BED.y + BED.d - 1.5, TOP + 3.4])), { size: 0.4 }));
  }
  out.push(drum(BED.x + BED.w));
  out.push(S(slab({ x: BED.x + BED.w + 7, y: -20, w: CAB.x - BED.x - BED.w - 7, d: 40, r: 0.5 }, TOP - 2, 2, 2, 0), { tone: "lo" }));
  return out.join("");
}

function gateGuide(y) {
  const plan = { x: GX - 3, y, w: 6, d: 3.5, r: 0.8 };
  return S(slab({ x: GX - 5, y: y - 1, w: 10, d: 5.5, r: 1.2 }, 0, 3, 3, 0.4), { tone: "mid" }) +
    S(slab(plan, 3, 55, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(plan, 30, P, 3), { tone: "faint" }) });
}

function gateTop() {
  const out = [];
  const bar = { x: GX - 4.5, y: -31, w: 9, d: 62, r: 1.2 };
  out.push(S(slab(bar, 58, 6, 3, 0.6), { tone: "mid" }));
  out.push(D([at([GX, -28, 64]), at([GX, 28, 64])], { size: 0.45 }));
  out.push(S(k.cylinder(GX, 0, 5, 64, 3, P, 28), { tone: "mid" }));
  out.push(S(k.cylinder(GX, 0, 4, 67, 14, P, 28), { tone: "mid", crease: "none", inner: L(k.sideArc(GX, 0, 4, 74, P, 16), { tone: "faint" }) }));
  out.push(S(k.cylinder(GX, 0, 4.6, 81, 2.4, P, 28), { tone: "mid" }));
  out.push(D([at([GX, 0, 83.4])], { size: 0.6, tone: "mid" }));
  return out.join("");
}

function gatePlate() {
  const plan = { x: GX - 1.6, y: -26.5, w: 3.2, d: 53, r: 0.6 };
  return `<g class="pm-gate" data-part="gate">${S(slab(plan, GATE.open, GATE.h, 2, 0.3), { tone: "hi", crease: "lo" })}</g>`;
}

function pipe(name) {
  const { r, points } = PIPES[name];
  const route = G.fillet(points, 9, 9, { P, tube: r });
  const pieces = tubePieces(route, r, P, { maxLength: 400 });
  const collar = ([x, y]) => S(k.cylinder(x, y, r + 1.8, HEAD.z + HEAD.h, 3, P, 28), { tone: "mid" });
  const flow = L(k.pathOf(route.map(at)), { tone: "lit", flow: true, className: "pm-flow" });
  return `<g class="pm-pipe" data-pipe="${name}">${collar(points[0])}${collar(points[3])}${pieces.map((piece) => tubeSvg(piece, { tone: "hi" })).join("")}${flow}</g>`;
}

function pipeStand() {
  const [x, y] = [SX[3] + 14, -9];
  const topZ = PIPES.WB.points[1][2] - PIPES.WB.r;
  return S(k.cylinder(x, y, 3.2, HEAD.z + HEAD.h, 2.4, P, 24), { tone: "mid" }) +
    S(k.cylinder(x, y, 1.5, HEAD.z + HEAD.h + 2.4, topZ - HEAD.z - HEAD.h - 2.4, P, 16), { tone: "mid", crease: "none" });
}

function cabinet() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(CAB, 0, 4, P)}" style="filter:blur(5px)"/>`);
  out.push(S(slab(k.insetPlan(CAB, -2), 0, 6, 4, 0.6), { tone: "lo" }));
  out.push(S(slab(CAB, 6, CAB_TOP - 6, 4, 0.8), { tone: "mid" }));
  const cap = k.insetPlan(CAB, -1.5);
  out.push(S(slab(cap, CAB_TOP, 4, 4, 0.8), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(cap, 5), CAB_TOP + 4, P, 4), { tone: "faint" }));
  out.push(D(k.corners(cap, 3).map(([x, y]) => at([x, y, CAB_TOP + 4])), { size: 0.45 }));
  const side = k.sideMatrix([CAB.x + CAB.w, CAB.y + CAB.d - 10], 0, P, "right");
  const vents = [0, 1, 2, 3, 4].map((i) => {
    const z = 30 + i * 9, len = 46;
    return `M0 ${-z}h${len}a1.6 1.6 0 0 1 0 3.2h${-len}a1.6 1.6 0 0 1 0 -3.2z`;
  }).join("");
  out.push(`<g transform="${side}"><path class="iso-line" data-tone="lo" d="${vents}"/></g>`);
  const cols = 4, rows = 8, cw = 15, gap = 3, rh = 9, rg = 2.2;
  const left = CAB.x + (CAB.w - (cols * cw + (cols - 1) * gap)) / 2;
  const bottom = 6 + (CAB_TOP - 6 - (rows * rh + (rows - 1) * rg)) / 2;
  const front = CAB.y + CAB.d;
  const drawers = [];
  for (let reg = 0; reg < 32; reg++) {
    const row = Math.floor(reg / cols), col = reg % cols;
    const x = left + col * (cw + gap), z = bottom + (rows - 1 - row) * (rh + rg);
    drawers.push({ reg, x, z });
  }
  drawers.sort((a, b) => a.z - b.z || a.x - b.x);
  for (const { reg, x, z } of drawers) {
    const plan = { x, y: front - 4, w: cw, d: 5.8, r: 0.6 };
    const pull = { x: x + cw / 2 - 3, y: front + 1.8, w: 6, d: 1.4, r: 0.5 };
    const body = S(slab(plan, z, rh, 2, 0.3), { tone: "hi", crease: "lo" });
    const grip = reg === 0
      ? D([at([x + 2.2, front + 1.8, z + rh / 2]), at([x + cw - 2.2, front + 1.8, z + rh / 2])], { size: 0.5, tone: "mid" })
      : S(slab(pull, z + rh / 2 - 0.9, 1.8, 2, 0), { tone: "mid", crease: "none" });
    out.push(`<g class="pm-drawer" data-reg="${reg}">${body}${grip}</g>`);
  }
  return out.join("");
}

const svg = k.figureSvg({
  width: W,
  height: H,
  label: "A conveyor machine with five tool stations labelled IF, ID, EX, MEM and WB. Each instruction rides the belt as a cartridge with its decoded text on the front. A drop gate sits between ID and EX, trapdoors sit under IF and ID, two bypass pipes run from the MEM and WB heads back to EX, and a register cabinet with 32 drawers stands at the end of the line.",
  body: [
    base(),
    magazine(),
    SX.map((_, s) => housing(s)).join(""),
    gateGuide(-30.5),
    bed(),
    `<g data-layer="carts">${gatePlate()}</g>`,
    gateGuide(BED.y + BED.d + 0.5),
    gateTop(),
    SX.map((_, s) => head(s)).join(""),
    pipeStand(),
    pipe("MEM"),
    pipe("WB"),
    cabinet(),
  ],
});

const font = (file) => {
  const bytes = readFileSync(new URL(`docs/textbook/fonts/${file}`, ROOT));
  if (!bytes.length) throw Error(`docs/textbook/fonts/${file} is empty`);
  return bytes.toString("base64");
};
const FONTS = `@font-face{font-family:LearningSans;font-weight:400;src:url(data:font/woff2;base64,${font("IBMPlexSans-Regular.woff2")}) format("woff2")}@font-face{font-family:LearningSans;font-weight:600;src:url(data:font/woff2;base64,${font("IBMPlexSans-SemiBold.woff2")}) format("woff2")}`;

const CSS = `${FONTS}
body.iso[data-theme="light"]{--anatomy-lit-top:#ffe500;--anatomy-lit-shade:#d4c200;--anatomy-lit:#111214;--pm-ink:#f5f5ef;background:#111214;color:#c9c9c2;font:16px/1.55 LearningSans,Arial,sans-serif}
.iso-page{width:min(1080px,100% - 24px);margin:32px auto 64px}
.pm-head h1{font:600 clamp(22px,4vw,30px)/1.15 LearningSans,Arial,sans-serif;color:var(--pm-ink);margin:0 0 6px}
.pm-head p{margin:0 0 18px;max-width:62ch}
.pm-bar{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;justify-content:space-between;margin:0 0 14px}
.pm-traces{display:flex;flex-wrap:wrap;gap:6px}
.pm-bar button{font:inherit;font-size:14px;border:1px solid #62645f;border-radius:3px;background:#202124;color:var(--pm-ink);padding:7px 11px;cursor:pointer;min-height:36px}
.pm-bar button:hover{border-color:#ffe500}
.pm-bar button[aria-pressed="true"]{background:#ffe500;border-color:#ffe500;color:#111214}
.pm-bar button:focus-visible{outline:3px solid #ffe500;outline-offset:3px}
.pm-steps{display:flex;gap:6px;align-items:center}
.pm-count{font-variant-numeric:tabular-nums;color:var(--pm-ink);min-width:12ch;text-align:right;font-size:14px}
.iso-plate{padding:44px 16px 52px}
.pm-caption{margin:6px 8px 0;min-height:3.2em;color:var(--anatomy-strong);font-size:16px}
.pm-caption code,.pm-strip code{font-family:var(--anatomy-mono);font-size:.92em}
.pm-strip{list-style:none;margin:14px 8px 0;padding:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.pm-strip li{border-top:2px solid var(--anatomy-lo);padding:6px 4px 0;font-size:13px;color:var(--anatomy-text);min-width:0}
.pm-strip li[data-kind="insn"]{border-color:var(--anatomy-hi)}
.pm-strip li[data-on]{border-color:#c7b300}
.pm-strip b{display:block;font:600 12px/1.2 var(--anatomy-mono);letter-spacing:.06em;color:var(--anatomy-strong)}
.pm-strip code{display:block;color:var(--anatomy-strong);overflow-wrap:anywhere}
.pm-strip small{display:block;color:var(--anatomy-muted);font-size:12px}
.iso-figure{margin:0}
.iso-legend{color:#a8a8a2}
.iso-legend .iso-caption{max-width:80ch}
.pm-pit{fill:#2b2b2e}.pm-pit-wall{fill:#46464b}.pm-pit-side{fill:#3a3a3e}.pm-flap{fill:#5b5b60}
.pm-trap-open{opacity:0;transition:opacity 180ms linear}
.pm-trap[data-open] .pm-trap-open{opacity:1}
.pm-trap[data-open] .pm-trap-shut{opacity:0}
.pm-trap-shut{transition:opacity 180ms linear}
.pm-trap[data-armed] .pm-door{fill:var(--anatomy-lit-top)}
.pm-trap[data-armed] .pm-door-edge{stroke:var(--anatomy-lit)}
.pm-gate[data-on] .iso-solid{--anatomy-top:var(--anatomy-lit-top)}
.pm-gate[data-on] .iso-top{fill:var(--anatomy-lit-top)}
.pm-gate[data-on] .iso-shade{fill:var(--anatomy-lit-shade)}
.pm-gate[data-on] .iso-edge{stroke:var(--anatomy-lit)}
.pm-pipe .pm-flow{opacity:0}
.pm-pipe[data-on] .tb-body{fill:var(--anatomy-lit-top)}
.pm-pipe[data-on] .tb-shine{fill:#fff6a8}
.pm-pipe[data-on] .tb-shade{fill:var(--anatomy-lit-shade)}
.pm-pipe[data-on] .pm-flow{opacity:.8}
.pm-drawer{transition:transform 260ms var(--anatomy-ease)}
.pm-drawer[data-on] .iso-top{fill:var(--anatomy-lit-top)}
.pm-drawer[data-on] .iso-shade{fill:var(--anatomy-lit-shade)}
.pm-drawer[data-on] .iso-edge{stroke:var(--anatomy-lit)}
.pm-cart .iso-face-text{font-weight:600}
.pm-bubble-void{fill:var(--anatomy-shade-0)}
.pm-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:640px){
 .iso-page{width:calc(100% - 16px);margin:16px auto 40px}
 .iso-plate{padding:36px 6px 64px}
 .pm-strip{grid-template-columns:1fr;gap:0}
 .pm-strip li{display:grid;grid-template-columns:3.4em 1fr;gap:8px;align-items:baseline;padding:5px 2px;border-top-width:1px}
 .pm-strip b,.pm-strip code,.pm-strip small{display:inline}
 .pm-strip small{grid-column:2/-1;margin-top:-4px}
 .pm-caption{font-size:15px;margin:4px 4px 0}
}
@media (prefers-reduced-motion:reduce){.pm-drawer,.pm-trap-open,.pm-trap-shut{transition:none}.pm-pipe .pm-flow{animation:none}}
`;

const traceButtons = TRACE_NAMES.map((name) => `<button type="button" data-trace="${name}" aria-pressed="false">${LABELS[name]}</button>`).join("");
const keys = [
  { mark: "lit", label: "Yellow marks what acts this cycle: the closed gate, armed trapdoors, a bypass pipe in use, the drawer being written" },
  { mark: "raised", label: "One cartridge is one instruction; an empty tray is a bubble" },
];
const forwardFrom = readFileSync(new URL('../../../rtl/rv32_core.sv', import.meta.url), 'utf8').split('\n').findIndex(line => line.includes('Newest producer wins')) + 2;
if (forwardFrom < 2) throw Error('rtl/rv32_core.sv forwarding block not found');
const caption = `Each cycle is one Icarus RTL snapshot from reports/visual-traces.json, taken at a falling edge. Stalls and flushes shown in a cycle take effect at the next rising edge. Cartridge text is decoded from the trace's instruction words; a fetch past the program reads nop, the word tests/tb.sv fills memory with. Bypass pipe lighting is derived from the stage contents and the forwarding rules in rtl/rv32_core.sv lines ${forwardFrom}-${forwardFrom + 10}, because the trace does not record mux selects.`;

const plate = k.plateHtml({
  fig: "Fig · pipeline",
  title: "Five-stage pipeline machine",
  hint: "← → step · space play",
  readout: "",
  keys,
  caption,
  body: `<div class="iso-stage" data-stage>${svg}</div><p class="pm-caption" data-caption aria-live="polite"></p><ol class="pm-strip" data-strip aria-label="Stage contents this cycle"></ol>`,
});

const body = `<header class="pm-head"><h1>Five stages, one cartridge per instruction</h1><p>Pick a trace, then step through it one clock cycle at a time. Every position comes from a recorded RTL simulation of this core.</p></header>
<div class="pm-bar" role="toolbar" aria-label="Trace and cycle controls"><div class="pm-traces" role="group" aria-label="Trace">${traceButtons}</div><div class="pm-steps"><button type="button" data-act="back" aria-label="Step back one cycle">← Back</button><button type="button" data-act="play" aria-pressed="false">Play</button><button type="button" data-act="next" aria-label="Step forward one cycle">Next →</button><span class="pm-count" data-count aria-live="off"></span></div></div>
${plate}`;

const CONFIG = {
  traces: Object.fromEntries(TRACE_NAMES.map((name) => [name, { frames: DATA.traces[name].frames, life: DATA.traces[name].life }])),
  names: TRACE_NAMES, P, SX, TOP, CART, CART_H, GX, GATE, RETIRE_X,
  clips: [0, 1].map((s) => {
    const pts = k.ringOf(HOLE(s), 2).map(([x, y]) => at([x, y, TOP]));
    return k.pathOf(G.hullOf([...pts, ...pts.map(([x, y]) => [x, y - 1000])]), true);
  }),
};

const live = readFileSync(new URL("live.js", HERE), "utf8");
const kitSource = readFileSync(new URL("vendor/iso-kit.mjs", HERE), "utf8").replace(/^export /gm, "");
const script = `${kitSource}\nconst CONFIG = ${JSON.stringify(CONFIG)};\n${live}`;
const html = k.pageHtml({ title: "Five-stage pipeline machine", theme: "light", body, script, width: 1080 }).replace("</style>", `${CSS}</style>`);

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL("index.html", OUT), html);
const counts = TRACE_NAMES.map((name) => `${name} ${DATA.traces[name].frames.length}`).join(", ");
console.log(`wrote output/figures/pipeline-machine/index.html (${(html.length / 1024).toFixed(0)} KB; cycles: ${counts})`);
