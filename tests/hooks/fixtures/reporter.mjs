// Test fixture: a non-blocking reporter, behaviour selected by AEO_FIXTURE_MODE.
// See fixtures/gate.mjs for why exit-code behaviour is tested out of process.

import { runReporter } from '../../../plugin/hooks/lib.mjs';

const mode = process.env.AEO_FIXTURE_MODE ?? 'report';

await runReporter({
  name: 'fixture-reporter',
  run: (payload) => {
    if (mode === 'throw') throw new Error('reporter exploded');
    if (mode === 'silent') return null;
    return `branch=${payload?.cwd ?? 'unknown'}`;
  },
});
