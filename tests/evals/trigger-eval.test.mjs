// Tests for evals/trigger-eval.mjs — the P6.4 trigger-accuracy eval.
//
// The harness's judgement comes from a model, so its judgement cannot be unit tested. Its
// mechanics can, and they are the part that decides what number gets published: roster
// loading, verdict parsing, per-skill scoring, the noise-floor aggregation, and the case-file
// validation that stops a set from measuring nothing. Every test below drives those against
// fixtures and hand-written verdict arrays. No subprocess is spawned and no model is called,
// which is why this file sits in the fast tier (D17).
//
// docs/EVIDENCE.md L-10, twice over:
//
//   - "A test without a positive control pins plumbing, not judgment." Every scoring group
//     has both directions — a perfect verdict set proven to score clean, and a set with one
//     planted error proven to show up in exactly the right skill's row and in the wrong-firing
//     list, and nowhere else.
//   - "A judge shown a pre-fill rubber-stamps it." There is a test asserting that the built
//     judge prompt contains neither the expected answer nor the case's rationale, because the
//     day someone passes the case object into the prompt builder instead of the prompt string
//     is the day this whole measurement quietly becomes worthless.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  NONE,
  aggregateRuns,
  buildJudgePrompt,
  formatReport,
  loadRoster,
  parseVerdict,
  readSkillFields,
  scoreRun,
  validateCases,
} from '../../evals/trigger-eval.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// Scratch space
// ---------------------------------------------------------------------------

const scratch = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aeo-p64-trigger-'));
  scratch.push(dir);
  return dir;
}

function writeSkill(root, name, { description, lane = false }) {
  const lines = ['---', `name: ${name}`, `description: ${description}`];
  if (lane) lines.push('disable-model-invocation: true');
  lines.push('---', '', `# ${name}`, '');
  const dir = path.join(root, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), lines.join('\n'), 'utf8');
}

/** A two-candidate, one-lane plugin root. Small on purpose: the roster rule is what is tested. */
function makeFixturePlugin() {
  const root = tempDir();
  writeSkill(root, 'alpha', { description: 'Does the alpha thing.' });
  writeSkill(root, 'beta', { description: 'Does the beta thing.' });
  writeSkill(root, 'gamma-lane', { description: 'An operator lane.', lane: true });
  return root;
}

// A fixture case set over the fixture roster. Two positives per skill, so validateCases is
// satisfied, plus enough near misses to clear its near-miss floor.
const FIXTURE_CASES = [
  { id: 'a1', kind: 'positive', expect: 'alpha', prompt: 'do the first thing', why: 'core first' },
  { id: 'a2', kind: 'positive', expect: 'alpha', prompt: 'the first thing again', why: 'second first' },
  { id: 'b1', kind: 'positive', expect: 'beta', prompt: 'do the second thing', why: 'core second' },
  { id: 'b2', kind: 'positive', expect: 'beta', prompt: 'the second thing again', why: 'second second' },
  { id: 'n1', kind: 'near-miss', expect: 'alpha', prompt: 'first-ish, but it reads like the second', why: 'the pair', competes: ['beta'] },
  { id: 'n2', kind: 'near-miss', expect: NONE, prompt: 'belongs to the lane', why: 'lane poaching', competes: ['alpha', 'beta'] },
  { id: 'n3', kind: 'near-miss', expect: 'beta', prompt: 'second-ish, but it reads like the first', why: 'the pair, other side', competes: ['alpha'] },
  { id: 'c1', kind: 'control-none', expect: NONE, prompt: 'unrelated question', why: 'generosity control' },
];

const PERFECT = ['alpha', 'alpha', 'beta', 'beta', 'alpha', NONE, 'beta', NONE];

// ---------------------------------------------------------------------------
// Frontmatter and roster
// ---------------------------------------------------------------------------

describe('roster loading', () => {
  test('reads name, description and the lane flag out of a frontmatter block', () => {
    const fields = readSkillFields('---\nname: x\ndescription: A thing.\ndisable-model-invocation: true\n---\n\n# x\n');
    assert.equal(fields.name, 'x');
    assert.equal(fields.description, 'A thing.');
    assert.equal(fields['disable-model-invocation'], 'true');
  });

  test('unquotes a double-quoted description, which is how monitor-design ships', () => {
    const fields = readSkillFields('---\nname: x\ndescription: "Use when asked \\"is it still working\\"."\n---\n');
    assert.equal(fields.description, 'Use when asked "is it still working".');
  });

  test('splits candidates from operator lanes, alphabetically, from the tree', () => {
    const { candidates, lanes } = loadRoster(makeFixturePlugin());
    assert.deepEqual(candidates.map((s) => s.name), ['alpha', 'beta']);
    assert.deepEqual(lanes.map((s) => s.name), ['gamma-lane']);
  });

  test('a skill whose description does not parse fails the load rather than joining the roster silently', () => {
    const root = makeFixturePlugin();
    writeFileSync(path.join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n', 'utf8');
    assert.throws(() => loadRoster(root), /no description field parsed/);
  });

  test('the shipped tree is read, not assumed: every candidate carries a real description', () => {
    const { candidates, lanes } = loadRoster(path.join(repoRoot, 'plugin'));
    assert.ok(candidates.length > 0, 'the shipped plugin has description-triggered skills');
    for (const s of [...candidates, ...lanes]) {
      assert.ok(s.description.length > 40, `${s.name} description is suspiciously short`);
    }
    for (const s of candidates) {
      assert.ok(!lanes.some((l) => l.name === s.name), `${s.name} is in both halves of the split`);
    }
  });
});

// ---------------------------------------------------------------------------
// The judge prompt — the pre-fill control
// ---------------------------------------------------------------------------

describe('judge prompt', () => {
  test('carries every roster description verbatim and the user message', () => {
    const roster = [{ name: 'alpha', description: 'Does the alpha thing.' }];
    const built = buildJudgePrompt(roster, 'do alpha');
    assert.match(built, /Does the alpha thing\./);
    assert.match(built, /do alpha/);
  });

  test('L-10 pre-fill control: the built prompt leaks no expectation, kind or rationale', () => {
    const roster = [
      { name: 'alpha', description: 'Does the alpha thing.' },
      { name: 'beta', description: 'Does the beta thing.' },
    ];
    for (const c of FIXTURE_CASES) {
      const built = buildJudgePrompt(roster, c.prompt);
      assert.ok(!built.includes(c.why), `${c.id}: rationale reached the judge`);
      assert.ok(!built.includes(c.kind), `${c.id}: case kind reached the judge`);
      if (c.expect !== NONE) {
        // The expected skill name legitimately appears in the roster, so the check is that it
        // appears nowhere outside it.
        const afterRoster = built.slice(built.indexOf('</roster>'));
        assert.ok(!afterRoster.includes(c.expect), `${c.id}: expected answer reached the judge`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Verdict parsing
// ---------------------------------------------------------------------------

describe('parseVerdict', () => {
  const names = ['alpha', 'beta'];

  test('reads a bare name, whatever the decoration', () => {
    assert.equal(parseVerdict('alpha', names), 'alpha');
    assert.equal(parseVerdict('  alpha  \n', names), 'alpha');
    assert.equal(parseVerdict('`alpha`', names), 'alpha');
    assert.equal(parseVerdict('Alpha.', names), 'alpha');
  });

  test('reads NONE in any casing', () => {
    assert.equal(parseVerdict('NONE', names), NONE);
    assert.equal(parseVerdict('none\n', names), NONE);
  });

  test('takes the last non-empty line when the judge preambles anyway', () => {
    assert.equal(parseVerdict('Thinking about it.\n\nbeta\n', names), 'beta');
  });

  test('an answer naming nothing in the roster is unreadable, not NONE', () => {
    assert.equal(parseVerdict('sprint-start', names), null);
    assert.equal(parseVerdict('', names), null);
    assert.equal(parseVerdict(undefined, names), null);
    assert.equal(parseVerdict('I would use alpha or beta', names), null);
  });
});

// ---------------------------------------------------------------------------
// Scoring — each group with a clean control and a single planted error
// ---------------------------------------------------------------------------

describe('scoreRun', () => {
  test('positive control: a perfect verdict set scores clean and lists nothing', () => {
    const r = scoreRun(FIXTURE_CASES, PERFECT);
    assert.equal(r.overall.correct, 8);
    assert.equal(r.overall.accuracy, 1);
    assert.equal(r.perSkill.alpha.recall, 1);
    assert.equal(r.perSkill.beta.recall, 1);
    assert.equal(r.perSkill.alpha.falseFires, 0);
    assert.equal(r.perSkill.beta.falseFires, 0);
    assert.equal(r.perSkill.alpha.precision, 1);
    assert.deepEqual(r.wrongFirings, []);
    assert.deepEqual(r.misses, []);
    assert.deepEqual(r.unparseable, []);
    assert.equal(r.none.accuracy, 1);
  });

  test('one planted competition error lands in both skills\' rows and nowhere else', () => {
    // n1 should select alpha; beta takes it instead.
    const verdicts = [...PERFECT];
    verdicts[4] = 'beta';
    const r = scoreRun(FIXTURE_CASES, verdicts);

    assert.equal(r.perSkill.alpha.shouldFire, 3);
    assert.equal(r.perSkill.alpha.caught, 2);
    assert.equal(r.perSkill.alpha.recall, round(2 / 3));
    assert.equal(r.perSkill.alpha.falseFires, 0, 'alpha did not fire anywhere it should not');

    assert.equal(r.perSkill.beta.recall, 1, 'beta still caught everything of its own');
    assert.equal(r.perSkill.beta.falseFires, 1);
    assert.equal(r.perSkill.beta.precision, round(3 / 4));

    assert.equal(r.wrongFirings.length, 1);
    assert.deepEqual(
      { id: r.wrongFirings[0].id, fired: r.wrongFirings[0].fired, expected: r.wrongFirings[0].expected },
      { id: 'n1', fired: 'beta', expected: 'alpha' },
    );
    assert.deepEqual(r.misses.map((m) => m.id), ['n1']);
    assert.equal(r.overall.correct, 7);
  });

  test('firing on a case that should have selected nothing is a wrong firing but not a miss', () => {
    const verdicts = [...PERFECT];
    verdicts[5] = 'alpha'; // n2 belongs to the lane
    const r = scoreRun(FIXTURE_CASES, verdicts);
    assert.deepEqual(r.wrongFirings.map((w) => `${w.fired}:${w.id}`), ['alpha:n2']);
    assert.deepEqual(r.misses, [], 'no skill was owed this case');
    assert.equal(r.perSkill.alpha.falseFires, 1);
    assert.equal(r.perSkill.alpha.recall, 1, 'recall is untouched by a false fire');
    assert.equal(r.none.correct, 1);
    assert.equal(r.none.total, 2);
  });

  test('staying silent where a skill was owed the case is a miss but not a wrong firing', () => {
    const verdicts = [...PERFECT];
    verdicts[0] = NONE;
    const r = scoreRun(FIXTURE_CASES, verdicts);
    assert.deepEqual(r.misses.map((m) => m.id), ['a1']);
    assert.deepEqual(r.wrongFirings, []);
    assert.equal(r.perSkill.alpha.recall, round(2 / 3));
  });

  test('an unreadable answer is counted as its own failure, never folded into NONE', () => {
    const verdicts = [...PERFECT];
    verdicts[7] = null; // c1 expected NONE
    const r = scoreRun(FIXTURE_CASES, verdicts);
    assert.deepEqual(r.unparseable, ['c1']);
    assert.equal(r.none.correct, 1, 'the unreadable answer did not score as a correct NONE');
    assert.equal(r.overall.correct, 7);
    assert.deepEqual(r.wrongFirings, []);
  });

  test('a length mismatch between cases and verdicts throws rather than scoring a shifted set', () => {
    assert.throws(() => scoreRun(FIXTURE_CASES, PERFECT.slice(1)), /8 cases but 7 verdicts/);
  });
});

// ---------------------------------------------------------------------------
// Noise floor
// ---------------------------------------------------------------------------

describe('aggregateRuns', () => {
  test('identical repeats report a zero floor and no flips', () => {
    const agg = aggregateRuns(FIXTURE_CASES, [PERFECT, [...PERFECT], [...PERFECT]]);
    assert.equal(agg.repeats, 3);
    assert.equal(agg.overall.spread, 0);
    assert.equal(agg.overall.stdev, 0);
    assert.equal(agg.stability.flipped, 0);
    assert.equal(agg.stability.flipRate, 0);
    assert.equal(agg.perSkill.alpha.recall.spread, 0);
    assert.deepEqual(agg.wrongFirings, []);
  });

  test('a floor is reported per skill, not only overall', () => {
    const runA = [...PERFECT];
    const runB = [...PERFECT];
    runB[4] = 'beta'; // only alpha's recall moves
    const agg = aggregateRuns(FIXTURE_CASES, [runA, runB]);
    assert.equal(agg.perSkill.alpha.recall.spread, round(1 - 2 / 3));
    assert.equal(agg.perSkill.beta.recall.spread, 0, 'beta recall is flat');
    assert.equal(agg.perSkill.beta.falseFire.spread, 1, 'beta false fires moved by one');
    assert.ok(agg.overall.spread > 0);
  });

  test('a case that re-rolled is listed by name with the verdicts it took', () => {
    const runA = [...PERFECT];
    const runB = [...PERFECT];
    runB[4] = 'beta';
    const agg = aggregateRuns(FIXTURE_CASES, [runA, runB]);
    assert.equal(agg.stability.flipped, 1);
    assert.equal(agg.stability.cases, 8);
    assert.equal(agg.stability.flipRate, round(1 / 8));
    assert.deepEqual(agg.stability.flippedCases, [{ id: 'n1', expect: 'alpha', verdicts: ['alpha', 'beta'] }]);
  });

  test('a wrong firing carries how many repeats it survived, so a one-off is not read as a defect', () => {
    const stable = [...PERFECT]; stable[5] = 'alpha';
    const once = [...PERFECT]; once[4] = 'beta';
    const agg = aggregateRuns(FIXTURE_CASES, [stable, [...stable], once]);
    const rows = agg.wrongFirings.map((w) => `${w.fired}:${w.id}:${w.count}`);
    assert.deepEqual(rows, ['alpha:n2:2', 'beta:n1:1']);
  });

  test('a description that is merely too narrow shows up in the miss union, not the firing union', () => {
    const quiet = [...PERFECT];
    quiet[4] = NONE; // alpha was owed n1 and said nothing
    const agg = aggregateRuns(FIXTURE_CASES, [quiet, [...quiet], PERFECT]);
    assert.deepEqual(agg.wrongFirings, []);
    assert.deepEqual(agg.misses.map((m) => `${m.expected}:${m.id}:${m.count}`), ['alpha:n1:2']);
  });

  test('the aggregate keeps each run scored separately, so a total can never hide a run', () => {
    const agg = aggregateRuns(FIXTURE_CASES, [PERFECT, [...PERFECT]]);
    assert.equal(agg.perRun.length, 2);
    assert.equal(agg.perRun[0].overall.total, 8);
  });

  test('no runs at all throws rather than reporting an empty floor', () => {
    assert.throws(() => aggregateRuns(FIXTURE_CASES, []), /no runs/);
  });
});

// ---------------------------------------------------------------------------
// Case-file validation
// ---------------------------------------------------------------------------

describe('validateCases', () => {
  const roster = [{ name: 'alpha', description: 'a' }, { name: 'beta', description: 'b' }];

  test('positive control: the fixture set passes clean', () => {
    assert.deepEqual(validateCases({ cases: FIXTURE_CASES }, roster), []);
  });

  test('a case expecting a skill the tree does not ship is rejected', () => {
    const bad = [...FIXTURE_CASES, { id: 'x', kind: 'positive', expect: 'delta', prompt: 'p', why: 'w' }];
    const problems = validateCases({ cases: bad }, roster);
    assert.ok(problems.some((p) => p.includes('delta')), problems.join('; '));
  });

  test('a duplicate id is rejected, because two cases under one name cannot both be read', () => {
    const bad = [...FIXTURE_CASES, { ...FIXTURE_CASES[0] }];
    assert.ok(validateCases({ cases: bad }, roster).some((p) => p.includes('duplicate id')));
  });

  test('a skill with fewer than two should-fire cases is rejected', () => {
    const thin = FIXTURE_CASES.filter((c) => c.id !== 'b2' && c.id !== 'n3');
    assert.ok(validateCases({ cases: thin }, roster).some((p) => p.startsWith('beta: only 1')));
  });

  test('a set of mostly obvious positives is rejected', () => {
    const soft = [
      { id: 'a1', kind: 'positive', expect: 'alpha', prompt: 'p', why: 'w' },
      { id: 'a2', kind: 'positive', expect: 'alpha', prompt: 'p', why: 'w' },
      { id: 'b1', kind: 'positive', expect: 'beta', prompt: 'p', why: 'w' },
      { id: 'b2', kind: 'positive', expect: 'beta', prompt: 'p', why: 'w' },
    ];
    assert.ok(validateCases({ cases: soft }, roster).some((p) => p.includes('near misses')));
  });

  test('a case with no authoring rationale is rejected', () => {
    const bad = FIXTURE_CASES.map((c) => (c.id === 'a1' ? { ...c, why: '' } : c));
    assert.ok(validateCases({ cases: bad }, roster).some((p) => p === 'a1: no authoring rationale'));
  });

  test('the shipped case file validates against the shipped roster', () => {
    const { candidates } = loadRoster(path.join(repoRoot, 'plugin'));
    const caseFile = JSON.parse(readFileSync(path.join(repoRoot, 'evals', 'trigger-cases.json'), 'utf8'));
    assert.deepEqual(validateCases(caseFile, candidates), []);
  });

  test('a near miss that names no neighbour is rejected as a positive in disguise', () => {
    const bad = FIXTURE_CASES.map((c) => (c.id === 'n1' ? { ...c, competes: [] } : c));
    assert.ok(validateCases({ cases: bad }, roster).some((p) => p.startsWith('n1: a near miss must name')));
  });

  test('a near miss naming its own expected skill as the competitor is rejected', () => {
    const bad = FIXTURE_CASES.map((c) => (c.id === 'n1' ? { ...c, competes: ['alpha'] } : c));
    assert.ok(validateCases({ cases: bad }, roster).some((p) => p.includes('names its own expected answer')));
  });

  test('a skill under no competitive pressure anywhere is rejected', () => {
    const soft = FIXTURE_CASES.map((c) => (c.kind === 'near-miss' ? { ...c, competes: ['alpha'], expect: 'alpha' } : c));
    assert.ok(validateCases({ cases: soft }, roster).some((p) => p.startsWith('beta: no near-miss case')));
  });

  test('every shipped candidate is exercised under competition by the shipped case set', () => {
    const caseFile = JSON.parse(readFileSync(path.join(repoRoot, 'evals', 'trigger-cases.json'), 'utf8'));
    const { candidates } = loadRoster(path.join(repoRoot, 'plugin'));
    const nearMisses = caseFile.cases.filter((c) => c.kind === 'near-miss');
    for (const s of candidates) {
      const involved = nearMisses.filter((c) => c.expect === s.name || (c.competes ?? []).includes(s.name));
      assert.ok(involved.length > 0, `${s.name} appears in no near-miss case`);
    }
  });
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

describe('formatReport', () => {
  test('states the noise floor above any score, and names wrong firings', () => {
    const runA = [...PERFECT];
    const runB = [...PERFECT];
    runB[4] = 'beta';
    const envelope = {
      roster: [{ name: 'alpha' }, { name: 'beta' }],
      model: 'fixture-model',
      repeats: 2,
      aggregate: aggregateRuns(FIXTURE_CASES, [runA, runB]),
    };
    const text = formatReport(envelope);
    assert.ok(text.indexOf('NOISE FLOOR') < text.indexOf('PER SKILL'), 'the floor is printed first');
    assert.match(text, /re-rolled: 1\/8/);
    assert.match(text, /beta on n1 \(1\/2 repeats\) — should have been alpha/);
    assert.match(text, /alpha missed n1 \(1\/2 repeats\), beta took it instead/);
    assert.match(text, /fixture-model/);
  });

  test('says so plainly when nothing fired wrongly', () => {
    const envelope = {
      roster: [{ name: 'alpha' }, { name: 'beta' }],
      model: 'fixture-model',
      repeats: 2,
      aggregate: aggregateRuns(FIXTURE_CASES, [PERFECT, [...PERFECT]]),
    };
    assert.match(formatReport(envelope), /FIRED WHERE IT SHOULD NOT[\s\S]*none/);
  });
});

function round(n) {
  return Number(n.toFixed(4));
}
