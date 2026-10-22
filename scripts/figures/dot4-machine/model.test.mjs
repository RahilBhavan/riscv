import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dot4, pack, lanesOf, encodeDot4, bitsOf, signed8} from './model.mjs';
import * as lab from '../../visual-lab/models.mjs';

const run = (a, b) => dot4(pack(a), pack(b));

test('lane i is bits [8i+7:8i], read as signed', () => {
  assert.deepEqual(lanesOf(0x80ff017f), [127, 1, -1, -128]);
  assert.deepEqual(lanesOf(pack([-128, -1, 2, 1])), [-128, -1, 2, 1]);
  assert.equal(pack([-128, 0, 0, 0]), 0x00000080);
  assert.equal(pack([0, 0, 0, -1]), 0xff000000);
  assert.throws(() => pack([128, 0, 0, 0]));
});

test('known cases match the visual-lab model', () => {
  const cases = [
    [[-128, -1, 2, 1], [-1, 4, 3, 2], 132],
    [[1, 2, 3, 4], [5, 6, 7, 8], 70],
    [[0, 0, 0, 0], [127, -128, 5, -5], 0],
    [[-7, 9, -11, 13], [3, -3, 3, -3], -120],
  ];
  for (const [a, b, sum] of cases) {
    const r = run(a, b);
    assert.equal(r.sum, sum);
    assert.equal(r.sum, lab.dot4(a, b).sum);
    assert.deepEqual(r.products, lab.dot4(a, b).products);
    assert.equal(r.low + r.high, r.sum);
  }
});

test('extremes: -128 * -128 * 4 = 65536 and the most negative sum', () => {
  const max = run([-128, -128, -128, -128], [-128, -128, -128, -128]);
  assert.equal(max.sum, 65536);
  assert.equal(max.rd, 0x00010000);
  const min = run([-128, -128, -128, -128], [127, 127, 127, 127]);
  assert.equal(min.sum, -65024);
  assert.equal(min.rd, 0xffff0200);
  assert.equal(run([127, 127, 127, 127], [127, 127, 127, 127]).sum, 64516);
});

test('random words agree with the visual-lab model', () => {
  let seed = 7;
  const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
  for (let i = 0; i < 2000; i++) {
    const w1 = next(), w2 = next(), r = dot4(w1, w2);
    assert.equal(r.sum, lab.dot4(lanesOf(w1), lanesOf(w2)).sum);
    assert.equal(lab.dot4(lanesOf(w1), lanesOf(w2)).packedA, w1);
  }
});

test('encoding is custom-0, funct3 0, funct7 0', () => {
  const word = encodeDot4(10, 11, 12);
  assert.equal(word, 0x00c5850b);
  const d = lab.decode(word);
  assert.equal(d.name, 'DOT4');
  assert.deepEqual([d.rd, d.rs1, d.rs2], [10, 11, 12]);
});

test('bit patterns are two\'s complement', () => {
  assert.deepEqual(bitsOf(-1, 8), [1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(bitsOf(-128, 8), [1, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(signed8(0x80), -128);
});
