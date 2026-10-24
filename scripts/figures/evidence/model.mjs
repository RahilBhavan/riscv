// Reads reports/*.json and tests/hazards.py into the plain data the evidence figures draw. Throws on any missing field.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root = new URL('../../../', import.meta.url);
const text = rel => readFileSync(new URL(rel, root), 'utf8');

const reader = name => {
  const data = JSON.parse(text(`reports/${name}.json`));
  return path => {
    const value = path.split('.').reduce((v, k) => v?.[k], data);
    if (value === undefined || value === null) throw Error(`reports/${name}.json has no ${path}; regenerate it with make`);
    return value;
  };
};
const need = (ok, message) => { if (!ok) throw Error(message); };

const benchmark = reader('benchmark');
const ablation = reader('ablation');
const verification = reader('verification');
const coverage = reader('line-coverage');
const mutation = reader('mutation');
const sweep = reader('dot4-sweep');
const isa = reader('isa-compare');

export const KERNELS = [
  {id: 'rv32i_shift', name: 'Shift-and-add, LW', short: 'Shift-add LW'},
  {id: 'rv32i_lb', name: 'Shift-and-add, LB', short: 'Shift-add LB'},
  {id: 'rv32i_qsquare', name: 'Quarter-square table', short: 'Quarter-square'},
  {id: 'dot4', name: 'DOT4', short: 'DOT4'},
];
for (const k of KERNELS) need(benchmark(`kernels.${k.id}`), `benchmark.json lacks kernel ${k.id}`);

const runs = benchmark('runs');
const uniform = runs.filter(r => r.dataset === 'uniform');
const sizes = [...new Set(uniform.map(r => r.n))].sort((a, b) => a - b);
need(sizes.length >= 2, 'benchmark.json needs at least two uniform vector lengths');
const runFor = (kernel, n, dataset = 'uniform') => {
  const r = runs.find(x => x.kernel === kernel && x.n === n && x.dataset === dataset);
  need(r, `benchmark.json has no ${kernel} run at n=${n} (${dataset})`);
  need(r.verified === true, `benchmark.json run ${kernel} n=${n} is not verified`);
  for (const f of ['cycles', 'retired', 'stalls', 'flushes']) need(Number.isFinite(r[f]), `benchmark.json run ${kernel} n=${n} lacks ${f}`);
  return r;
};

export const cycles = {
  sizes,
  series: KERNELS.map(k => ({...k, points: sizes.map(n => {
    const r = runFor(k.id, n);
    return {n, cycles: r.cycles, retired: r.retired, stalls: r.stalls, flushes: r.flushes};
  })})),
  extremes: runs.filter(r => r.dataset === 'extremes').map(r => ({kernel: r.kernel, n: r.n, cycles: r.cycles})),
  simulator: benchmark('simulator'),
  seed: benchmark('input_seed'),
  window: benchmark('cycle_window'),
};

const VARIANTS = [
  {id: 'dot4_0', name: 'DOT4 off', detail: 'chparam DOT4=0'},
  {id: 'dot4_1', name: 'DOT4 on', detail: 'chparam DOT4=1'},
  {id: 'dot4_1_default_flow', name: 'Shipped netlist', detail: 'make timing, DOT4=1'},
];
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[(s.length - 1) / 2]; };
export const fmax = {
  seeds: ablation('seeds'),
  variants: VARIANTS.map(v => {
    const seeds = ablation(`variants.${v.id}.seeds`);
    need(seeds.length === ablation('seeds').length, `ablation.json ${v.id} lacks a seed`);
    const reported = ablation(`variants.${v.id}.fmax_mhz.median`);
    need(Math.abs(median(seeds.map(s => s.fmax_mhz)) - reported) < 1e-9, `ablation.json ${v.id} median disagrees with its seeds`);
    return {...v, seeds: seeds.map(s => ({seed: s.seed, mhz: s.fmax_mhz})), median: reported,
      min: ablation(`variants.${v.id}.fmax_mhz.min`), max: ablation(`variants.${v.id}.fmax_mhz.max`),
      cells: ablation(`variants.${v.id}.logic_cells.median`), available: ablation(`variants.${v.id}.logic_cells_available`),
      lut4: ablation(`variants.${v.id}.lut4`)};
  }),
  deltaMhz: ablation('delta_dot4_on_minus_off.median_fmax_mhz'),
  deltaCells: ablation('delta_dot4_on_minus_off.median_logic_cells'),
  netlistSpread: {lut4: ablation('same_logic_netlist_spread.lut4'), mhz: ablation('same_logic_netlist_spread.median_fmax_mhz')},
  what: ablation('what'),
};
const [off, on] = fmax.variants;
need(Math.abs(on.median - off.median - fmax.deltaMhz) < 0.001, 'ablation.json delta_dot4_on_minus_off.median_fmax_mhz disagrees with the variant medians');
need(on.cells - off.cells === fmax.deltaCells, 'ablation.json delta logic cells disagrees with the variants');
need(new Set(fmax.variants.map(v => v.available)).size === 1, 'ablation.json variants disagree on available logic cells');

const BASELINES = [
  {id: 'rv32i_qsquare', name: 'Quarter-square table'},
  {id: 'rv32i_shift', name: 'Shift-and-add, LW'},
  {id: 'rv32i_lb', name: 'Shift-and-add, LB'},
];
const clockRatio = on.median / off.median;
export const speedup = {
  clock: {on: on.median, off: off.median, ratio: clockRatio, onMin: on.min, offMax: off.max, onMax: on.max, offMin: off.min},
  definition: ablation('throughput_definition'),
  baselines: BASELINES.map(b => ({...b, rows: ablation('throughput').map(t => {
    const s = t[`speedup_vs_${b.id}`];
    need(s, `ablation.json throughput n=${t.n} lacks speedup_vs_${b.id}`);
    const cyc = t[b.id].cycles / t.dot4.cycles;
    need(Math.abs(cyc - s.cycles) < 0.001, `ablation.json n=${t.n} ${b.id} cycle speedup disagrees with its cycles`);
    need(Math.abs(cyc * clockRatio - s.clock_adjusted_median) < 0.002, `ablation.json n=${t.n} ${b.id} clock-adjusted median is not cycles x Fmax ratio`);
    need(Math.abs(cyc * on.min / off.max - s.clock_adjusted_min) < 0.002, `ablation.json n=${t.n} ${b.id} min is not slowest DOT4 seed over fastest DOT4=0 seed`);
    return {n: t.n, cycles: s.cycles, median: s.clock_adjusted_median, min: s.clock_adjusted_min, max: s.clock_adjusted_max,
      dot4Cycles: t.dot4.cycles, baseCycles: t[b.id].cycles};
  })})),
};

const src = text('tests/hazards.py');
const tuple = name => {
  const m = src.match(new RegExp(`^${name} = \\(([^)]*)\\)`, 'm'));
  need(m, `tests/hazards.py has no ${name} tuple`);
  return [...m[1].matchAll(/'([^']+)'|(\d+)/g)].map(x => x[1] ?? Number(x[2]));
};
const hazardsSha = createHash('sha256').update(src).digest('hex');
need(hazardsSha === verification('source_sha256')['tests/hazards.py'],
  'tests/hazards.py changed since reports/verification.json was written; rerun make coverage (it writes reports/verification.json)');
const producers = tuple('PRODUCERS'), slots = tuple('SLOTS'), distances = tuple('DISTANCES');
const transfers = tuple('TRANSFERS'), events = tuple('REDIRECT_EVENTS');
const missing = new Set(verification('hazard_cross_missing'));
const bin = id => ({id, hit: !missing.has(id)});
export const hazards = {
  producers, slots, distances, transfers, events,
  cross: producers.map(p => ({producer: p, cells: slots.map(s => distances.map(d => bin(`${p}>${s}:d${d}`)))})),
  x0: producers.map(p => distances.map(d => bin(`x0:${p}>read:d${d}`))),
  redirect: transfers.map(t => events.map(e => bin(`redirect:${t}:${e}`))),
  hit: verification('hazard_cross_bins_hit'),
  total: verification('hazard_cross_bins_total'),
  programs: verification('hazard_programs'),
  missing: [...missing],
  definition: verification('hazard_cross_definition'),
};
const universe = producers.length * slots.length * distances.length + producers.length * distances.length + transfers.length * events.length;
need(universe === hazards.total, `tests/hazards.py defines ${universe} bins but verification.json totals ${hazards.total}`);
need(hazards.hit === hazards.total - missing.size, 'verification.json hit count disagrees with its missing list');

const vsweep = sweep('simulators.verilator'), isweep = sweep('simulators.icarus');
need(vsweep.custom0_executed === 1 && vsweep.custom0_trapped === vsweep.custom0_encodings - 1, 'dot4-sweep.json: expected exactly one executing custom-0 encoding');
need(vsweep.checksum === sweep('oracle_checksum') && isweep.checksum === sweep('oracle_checksum'), 'dot4-sweep.json checksum differs from the oracle');
const byChecker = mutation('results').reduce((acc, r) => ({...acc, [r.checker]: (acc[r.checker] ?? 0) + (r.killed ? 1 : 0)}), {});
export const checks = {
  programs: verification('test_cases'), retired: verification('retired_instructions'), simulator: verification('simulator'),
  invariantCycles: verification('invariant_cycles_checked'),
  binsHit: verification('functional_bins_hit'), binsTotal: verification('functional_bins_total'),
  archPassed: isa('arch_test.tests_passed'), archTotal: isa('arch_test.tests_total'), archRelease: isa('arch_test.release').split(' ')[0],
  signatureWords: isa('arch_test.signature_words_compared'),
  randomPrograms: isa('random_commit_log.programs'), randomRetirements: isa('random_commit_log.retirements_compared'),
  randomStoreBytes: isa('random_commit_log.store_bytes_compared'),
  mutantsKilled: mutation('killed'), mutants: mutation('mutants'), byChecker,
  sweepCases: vsweep.sweep_cases, sweepSims: Object.keys(sweep('simulators')),
  encodings: vsweep.custom0_encodings, trapped: vsweep.custom0_trapped,
  lineHit: coverage('hit'), lineTotal: coverage('total'), linePercent: coverage('percent'),
  uncovered: coverage('uncovered'), lineTool: coverage('tool').split(' ').slice(0, 2).join(' '),
  hazardHit: hazards.hit, hazardTotal: hazards.total, hazardPrograms: hazards.programs,
};
