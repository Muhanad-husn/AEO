// Slice 02 replaces this file and scripts/score/interventions.mjs together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { line } from '../../scripts/score/interventions.mjs';

test('the interventions stub reports both lines as not measured', () => {
  assert.equal(line({}), 'interventions: not measured\nexecuted: not measured');
});
