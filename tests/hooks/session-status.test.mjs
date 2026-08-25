// Tests for plugin/hooks/session-status.mjs (P1.7).
//
// Run from the repo root: node --test  (or node --test "tests/hooks/*.test.mjs";
// see lib.test.mjs's header for why not `node --test tests/hooks/`).
//
// The hook's one stated must-not is "block anything" (PLAN.md), so every scenario
// below asserts the real exit code out of a spawned process -- "never blocks" is an
// exit-code claim, and runReporter's in-library guarantee is not a substitute for
// testing this hook's own script, which has its own top-level await and its own gh
// subprocess calls outside anything runReporter wraps.
//
// gh is faked through session-status.mjs's AEO_GH_COMMAND / AEO_GH_PREFIX_ARGS seam
// (see that file's comment on it) rather than by relying on a real `gh` install --
// tests must not depend on this machine's GitHub auth state, and must not be slow or
// flaky because the real CLI hung or rate-limited.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const scriptPath = path.join(repoRoot, 'plugin', 'hooks', 'session-status.mjs');
const realPluginRoot = path.join(repoRoot, 'plugin');
const fakeGhScript = path.join(import.meta.dirname, 'fixtures', 'fake-gh.mjs');

// ---------------------------------------------------------------------------
// scratch space
// ---------------------------------------------------------------------------

const scratch = [];
function tempDir(prefix = 'aeo-p17-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** Where a hook child runs when a case does not name a directory of its own. */
const NEUTRAL_CWD = tempDir('aeo-p17-nowhere-');

function gitRun(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? r.error}`);
  return (r.stdout ?? '').trim();
}

/** A throwaway repo with one real commit, so branch and HEAD resolve. */
function makeRepo() {
  const dir = tempDir();
  gitRun(dir, 'init', '-q', '-b', 'feat/example');
  gitRun(dir, 'config', 'user.name', 'aeo-test');
  gitRun(dir, 'config', 'user.email', 'aeo-test@example.invalid');
  gitRun(dir, 'commit', '-q', '--allow-empty', '-m', 'init commit');
  return dir;
}

/**
 * A scratch plugin root with hooks.json plus a stub for every script it references, so
 * preflight() reports ok regardless of whether sibling Phase 1 slices (P1.2/P1.3/P1.6)
 * have merged into this worktree yet -- their gate scripts do not exist here, and
 * simulating a fully-wired install is how the banner-absent path is tested without
 * waiting on that merge.
 */
function makePassingPluginRoot() {
  return makePluginRoot(readFileSync(path.join(realPluginRoot, 'hooks', 'hooks.json'), 'utf8'));
}

/** The same, from a hooks.json of the caller's own. Every script it names is stubbed. */
function makePluginRoot(raw) {
  const root = tempDir('aeo-p17-plugin-');
  const hooksDir = path.join(root, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(path.join(hooksDir, 'hooks.json'), raw);
  for (const m of raw.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}([^\s"']*\.mjs)/g)) {
    const abs = path.join(root, m[1].replace(/^[/\\]/, ''));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, '// stub\n');
  }
  return root;
}

/** Env with CLAUDE_PLUGIN_ROOT and every gh-related seam removed, then overrides applied. */
function buildEnv(overrides = {}) {
  const env = { ...process.env };
  // AEO_LIVE_DATA_ROOT and AEO_DATA_ROOT are cleared for the same reason as the gh
  // seams: the D18 report reads them, and a test whose expected output depends on
  // whether the founder's shell happens to export one is not a test.
  // CLAUDE_PROJECT_DIR is blanked rather than deleted, for the reason L-03 names. It
  // OUTRANKS the child's own cwd in resolveOperationDir, so on a machine where a
  // session exports it -- every Claude Code session does -- the two payload-less cases
  // below resolved to the founder's checkout instead of the temp repo they set up, and
  // this hook then read that checkout's real logs/<job>/summary.md.
  env.CLAUDE_PROJECT_DIR = '';
  for (const key of [
    'CLAUDE_PLUGIN_ROOT',
    'AEO_GH_COMMAND',
    'AEO_GH_PREFIX_ARGS',
    'AEO_FAKE_GH_MODE',
    'AEO_GH_TIMEOUT_MS',
    'AEO_LIVE_DATA_ROOT',
    'AEO_DATA_ROOT',
  ]) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

// The second latent flake in this battery, and the same class as the run-log one: an
// assertion that can be decided by how busy the machine is rather than by the code.
//
// Every case below except the two that test the timeout wants gh to ANSWER, and then
// asserts the answer did not read as `unknown`. The hook's own default budget is 3s,
// which is generous for a fake gh and is not generous for a fake gh that has to start
// a second node process on a machine already running the rest of the suite in
// parallel. A slow start would render `unknown`, the assertion would fail, and the
// failure would say nothing about the hook. So the default here is far above anything
// a spawn can plausibly take. The tests that are ABOUT the timeout pass their own
// small value and are unaffected.
const GH_ANSWER_TIMEOUT_MS = 60_000;

/** Env wired to the fake gh (fixtures/fake-gh.mjs), plus the given overrides. */
function fakeGhEnv({ mode = 'empty', timeoutMs = GH_ANSWER_TIMEOUT_MS, pluginRoot, ...rest } = {}) {
  return buildEnv({
    AEO_GH_COMMAND: process.execPath,
    AEO_GH_PREFIX_ARGS: JSON.stringify([fakeGhScript]),
    AEO_FAKE_GH_MODE: mode,
    AEO_GH_TIMEOUT_MS: timeoutMs !== undefined ? String(timeoutMs) : undefined,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    ...rest,
  });
}

function runHook({ cwd, payload, raw, env } = {}) {
  const input = raw !== undefined ? raw : payload === undefined ? '' : JSON.stringify(payload);
  const r = spawnSync(process.execPath, [scriptPath], {
    input,
    encoding: 'utf8',
    // Never the runner's cwd, which is this repository: an unset `cwd` here is what
    // makes the hook's last-resort resolver reach the tree the suite is running in.
    cwd: cwd ?? NEUTRAL_CWD,
    env: env ?? buildEnv(),
  });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';

  // L-08, one layer up from the hook's own output: the hook always prints something,
  // even outside a git worktree and even with gh unreachable (renderDataRoot() alone
  // survives every early return). So empty stdout here is never a real answer from the
  // hook -- the spawn did not complete, or was killed -- and letting it flow into an
  // assert.match against a content regex turns "the process produced nothing" into a
  // report that reads as "the hook rendered the wrong thing." Fail loudly here, with
  // what actually happened, instead of downstream with what didn't.
  if (stdout === '') {
    const how = r.error
      ? `spawn error: ${r.error.message}`
      : r.signal
        ? `killed by signal ${r.signal}`
        : `exited ${r.status}`;
    throw new Error(
      `session-status.mjs produced no stdout (${how}). This means the process did not run ` +
      `to completion, not that it rendered the wrong log. stderr: ${stderr.trim() || '(none)'}`,
    );
  }

  return { status: r.status, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Never blocks (the hook's one stated must-not)
// ---------------------------------------------------------------------------

describe('never blocks', () => {
  test('exits 0 in a real repo with gh answering normally', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
  });

  test('exits 0 on malformed JSON stdin', () => {
    const repo = makeRepo();
    const r = runHook({ cwd: repo, raw: '{not valid json', env: fakeGhEnv({ pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
  });

  test('exits 0 on empty stdin', () => {
    const repo = makeRepo();
    const r = runHook({ cwd: repo, raw: '', env: fakeGhEnv({ pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
  });

  test('exits 0 when the cwd is not a git worktree at all', () => {
    const notARepo = tempDir('aeo-p17-not-a-repo-');
    const r = runHook({ payload: { cwd: notARepo }, env: fakeGhEnv({ pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
    // No repo state, because there is no repo. Not silence, though: D18's data-root
    // line is a fact about whether the sandbox guard is doing anything, which is true
    // of the session rather than of any repository, so it survives this early return.
    assert.doesNotMatch(r.stdout, /Live repo state/, 'nothing about a repo outside a git worktree');
    assert.doesNotMatch(r.stdout, /\*\*Branch:/);
  });

  test('exits 0 when gh is not installed', () => {
    const repo = makeRepo();
    const env = buildEnv({ AEO_GH_COMMAND: 'aeo-gh-that-does-not-exist', CLAUDE_PLUGIN_ROOT: makePassingPluginRoot() });
    const r = runHook({ payload: { cwd: repo }, env });
    assert.equal(r.status, 0);
  });

  test('exits 0 when gh exits non-zero (e.g. not authenticated)', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'error', pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
  });

  test('exits 0 when gh hangs past its timeout', () => {
    const repo = makeRepo();
    const r = runHook({
      payload: { cwd: repo },
      env: fakeGhEnv({ mode: 'hang', timeoutMs: 200, pluginRoot: makePassingPluginRoot() }),
    });
    assert.equal(r.status, 0);
  });

  test('exits 0 when gh emits unparseable output', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'garbage', pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
  });

  test('exits 0 when gh floods stdout past the output cap', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'huge', pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
  });
});

// ---------------------------------------------------------------------------
// Unknown is never reported as a confident zero
// ---------------------------------------------------------------------------

describe('unknown versus zero', () => {
  test('an empty gh answer reads as none, not unknown', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Open issues:\*\* none\./);
    assert.match(r.stdout, /\*\*Open PRs -- awaiting founder approval:\*\* none\./);
    assert.doesNotMatch(r.stdout, /unknown/);
  });

  test('a populated gh answer lists items, not unknown', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'items', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Open issues \(1\):\*\*/);
    assert.match(r.stdout, /#1 fixture issue {2}\[bug\]/);
    assert.match(r.stdout, /\*\*Open PRs -- awaiting founder approval \(1\):\*\*/);
    assert.match(r.stdout, /#2 fixture open pr \(draft\)/);
    assert.match(r.stdout, /\*\*Last 1 merged PRs \(already shipped\):\*\*/);
    assert.match(r.stdout, /#3 fixture merged pr {2}_\(2026-08-01\)_/);
    assert.doesNotMatch(r.stdout, /unknown/);
  });

  test('a missing gh reads as unknown, never as none', () => {
    const repo = makeRepo();
    const env = buildEnv({ AEO_GH_COMMAND: 'aeo-gh-that-does-not-exist', CLAUDE_PLUGIN_ROOT: makePassingPluginRoot() });
    const r = runHook({ payload: { cwd: repo }, env });
    assert.match(r.stdout, /\*\*Open issues:\*\* unknown \(gh is not installed/);
    assert.doesNotMatch(r.stdout, /Open issues:\*\* none/);
  });

  test('a gh error reads as unknown, never as none', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'error', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Open issues:\*\* unknown \(/);
    assert.doesNotMatch(r.stdout, /Open issues:\*\* none/);
  });

  test('a gh timeout reads as unknown, never as none', () => {
    const repo = makeRepo();
    const r = runHook({
      payload: { cwd: repo },
      env: fakeGhEnv({ mode: 'hang', timeoutMs: 200, pluginRoot: makePassingPluginRoot() }),
    });
    assert.match(r.stdout, /unknown \(gh did not answer within 200ms\)/);
    assert.doesNotMatch(r.stdout, /Open issues:\*\* none/);
  });

  test('unparseable gh output reads as unknown, never as none', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'garbage', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Open issues:\*\* unknown \(gh returned unparseable output/);
  });

  test('oversized gh output is capped, not parsed, and still reads as unknown', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'huge', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Open issues:\*\* unknown \(/);
    assert.ok(r.stdout.length < 10_000, `stdout should stay small even when gh floods; was ${r.stdout.length} bytes`);
  });

  test('a JSON object reads as unknown, never as none', () => {
    // `{"message":"Not Found"}` is valid JSON and is not a list. Any gh on PATH can
    // produce it -- a version change, an extension, a wrapper shim -- and it used to be
    // coerced to an empty array, so the report stated there were no open issues and no
    // open PRs on the strength of an error message.
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'object', pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\*\*Open issues:\*\* unknown \(gh returned a JSON object where a list was expected\)/);
    assert.match(r.stdout, /\*\*Open PRs -- awaiting founder approval:\*\* unknown \(/);
    assert.match(r.stdout, /\*\*Recently merged PRs:\*\* unknown \(/);
    assert.doesNotMatch(r.stdout, /:\*\* none\./);
  });

  test('silence on a zero exit reads as unknown, never as none', () => {
    // `gh ... --json` always prints at least `[]`, so nothing at all is no answer rather
    // than an empty answer.
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'silent', pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\*\*Open issues:\*\* unknown \(gh exited 0 but printed nothing/);
    assert.doesNotMatch(r.stdout, /:\*\* none\./);
  });
});

// ---------------------------------------------------------------------------
// Caps report both sides of the cut (L-08)
// ---------------------------------------------------------------------------

describe('a truncated list is never printed as a total', () => {
  test('an over-cap list says how many are shown and that there are more', () => {
    // The fake gh returns exactly as many items as were requested, which is the hook's
    // cap plus one. `**Open issues (40):**` on a repo with 55 open issues is read as
    // forty, in the one hook whose whole purpose is to be believed over memory.
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'overflow', pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\*\*Open issues \(showing 40 of more than 40\):\*\*/);
    assert.match(r.stdout, /\*\*Open PRs -- awaiting founder approval \(showing 20 of more than 20\):\*\*/);
    const issueLines = r.stdout.split('\n').filter((l) => /^- #\d+ fixture issue /.test(l));
    assert.equal(issueLines.length, 40, 'the 41st item exists only to prove the list was cut, and is not rendered');
  });
});

// ---------------------------------------------------------------------------
// Ground-truth labelling (L-08)
// ---------------------------------------------------------------------------

describe('ground-truth framing', () => {
  test('states memory files and plan checkboxes are not ground truth', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /Ground truth, read from git and GitHub just now/);
    assert.match(r.stdout, /Memory files and plan/);
    assert.match(r.stdout, /checkboxes are neither/);
  });

  test('reports the branch and HEAD', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Branch:\*\* feat\/example {2}\| {2}\*\*HEAD:\*\* \w+ init commit/);
  });

  test('an unborn HEAD still emits the branch line, as unknown', () => {
    // `rev-parse --abbrev-ref HEAD` exits 128 in a repo with no commits, and the line
    // used to be skipped entirely on that, so a reader could not tell "unborn" from
    // "not reported".
    const repo = tempDir();
    gitRun(repo, 'init', '-q', '-b', 'main');
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\*\*Branch:\*\* unknown \(unborn HEAD, or git did not answer\)/);
  });
});

// ---------------------------------------------------------------------------
// The runtime banner (D8) -- rendered by this hook when preflight() fails
// ---------------------------------------------------------------------------

describe('gate-health banner', () => {
  test('renders when preflight fails (CLAUDE_PLUGIN_ROOT unset)', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: undefined }) });
    assert.match(r.stdout, /AEO GATES ARE NOT ENFORCING/);
  });

  test('renders when preflight fails (CLAUDE_PLUGIN_ROOT points nowhere)', () => {
    const repo = makeRepo();
    const r = runHook({
      payload: { cwd: repo },
      env: fakeGhEnv({ mode: 'empty', pluginRoot: path.join(repo, 'does-not-exist') }),
    });
    assert.match(r.stdout, /AEO GATES ARE NOT ENFORCING/);
  });

  test('stays absent when preflight passes', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.doesNotMatch(r.stdout, /AEO GATES ARE NOT ENFORCING/);
  });
});

// ---------------------------------------------------------------------------
// The gates, stated positively (issue #39)
// ---------------------------------------------------------------------------

// A PreToolUse gate that allows prints nothing, so the healthy session -- every ordinary
// one -- used to say nothing about gates at all, and two of four actors in the Checkpoint
// 5 run read that silence as "no gate is wired". Both were wrong. The claim under test is
// that an actor can now check instead of infer: the names come out of the manifest that
// is actually loaded, and the report says what silence from a gate means.

describe('gates stated positively', () => {
  test('names the wired gates, and says a silent gate allowed', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Gates wired for this session/);
    assert.match(r.stdout, /PreToolUse: .*block-merge/);
    assert.match(r.stdout, /PreToolUse: .*sandbox-guard/);
    // The half that fixes the misreading. Naming the gates without this leaves the
    // actor to work out what silence from one means, which is the step both actors got
    // wrong.
    assert.match(r.stdout, /prints nothing when it allows/);
    assert.match(r.stdout, /not one where none was wired/);
  });

  test('the names come from the loaded hooks.json, not from a list in the hook', () => {
    // The whole point of reading the manifest. A hard-coded list would pass the test
    // above forever and report the real gates here, where this install has none of them.
    const repo = makeRepo();
    const root = makePluginRoot(
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: '^Bash$', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/invented-gate.mjs'] }] },
          ],
        },
      }),
    );
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: root }) });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /PreToolUse: invented-gate/);
    assert.doesNotMatch(r.stdout, /block-merge/);
  });

  test('a manifest it cannot read is reported as unknown, never as a list', () => {
    // Reachable because preflight only needs the scripts to exist somewhere in the file:
    // this manifest satisfies it and still registers nothing under any event. Whatever
    // the cause, "I could not tell" must not render as "these are your gates".
    const repo = makeRepo();
    const root = makePluginRoot(JSON.stringify({ description: 'see ${CLAUDE_PLUGIN_ROOT}/hooks/block-merge.mjs' }));
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: root }) });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Gates wired: unknown/);
    assert.match(r.stdout, /not a finding that none of them are/);
    assert.doesNotMatch(r.stdout, /Gates wired for this session/);
  });

  test('a broken runtime gets the banner and no list of gates above it', () => {
    // Ordering, asserted as absence. A session whose gates are failing open must not be
    // handed their names as reassurance -- the banner is the whole answer there.
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: undefined }) });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /AEO GATES ARE NOT ENFORCING/);
    assert.doesNotMatch(r.stdout, /Gates wired for this session/);
    assert.doesNotMatch(r.stdout, /prints nothing when it allows/);
  });
});

// ---------------------------------------------------------------------------
// Production data root (D18)
// ---------------------------------------------------------------------------

// Out of process, like everything else here, because the claim is about what the
// session actually reads: this hook has its own top-level await and its own env
// handling, and the variable is read from process.env inside the spawned script.
//
// The load-bearing assertion is not that some line appears. It is that the three
// states are told apart and that the undeclared one does not read as an all-clear
// (L-08). So each case asserts what the report says AND what it must not say.

describe('production data root', () => {
  test('an undeclared root is reported, and named as undeclared', () => {
    const repo = makeRepo();
    const r = runHook({
      payload: { cwd: repo },
      env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot(), AEO_LIVE_DATA_ROOT: undefined }),
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Production data root: NOT DECLARED/);
    assert.match(r.stdout, /AEO_LIVE_DATA_ROOT/);
  });

  test('an undeclared root says the guard does nothing, not that all is well', () => {
    const repo = makeRepo();
    const r = runHook({
      payload: { cwd: repo },
      env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot(), AEO_LIVE_DATA_ROOT: undefined }),
    });
    // The negative-signal rule, asserted as a negative: nothing in this branch may
    // present the absence as cover. "not a clean bill of health" is in the text; the
    // words that would make it read as one are not.
    assert.match(r.stdout, /not a clean bill of health/);
    assert.match(r.stdout, /would not be refused/);
    assert.doesNotMatch(r.stdout, /Production data root: declared/);
  });

  test('a declared absolute root reads as declared, and names the path', () => {
    const repo = makeRepo();
    const live = tempDir('aeo-p17-live-');
    const r = runHook({
      payload: { cwd: repo },
      env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot(), AEO_LIVE_DATA_ROOT: live }),
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Production data root: declared/);
    assert.ok(r.stdout.includes(live), `expected the declared path ${live} in the report`);
    assert.doesNotMatch(r.stdout, /NOT DECLARED/);
  });

  test('a declared root is not reported as safe, only as declared', () => {
    const repo = makeRepo();
    const live = tempDir('aeo-p17-live-');
    const r = runHook({
      payload: { cwd: repo },
      env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot(), AEO_LIVE_DATA_ROOT: live }),
    });
    assert.match(r.stdout, /whether it names the right directory is not something/);
  });

  test('a relative declaration is a third state, distinct from both', () => {
    const repo = makeRepo();
    const r = runHook({
      payload: { cwd: repo },
      env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot(), AEO_LIVE_DATA_ROOT: 'data' }),
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Production data root: DECLARED BUT UNUSABLE/);
    assert.match(r.stdout, /refusing every command/);
    assert.doesNotMatch(r.stdout, /Production data root: declared at/);
  });

  test('it is reported even outside a git worktree, where nothing else is', () => {
    // The report returns early when the cwd is not a worktree. An undeclared root is a
    // fact about enforcement, not about the repo, so it has to survive that return.
    const plain = tempDir('aeo-p17-nogit-');
    const r = runHook({
      payload: { cwd: plain },
      env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot(), AEO_LIVE_DATA_ROOT: undefined }),
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Production data root: NOT DECLARED/);
    assert.doesNotMatch(r.stdout, /Live repo state/);
  });

  test('reporting it never blocks, whatever the variable holds', () => {
    const repo = makeRepo();
    for (const value of ['', '   ', 'data', 'C:\\definitely\\not\\here', '../up', '"quoted"']) {
      const r = runHook({
        payload: { cwd: repo },
        env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot(), AEO_LIVE_DATA_ROOT: value }),
      });
      assert.equal(r.status, 0, `AEO_LIVE_DATA_ROOT=${JSON.stringify(value)} must not block`);
    }
  });

  // #133: the report has to read the declaration the same way the gate itself does now,
  // or a session start could tell a founder "declared" for a value the very next Bash
  // call would refuse to honour.
  describe('the declaration file (#133)', () => {
    function writeSettings(repo, { live = '', data = '' } = {}) {
      const file = path.join(repo, '.claude', 'settings.json');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ env: { AEO_LIVE_DATA_ROOT: live, AEO_DATA_ROOT: data } }, null, 2));
      return file;
    }

    test('a declaration in the file alone is reported, with nothing in the environment', () => {
      const repo = makeRepo();
      const live = tempDir('aeo-p17-live-');
      writeSettings(repo, { live });
      const r = runHook({
        payload: { cwd: repo },
        env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot(), AEO_LIVE_DATA_ROOT: undefined }),
      });
      assert.equal(r.status, 0);
      assert.match(r.stdout, /Production data root: declared/);
      assert.ok(r.stdout.includes(live), 'the file-only declaration is not in the report');
    });

    // The same regression sandbox-guard.mjs's own battery covers: a stale value left in
    // the environment must not read as an armed guard once the file says otherwise.
    test('the file overrides a stale declaration left behind in the environment', () => {
      const repo = makeRepo();
      writeSettings(repo, { live: '' }); // the file, right now, says: nothing declared
      const stale = tempDir('aeo-p17-stale-');
      const r = runHook({
        payload: { cwd: repo },
        env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot(), AEO_LIVE_DATA_ROOT: stale }),
      });
      assert.equal(r.status, 0);
      assert.match(r.stdout, /Production data root: NOT DECLARED/);
      assert.doesNotMatch(r.stdout, /Production data root: declared/);
    });

    test('with no settings file at all, the environment is still the report\'s source', () => {
      const repo = makeRepo(); // no .claude/settings.json
      const live = tempDir('aeo-p17-live-');
      const r = runHook({
        payload: { cwd: repo },
        env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot(), AEO_LIVE_DATA_ROOT: live }),
      });
      assert.equal(r.status, 0);
      assert.match(r.stdout, /Production data root: declared/);
      assert.ok(r.stdout.includes(live), 'the env-only declaration is not in the report');
    });
  });
});

// ---------------------------------------------------------------------------
// Newest run log
// ---------------------------------------------------------------------------

// Selection is asserted with mtime pinned by hand in every case below, never left to
// whatever the clock did during the test.
//
// The original of the first test wrote two summaries back to back and let their write
// order decide. Two files created in the same millisecond tie on mtime, the hook's
// comparison was `>` against a running best, and the tie then resolved by readdir
// order, which returns `2026-08-01-older-job` first. That is a one-in-three test flake
// and the same bug in the shipped hook: the status reporter would name a stale log as
// the newest, which is precisely what L-08 built it to stop. Nothing here can now pass
// by luck: the timestamps are set, and two of the five cases make mtime point the
// wrong way on purpose.

/** A `logs/<name>/summary.md` whose mtime is pinned to `mtime`. */
function writeRunLog(repo, name, body, mtime) {
  const dir = path.join(repo, 'logs', name);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'summary.md');
  writeFileSync(file, body);
  utimesSync(file, mtime, mtime);
  return file;
}

const EIGHT_PLUS_LINES = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');

describe('newest run log', () => {
  test('picks the newest date when mtimes are identical, capped at 8 lines', () => {
    const repo = makeRepo();
    const sameInstant = new Date('2026-08-03T12:00:00Z');
    writeRunLog(repo, '2026-08-01-older-job', '# stale entry\n\nshould not appear\n', sameInstant);
    writeRunLog(repo, '2026-08-02-newer-job', `# newer job\n\n${EIGHT_PLUS_LINES}\n`, sameInstant);

    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Newest run log:\*\* `logs\/2026-08-02-newer-job\/summary\.md`/);
    assert.doesNotMatch(r.stdout, /stale entry/);
    const quotedLines = r.stdout.split('\n').filter((l) => l.startsWith('> '));
    assert.equal(quotedLines.length, 9, 'eight excerpt lines plus the truncation marker');
    // 21 non-blank lines in the summary, eight shown. Without the marker an excerpt
    // whose ninth line reads "3 acceptance tests still failing" looks complete.
    assert.match(quotedLines[8], /excerpt: 13 more line\(s\) in the summary/);
  });

  test('the date in the name beats mtime, so a re-touched old log is not the current one', () => {
    // mtime says the older job is newest. The name says otherwise, and the name is
    // what a reader means by "newest run log". This case is deterministic and the old
    // mtime-only selection fails it every time.
    const repo = makeRepo();
    writeRunLog(repo, '2026-08-01-older-job', '# stale entry\n\nshould not appear\n', new Date('2026-08-04T12:00:00Z'));
    writeRunLog(repo, '2026-08-02-newer-job', '# newer job\n', new Date('2026-08-02T12:00:00Z'));

    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Newest run log:\*\* `logs\/2026-08-02-newer-job\/summary\.md`/);
    assert.doesNotMatch(r.stdout, /stale entry/);
  });

  test('a dated log outranks an undated directory whatever its mtime', () => {
    const repo = makeRepo();
    writeRunLog(repo, 'scratch', '# undated\n\nshould not appear\n', new Date('2026-08-09T12:00:00Z'));
    writeRunLog(repo, '2026-08-02-newer-job', '# newer job\n', new Date('2026-08-02T12:00:00Z'));

    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Newest run log:\*\* `logs\/2026-08-02-newer-job\/summary\.md`/);
    assert.doesNotMatch(r.stdout, /undated/);
  });

  test('mtime still decides between two undated directories', () => {
    const repo = makeRepo();
    writeRunLog(repo, 'alpha-job', '# alpha\n', new Date('2026-08-01T12:00:00Z'));
    writeRunLog(repo, 'beta-job', '# beta wrote last\n', new Date('2026-08-05T12:00:00Z'));

    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Newest run log:\*\* `logs\/beta-job\/summary\.md`/);
  });

  test('two logs on the same date with identical mtimes still resolve to one answer', () => {
    // The last tiebreak. Directory names are unique, so this always decides, and the
    // point is only that it decides the same way every run rather than by readdir
    // order. Run twice in one test because a single run cannot show stability.
    const repo = makeRepo();
    const sameInstant = new Date('2026-08-03T12:00:00Z');
    writeRunLog(repo, '2026-08-03-aaa-job', '# aaa\n', sameInstant);
    writeRunLog(repo, '2026-08-03-zzz-job', '# zzz\n', sameInstant);

    const env = fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() });
    const first = runHook({ payload: { cwd: repo }, env });
    const second = runHook({ payload: { cwd: repo }, env });
    assert.match(first.stdout, /\*\*Newest run log:\*\* `logs\/2026-08-03-zzz-job\/summary\.md`/);
    assert.equal(
      /\*\*Newest run log:\*\* `([^`]+)`/.exec(first.stdout)?.[1],
      /\*\*Newest run log:\*\* `([^`]+)`/.exec(second.stdout)?.[1],
    );
  });

  test('says nothing about run logs when logs/ does not exist', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.doesNotMatch(r.stdout, /Newest run log/);
  });
});
