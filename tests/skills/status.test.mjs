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
  for (const key of ['AEO_GH_COMMAND', 'AEO_GH_PREFIX_ARGS', 'AEO_FAKE_GH_MODE', 'AEO_GH_TIMEOUT_MS']) {
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
  test('names the absence and every candidate name looked for, and still renders issues and PRs', () => {
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
