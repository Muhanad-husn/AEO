// Tests for the `status` skill's render (P6.3, issue #81).
//
//   node --test tests/skills/status.test.mjs
//
// The skill's entry point (plugin/skills/status/scripts/render-status.mjs) is a thin
// CLI wrapper over the shared renderer, plugin/hooks/status-render.mjs, which
// session-status.mjs's SessionStart hook also calls -- "one renderer, two callers"
// (issue #81). This file exercises the skill's own script end to end: a real spawned
// process, real stdout, gh faked out of process through the same AEO_GH_COMMAND /
// AEO_GH_PREFIX_ARGS seam tests/hooks/session-status.test.mjs already uses (see that
// file's header for why gh is faked out of process rather than mocked in it -- the same
// reasoning applies unchanged here).
//
// D20 says skills are prose and prose gets no tests, but this is not prose: it is the
// script the skill runs, and the render is the whole point of P6.3.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const scriptPath = path.join(repoRoot, 'plugin', 'skills', 'status', 'scripts', 'render-status.mjs');
const fakeGhScript = path.join(repoRoot, 'tests', 'hooks', 'fixtures', 'fake-gh.mjs');

// ---------------------------------------------------------------------------
// scratch space
// ---------------------------------------------------------------------------

const scratch = [];
function tempDir(prefix = 'aeo-p63-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function gitRun(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? r.error}`);
  return (r.stdout ?? '').trim();
}

/** A throwaway repo with one real commit, so `resolveWorktree` finds a toplevel. */
function makeRepo() {
  const dir = tempDir();
  gitRun(dir, 'init', '-q', '-b', 'main');
  gitRun(dir, 'config', 'user.name', 'aeo-test');
  gitRun(dir, 'config', 'user.email', 'aeo-test@example.invalid');
  gitRun(dir, 'commit', '-q', '--allow-empty', '-m', 'init commit');
  return dir;
}

// Generous on purpose: the fake gh has to start a second node process, and this test
// suite may be running alongside the rest of the fast/integration tiers on one machine.
// The cases actually about gh being absent do not use this at all.
const GH_ANSWER_TIMEOUT_MS = 60_000;

/** Env with every gh-related seam and CLAUDE_PROJECT_DIR cleared, then overrides applied. */
function buildEnv(overrides = {}) {
  const env = { ...process.env };
  // Blanked rather than deleted (L-03's reasoning, carried from session-status.test.mjs):
  // CLAUDE_PROJECT_DIR outranks the child's own cwd in resolveOperationDir, and every
  // Claude Code session exports it, so leaving it set would resolve these cases against
  // this repository's own checkout instead of the temp repo each case builds.
  env.CLAUDE_PROJECT_DIR = '';
  // CLAUDE_PLUGIN_ROOT is cleared the same way session-status.test.mjs clears it: every
  // Claude Code session exports it, and the Decision Log fallback (issue #132) reads it,
  // so leaving a founder's real plugin install path set here would make the "no plugin
  // root available" cases below depend on which machine ran the suite.
  for (const key of ['AEO_GH_COMMAND', 'AEO_GH_PREFIX_ARGS', 'AEO_FAKE_GH_MODE', 'AEO_GH_TIMEOUT_MS', 'CLAUDE_PLUGIN_ROOT']) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/** Env wired to the fake gh (tests/hooks/fixtures/fake-gh.mjs), plus the given overrides. */
function fakeGhEnv({ mode = 'empty', timeoutMs = GH_ANSWER_TIMEOUT_MS, ...rest } = {}) {
  return buildEnv({
    AEO_GH_COMMAND: process.execPath,
    AEO_GH_PREFIX_ARGS: JSON.stringify([fakeGhScript]),
    AEO_FAKE_GH_MODE: mode,
    AEO_GH_TIMEOUT_MS: timeoutMs !== undefined ? String(timeoutMs) : undefined,
    ...rest,
  });
}

function runScript({ cwd, env } = {}) {
  const r = spawnSync(process.execPath, [scriptPath], { cwd, encoding: 'utf8', env: env ?? buildEnv() });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function writeDecisionLog(repo, relPath, body) {
  const abs = path.join(repo, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

/** A scratch plugin root holding only DECISIONS.md (or nothing, if body is omitted). */
function makePluginRoot(decisionsBody) {
  const root = tempDir('aeo-p132-plugin-');
  if (decisionsBody !== undefined) writeFileSync(path.join(root, 'DECISIONS.md'), decisionsBody);
  return root;
}

/**
 * A `plans/<feature>/` directory the way tdd-plan writes one: a README.md carrying the
 * feature-level `**Status:**` field, and one `NN-<slug>.md` per slice named. Slice body
 * content is irrelevant to the renderer -- only the file's existence and name matter.
 */
function writePlanChain(repo, feature, { slices = [], status = 'in-progress' } = {}) {
  const dir = path.join(repo, 'plans', feature);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'README.md'),
    [`# Feature: ${feature}`, '', `**Status:** ${status}`, ''].join('\n'),
  );
  for (const slice of slices) {
    writeFileSync(path.join(dir, `${slice}.md`), `# Slice ${slice}\n`);
  }
}

/** `docs/tdd-evidence/<feature>/<slice>/`, the way collect-evidence.mjs creates one. */
function writeEvidenceDir(repo, feature, slice) {
  mkdirSync(path.join(repo, 'docs', 'tdd-evidence', feature, slice), { recursive: true });
}

const FIXTURE_DECISIONS = [
  '# Decisions',
  '',
  '### D5 — GitHub issues are the single source of truth',
  '',
  'Body text nobody should see in the render.',
  '',
  '### D1 — Port the hooks to Python, in a dedicated directory',
  '',
  'More body text nobody should see either.',
  '',
].join('\n');

// ---------------------------------------------------------------------------
// The render against fixture inputs
// ---------------------------------------------------------------------------

describe('render against fixture inputs', () => {
  test('triages issues, shows PR check state, and lists the Decision Log by identifier', () => {
    const repo = makeRepo();
    writeDecisionLog(repo, path.join('docs', 'DECISIONS.md'), FIXTURE_DECISIONS);

    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'status-fixture' }) });
    assert.equal(r.status, 0, r.stderr);

    // Issues, triaged into open / in flight / blocked (fixture: #10 plain, #11
    // assigned, #12 has an open PR against it, #13 blocked by #9).
    assert.match(r.stdout, /\*\*Issues \(4\):\*\*/);
    assert.match(r.stdout, /Open \(1\):/);
    assert.match(r.stdout, /- #10 plain backlog issue {2}\[bug\]/);
    assert.match(r.stdout, /In flight \(2\):/);
    assert.match(r.stdout, /- #11 assigned issue/);
    assert.match(r.stdout, /- #12 issue with an open pr against it/);
    assert.match(r.stdout, /Blocked \(1\):/);
    assert.match(r.stdout, /- #13 blocked issue {2}\(blocked by #9\)/);

    // Open PRs, with check state folded into the same line (fixture: passing,
    // failing, pending-and-draft, no checks at all).
    assert.match(r.stdout, /\*\*Open PRs \(4\):\*\*/);
    assert.match(r.stdout, /- #20 passing pr {2}\[checks: passing\]/);
    assert.match(r.stdout, /- #21 failing pr {2}\[checks: failing\]/);
    assert.match(r.stdout, /- #22 pending draft pr \(draft\) {2}\[checks: pending\]/);
    assert.match(r.stdout, /- #23 no checks pr {2}\[checks: no checks\]/);

    // The Decision Log: one line per decision, sorted by identifier, no body text.
    assert.match(r.stdout, /\*\*Decision Log\*\* \(`docs\/DECISIONS\.md`, 2\):/);
    assert.match(r.stdout, /- D1 — Port the hooks to Python, in a dedicated directory/);
    assert.match(r.stdout, /- D5 — GitHub issues are the single source of truth/);
    const d1Index = r.stdout.indexOf('- D1 —');
    const d5Index = r.stdout.indexOf('- D5 —');
    assert.ok(d1Index >= 0 && d5Index >= 0);
    assert.ok(d1Index < d5Index, 'D1 sorts before D5 even though the file lists D5 first');
    assert.doesNotMatch(r.stdout, /Body text nobody should see/);
  });

  test('prefers docs/DECISIONS.md over a lower-priority candidate when both exist', () => {
    // Two directory-distinct candidates (not merely a case difference -- NTFS treats
    // `DECISIONS.md` and `decisions.md` in the SAME directory as one file, so a
    // case-only variant would not exercise priority order on this filesystem).
    const repo = makeRepo();
    writeDecisionLog(repo, path.join('docs', 'DECISIONS.md'), '### D5 — GitHub issues are the single source of truth\n\nrationale\n');
    writeDecisionLog(repo, 'decisions.md', '### D2 — Vendor the upstream repo\n\nrationale\n');

    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'empty' }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\*\*Decision Log\*\* \(`docs\/DECISIONS\.md`, 1\):/);
    assert.match(r.stdout, /- D5 — GitHub issues are the single source of truth/);
    assert.doesNotMatch(r.stdout, /D2 — Vendor the upstream repo/);
  });
});

// ---------------------------------------------------------------------------
// The missing-source path (L-08: a missing section must be named, never silent)
// ---------------------------------------------------------------------------

describe('missing Decision Log', () => {
  // Issue #132: a project with no decision log of its own now falls back to the
  // plugin's, resolved from CLAUDE_PLUGIN_ROOT -- so "not found" only survives when
  // NEITHER exists, which is what this case now deliberately pins down (CLAUDE_PLUGIN_ROOT
  // is cleared by buildEnv/fakeGhEnv, so there is nowhere left to fall back to).
  test('names the absence and every candidate name looked for, and still renders issues and PRs, when no plugin root is available either', () => {
    const repo = makeRepo(); // no docs/DECISIONS.md, DECISIONS.md, docs/decisions.md, or decisions.md
    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'status-fixture' }) });
    assert.equal(r.status, 0, r.stderr);

    assert.match(r.stdout, /\*\*Decision Log:\*\* not found\. Looked for /);
    assert.match(r.stdout, /docs\/DECISIONS\.md/);
    assert.match(r.stdout, /DECISIONS\.md/);
    assert.match(r.stdout, /docs\/decisions\.md/);
    assert.match(r.stdout, /decisions\.md/);

    // A missing source omits only its own section (L-08) -- the rest of the report
    // still renders in full.
    assert.match(r.stdout, /\*\*Issues \(4\):\*\*/);
    assert.match(r.stdout, /\*\*Open PRs \(4\):\*\*/);
  });

  test('when CLAUDE_PLUGIN_ROOT is set but has no DECISIONS.md either, "not found" names that it looked there too', () => {
    const repo = makeRepo();
    const pluginRoot = makePluginRoot(); // plugin root with no DECISIONS.md at all
    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'empty', CLAUDE_PLUGIN_ROOT: pluginRoot }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\*\*Decision Log:\*\* not found\. Looked for /);
    assert.match(r.stdout, /the plugin's own DECISIONS\.md/);
  });

  test('a file present under a candidate name with no matching heading is reported distinctly from "not found"', () => {
    const repo = makeRepo();
    writeDecisionLog(repo, path.join('docs', 'DECISIONS.md'), '# Decisions\n\nNothing here matches the heading pattern yet.\n');

    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'empty' }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\*\*Decision Log\*\* \(`docs\/DECISIONS\.md`\): present, but no/);
    assert.doesNotMatch(r.stdout, /not found/);
  });
});

// ---------------------------------------------------------------------------
// Decision Log fallback to the plugin's own log (issue #132, Part A). A consuming
// project inherits this plugin's DECISIONS.md; it does not keep a copy of its own
// unless it chooses to. Reporting "not found" against four paths that were never going
// to exist in that project reads as a defect in their repo and is not one.
// ---------------------------------------------------------------------------

describe('Decision Log falls back to the plugin\'s own log (issue #132)', () => {
  test('a project with no decision log of its own shows the plugin\'s, named as a fallback rather than the project\'s own', () => {
    const repo = makeRepo();
    const pluginRoot = makePluginRoot('### D9 — Some plugin decision\n\nbody\n');
    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'empty', CLAUDE_PLUGIN_ROOT: pluginRoot }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /this project keeps none of its own/);
    assert.match(r.stdout, /- D9 — Some plugin decision/);
    assert.doesNotMatch(r.stdout, /not found/);
  });

  test('an empty plugin Decision Log (present but no heading matched) is reported distinctly, still as a fallback', () => {
    const repo = makeRepo();
    const pluginRoot = makePluginRoot('# Decisions\n\nNothing here matches the heading pattern yet.\n');
    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'empty', CLAUDE_PLUGIN_ROOT: pluginRoot }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /this project keeps none of its own.*present, but no/);
    assert.doesNotMatch(r.stdout, /not found/);
  });

  test('a project\'s own decision log wins over the plugin\'s even when both exist', () => {
    const repo = makeRepo();
    writeDecisionLog(repo, path.join('docs', 'DECISIONS.md'), FIXTURE_DECISIONS);
    const pluginRoot = makePluginRoot('### D9 — Some plugin decision\n\nbody\n');
    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'empty', CLAUDE_PLUGIN_ROOT: pluginRoot }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\*\*Decision Log\*\* \(`docs\/DECISIONS\.md`, 2\):/);
    assert.doesNotMatch(r.stdout, /D9 — Some plugin decision/);
    assert.doesNotMatch(r.stdout, /keeps none of its own/);
  });

  test('this repository\'s own docs/DECISIONS.md still resolves unchanged when run from this checkout', () => {
    // The plugin's real DECISIONS.md lives inside THIS repo too (plugin/DECISIONS.md),
    // so this pins down that the project's own candidate always wins first -- the fix
    // must not make this repository's status render regress to the plugin's copy.
    const realRepoRoot = path.resolve(import.meta.dirname, '../..');
    const realPluginRoot = path.join(realRepoRoot, 'plugin');
    const r = runScript({ cwd: realRepoRoot, env: fakeGhEnv({ mode: 'empty', CLAUDE_PLUGIN_ROOT: realPluginRoot }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\*\*Decision Log\*\* \(`docs\/DECISIONS\.md`/);
  });
});

// ---------------------------------------------------------------------------
// Not inside a git worktree
// ---------------------------------------------------------------------------

describe('outside a git worktree', () => {
  test('says so plainly rather than crashing or printing a stale answer', () => {
    const notARepo = tempDir('aeo-p63-not-a-repo-');
    const r = runScript({ cwd: notARepo, env: fakeGhEnv({ mode: 'status-fixture' }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\*\*Status:\*\* not inside a git worktree; nothing to render\./);
  });
});

// ---------------------------------------------------------------------------
// Unknown is never reported as a confident zero (L-08), same discipline as
// session-status.mjs's own suite
// ---------------------------------------------------------------------------

describe('unknown versus zero', () => {
  test('a missing gh reads Issues and Open PRs as unknown, never as empty', () => {
    const repo = makeRepo();
    const env = buildEnv({ AEO_GH_COMMAND: 'aeo-gh-that-does-not-exist' });
    const r = runScript({ cwd: repo, env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\*\*Issues:\*\* unknown \(gh is not installed/);
    assert.match(r.stdout, /\*\*Open PRs:\*\* unknown \(gh is not installed/);
    assert.doesNotMatch(r.stdout, /Issues \(0\)/);
    assert.doesNotMatch(r.stdout, /none open/);
  });

  test('an empty gh answer reads as none, not unknown', () => {
    const repo = makeRepo();
    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'empty' }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\*\*Issues:\*\* none open\./);
    assert.match(r.stdout, /\*\*Open PRs:\*\* none\./);
  });
});

// ---------------------------------------------------------------------------
// Slice chains (issue #132, Part B): plans/<feature>/ counted against
// docs/tdd-evidence/<feature>/<slice>/ -- directory presence, nothing read from
// specs/ or PR titles (neither is an AEO contract, see status-render.mjs's header).
// ---------------------------------------------------------------------------

describe('Slice chains', () => {
  test('a repo with no plans/ directory renders no Slice chains section at all -- silence, not a zero', () => {
    const repo = makeRepo();
    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'empty' }) });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /Slice chains/);
  });

  test('a fully-built, closed chain reports N\\/N built and chain closed', () => {
    const repo = makeRepo();
    writePlanChain(repo, 'stage-a1-parse', { slices: ['01-tokenize', '02-normalize'], status: 'done' });
    writeEvidenceDir(repo, 'stage-a1-parse', '01-tokenize');
    writeEvidenceDir(repo, 'stage-a1-parse', '02-normalize');

    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'empty' }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\*\*Slice chains \(1\):\*\*/);
    assert.match(r.stdout, /- stage-a1-parse\s+2\/2 built, chain closed/);
    assert.match(r.stdout, /No chain has unbuilt slices\./);
  });

  test('a partially-built chain names the lowest-numbered unbuilt slice and does not claim it is closed', () => {
    const repo = makeRepo();
    writePlanChain(repo, 'stage-a3-typegen', {
      slices: ['01-scan', '02-emit', '03-validate'],
      status: 'in-progress',
    });
    writeEvidenceDir(repo, 'stage-a3-typegen', '01-scan');

    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'empty' }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /- stage-a3-typegen\s+1\/3 built, next unbuilt: 02-emit/);
    assert.doesNotMatch(r.stdout, /stage-a3-typegen.*chain closed/);
    assert.doesNotMatch(r.stdout, /No chain has unbuilt slices\./);
  });

  test('the render names evidence-directory presence as a proxy for "built", not proof', () => {
    const repo = makeRepo();
    writePlanChain(repo, 'stage-a1-parse', { slices: ['01-tokenize'], status: 'done' });
    writeEvidenceDir(repo, 'stage-a1-parse', '01-tokenize');

    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'empty' }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /proxy for "built"/);
    assert.match(r.stdout, /PR closed unmerged would still count/);
  });

  test('multiple chains render sorted by feature name, each counted independently', () => {
    const repo = makeRepo();
    writePlanChain(repo, 'stage-a2-typing', { slices: ['01-a', '02-b', '03-c', '04-d'], status: 'done' });
    for (const s of ['01-a', '02-b', '03-c', '04-d']) writeEvidenceDir(repo, 'stage-a2-typing', s);
    writePlanChain(repo, 'stage-a1-parse', { slices: ['01-a'], status: 'in-progress' });

    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'empty' }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\*\*Slice chains \(2\):\*\*/);
    const a1Index = r.stdout.indexOf('stage-a1-parse');
    const a2Index = r.stdout.indexOf('stage-a2-typing');
    assert.ok(a1Index >= 0 && a2Index >= 0);
    assert.ok(a1Index < a2Index, 'stage-a1-parse sorts before stage-a2-typing');
    assert.match(r.stdout, /- stage-a2-typing\s+4\/4 built, chain closed/);
    assert.match(r.stdout, /- stage-a1-parse\s+0\/1 built, next unbuilt: 01-a/);
  });

  test('a plan directory with a README but no slice files yet is named as nothing planned yet, not 0\\/0 built', () => {
    const repo = makeRepo();
    writePlanChain(repo, 'stage-a4-empty', { slices: [], status: 'planning' });

    const r = runScript({ cwd: repo, env: fakeGhEnv({ mode: 'empty' }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /- stage-a4-empty\s+0 slices planned yet/);
    assert.doesNotMatch(r.stdout, /0\/0 built/);
  });
});
