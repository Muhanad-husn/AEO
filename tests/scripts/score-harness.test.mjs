// Slice 03 replaces this file and scripts/score/harness.mjs together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { line } from '../../scripts/score/harness.mjs';

test('the harness stub reports not measured', () => {
  assert.equal(line({}), 'harness: not measured');
});
