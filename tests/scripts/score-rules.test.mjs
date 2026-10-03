// Acceptance tests for the rules block: what each guard rule refused, and which skills
// and references a consumer loaded, inside its window. They read the synthetic
// transcripts under tests/fixtures/score/rules/ through a temporary home directory, so
// nothing here touches a real transcript, git or GitHub. score.mjs runs on a snapshot
// the live reader built from those transcripts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { windowOf } from '../../scripts/score/consumer.mjs';
import { projectSlug } from '../../scripts/score/sources.mjs';
import { block, readRules } from '../../scripts/score/rules.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'scripts', 'score.mjs');
const fixtures = join(root, 'tests', 'fixtures', 'score', 'rules');

const consumerDir = 'RulesConsumer';
const slug = projectSlug(consumerDir);

// A milestone window of 2026-09-28 to 2026-10-01, read at +02:00, closing at
// 2026-10-01T18:00:00Z.
const base = {
  recordedAt: '2026-10-02T12:00:00+02:00',
  consumer: 'example/rules-consumer',
  milestone: {
    title: 'DEC-1',
    createdAt: '2026-09-28T06:00:00Z',
    closedAt: '2026-10-01T18:00:00Z',
    closingCommit: { sha: 'ccc', date: '2026-10-01T20:00:00+02:00' },
  },
  ledger: { present: false, rows: [] },
  pullRequests: [{ number: 12, mergedAt: '2026-09-30T12:00:00Z' }],
  interventions: null,
  harness: {
    processes: { bash: 1, grep: 0, read: 0, task: 0 },
    sessionStartLines: 10,
    tests: { testLines: 0, sourceLines: 0 },
  },
};

// The consumer's project directory holds one session, a resumed copy that repeats one
// of its refusal records, and one subagent session under the session's own directory.
function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'score-rules-'));
  const project = join(home, '.claude', 'projects', slug);
  const subagents = join(project, 'session-1', 'subagents');
  mkdirSync(subagents, { recursive: true });
  cpSync(join(fixtures, 'session.jsonl'), join(project, 'session-1.jsonl'));
  cpSync(join(fixtures, 'session-resumed.jsonl'), join(project, 'session-2.jsonl'));
  cpSync(join(fixtures, 'subagent.jsonl'), join(subagents, 'agent-a1.jsonl'));
  return home;
}

// The live read, then score.mjs replaying what it recorded.
function score(home) {
  const snapshot = { ...base, rules: readRules(slug, windowOf(base), home) };
  const text = JSON.stringify(snapshot, null, 2) + '\n';
  const path = join(mkdtempSync(join(tmpdir(), 'score-rules-snap-')), 'snapshot.json');
  writeFileSync(path, text);
  const stdout = execFileSync(process.execPath, [script, consumerDir, '--milestone', 'DEC-1', '--from', path], {
    encoding: 'utf8',
  });
  return { text, stdout };
}

function rulesBlock(stdout) {
  const lines = stdout.split('\n');
  const start = lines.findIndex((l) => l.startsWith('rules:'));
  assert.notEqual(start, -1, `no rules block in:\n${stdout}`);
  return lines.slice(start).filter((l) => l !== '');
}

const guardLines = [
  '  guard block-merge/api-merge: 0 refused',
  '  guard block-merge/branch-delete: 0 refused',
  '  guard block-merge/forge-merge: 0 refused',
  '  guard block-merge/git-merge: 1 refused',
  '  guard block-merge/pr-merge: 1 refused',
  '  guard block-merge/remote-branch-delete: 0 refused',
  '  guard block-merge/text-fallback: 1 refused',
  '  guard gate/could-not-evaluate: 0 refused',
  '  guard path-guard/harness-config: 1 refused (retired)',
  '  guard redirect-guard/target: 1 refused (retired)',
  '  guard sandbox-guard/seam-unset: 2 refused (retired)',
  '  guard sandbox-guard/unnamed-cd: 0 refused, 1 warned (retired)',
  '  guard sandbox-guard/write-unrestorable: 2 refused',
];

test('score.mjs prints each guard rule id with its refusal count in the window', () => {
  const lines = rulesBlock(score(tempHome()).stdout);
  assert.equal(
    lines[0],
    'rules: 9 refused, 1 warned, 1 unmatched, 3 skill loads, 2 reference loads (3 sessions, 1 subagent)',
  );
  assert.deepEqual(lines.filter((l) => l.startsWith('  guard ')), guardLines);
});

test('refusals in the subagent transcript are counted', () => {
  const lines = rulesBlock(score(tempHome()).stdout);
  // git-merge, pr-merge, the text fallback, the write rules and both fences fire only
  // inside the subagent session.
  assert.ok(lines.includes('  guard block-merge/git-merge: 1 refused'));
  assert.ok(lines.includes('  guard path-guard/harness-config: 1 refused (retired)'));
  assert.ok(lines.includes('  guard sandbox-guard/write-unrestorable: 2 refused'));
});

test('the pre-#214 seam wording counts once per refusal, a resumed copy not again', () => {
  const lines = rulesBlock(score(tempHome()).stdout);
  assert.ok(lines.includes('  guard sandbox-guard/seam-unset: 2 refused (retired)'));
});

// The fixture's one refusal before the window is a retired rule's, and a retired rule is
// printed only when it fired, so its absence is its zero.
test('a refusal outside the window counts as zero', () => {
  const lines = rulesBlock(score(tempHome()).stdout);
  assert.ok(!lines.some((l) => l.startsWith('  guard sandbox-guard/run-names-root:')));
});

test('skill loads and reference reads are counted by name, inside the window only', () => {
  const lines = rulesBlock(score(tempHome()).stdout);
  assert.ok(lines.includes('  skill build: 1'));
  assert.ok(lines.includes('  skill pr: 1'), 'the aeo:pr load after the window closes is not counted');
  assert.ok(lines.includes('  skill sprint-plan: 1'), 'a typed /aeo:sprint-plan is a load');
  assert.ok(lines.includes('  skill status: 0'));
  assert.ok(lines.includes('  reference ci: 1'), 'a read under the installed plugin cache');
  assert.ok(lines.includes('  reference slicing: 1'), 'a read of plugin/references/slicing.md');
  assert.ok(lines.includes('  reference dispatch: 0'));
  assert.ok(!lines.some((l) => l.includes('update-config') || l.includes('notes')));
});

test('two runs are byte-identical', () => {
  const first = score(tempHome());
  const second = score(tempHome());
  assert.equal(first.text, second.text);
  assert.equal(first.stdout, second.stdout);
});

test('a consumer with no transcripts says so, and a snapshot from before the counter prints no block', () => {
  const empty = mkdtempSync(join(tmpdir(), 'score-rules-empty-'));
  mkdirSync(join(empty, '.claude', 'projects'), { recursive: true });
  assert.equal(readRules(slug, windowOf(base), empty), null);
  assert.equal(block({ ...base, rules: null }), 'rules: no transcripts');
  assert.equal(block(base), null);
});
