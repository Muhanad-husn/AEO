// A fast-tier smoke check over the scaffolder's shipped manifest (issue #96).
//
//   node --test tests/skills/new-project-plan-smoke.test.mjs
//
// The scaffolder's real test is tests/skills/new-project-scaffold.test.mjs, which writes
// the tree, runs git and spawns the emitted suite. That cost is why it lives in the
// integration tier, and D26 says it stays there. The consequence D26 also records is that
// a commit which breaks the scaffolder still passes the fast tier, which is the only tier
// that ran locally before every commit to this repo (D26, amended by D30). This file
// narrows that window at a price the fast tier can afford: it reads one data file and
// asserts nothing that needs a process.
//
// Two properties, both named by issue #96. That scaffold-plan.json parses at all, because
// a manifest that does not parse takes every scaffold down with it and takes SKILL.md's
// step 3 with it. And that the declared step order still puts logs/ ahead of every
// product-code step, which is EN-14's requirement and the one ordering property the
// manifest exists to hold.
//
// The division of labour with the integration test is deliberate. That file asserts what
// the walk emits — the filesystem at each product write, the committed tree, the resolved
// test command. This file asserts only what the manifest declares. Repeating the emission
// checks here would buy the same signal for the cost that put them in the other tier.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const PLAN_PATH = path.resolve(
  import.meta.dirname,
  '../../plugin/skills/new-project/assets/scaffold-plan.json',
);

/** The directory whose presence EN-14 is about. */
const OBSERVABILITY_DIR = 'logs';

const raw = readFileSync(PLAN_PATH, 'utf8');

describe('the shipped scaffold plan parses', () => {
  test('scaffold-plan.json is valid JSON with a steps array', () => {
    let plan;
    try {
      plan = JSON.parse(raw);
    } catch (err) {
      assert.fail(
        `plugin/skills/new-project/assets/scaffold-plan.json does not parse (${err.message}). ` +
          'SKILL.md tells the agent to walk this file, so a scaffold cannot start without it.',
      );
    }
    assert.ok(
      Array.isArray(plan.steps) && plan.steps.length > 0,
      'scaffold-plan.json parsed but declares no steps, so the scaffolder would emit nothing.',
    );
  });
});

describe('the declared step order puts logs/ before every product-code step (EN-14)', () => {
  const plan = JSON.parse(raw);
  const stage0 = plan.steps.filter((s) => s.stage === 0);

  test('stage 0 declares both an observability step and product code', () => {
    // Without both, the ordering assertion below would pass by finding nothing to compare,
    // which is the zero-that-means-not-measured failure L-08 keeps naming.
    assert.ok(
      stage0.some((s) => (s.path ?? '').startsWith(`${OBSERVABILITY_DIR}/`)),
      `no stage-0 step writes under ${OBSERVABILITY_DIR}/`,
    );
    assert.ok(
      stage0.some((s) => s.role === 'product'),
      'stage 0 declares no product-code steps',
    );
  });

  test('the observability step comes first in array order', () => {
    const logsIndex = stage0.findIndex((s) => (s.path ?? '').startsWith(`${OBSERVABILITY_DIR}/`));
    stage0.forEach((step, index) => {
      if (step.role !== 'product') return;
      assert.ok(
        logsIndex < index,
        `${step.path ?? `from=${step.from}`} (product code, position ${index}) is declared ` +
          `before ${OBSERVABILITY_DIR}/ (position ${logsIndex}). SKILL.md walks this array in ` +
          'order, so EN-14 is violated by the order itself.',
      );
    });
  });
});
