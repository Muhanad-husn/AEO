// Cost of the harness itself: node processes fired per tool call, lines a
// session reads before its first action, and lines of tests over lines of
// source for the consumer as configured on this machine.
//
// `measure` and its helpers live in plugin/hooks/harness-cost.mjs (moved there by
// slice 05-harness-cost, #185), so the sensorium's session-start section
// (plugin/hooks/sensorium/50-harness.mjs) can read the same numbers without a
// scripts/ dependency. Re-exported here unchanged so this file's own callers, and
// tests/scripts/score-harness.test.mjs, need no change.
export { measure } from '../../plugin/hooks/harness-cost.mjs';

export function line(snapshot) {
  const harness = snapshot.harness;
  if (!harness) return snapshot.record ? 'harness: no checkout' : 'harness: not measured';
  const { processes, sessionStartLines, tests } = harness;
  const testsPart = tests === null
    ? 'tests: no manifest'
    : `tests ${(tests.sourceLines === 0 ? 0 : tests.testLines / tests.sourceLines).toFixed(2)} of source (${tests.testLines} / ${tests.sourceLines})`;
  return [
    `harness: bash ${processes.bash} node, grep ${processes.grep}, read ${processes.read}, task ${processes.task}`,
    `session start ${sessionStartLines} lines`,
    testsPart,
  ].join('; ');
}
