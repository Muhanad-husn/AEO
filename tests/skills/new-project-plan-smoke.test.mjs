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

  test('the exclude list keeps every Markdown file the scaffold itself writes at the root', () => {
    // README.md and CLAUDE.md were the original two. Issue #199 adds four more, and they
    // matter more than the first two did: the move runs before the steps array is
    // walked, so a founder who drafted their own PLAN.md or RULES.md before scaffolding
    // would have it filed under docs/ and then silently replaced by the scaffold's.
    const excludeLower = plan.founderDocs.excludeAtRoot.map((n) => n.toLowerCase());
    const written = plan.steps
      .filter((s) => typeof s.path === 'string' && /^[^/]+\.md$/i.test(s.path))
      .map((s) => s.path.toLowerCase());
    assert.ok(written.length > 0, 'no step writes a Markdown file at the root, so this checks nothing');
    for (const name of written) {
      assert.ok(excludeLower.includes(name), `${name} is written at the root but is not in founderDocs.excludeAtRoot`);
    }
  });

  test('the destination is docs/, the directory stage 0 already creates for tdd-evidence', () => {
    // Not a new directory the founder has to learn — scaffold-plan.json already writes
    // docs/tdd-evidence/.gitkeep in stage 0, so docs/ is not new territory.
    assert.equal(plan.founderDocs.destination, 'docs');
  });
});

// ---------------------------------------------------------------------------
// issue #199 — the oracle answer, and the four files the scaffold writes from it
// ---------------------------------------------------------------------------
//
// The integration test walks the plan with a real answer set and asserts the tree and
// the sensorium's reading of it. This file stays declarative: it asserts only what the
// manifest declares, and that the fixture the other test answers from stays inside that
// declaration.
//
// Why these four files are declared rather than left to the handbook. The sensorium
// reads them from a consuming project's root and prints what it finds: the status table
// under a Status heading is the score (phase 2 decision 3), RULES.md's Kill line is the
// bar (phase 2 decision 4), LEDGER.md's ceiling is where dollars come from (phase 0
// decision 2), and COMMITMENTS.md is the commitment ledger (phase 0 decision 4). A
// scaffold that skips them hands the founder a project whose every session start says
// "none declared".

const ORACLE_FILES = ['RULES.md', 'PLAN.md', 'LEDGER.md', 'COMMITMENTS.md'];

const FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  '../fixtures/new-project/oracle-answers.json',
);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

/** Whether a step applies under an answer set: every `when` key must match. */
function stepApplies(step, answers) {
  if (!step.when) return true;
  return Object.entries(step.when).every(([key, values]) => values.includes(answers[key]));
}

describe('the plan declares the answers new-project asks for (issue #199)', () => {
  const plan = JSON.parse(raw);

  test('two answers are declared: the product oracle, and whether money moves', () => {
    assert.ok(plan.answers, 'scaffold-plan.json declares no answers block');
    assert.deepEqual(
      Object.keys(plan.answers).sort(),
      ['money', 'oracle'],
      'the answers block declares something other than the oracle and money answers',
    );
  });

  test('the oracle answer offers the four values PLAN.md section 2 names', () => {
    assert.deepEqual(
      plan.answers.oracle.values,
      ['key and rubric', 'acceptance suite', 'founder as reader', 'none yet'],
      'the oracle answer does not offer the four values, in that order',
    );
  });

  test('the money answer is yes or no, and a yes carries a ceiling', () => {
    assert.deepEqual(plan.answers.money.values, ['yes', 'no']);
    assert.equal(
      plan.answers.money.ceilingWith,
      'yes',
      'a money answer of yes must name the ceiling LEDGER.md first line carries (phase 0 decision 2)',
    );
  });
});

describe('the four oracle files are declared as stage-0 authored steps (issue #199)', () => {
  const plan = JSON.parse(raw);
  const byPath = new Map(plan.steps.map((s) => [s.path, s]));

  for (const name of ORACLE_FILES) {
    test(`${name} is a stage-0 authored step carrying required markers and no content`, () => {
      const step = byPath.get(name);
      assert.ok(step, `scaffold-plan.json declares no ${name} step`);
      assert.equal(step.stage, 0, `${name} is not a stage-0 step`);
      assert.equal(step.authored, true, `${name} is not authored; its words are the project's`);
      assert.equal(step.content, undefined, `${name} carries content; authored steps never do`);
      assert.ok(
        Array.isArray(step.requires) && step.requires.length > 0,
        `${name} declares no requires markers, so nothing says what the agent has to put in it`,
      );
    });
  }

  test('each marker is the one a reader under plugin/hooks/ actually matches on', () => {
    // Not taste. Each string below is what a sensorium reader matches on, so a marker
    // drifting from it turns a scaffolded project's session start into "none declared"
    // while every other check here still passes.
    assert.ok(byPath.get('RULES.md').requires.includes('**Kill line.**'));
    assert.ok(byPath.get('PLAN.md').requires.includes('## Status'));
    assert.ok(byPath.get('PLAN.md').requires.includes('| Phase | State | Score |'));
    assert.ok(byPath.get('COMMITMENTS.md').requires.includes('| Date | Recommendation | Executed |'));
    assert.ok(byPath.get('LEDGER.md').requires.includes('Ceiling $'));
  });

  test('all four are declared before every product-code step', () => {
    const stage0 = plan.steps.filter((s) => s.stage === 0);
    for (const name of ORACLE_FILES) {
      const at = stage0.findIndex((s) => s.path === name);
      assert.notEqual(at, -1, `${name} is not a stage-0 step`);
      stage0.forEach((step, index) => {
        if (step.role !== 'product') return;
        assert.ok(at < index, `${name} (position ${at}) is declared after ${step.path ?? step.from}`);
      });
    }
  });
});

describe('the when conditions read the declared answers and nothing else (issue #199)', () => {
  const plan = JSON.parse(raw);

  test('LEDGER.md is written only when money moves', () => {
    const ledger = plan.steps.find((s) => s.path === 'LEDGER.md');
    assert.ok(ledger, 'scaffold-plan.json declares no LEDGER.md step');
    assert.deepEqual(
      ledger.when,
      { money: ['yes'] },
      'LEDGER.md is not conditional on a money answer of yes',
    );
  });

  test('every when names a declared answer key and declared values', () => {
    const conditional = plan.steps.filter((s) => s.when);
    assert.ok(conditional.length > 0, 'no step carries a when, so the condition mechanism is unused');
    for (const step of conditional) {
      for (const [key, values] of Object.entries(step.when)) {
        assert.ok(plan.answers?.[key], `step ${step.path} conditions on "${key}", which is not a declared answer`);
        assert.ok(
          Array.isArray(values) && values.length > 0,
          `step ${step.path}'s when.${key} is not a non-empty list`,
        );
        for (const value of values) {
          assert.ok(
            plan.answers[key].values.includes(value),
            `step ${step.path} conditions on ${key}="${value}", which the answer does not offer`,
          );
        }
      }
    }
  });
});

describe('the answer fixture stays inside what the plan declares (issue #199)', () => {
  const plan = JSON.parse(raw);

  test('the fixture declares the two cases the acceptance criterion names', () => {
    assert.deepEqual(
      Object.keys(fixture.cases).sort(),
      ['founder-as-reader-no-money', 'founder-as-reader-with-ceiling'],
    );
  });

  for (const [name, testCase] of Object.entries(fixture.cases)) {
    test(`${name} answers with values the plan offers`, () => {
      for (const [key, value] of Object.entries(testCase.answers)) {
        if (key === 'ceiling') {
          assert.equal(typeof value, 'number', 'a ceiling is a number of dollars');
          continue;
        }
        assert.ok(
          plan.answers?.[key]?.values.includes(value),
          `case ${name} answers ${key}="${value}", which the plan does not offer`,
        );
      }
      if (testCase.answers.money === plan.answers?.money?.ceilingWith) {
        assert.equal(typeof testCase.answers.ceiling, 'number', `case ${name} says money moves but names no ceiling`);
      }
    });

    test(`${name} supplies a body for every authored stage-0 step that applies, and none that does not`, () => {
      // The fixture stands in for the agent. A body missing here would make the
      // integration test skip a file silently; a body for a step the answers exclude
      // would make the when condition look enforced when it is not.
      const expected = plan.steps
        .filter((s) => s.stage === 0 && s.authored && stepApplies(s, testCase.answers))
        .map((s) => s.path)
        .sort();
      assert.deepEqual(Object.keys(testCase.authored).sort(), expected);
    });
  }
});
