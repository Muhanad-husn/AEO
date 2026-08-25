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

// ---------------------------------------------------------------------------
// issue #124 — the founder-documents rule the scaffolder applies before step 3's
// steps array is walked at all
// ---------------------------------------------------------------------------
//
// The integration test (new-project-scaffold.test.mjs) exercises the actual move: it
// seeds a root with founder documents, runs the walk, and checks the resulting tree and
// commit. This file stays in the fast tier the same way the rest of it does — it asserts
// only what the manifest declares, not what a filesystem walk produces.

describe('the founderDocs rule is declared, not left to a filename pattern (issue #124)', () => {
  const plan = JSON.parse(raw);

  test('founderDocs names a destination directory and a non-empty exclude list', () => {
    assert.ok(plan.founderDocs, 'scaffold-plan.json declares no founderDocs rule');
    assert.equal(
      typeof plan.founderDocs.destination === 'string' && plan.founderDocs.destination.length > 0,
      true,
      'founderDocs.destination is missing or empty',
    );
    assert.ok(
      Array.isArray(plan.founderDocs.excludeAtRoot) && plan.founderDocs.excludeAtRoot.length > 0,
      'founderDocs.excludeAtRoot is missing or empty',
    );
  });

  test('the exclude list keeps README.md and CLAUDE.md, the two files step 3 always writes', () => {
    const excludeLower = plan.founderDocs.excludeAtRoot.map((n) => n.toLowerCase());
    assert.ok(excludeLower.includes('readme.md'), 'README.md is not in founderDocs.excludeAtRoot');
    assert.ok(excludeLower.includes('claude.md'), 'CLAUDE.md is not in founderDocs.excludeAtRoot');
  });

  test('the destination is docs/, the directory stage 0 already creates for tdd-evidence', () => {
    // Not a new directory the founder has to learn — scaffold-plan.json already writes
    // docs/tdd-evidence/.gitkeep in stage 0, so docs/ is not new territory.
    assert.equal(plan.founderDocs.destination, 'docs');
  });
});
