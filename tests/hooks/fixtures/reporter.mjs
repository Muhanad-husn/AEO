// Test fixture: a non-blocking reporter, behaviour selected by AEO_FIXTURE_MODE.
// See fixtures/gate.mjs for why exit-code behaviour is tested out of process.

import { runReporter } from '../../../plugin/hooks/lib.mjs';

const mode = process.env.AEO_FIXTURE_MODE ?? 'report';

await runReporter({
  name: 'fixture-reporter',
  run: async (payload) => {
    if (mode === 'throw') throw new Error('reporter exploded');
    if (mode === 'silent') return null;
    if (mode === 'floating-rejection') {
      // Outside every stack runReporter can wrap. Without a process-level handler
      // Node exits 1, and the "always exits 0" contract would not hold.
      Promise.reject(new Error('reporter floating rejection'));
      await new Promise((resolve) => setTimeout(resolve, 30));
      return null;
    }
    return `branch=${payload?.cwd ?? 'unknown'}`;
  },
});
