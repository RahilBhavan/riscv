// Fails the build when README.md quotes a number that no longer matches reports/*.json.
import {readFileSync} from 'node:fs';
import {metrics} from './metrics.mjs';

const {regression: g, coverage: c, spike: s, dot4Sweep: d, mutants: m, speedup: x, fmax: f, area: a, board: b} = metrics;

export const readmeClaims = [
  `${g.programs} programs pass`,
  `${g.programs} directed, random and generated hazard programs`,
  `${g.retired} retired instruction records`,
  `${g.seeds} deterministic random seeds`,
  `${g.invariantCycles} cycles`,
  `${s.archPassed}/${s.archTotal} RV32I tests from riscv-arch-test ${s.archRelease}`,
  `${s.randomPrograms} random programs`,
  `${g.hazardPrograms} generated programs hit ${g.hazardBinsHit}/${g.hazardBinsTotal} bins`,
  `all ${d.cases} isolated`,
  `All ${d.encodings} custom-0 encodings`,
  `the ${d.trapped} unsupported`,
  `${m.killed}/${m.total}`,
  `${c.hit}/${c.total} core line instrumentation points = ${c.percent}%`,
  `only ${c.total} instrumented points`,
  `${g.binsHit}/${g.binsTotal} instruction/branch-outcome/trap bins`,
  `for a ${x.n}-element int8 dot product, DOT4 takes ${x.cyclesDot4} cycles`,
  `takes ${x.cyclesQsquare} cycles`,
  `takes ${x.cyclesShift}`,
  `${x.vsQsquare}× over quarter-square (${x.vsQsquareMin}–${x.vsQsquareMax}×`,
  `${x.vsShift}× over shift-and-add`,
  `DOT4 is ${x.vsQsquare}× faster`,
  `adds ${x.logicCellCost}% logic cells and costs ${x.fmaxCost}% of median Fmax`,
  `${a.lut4} LUT4 primitives and ${a.flipFlops} flip-flops`,
  `${a.logicCells}/${a.logicCellsAvailable} iCE40 logic cells (${a.logicCellsPercent}%)`,
  `**${f.median} MHz median over five route seeds** (${f.min}–${f.max} MHz)`,
  `${f.median} MHz median internal post-route estimate over nextpnr seeds ${f.seeds}, range ${f.min}–${f.max} MHz`,
  `seed-${f.officialSeed} report is ${f.official} MHz`,
  `The ${f.constraint} MHz constraint passes`,
  `routes at ${b.fmax} MHz post-route against the board's ${b.constraint} MHz oscillator`,
  `~${Math.round(Number(f.median))} MHz post-route on iCE40 HX8K`,
];

export function checkReadme(path = new URL('../../README.md', import.meta.url)) {
  const readme = readFileSync(path, 'utf8');
  const missing = readmeClaims.filter(claim => !readme.includes(claim));
  if (missing.length) throw Error(`README.md is stale against reports/*.json. Update it to say:\n${missing.map(claim => `  ${claim}`).join('\n')}`);
  if (b.tested) throw Error('reports/board.json says the board was tested; replace the README "has not run on a board" text with the recorded run.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  checkReadme();
  console.log(`README.md matches reports/*.json (${readmeClaims.length} claims)`);
}
