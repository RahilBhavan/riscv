'use strict';
// Score · A minor · 96 BPM · Am-F-C-G. Every sync point reads S and CYC_T from scenes.js.
// Earworm: pluck A4 C5 E5 D5 left hanging in the hook, resolved to A on the end card.
function score(A) {
  const b = (n) => beats(n);
  A.reverb(0.22);

  // ── HOOK + PIPELINE: the CPU clock is the beat. A tick and a soft kick per trace cycle.
  A.hit(0, 0.3);
  [[0, 'A4'], [0.5, 'C5'], [1, 'E5'], [2, 'D5']].forEach(([bt, n]) => { A.pluck(b(bt), n, 0.4, 0.8); A.bell(b(bt), n, 1.2, 0.3); });
  CYC_T.forEach((t, i) => {
    if (t < 0) return;
    A.tick(t, 0.7, 2400 + 120 * i, (i % 2 ? 0.2 : -0.2)); A.kick(t, 0.45 + 0.05 * i, { f1: 50, len: 0.3 });
    if (t >= 0.2) A.whoosh(t - 0.2, 0.25, 0.18, true);
  });
  const fetchDot = CYC.findIndex((c) => c.stages[0] === DATA.dotPc);
  if (fetchDot >= 0 && CYC_T[fetchDot] >= 0) A.blip(CYC_T[fetchDot] + 0.04, 'E6', 0.5, 0);
  A.progression(0, ['Am', 'F'], 4, (n, t) => { A.pad(t, n, A.bar, 0.55, { cutoff: 1400 }); A.sub(t, n[0] - 12, A.bar - 0.1, 0.45); }, 3);
  A.pattern(0, '..x...x...x...x.', (t) => A.hat(t, 0.35), 2);

  // DOT4 lands in EX with line 2
  A.hit(S.line2, 0.75); A.bellFx(S.line2 + 0.03, 'A6', 0.6, 0.5); A.pop(S.line2 + 0.02, 0.6, 1.26);
  A.pattern(S.line2, 'x.......x.......', (t) => A.kick(t, 0.6), 1);
  A.pattern(S.line2, '..x...x...x.x.x.', (t, i) => A.hat(t, 0.35 + i * 0.04), 1);

  // ── PUSH into EX
  A.whoosh(S.push - 0.05, S.lanes - S.push + 0.05, 0.9, true);
  A.hit(S.lanes, 0.5);

  // ── LANES: pops climb, one hit for all four multiplies, then the sum
  for (let k = 0; k < 4; k++) {
    A.pop(S.lanes + 0.12 + k * 0.07, 0.45, 1 + 0.06 * k);
    A.pop(S.lanes + 0.42 + k * 0.07, 0.45, 1.26 + 0.06 * k);
  }
  A.progression(S.lanes, ['C', 'G'], 3, (n, t) => { A.keys(t, n, b(2.8), 0.45); A.sub(t, n[0] - 12, b(2.8), 0.5); }, 3);
  A.hit(S.mul, 0.9); A.kick(S.mul, 0.8);
  ['A5', 'C6', 'E6', 'A6'].forEach((n, k) => A.blip(S.mul + 0.01 * k, n, 0.45, -0.3 + 0.2 * k));
  A.hit(S.sum, 0.7); A.cash(S.sum + 0.05, 0.5); A.bellFx(S.sum + 0.04, 'E6', 0.7, 0.45);

  // ── BUILD: riser and low-pass close while x3 grows, then true silence
  A.sweep(S.sum, S.still, 20000, 700);
  A.riser(S.sum, S.still - S.sum, 0.9);
  A.pattern(S.sum, 'x...x...x...x...x.x.x.x.xxxx', (t, i) => A.kick(t, 0.35 + i * 0.03), 1);
  A.whoosh(S.grow, S.still - S.grow, 0.6, true);
  A.silence(S.still, S.drop);

  // ── DROP: 5.3x
  A.sweep(S.drop, S.drop + 0.03, 700, 20000);
  A.impact(S.drop, 1); A.boom(S.drop, 0.8); A.crash(S.drop, 0.8);
  A.pattern(S.drop, 'x...x...x...x...x...x...', (t) => A.kick(t, 1), 1);
  A.pattern(S.drop, '....x.......x.......x...', (t) => A.clap(t, 0.8), 1);
  A.pattern(S.drop, '..x...x...x...x...x...x.', (t) => A.hat(t, 0.6), 1);
  A.progression(S.drop, ['Am', 'F', 'C'], 2, (n, t) => { A.bass(t, n[0] - 12, b(2) - 0.05, 1, { cutoff: 600 }); A.pad(t, n, b(2), 0.55, { cutoff: 2600 }); }, 3);
  A.pop(S.drop + BEAT, 0.5, 1.26); A.pop(S.drop + 2 * BEAT, 0.4, 1.5);

  // ── SPIKE: a tick per passing test, a hit when all land
  A.level(S.spike, 0.55, 0.05);
  A.swipe(S.spike - 0.3, 0.7, 1);
  A.progression(S.spike, ['C', 'G'], 2, (n, t) => { A.keys(t, n, b(1.9), 0.5); A.sub(t, n[0] - 12, b(1.9), 0.55); }, 3);
  A.pattern(S.spike, 'x.......x.......', (t) => A.kick(t, 0.7), 1);
  for (let i = 0; i < DATA.archPassed; i++) if (i % 2 === 0) A.tick(S.spike + 0.2 + i * 0.035, 0.4, 2200 + 40 * i, ((i % 4) - 1.5) * 0.15);
  A.hit(S.spike + 0.32 + (DATA.archPassed - 1) * 0.035, 0.7);
  A.bellFx(S.spike + 0.34 + (DATA.archPassed - 1) * 0.035, 'G6', 0.6, 0.4);

  // ── END: land on E, resolve the motif to A on the URL, ring out
  A.level(S.end, 0.8, 0.05);
  A.hit(S.end, 0.8); A.crash(S.end, 0.35); A.kick(S.end, 0.8);
  A.keys(S.end, A.chord('E', 3), b(2), 0.55); A.sub(S.end, 'E2', b(2) - 0.05, 0.6);
  endStagePops(A);
  A.bell(S.end, 'A4', 1.2, 0.7); A.bell(S.end + b(0.5), 'C5', 1.2, 0.7); A.bell(S.end + b(1), 'E5', 1.6, 0.7);
  const tail = A.dur - S.url;
  for (let k = 0; k < 6; k++) A.type(S.url + k * 0.08, 0.5, ((k % 3) - 1) * 0.2);
  A.kick(S.url, 0.7);
  A.sub(S.url, 'A1', tail - 0.3, 0.7);
  A.pad(S.url, A.chord('Am9', 3), tail - 0.5, 0.55, { attack: 0.06, cutoff: 2400 });
  A.keys(S.url, A.chord('Am9', 3), tail, 0.55);
  A.bell(S.url, 'A5', tail, 0.9); A.bell(S.url + 0.02, 'E6', tail, 0.45);
}
function endStagePops(A) { for (let s = 0; s < 5; s++) A.pop(S.end + 0.05 + s * 0.06, 0.35, s === 2 ? 1.5 : 1 + 0.06 * s); }
