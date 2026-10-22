#!/usr/bin/env node
// Builds output/figures/video/riscv.mp4 and poster.png with the motion-director engine.
// Every number on screen is read here from reports/*.json and handed to the film as DATA.
// Usage: node scripts/figures/video/build.mjs [--qc]
import {readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {metrics} from '../../textbook/metrics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const ENGINE = process.env.MOTION_DIRECTOR_ENGINE ?? join(homedir(), '.claude/skills/motion-director/engine');
const WORK = process.env.VIDEO_WORKDIR ?? join(homedir(), 'scratch/riscv/md');
const PROJ = join(WORK, 'riscv');
const OUT = join(root, 'output/figures/video');
const MAX_BYTES = 8 * 1024 * 1024;
const qcOnly = process.argv.includes('--qc');

const fail = msg => { throw Error(`video build: ${msg}`); };
const need = (value, what) => (value === undefined || value === null || value === '' ? fail(`missing ${what}`) : value);

const signed12 = w => (w | 0) >> 20;
function disasm(word) {
  const w = word >>> 0, op = w & 127, rd = (w >>> 7) & 31, f3 = (w >>> 12) & 7, rs1 = (w >>> 15) & 31, rs2 = (w >>> 20) & 31, f7 = w >>> 25;
  if (op === 0x37) return {op: 'lui', rd, imm: w & 0xfffff000, text: `lui x${rd}`};
  if (op === 0x13 && f3 === 0) return {op: 'addi', rd, rs1, imm: signed12(w), text: `addi x${rd}`};
  if (op === 0x0b && f3 === 0 && f7 === 0) return {op: 'dot4', rd, rs1, rs2, text: `dot4 x${rd}`};
  if (w === 0x00100073) return {op: 'ebreak', text: 'ebreak'};
  fail(`dot_mixed has an instruction word the film cannot name: 0x${w.toString(16)}`);
}
const lanesOf = v => [0, 1, 2, 3].map(i => ((v >>> (8 * i)) & 255) >= 128 ? ((v >>> (8 * i)) & 255) - 256 : (v >>> (8 * i)) & 255);

function traceData() {
  const report = JSON.parse(readFileSync(join(root, 'reports/visual-traces.json'), 'utf8'));
  need(report.scope, 'visual-traces.json scope');
  const trace = need(report.traces?.dot_mixed, 'visual-traces.json traces.dot_mixed');
  if (trace.checked !== true) fail('dot_mixed trace is not marked checked against the oracle');
  const insns = need(trace.words, 'dot_mixed words').map(disasm);

  const regs = new Array(32).fill(0);
  let dotIndex = -1;
  for (const [i, d] of insns.entries()) {
    if (d.op === 'lui') regs[d.rd] = d.imm >>> 0;
    else if (d.op === 'addi') regs[d.rd] = (regs[d.rs1] + d.imm) >>> 0;
    else if (d.op === 'dot4') { dotIndex = i; break; }
  }
  if (dotIndex < 0) fail('dot_mixed has no DOT4 instruction');
  const dot = insns[dotIndex], dotPc = 4 * dotIndex;
  const a = lanesOf(regs[dot.rs1]), b = lanesOf(regs[dot.rs2]);
  const products = a.map((x, i) => x * b[i]);
  const sum = products.reduce((x, y) => x + y, 0);

  const frames = need(trace.frames, 'dot_mixed frames');
  const exOf = f => (f.stages[2].valid ? f.stages[2].pc : null);
  const dotEx = frames.findIndex(f => exOf(f) === dotPc);
  if (dotEx < 0) fail('DOT4 never reaches EX in the trace');
  if (frames[dotEx].a >>> 0 !== regs[dot.rs1]) fail(`trace EX operand a=${frames[dotEx].a} differs from decoded x${dot.rs1}`);
  const next = insns[dotIndex + 1];
  if (next?.op !== 'addi' || next.rs1 !== dot.rd) fail('expected the instruction after DOT4 to read its result');
  const nextEx = frames.find(f => exOf(f) === dotPc + 4);
  if (!nextEx || nextEx.a >>> 0 !== sum >>> 0) fail(`forwarded DOT4 result in the trace (${nextEx?.a}) differs from the lane sum ${sum}`);

  return {
    cycles: frames.slice(0, dotEx + 1).map(f => ({cycle: f.cycle, stages: f.stages.map(s => (s.valid ? s.pc : null))})),
    names: Object.fromEntries(insns.map((d, i) => [4 * i, d.text])),
    dotPc,
    dotText: `dot4 x${dot.rd}, x${dot.rs1}, x${dot.rs2}`,
    regA: `x${dot.rs1}`, regB: `x${dot.rs2}`, regD: `x${dot.rd}`,
    a, b, products, sum,
  };
}

function repoUrl() {
  const remote = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], {encoding: 'utf8'}).trim();
  const m = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/) ?? fail(`origin is not a GitHub URL: ${remote}`);
  return `github.com/${m[1]}/${m[2]}`;
}

function data() {
  if (metrics.board.tested !== false) fail('board.json says the core ran on a board; update the end-card footnote before rebuilding');
  return {
    ...traceData(),
    speedup: need(metrics.speedup.vsQsquare, 'ablation speedup_vs_rv32i_qsquare'),
    archPassed: Number(need(metrics.spike.archPassed, 'isa-compare arch_test.tests_passed')),
    archTotal: Number(need(metrics.spike.archTotal, 'isa-compare arch_test.tests_total')),
    archRelease: need(metrics.spike.archRelease, 'isa-compare arch_test.release'),
    url: repoUrl(),
  };
}

const run = (args, opts = {}) => execFileSync(args[0], args.slice(1), {stdio: 'inherit', ...opts});

const DATA = data();
console.log('film data', JSON.stringify({speedup: DATA.speedup, arch: `${DATA.archPassed}/${DATA.archTotal}`, lanes: [DATA.a, DATA.b], sum: DATA.sum, cycles: DATA.cycles.length}));

if (!existsSync(join(ENGINE, 'render.mjs'))) fail(`motion-director engine not found at ${ENGINE}`);
if (!existsSync(join(PROJ, 'film.html'))) {
  mkdirSync(WORK, {recursive: true});
  run(['node', join(ENGINE, 'new.mjs'), '--title', 'riscv', '--format', 'square', '--seconds', '20', '--style', 'motion', '--bpm', '96', '--dir', WORK]);
}
const film = join(here, 'film');
copyFileSync(join(film, 'config.js'), join(PROJ, 'film/config.js'));
copyFileSync(join(film, 'score.js'), join(PROJ, 'film/score.js'));
writeFileSync(join(PROJ, 'film/scenes.js'), `'use strict';\nconst DATA = ${JSON.stringify(DATA)};\n` + readFileSync(join(film, 'scenes.js'), 'utf8'));

if (qcOnly) {
  run(['node', join(ENGINE, 'render.mjs'), PROJ, '--qc']);
  console.log(`QC sheet: ${join(PROJ, 'qc/sheet.png')}`);
  process.exit(0);
}

run(['node', join(ENGINE, 'render.mjs'), PROJ]);
const mp4 = join(PROJ, 'riscv.mp4');
if (!existsSync(mp4)) fail(`render did not produce ${mp4}`);
mkdirSync(OUT, {recursive: true});
const dest = join(OUT, 'riscv.mp4');
copyFileSync(mp4, dest);
const bytes = statSync(dest).size;
if (bytes > MAX_BYTES) fail(`riscv.mp4 is ${(bytes / 1048576).toFixed(1)} MB, over the 8 MB budget`);

const seconds = JSON.parse(readFileSync(join(film, 'config.js'), 'utf8').replace(/^[^{]*/, '').replace(/;\s*$/, '')).seconds;
run(['ffmpeg', '-v', 'error', '-y', '-sseof', '-0.1', '-i', dest, '-frames:v', '1', '-update', '1', join(OUT, 'poster.png')]);

const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', dest], {encoding: 'utf8'}));
const video = probe.streams.find(s => s.codec_type === 'video'), audio = probe.streams.find(s => s.codec_type === 'audio');
const duration = Number(probe.format.duration);
if (!video || video.width !== 1080 || video.height !== 1080) fail(`expected 1080x1080 video, got ${JSON.stringify(video)}`);
if (!audio) fail('riscv.mp4 has no audio stream');
if (Math.abs(duration - seconds) > 0.25) fail(`duration ${duration}s, expected ${seconds}s`);
console.log(`PASS ${dest} ${video.width}x${video.height} ${duration.toFixed(2)}s audio=yes ${(bytes / 1048576).toFixed(2)} MB; poster ${join(OUT, 'poster.png')}`);
