const { traces, names, SX, TOP, CART, CART_H, GX, GATE, RETIRE_X, clips } = CONFIG;
const P = CONFIG.P;
const NS = "http://www.w3.org/2000/svg";
const MOVE = 650;
const PLAY_EVERY = 1700;
const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"];

const stage = document.querySelector("[data-stage]");
const svg = stage.querySelector("svg");
const layer = svg.querySelector('[data-layer="carts"]');
const gateEl = layer.querySelector('[data-part="gate"]');
const traps = [...svg.querySelectorAll(".pm-trap")];
const pipes = Object.fromEntries([...svg.querySelectorAll(".pm-pipe")].map((el) => [el.dataset.pipe, el]));
const drawers = Object.fromEntries([...svg.querySelectorAll(".pm-drawer")].map((el) => [el.dataset.reg, el]));
const readout = document.querySelector("[data-readout]");
const captionEl = document.querySelector("[data-caption]");
const stripEl = document.querySelector("[data-strip]");
const countEl = document.querySelector("[data-count]");
const traceButtons = [...document.querySelectorAll("[data-trace]")];
const playButton = document.querySelector('[data-act="play"]');
const still = matchMedia("(prefers-reduced-motion: reduce)");

const defs = document.createElementNS(NS, "defs");
defs.innerHTML = clips.map((d, s) => `<clipPath id="pm-drop-${s}"><path d="${d}"/></clipPath>`).join("");
svg.prepend(defs);

const hex = (n) => "0x" + (n >>> 0).toString(16).padStart(2, "0");
const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const mix = (a, b, t) => a + (b - a) * t;

function cartMarkup(slot) {
  if (slot.kind === "bubble") {
    const h = 9;
    const inner = insetPlan(CART, 3);
    return solidSvg(slabOf(CART, TOP, h, P, 4, 0.5), { tone: "mid" }) +
      `<path class="pm-bubble-void" d="${onTop(ringOf(inner, 4), TOP + h, P, true)}"/>` +
      lineSvg(planOutline(inner, TOP + h, P, 4), { tone: "lo" }) +
      lineSvg(planOutline(insetPlan(CART, 7), TOP + h, P, 4), { tone: "faint" });
  }
  const top = TOP + CART_H;
  const front = CART.y + CART.d + 0.05;
  const [op, ...rest] = slot.asm.split(" ");
  const args = rest.join(" ");
  const face = (z, text, size) => faceTextSvg(sideMatrix([0, front], z, P, "left"), text, { size, tone: slot.past ? "mid" : "hi", anchor: "middle" });
  const frame = `<g transform="${sideMatrix([0, front], 0, P, "left")}"><path class="iso-line" data-tone="faint" d="M-27 ${-(top - 2.2)}h54v${CART_H - 4.4}h-54z"/></g>`;
  const label = args ? face(TOP + 10.4, op, 6) + face(TOP + 4.4, args, 5) : face(TOP + 7.2, op, 6.4);
  return solidSvg(slabOf(CART, TOP, CART_H, P, 4, 0.8), { tone: "hi", crease: "lo" }) +
    lineSvg(planOutline(insetPlan(CART, 3.5), top, P, 4), { tone: "faint" }) +
    faceTextSvg(topMatrix([CART.x + 7, CART.y + CART.d - 8], top, P, "x"), hex(slot.pc), { size: 4.2, tone: "lo" }) +
    frame + label;
}

const state = { name: "load_store", f: 0, playing: false, touring: false, lastStep: 0, settleAt: 0, visible: false };
const nodes = new Map();
const gate = { from: GATE.open, to: GATE.open, t0: 0, z: GATE.open };
let frameReq = 0;

const trace = () => traces[state.name];
const frameAt = (f) => trace().frames[f];

function poseOf(id, f) {
  const s = frameAt(f).slots.findIndex((slot) => slot && slot.id === id);
  if (s >= 0) return { x: SX[s], z: 0, o: 1, clip: null };
  const life = trace().life[id];
  if (f < life.birth) return { x: SX[life.birthStage], z: 20, o: 0, clip: null };
  if (life.exit === "drop") return { x: SX[life.lastStage], z: -46, o: 0, clip: life.lastStage };
  return { x: RETIRE_X, z: 0, o: 1, clip: null };
}

function slotById(id) {
  for (const frame of trace().frames) for (const slot of frame.slots) if (slot && slot.id === id) return slot;
  return null;
}

function nodeFor(id, pose) {
  const outer = document.createElementNS(NS, "g");
  outer.setAttribute("class", "pm-cart");
  const inner = document.createElementNS(NS, "g");
  inner.innerHTML = cartMarkup(slotById(id));
  outer.append(inner);
  layer.append(outer);
  const node = { id, outer, inner, from: { ...pose }, to: { ...pose }, t0: 0, cur: { ...pose } };
  nodes.set(id, node);
  return node;
}

function place(node, pose, clip) {
  node.cur = pose;
  node.inner.setAttribute("transform", translateAlong(P, [pose.x, 0, pose.z]));
  node.outer.setAttribute("opacity", pose.o.toFixed(3));
  if (clip == null) node.outer.removeAttribute("clip-path");
  else node.outer.setAttribute("clip-path", `url(#pm-drop-${clip})`);
}

function order() {
  const items = [...nodes.values()].map((node) => ({ el: node.outer, key: node.cur.x })).concat([{ el: gateEl, key: GX }]);
  items.sort((a, b) => a.key - b.key);
  const current = [...layer.children];
  if (items.every((item, i) => current[i] === item.el)) return;
  const fragment = document.createDocumentFragment();
  items.forEach((item) => fragment.append(item.el));
  layer.append(fragment);
}

function visuals() {
  const frame = frameAt(state.f);
  gateEl.toggleAttribute("data-on", frame.stall);
  traps.forEach((el) => el.toggleAttribute("data-armed", !!frame.flush));
  const from = new Set(frame.forwards.map((f) => f.from));
  for (const [name, el] of Object.entries(pipes)) el.toggleAttribute("data-on", from.has(name));
  for (const [reg, el] of Object.entries(drawers)) {
    const on = Number(reg) === frame.write;
    el.toggleAttribute("data-on", on);
    el.setAttribute("transform", on ? translateAlong(P, [0, 5, 0]) : "");
  }
}

function setGate(now, delay) {
  const target = frameAt(state.f).stall ? GATE.closed : GATE.open;
  if (gate.to === target) return;
  Object.assign(gate, { from: gate.z, to: target, t0: now + delay });
}

function placeGate(z) {
  gate.z = z;
  gateEl.setAttribute("transform", translateAlong(P, [0, 0, z - GATE.open]));
}

function rebuild() {
  for (const node of nodes.values()) node.outer.remove();
  nodes.clear();
  frameAt(state.f).slots.forEach((slot) => { if (slot) place(nodeFor(slot.id, poseOf(slot.id, state.f)), poseOf(slot.id, state.f), null); });
  const target = frameAt(state.f).stall ? GATE.closed : GATE.open;
  Object.assign(gate, { from: target, to: target, t0: 0 });
  placeGate(target);
  traps.forEach((el) => el.removeAttribute("data-open"));
  order();
  visuals();
  state.settleAt = 0;
}

function go(g, { jump = false } = {}) {
  const tr = trace();
  g = Math.max(0, Math.min(tr.frames.length - 1, g));
  const prev = state.f;
  if (g === prev && !jump) return;
  state.f = g;
  text();
  if (jump || Math.abs(g - prev) !== 1 || still.matches) { rebuild(); return; }
  const now = performance.now();
  const ids = new Set([...nodes.keys()]);
  frameAt(g).slots.forEach((slot) => slot && ids.add(slot.id));
  frameAt(prev).slots.forEach((slot) => slot && ids.add(slot.id));
  for (const id of ids) {
    const node = nodes.get(id) ?? nodeFor(id, poseOf(id, prev));
    node.from = { ...node.cur };
    node.to = poseOf(id, g);
    node.t0 = now;
  }
  setGate(now, MOVE);
  state.settleAt = now + MOVE;
  run();
}

function tick(now) {
  frameReq = 0;
  let busy = false;
  let falling = false;
  for (const node of [...nodes.values()]) {
    const t = ease((now - node.t0) / MOVE);
    const { from, to } = node;
    const clip = to.clip ?? from.clip;
    place(node, { x: mix(from.x, to.x, t), z: mix(from.z, to.z, t), o: mix(from.o, to.o, t), clip: to.clip }, t < 1 ? clip : to.clip);
    if (t < 1) { busy = true; if (clip != null) falling = true; }
    else if (!frameAt(state.f).slots.some((slot) => slot && slot.id === node.id)) { node.outer.remove(); nodes.delete(node.id); }
  }
  traps.forEach((el) => el.toggleAttribute("data-open", falling));
  const gt = ease((now - gate.t0) / 300);
  placeGate(mix(gate.from, gate.to, gt));
  if (gt < 1) busy = true;
  if (state.settleAt) {
    if (now >= state.settleAt) { state.settleAt = 0; visuals(); } else busy = true;
  }
  order();
  if (state.playing && state.visible) {
    busy = true;
    if (now - state.lastStep >= PLAY_EVERY) {
      state.lastStep = now;
      if (state.f >= trace().frames.length - 1) setPlaying(false);
      else go(state.f + 1);
    }
  }
  if (busy && state.visible) frameReq = requestAnimationFrame(tick);
}

function run() {
  if (!frameReq && state.visible) frameReq = requestAnimationFrame(tick);
}

const sourceOf = (frame, operand) => frame.forwards.find((f) => f.operand === operand)?.from ?? "register file";
const value = (n) => (n >= 0x10000 ? hex(n) : String(n | 0));

function text() {
  const frame = frameAt(state.f);
  const total = trace().frames.length;
  const tag = frame.flush ? (frame.flush.kind === "trap" ? "trap flush" : "branch flush") : frame.stall ? "load-use stall" : frame.forwards.length ? "forwarding" : frame.write != null ? `writes x${frame.write}` : frame.halted ? "fetch halted" : "advance";
  readout.textContent = `cycle ${frame.cycle} · ${tag}`;
  countEl.textContent = `Cycle ${frame.cycle} of ${frameAt(total - 1).cycle}`;
  captionEl.innerHTML = esc(frame.caption).replace(/`([^`]+)`/g, "<code>$1</code>");
  const producers = new Set(frame.forwards.map((f) => f.from));
  stripEl.innerHTML = frame.slots.map((slot, s) => {
    const name = STAGE_NAMES[s];
    const on = (name === "MEM" || name === "WB") && producers.has(name);
    if (!slot) return `<li data-kind="empty"><b>${name}</b><code>empty</code><small>${s === 0 && frame.halted ? "fetch halted" : "no cartridge"}</small></li>`;
    if (slot.kind === "bubble") return `<li data-kind="bubble"><b>${name}</b><code>bubble</code><small>empty tray</small></li>`;
    let note = hex(slot.pc) + (slot.past ? " · past program" : "");
    if (s === 2 && frame.operands && frame.uses) {
      const parts = [];
      if (frame.uses.a) parts.push(`a = ${value(frame.operands.a)} from ${sourceOf(frame, "a")}`);
      if (frame.uses.b) parts.push(`b = ${value(frame.operands.b)} from ${sourceOf(frame, "b")}`);
      if (parts.length) note += " · " + parts.join(" · ");
    }
    return `<li data-kind="insn"${on ? " data-on" : ""}><b>${name}</b><code>${esc(slot.asm)}</code><small>${note}</small></li>`;
  }).join("");
  traceButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.trace === state.name)));
  const params = new URLSearchParams({ trace: state.name, cycle: String(frame.cycle) });
  history.replaceState(null, "", "#" + params);
}

function setPlaying(on) {
  state.playing = on;
  playButton.setAttribute("aria-pressed", String(on));
  playButton.textContent = on ? "Pause" : "Play";
  if (on) {
    if (state.f >= trace().frames.length - 1) go(0, { jump: true });
    state.lastStep = performance.now();
    run();
  }
}

const takeOver = () => { state.touring = false; };

function chooseTrace(name) {
  state.name = name;
  state.f = 0;
  text();
  rebuild();
}

traceButtons.forEach((button) => button.addEventListener("click", () => { takeOver(); setPlaying(false); chooseTrace(button.dataset.trace); }));
document.querySelector('[data-act="back"]').addEventListener("click", () => { takeOver(); setPlaying(false); go(state.f - 1); });
document.querySelector('[data-act="next"]').addEventListener("click", () => { takeOver(); setPlaying(false); go(state.f + 1); });
playButton.addEventListener("click", () => { takeOver(); setPlaying(!state.playing); });
document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const actions = {
    ArrowRight: () => { setPlaying(false); go(state.f + 1); },
    ArrowLeft: () => { setPlaying(false); go(state.f - 1); },
    Home: () => { setPlaying(false); go(0, { jump: true }); },
    End: () => { setPlaying(false); go(trace().frames.length - 1, { jump: true }); },
    " ": () => setPlaying(!state.playing),
  };
  const act = actions[event.key];
  if (!act) return;
  event.preventDefault();
  takeOver();
  act();
});

new IntersectionObserver((entries) => {
  state.visible = entries[entries.length - 1].isIntersecting;
  if (state.visible) run();
}, { rootMargin: "120px 0px" }).observe(stage);

const params = new URLSearchParams(location.hash.slice(1));
const asked = params.get("trace");
if (asked && names.includes(asked)) state.name = asked;
const cycle = Number(params.get("cycle"));
const index = trace().frames.findIndex((frame) => frame.cycle === cycle);
state.f = index >= 0 ? index : 0;
text();
rebuild();
if (!asked && !still.matches) {
  state.touring = true;
  setTimeout(() => { if (state.touring) setPlaying(true); }, 1400);
}
