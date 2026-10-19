// Every measured number quoted by the books, slides and visual lab, read from reports/*.json at build time.
import {readFileSync} from 'node:fs';

const root = new URL('../../', import.meta.url);
const report = name => JSON.parse(readFileSync(new URL(`reports/${name}.json`, root), 'utf8'));
const field = (name, data, path) => {
  const value = path.split('.').reduce((v, k) => v?.[k], data);
  if (value === undefined) throw Error(`reports/${name}.json has no ${path}; regenerate it with make`);
  return value;
};
const reader = name => { const data = report(name); return path => field(name, data, path); };

const count = n => n.toLocaleString('en-US');
const fixed = (n, digits) => n.toFixed(digits);
const percent = (part, whole) => fixed(100 * part / whole, 0);

const verification = reader('verification');
const coverage = reader('line-coverage');
const isa = reader('isa-compare');
const sweep = reader('dot4-sweep');
const mutation = reader('mutation');
const implementation = reader('implementation');
const ablation = reader('ablation');
const board = reader('board');

const seeds = ablation('seeds');
const shipped = ablation('variants.dot4_1_default_flow');
const withoutDot4 = ablation('variants.dot4_0');
const largest = ablation('throughput').reduce((a, b) => b.n > a.n ? b : a);
const verilatorSweep = sweep('simulators.verilator');
const lc = implementation('utilization.ICESTORM_LC');
const uncovered = coverage('uncovered').length;

export const metrics = {
  regression: {
    programs: count(verification('test_cases')),
    retired: count(verification('retired_instructions')),
    seeds: count(verification('random_seeds')),
    binsHit: count(verification('functional_bins_hit')),
    binsTotal: count(verification('functional_bins_total')),
    hazardPrograms: count(verification('hazard_programs')),
    hazardBinsHit: count(verification('hazard_cross_bins_hit')),
    hazardBinsTotal: count(verification('hazard_cross_bins_total')),
    invariantCycles: count(verification('invariant_cycles_checked')),
  },
  coverage: {
    hit: count(coverage('hit')),
    total: count(coverage('total')),
    percent: fixed(coverage('percent'), 2),
    uncoveredNote: uncovered === 0 ? 'No point is uncovered.'
      : uncovered === 1 ? 'Its uncovered point is the invalid branch-funct3 default.'
      : `${uncovered} points are uncovered.`,
    tool: coverage('tool').split(' ').slice(0, 2).join(' '),
  },
  spike: {
    archPassed: count(isa('arch_test.tests_passed')),
    archTotal: count(isa('arch_test.tests_total')),
    archRelease: isa('arch_test.release').split(' ')[0],
    signatureWords: count(isa('arch_test.signature_words_compared')),
    randomPrograms: count(isa('random_commit_log.programs')),
    randomRetirements: count(isa('random_commit_log.retirements_compared')),
  },
  dot4Sweep: {
    cases: count(verilatorSweep.sweep_cases),
    encodings: count(verilatorSweep.custom0_encodings),
    trapped: count(verilatorSweep.custom0_trapped),
  },
  mutants: {
    killed: count(mutation('killed')),
    total: count(mutation('mutants')),
  },
  speedup: {
    n: count(largest.n),
    vsQsquare: fixed(largest.speedup_vs_rv32i_qsquare.clock_adjusted_median, 1),
    vsQsquareMin: fixed(largest.speedup_vs_rv32i_qsquare.clock_adjusted_min, 1),
    vsQsquareMax: fixed(largest.speedup_vs_rv32i_qsquare.clock_adjusted_max, 1),
    vsShift: fixed(largest.speedup_vs_rv32i_shift.clock_adjusted_median, 1),
    cyclesDot4: count(largest.dot4.cycles),
    cyclesQsquare: count(largest.rv32i_qsquare.cycles),
    cyclesShift: count(largest.rv32i_shift.cycles),
    logicCellCost: percent(ablation('delta_dot4_on_minus_off.median_logic_cells'), withoutDot4.logic_cells.median),
    fmaxCost: percent(-ablation('delta_dot4_on_minus_off.median_fmax_mhz'), withoutDot4.fmax_mhz.median),
  },
  fmax: {
    median: fixed(shipped.fmax_mhz.median, 2),
    min: fixed(shipped.fmax_mhz.min, 2),
    max: fixed(shipped.fmax_mhz.max, 2),
    seeds: `${Math.min(...seeds)}–${Math.max(...seeds)}`,
    official: fixed(Object.values(implementation('fmax'))[0].achieved, 2),
    officialSeed: count(implementation('seed')),
    constraint: count(implementation('constraint_mhz')),
  },
  area: {
    lut4: count(implementation('synthesis_primitives.SB_LUT4')),
    flipFlops: count(implementation('flip_flops')),
    logicCells: count(lc.used),
    logicCellsAvailable: count(lc.available),
    logicCellsPercent: fixed(100 * lc.used / lc.available, 1),
  },
  board: {
    fmax: fixed(board('fmax_mhz'), 2),
    constraint: count(board('constraint_mhz')),
    logicCells: count(board('utilization.ICESTORM_LC.used')),
    blockRams: count(board('utilization.ICESTORM_RAM.used')),
    tested: board('board_tested'),
  },
};
