// Fails the build when README.md quotes a number that no longer matches reports/*.json.
import {readFileSync} from 'node:fs';
import {metrics} from './metrics.mjs';

const {regression: g, coverage: c, spike: s, dot4Sweep: d, mutants: m, speedup: x, fmax: f, area: a, board: b, extended: e, formal: v} = metrics;

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
  `~${Math.round(Number(f.median))} MHz post-route on iCE40 HX8K`,  `${g.waitCycles} more cycles`,
  `${e.programs} programs pass on the MEXT=1 ZICSR=1 core`,
  `${e.retired} retired instruction records`,
  `${e.binsHit}/${e.binsTotal} bins`,
  `${e.archPassed}/${e.archTotal} tests from the RV32I, M and privilege suites`,
  `${e.outsideSelection} of them`,
  `${v.basePassed}/${v.baseTotal} riscv-formal checks pass on the default core and ${v.extendedPassed}/${v.extendedTotal} on the extended core`,
  `${e.lut4} LUT4 primitives and ${e.flipFlops} flip-flops, ${e.logicCells}/${a.logicCellsAvailable} logic cells (${e.logicCellsPercent}%)`,
  `${e.fmaxMedian} MHz median post-route estimate (${e.fmaxMin}–${e.fmaxMax} MHz)`,
];

// docs/RESEARCH.md repeats the headline outreach line; it must carry the same rounded figures.
export const researchClaims = [
  `is ${x.vsQsquare}× faster on a dot-product kernel`,
  `~${Math.round(Number(f.median))} MHz post-route on iCE40 HX8K`,
];

const here = rel => new URL(`../../${rel}`, import.meta.url);

// Each reports/verification*.json and its reports/raw/regression*.log are written together by the
// Verilator DOT4=1 runs (make coverage). Icarus runs from make test write build/ only.
const REGENERATE = 'Regenerate both with: docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" rv32-tools make coverage';

// Each raw regression log must come from the run behind its verification report.
export function checkRegressionLog(path = here('reports/raw/regression.log'), reportPath = here('reports/verification.json')) {
  const rel = u => String(u.pathname ?? u).replace(/^.*\/(reports\/)/, '$1');
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const stale = detail => Error(`${rel(path)} disagrees with ${rel(reportPath)}: ${detail}. ${REGENERATE}`);
  const records = lines.map(l => /^PASS (\S+): (\d+) retired(?:, and again with wait states)?$/.exec(l));
  const bad = lines.filter((l, i) => !records[i]);
  if (bad.length) throw stale(`${bad.length} line(s) are not "PASS <name>: <n> retired[, and again with wait states]", first: ${JSON.stringify(bad[0])}`);
  const names = records.map(m => m[1]);
  const duplicated = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  if (duplicated.length) throw stale(`program names repeat: ${duplicated.slice(0, 5).join(', ')}`);
  const expected = Number(report.test_cases);
  if (names.length !== expected) throw stale(`${names.length} PASS lines, but the report counts ${expected} programs`);
  const hazards = names.filter(n => n.startsWith('hazard_')).length;
  if (hazards !== Number(report.hazard_programs)) throw stale(`${hazards} hazard_ programs, but the report counts ${report.hazard_programs}`);
  const retired = records.reduce((sum, m) => sum + Number(m[2]), 0);
  if (retired !== Number(report.retired_instructions)) throw stale(`retired counts sum to ${retired}, but the report counts ${report.retired_instructions}`);
}

export function checkResearch(path = here('docs/RESEARCH.md')) {
  const text = readFileSync(path, 'utf8');
  const missing = researchClaims.filter(claim => !text.includes(claim));
  if (missing.length) throw Error(`docs/RESEARCH.md is stale against reports/*.json. Update it to say:\n${missing.map(claim => `  ${claim}`).join('\n')}`);
}

export function checkReadme(path = new URL('../../README.md', import.meta.url)) {
  // The README keeps a short table; docs/RESULTS.md holds the full bullets. Claims may appear in either.
  const readme = readFileSync(path, 'utf8') + readFileSync(here('docs/RESULTS.md'), 'utf8');
  const missing = readmeClaims.filter(claim => !readme.includes(claim));
  if (missing.length) throw Error(`README.md is stale against reports/*.json. Update it to say:\n${missing.map(claim => `  ${claim}`).join('\n')}`);
  if (b.tested) throw Error('reports/board.json says the board was tested; replace the README "has not run on a board" text with the recorded run.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  checkReadme();
  checkResearch();
  checkRegressionLog();
  checkRegressionLog(here('reports/raw/regression-extended.log'), here('reports/verification-extended.json'));
  console.log(`README.md (${readmeClaims.length} claims), docs/RESEARCH.md (${researchClaims.length}) and reports/raw/regression*.log match reports/*.json`);
}
