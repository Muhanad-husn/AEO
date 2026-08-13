import test from 'node:test';
import assert from 'node:assert/strict';
import { runningTotal } from '../src/total.mjs';

test('sums a list', () => {
  assert.equal(runningTotal([1, 2, 3]), 6);
});

test('ignores non-numeric entries instead of producing NaN', () => {
  assert.equal(runningTotal([1, undefined, 3]), 4);
  assert.equal(runningTotal([1, '2', 3]), 4);
  assert.equal(runningTotal([1, null, 3]), 4);
  assert.equal(runningTotal([1, {}, 3]), 4);
  assert.equal(runningTotal([1, true, 3]), 4);
  assert.equal(runningTotal([1, NaN, 3]), 4);
});

test('returns 0 when no entry is numeric', () => {
  assert.equal(runningTotal(['a', null, undefined, NaN]), 0);
});

test('keeps negative, fractional, and infinite numbers', () => {
  assert.equal(runningTotal([-2, 0.5, 'x']), -1.5);
  assert.equal(runningTotal([1, Infinity]), Infinity);
});

test('rejects non-array input with a clear TypeError', () => {
  const cases = [
    null,
    undefined,
    42,
    'not an array',
    {},
    { length: 2, 0: 1, 1: 2 },
  ];

  for (const value of cases) {
    assert.throws(
      () => runningTotal(value),
      (err) => {
        assert.ok(err instanceof TypeError, `expected TypeError for ${String(value)}`);
        assert.match(err.message, /runningTotal/);
        assert.match(err.message, /values/);
        return true;
      },
      `expected runningTotal(${String(value)}) to throw`
    );
  }
});
