import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulate, tryIt, execute, CASES, TRY_VALUE } from './model.mjs';

const traces = JSON.parse(readFileSync(new URL('../../../reports/visual-traces.json', import.meta.url), 'utf8')).traces;

for (const [name, trace] of Object.entries(traces)) {
  test(`model replays the ${name} RTL trace cycle by cycle`, () => {
    const run = simulate(trace.words);
    assert.equal(run.frames.length, trace.frames.length, 'same number of cycles');
    assert.equal(run.retired, trace.retirements, 'same retirements');
    trace.frames.forEach((rtl, i) => {
      const { cycle, stages, stall, flush, a, b } = run.frames[i];
      const { b: rtlB, ...rtlRest } = rtl;
      assert.deepEqual({ cycle, stages, stall, flush, a }, rtlRest, `cycle ${rtl.cycle}`);
      // tests/tb.sv's TRACE line has 14 format specifiers for 15 values, so b prints in decimal and the report reads it as hex.
      assert.ok(rtlB === b || rtlB === parseInt(String(b), 16), `cycle ${rtl.cycle} b: model ${b}, report ${rtlB}`);
    });
  });
}

test('only a load used by the very next instruction stalls', () => {
  for (const [producer, distance] of CASES) {
    const { stalls } = tryIt(producer, distance);
    assert.equal(stalls, producer === 'load' && distance === 1 ? 1 : 0, `${producer} at distance ${distance}`);
  }
});

test('each case forwards from the stage the RTL rules predict', () => {
  const expected = { 1: { alu: 'MEM', load: 'WB' }, 2: { alu: 'WB', load: 'WB' }, 3: { alu: 'bypass', load: 'bypass' } };
  for (const [producer, distance] of CASES) {
    const run = tryIt(producer, distance);
    assert.equal(run.source, expected[distance][producer], `${producer} at distance ${distance}`);
    assert.equal(run.operand, TRY_VALUE, 'consumer reads the produced value');
  }
});

test('every run obeys cycles = retired + stalls + 2*flushes + 3', () => {
  const runs = [...Object.values(traces).map(t => simulate(t.words)), ...CASES.map(c => tryIt(...c))];
  for (const run of runs) assert.equal(run.frames.length, run.retired + run.stalls + 2 * run.flushes + 3);
});

test('a load-use stall and a flush can never fire in the same cycle', () => {
  let seed = 2026;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 200000; i++) {
    const insn = i < 128 ? (random() & ~127) | i : random();
    const ex = execute(insn, random() & ~3, random(), random());
    const hazardPossible = ex.ld && !ex.trap;
    assert.ok(!(hazardPossible && (ex.taken || ex.trap)), `0x${insn.toString(16)}`);
  }
});
