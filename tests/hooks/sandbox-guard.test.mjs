// Tests for plugin/hooks/sandbox-guard.mjs.
//
//   node --test                              # everything, from the repo root
//   node --test "tests/hooks/*.test.mjs"     # this directory only
//
// The exit code is the behaviour: 2 blocks; anything else lets the tool call through
// (C-06). 'the process contract' spawns the real gate and pins that, once per verdict kind
// and shell, and checks each spawned result equals the in-process one. Every other case
// decides in-process through the same parse and settle runGate uses (#224), because a
// spawn per case cost this file over two minutes on Windows.
//
// This gate's product is a guarantee about data that cannot be un-deleted, so a suite
// that passes for the wrong reason is worth more here than a bug. Every block therefore
// asserts WHICH rule fired, not just that something did. P1.6 shipped a first battery
// that stayed green under an inverted gate because its payloads blocked one branch later
// for an unrelated reason; the fix is the same one applied throughout below.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolveRoots, sandboxGuard } from '../../plugin/hooks/sandbox-guard.mjs';
import { parseHookPayload, settleGate } from '../../plugin/hooks/lib.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const GUARD = path.join(repoRoot, 'plugin', 'hooks', 'sandbox-guard.mjs');
const GATE = path.join(repoRoot, 'plugin', 'hooks', 'gate.mjs');

const LIVE = 'AEO_LIVE_DATA_ROOT';
const DATA = 'AEO_DATA_ROOT';

// ---------------------------------------------------------------------------
// scratch space and the runners
// ---------------------------------------------------------------------------

const scratch = [];
after(() => {
  for (const dir of scratch) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* the OS reclaims it */
    }
  }
});

function tempDir(prefix = 'aeo-p15-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/**
 * Where every hook child runs. The case below that hands the guard a payload with no
 * usable cwd relies on the guard finding no directory, and CLAUDE_PROJECT_DIR being
 * blanked leaves the hook process's own cwd as the last resort. Inherited, that is THIS
 * repository. Pinned to scratch.
 */
const NEUTRAL_CWD = tempDir('aeo-p15-nowhere-');

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? r.error}`);
  return (r.stdout ?? '').trim();
}

// One built repository per shape, copied for each case. Building one costs nine git
// processes, which on Windows was most of what this file spent once the guard ran
// in-process (#224).
const templates = new Map();

/** A real repository on a feature branch, recording a Node test command by default. */
function makeRepo({ base = { 'aeo-tests.json': JSON.stringify({ test: 'npm test' }) }, branch = 'feat/slice', change = {} } = {}) {
  const key = JSON.stringify({ base, branch });
  if (!templates.has(key)) templates.set(key, buildRepo(base, branch));
  const dir = tempDir();
  cpSync(templates.get(key), dir, { recursive: true });
  for (const [rel, body] of Object.entries(change)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  if (Object.keys(change).length > 0) git(dir, 'add', '-A');
  return dir;
}

function buildRepo(base, branch) {
  const dir = tempDir('aeo-p15-template-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'aeo-test');
  git(dir, 'config', 'user.email', 'aeo-test@example.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  for (const [rel, body] of Object.entries({ '.gitkeep': '', ...base })) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  git(dir, 'remote', 'add', 'origin', 'https://example.invalid/x.git');
  git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  if (branch !== 'main') git(dir, 'switch', '-q', '-c', branch);
  return dir;
}

/**
 * Run a gate as a hook.
 *
 * Both seam variables are stripped from the inherited environment first, so a machine
 * that happens to carry them cannot silently change a result. Every case that needs one
 * states it.
 */
function hookInput({ payload, raw, env = {} } = {}) {
  const input = raw !== undefined ? raw : payload === undefined ? '' : JSON.stringify(payload);
  const childEnv = { ...process.env, CLAUDE_PROJECT_DIR: '' };
  delete childEnv[LIVE];
  delete childEnv[DATA];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  return { input, childEnv };
}

function runHook(script, options) {
  const { input, childEnv } = hookInput(options);
  const r = spawnSync(process.execPath, [script], { input, encoding: 'utf8', cwd: NEUTRAL_CWD, env: childEnv, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * The guard decided in this process, with what the spawned hook would have had: the same
 * serialised payload, the same environment, NEUTRAL_CWD as its working directory, and its
 * verdict collected as the text it writes to stderr. Nothing here touches process.env or
 * process.cwd(), so cases stay isolated from each other.
 */
function decide(options) {
  const { input, childEnv } = hookInput(options);
  const parsed = parseHookPayload('sandbox-guard', input);
  let outcome = parsed.outcome;
  if (outcome === null) {
    let caught = null;
    try {
      sandboxGuard(parsed.payload, { env: childEnv, cwd: () => NEUTRAL_CWD });
    } catch (err) {
      caught = { err };
    }
    outcome = settleGate('sandbox-guard', caught);
  }
  return { status: outcome.code, stdout: '', stderr: outcome.stderr ?? '' };
}

const guard = decide;
const spawnGuard = (options) => runHook(GUARD, options);
// Spawned: gate.mjs also runs block-merge, which reads the process's own state.
const gate = (options) => runHook(GATE, options);

const bash = (command, cwd, extra = {}) => ({
  session_id: 'test-session',
  hook_event_name: 'PreToolUse',
  cwd,
  tool_name: 'Bash',
  tool_input: { command },
  ...extra,
});

/**
 * A file-tool payload, in the shape each tool really sends. Edit, Write, MultiEdit and
 * Read name their target `file_path`; NotebookEdit and NotebookRead name it
 * `notebook_path`. MultiEdit carries its edits beside the one path, not a path per edit.
 */
const fileCall = (tool, target, cwd, extra = {}) => {
  const key = tool.startsWith('Notebook') ? 'notebook_path' : 'file_path';
  const body =
    tool === 'MultiEdit'
      ? { [key]: target, edits: [{ old_string: 'a', new_string: 'b' }] }
      : tool === 'Write'
        ? { [key]: target, content: 'x\n' }
        : tool === 'Edit'
          ? { [key]: target, old_string: 'a', new_string: 'b' }
          : { [key]: target };
  return { session_id: 'test-session', hook_event_name: 'PreToolUse', cwd, tool_name: tool, tool_input: body, ...extra };
};

// The write tools only (#167). Read and NotebookRead left this set when they left
// hooks.json's matchers: a payload the wiring never sends is not a case this suite can
// hold the gate to.
const FILE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

function assertBlockedBecause(result, pattern, message) {
  assert.equal(result.status, 2, `${message}: expected exit 2, got ${result.status}\n${result.stderr}`);
  assert.match(result.stderr, /^BLOCKED: /m, `${message}: no BLOCKED line on stderr`);
  assert.match(result.stderr, pattern, `${message}: blocked, but not by the rule under test\n${result.stderr}`);
}

function assertAllowed(result, message) {
  assert.equal(result.status, 0, `${message}: expected exit 0, got ${result.status}\n${result.stderr}`);
  assert.doesNotMatch(result.stderr, /^BLOCKED: /m, `${message}: blocked when it should have allowed`);
}

// The rule each block message names. Asserting on these is what stops a mutation from
// leaving the battery green because something else happened to block.
const TARGETS_LIVE_DATA = /targets .*which resolves to .*inside the\s+production data root/;
// A write, move or delete where git cannot put back what it changes (#237).
const CHANGES_LIVE_DATA = /this command changes .*inside the production data root .*git cannot restore it/;

// A sandbox and a production root that are real directories and are not related.
function roots() {
  const base = tempDir();
  const live = path.join(base, 'production');
  const sandbox = path.join(base, 'sandbox');
  mkdirSync(live, { recursive: true });
  mkdirSync(sandbox, { recursive: true });
  return { base, live, sandbox };
}

// ---------------------------------------------------------------------------
// The process contract: the real hook, spawned
// ---------------------------------------------------------------------------
//
// The exit code is the behaviour, so each verdict kind is pinned once through a real
// process, for both shells, and each spawned result must equal what decide() returns for
// the same input. That equality is what lets every other case in this file run in-process.

describe('the process contract', () => {
  const pwsh = (command, cwd) => ({ ...bash(command, cwd), tool_name: 'PowerShell' });

  function spawned(options) {
    const r = spawnGuard(options);
    assert.deepEqual(decide(options), r, 'the in-process verdict differs from the spawned hook');
    return r;
  }

  test('a block exits 2 with the reason on stderr, from Bash and from PowerShell', () => {
    const { live, sandbox } = roots();
    const env = { [LIVE]: live, [DATA]: sandbox };
    const target = path.join(live, 'index.json');
    for (const payload of [bash(`rm ${target}`, tempDir()), pwsh(`rm ${target}`, tempDir())]) {
      const r = spawned({ payload, env });
      assertBlockedBecause(r, CHANGES_LIVE_DATA, `${payload.tool_name} deleting production data`);
      assert.equal(r.stdout, '', `${payload.tool_name}: a block writes nothing to stdout`);
    }
  });

  test('a file tool block exits 2 with the reason on stderr', () => {
    const { live, sandbox } = roots();
    const r = spawned({ payload: fileCall('Write', path.join(live, 'x.txt'), tempDir()), env: { [LIVE]: live, [DATA]: sandbox } });
    assertBlockedBecause(r, TARGETS_LIVE_DATA, 'Write into production data');
  });

  test('an allow exits 0 and writes nothing, from Bash and from PowerShell', () => {
    const { live, sandbox } = roots();
    for (const payload of [bash('git status', tempDir()), pwsh('Get-ChildItem', tempDir())]) {
      const r = spawned({ payload, env: { [LIVE]: live, [DATA]: sandbox } });
      assertAllowed(r, `${payload.tool_name} outside production data`);
      assert.deepEqual([r.stdout, r.stderr], ['', ''], `${payload.tool_name}: an allow says nothing`);
    }
  });

  test('with no AEO_LIVE_DATA_ROOT a call exits 0 and says nothing', () => {
    const r = spawned({ payload: bash('echo "unterminated', makeRepo()) });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''], 'no declaration, no verdict');
  });

  test('a malformed payload exits 0 with a line on stderr', () => {
    for (const raw of ['', 'not json at all']) {
      const r = spawned({ raw, env: { [LIVE]: 'D:/production' } });
      assert.equal(r.status, 0, `raw ${JSON.stringify(raw)}: expected exit 0`);
      assert.match(r.stderr, /^sandbox-guard: (empty|unreadable) hook payload/, `raw ${JSON.stringify(raw)}: silent skip`);
    }
  });

});

// ---------------------------------------------------------------------------
// The two cases PLAN's verify line names by name
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// What arms the guard
// ---------------------------------------------------------------------------

describe('what arms the guard', () => {
  test('with no production data root declared the guard does not fire', () => {
    const repo = makeRepo();
    for (const env of [{}, { [LIVE]: '' }, { [LIVE]: '   ' }, { [DATA]: tempDir() }]) {
      assertAllowed(guard({ payload: bash('npm test', repo), env }), `no declaration, env ${JSON.stringify(env)}`);
    }
  });

  test('a declared production root with no seam allows a command that reaches nothing inside it (#214)', () => {
    const { live } = roots();
    const repo = makeRepo();
    for (const command of ['npm test', 'ls', 'git status', 'cat README.md']) {
      assertAllowed(guard({ payload: bash(command, repo), env: { [LIVE]: live } }), command);
    }
    for (const value of ['', '   ', '\t']) {
      assertAllowed(
        guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: value } }),
        `blank seam ${JSON.stringify(value)} reads as unset`,
      );
    }
  });

});

// ---------------------------------------------------------------------------
// A session with no seam (#214)
// ---------------------------------------------------------------------------
//
// Axial declared AEO_LIVE_DATA_ROOT in its settings file and set no AEO_DATA_ROOT, and the
// guard refused `gh issue view`, then refused it again behind the prefix its own message
// prescribed, because the `cd` before it was judged against the unset session seam. That
// refusal read no production data. It is removed (PLAN section 5, kill line).

describe('a session with no seam (#214)', () => {
  const setup = () => {
    const { base, live, sandbox } = roots();
    mkdirSync(path.join(live, 'index'), { recursive: true });
    const repo = makeRepo();
    // Axial's shape: the declaration lives in the settings file, the seam nowhere.
    mkdirSync(path.join(repo, '.claude'), { recursive: true });
    writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ env: { [LIVE]: live } }));
    return { base, live, sandbox, repo };
  };

  test('a read-only lookup runs', () => {
    const { repo } = setup();
    assertAllowed(guard({ payload: bash('gh issue view 853', repo), env: {} }), 'gh issue view 853');
  });

  test('a cd before the lookup does not turn it into a refusal', () => {
    const { repo, sandbox } = setup();
    for (const command of [
      `cd ${sandbox} && gh issue view 853 && gh issue view 855`,
      `cd ${sandbox} && ${DATA}=${sandbox} gh issue view 853`,
    ]) {
      assertAllowed(guard({ payload: bash(command, repo), env: {} }), command);
    }
  });

  // From the founder's comment on #214: the prefix-first form still failed on a pipe and
  // on `;`, because the unprefixed segment after it was judged against the unset seam.
  test('a pipe or a `;` after a prefixed command does not turn it into a refusal', () => {
    const { repo, sandbox } = setup();
    for (const command of [
      `${DATA}=${sandbox} npm test | tail -5`,
      `${DATA}=${sandbox} npm test ; echo done`,
      'git status ; gh issue view 853',
    ]) {
      assertAllowed(guard({ payload: bash(command, repo), env: {} }), command);
    }
  });

  test('the suite runs with no seam', () => {
    const { repo } = setup();
    assertAllowed(guard({ payload: bash('npm test', repo), env: {} }), 'npm test, no seam');
  });

});

// ---------------------------------------------------------------------------
// The declaration file (#133)
// ---------------------------------------------------------------------------
//
// AEO_LIVE_DATA_ROOT is read from .claude/settings.json now, re-resolved on every
// invocation, instead of trusted from process.env. The regression that got this filed:
// a session's environment can carry a stale declaration (settings.json is a tracked
// file; a branch checkout can revert it while a long session's own env keeps the old
// value), and the guard has to prefer what the file says NOW over what the environment
// remembers.

describe('the declaration file (#133)', () => {
  /** Write `.claude/settings.json` under `repo`, declaring the given env values. */
  function writeSettings(repo, { live = '', data = '' } = {}) {
    const file = path.join(repo, '.claude', 'settings.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ env: { [LIVE]: live, [DATA]: data } }, null, 2));
    return file;
  }

  // The probe for "armed": a delete of a file inside the declared root, where git reads no
  // repository. With no declaration that path is an ordinary directory and the command runs.
  const probe = (live) => `rm ${path.join(live, 'index.json')}`;

  test('a declaration in the file alone arms the guard, with nothing in the environment', () => {
    const { live } = roots();
    const repo = makeRepo();
    writeSettings(repo, { live });
    assertBlockedBecause(guard({ payload: bash(probe(live), repo), env: {} }), CHANGES_LIVE_DATA, 'file-only declaration');
  });

  test('the file is re-read on every invocation: a blank rewrite disarms the very next call', () => {
    const { live } = roots();
    const repo = makeRepo();
    const settingsFile = writeSettings(repo, { live });
    assertBlockedBecause(guard({ payload: bash(probe(live), repo), env: {} }), CHANGES_LIVE_DATA, 'armed by the file');

    writeFileSync(settingsFile, JSON.stringify({ env: { [LIVE]: '', [DATA]: '' } }, null, 2));
    assertAllowed(guard({ payload: bash(probe(live), repo), env: {} }), 'the same call, after the file was edited back to blank');
  });

  // The regression the issue was filed from: the environment carries a stale
  // declaration -- what Claude Code's own settings.json-to-env injection leaves behind
  // when a value goes back to blank, per the issue's own account -- while the file, read
  // fresh on this call, says there is nothing declared. The file wins, because it is the
  // one source that cannot get stuck.
  test('the file overrides a stale declaration left behind in the environment', () => {
    const { live } = roots();
    const repo = makeRepo();
    writeSettings(repo, { live: '' }); // the file, right now, says: nothing declared
    const staleEnv = { [LIVE]: live }; // env still thinks otherwise
    assertAllowed(guard({ payload: bash(probe(live), repo), env: staleEnv }), 'file says blank; the guard must not trust the stale env');

    // Control: with no file at all, the stale env is exactly what the guard used to run
    // on, so this proves the ALLOW above came from the file and not from something else.
    const noFile = makeRepo();
    assertBlockedBecause(guard({ payload: bash(probe(live), noFile), env: staleEnv }), CHANGES_LIVE_DATA, 'no file: env is still honoured');
  });

  test('a missing or malformed settings.json defers to the environment, not to a block of its own', () => {
    const { live } = roots();
    const repo = makeRepo(); // no .claude/settings.json at all
    assertBlockedBecause(
      guard({ payload: bash(probe(live), repo), env: { [LIVE]: live } }),
      CHANGES_LIVE_DATA,
      'no settings file: env still arms it',
    );

    const file = path.join(repo, '.claude', 'settings.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{not json');
    assertBlockedBecause(
      guard({ payload: bash(probe(live), repo), env: { [LIVE]: live } }),
      CHANGES_LIVE_DATA,
      'malformed settings file: env still arms it',
    );
  });

  test('payload.cwd outranks CLAUDE_PROJECT_DIR when locating the declaration file', () => {
    const { live: liveA, sandbox: sandboxA } = roots();
    const { live: liveB } = roots();
    const repoA = makeRepo();
    const repoB = makeRepo();
    writeSettings(repoA, { live: liveA });
    writeSettings(repoB, { live: liveB });
    mkdirSync(path.join(liveA, 'index'), { recursive: true });
    const env = { CLAUDE_PROJECT_DIR: repoB, [DATA]: sandboxA };
    // The command deletes inside liveA. If repoA's own declaration governs (payload.cwd
    // wins, as it must), this blocks. If CLAUDE_PROJECT_DIR's
    // project (repoB) wrongly governed instead, liveA would be an ordinary, undeclared
    // directory and this would pass straight through.
    assertBlockedBecause(
      guard({ payload: bash(`rm -rf ${path.join(liveA, 'index')}`, repoA), env }),
      CHANGES_LIVE_DATA,
      "payload.cwd's own repo governs the declaration, not CLAUDE_PROJECT_DIR's",
    );
  });

  test('with no payload.cwd, CLAUDE_PROJECT_DIR locates the declaration file', () => {
    const { live } = roots();
    const repo = makeRepo();
    writeSettings(repo, { live });
    const payload = bash(probe(live), repo);
    delete payload.cwd;
    assertBlockedBecause(
      guard({ payload, env: { CLAUDE_PROJECT_DIR: repo } }),
      CHANGES_LIVE_DATA,
      'CLAUDE_PROJECT_DIR is the only directory offered',
    );
  });

  // The case the issue was filed from: a linked worktree must resolve to the same
  // declaration as the main checkout when their working trees agree, and its own,
  // independent declaration when they do not -- exactly what git already guarantees for
  // any other tracked file, since every worktree carries its own copy.
  test('a linked worktree reads its own settings.json, independent of the main checkout', () => {
    const { live: liveMain } = roots();
    const { live: liveWt } = roots();
    const main = makeRepo();
    writeSettings(main, { live: liveMain });
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'declare production data');

    const worktree = path.join(tempDir(), 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feat/declaration-wt', worktree);

    // Freshly created from the same commit: the worktree sees the SAME declaration.
    assertBlockedBecause(
      guard({ payload: bash(probe(liveMain), worktree), env: {} }),
      CHANGES_LIVE_DATA,
      'worktree, same declaration as main, immediately after creation',
    );

    // Editing the worktree's own copy does not touch main's, and vice versa: each
    // resolves independently, which is the guarantee #133 was filed over.
    writeSettings(worktree, { live: liveWt });
    assertBlockedBecause(
      guard({ payload: bash(probe(liveWt), worktree), env: {} }),
      CHANGES_LIVE_DATA,
      'worktree, its own edited declaration',
    );
    assertAllowed(guard({ payload: bash(probe(liveMain), worktree), env: {} }), "the worktree no longer reads main's declared root");

    assertBlockedBecause(
      guard({ payload: bash(probe(liveMain), main), env: {} }),
      CHANGES_LIVE_DATA,
      "main checkout is unaffected by the worktree's edit",
    );
    assertAllowed(guard({ payload: bash(probe(liveWt), main), env: {} }), "main has not picked up the worktree's edit");
  });
});

// ---------------------------------------------------------------------------
// A command that names production data outright
// ---------------------------------------------------------------------------

describe('paths named in the command', () => {
  test('an absolute path inside production data blocks whatever the seam says', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    const inside = path.join(live, 'index');
    mkdirSync(inside, { recursive: true });
    assertBlockedBecause(
      guard({ payload: bash(`rm -rf ${inside}`, repo), env: { [LIVE]: live, [DATA]: sandbox } }),
      CHANGES_LIVE_DATA,
      'a delete of what git does not hold',
    );
  });

  test('a relative path resolving into production data blocks', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    mkdirSync(path.join(live, 'index'), { recursive: true });
    assertBlockedBecause(
      guard({ payload: bash('rm -rf ./index', path.join(live)), env: { [LIVE]: live, [DATA]: sandbox } }),
      CHANGES_LIVE_DATA,
      'relative token resolved against the operation directory',
    );
  });

  test('ordinary paths, urls and bare words do not block', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    for (const command of [
      'npm test',
      'git status',
      'ls plugin/hooks',
      'curl https://example.invalid/production/index',
      'grep -r production .',
      'echo production',
    ]) {
      assertAllowed(guard({ payload: bash(command, repo), env: { [LIVE]: live, [DATA]: sandbox } }), command);
    }
  });
});

// ---------------------------------------------------------------------------
// A SQLite URI that opens read-only (#246)
// ---------------------------------------------------------------------------
//
// decision-model-poc exports from its production database with a script that opens it
// only through `file:<root>/db/cip.sqlite?mode=ro`. SQLite refuses writes on that
// connection, so the run cannot change the file. Before #246 the guard let every URI
// through by accident: the `=` in `?mode=` cut the token to its query value, and a
// `file:` prefix made the rest neither absolute nor URL-shaped. So `mode=rw` passed too.

// ---------------------------------------------------------------------------
// The directory the command runs in
// ---------------------------------------------------------------------------
//
// No token in `cd corpus && rm -rf index` carries a separator, so the target is judged
// where the command runs. The Bash tool persists its working directory between calls, so
// one `cd corpus` reaches the same place.

describe('the operation directory', () => {
  test('a relative cd into production data blocks', () => {
    const { base, live, sandbox } = roots();
    mkdirSync(path.join(live, 'index'), { recursive: true });
    assertBlockedBecause(
      guard({ payload: bash(`cd ${path.basename(live)} && rm -rf index`, base), env: { [LIVE]: live, [DATA]: sandbox } }),
      CHANGES_LIVE_DATA,
      'a delete after the same cd is judged on its target',
    );
  });

  // The Bash tool persists its working directory between calls, so the two-step form
  // reaches the same place, and so does a session that never types `cd` at all.
  test('a session already sitting in production data blocks with no cd at all', () => {
    const { live, sandbox } = roots();
    mkdirSync(path.join(live, 'index'), { recursive: true });
    // No token here carries a separator, so the rule that names a path sees nothing.
    assertBlockedBecause(
      guard({ payload: bash('rm -rf index', live), env: { [LIVE]: live, [DATA]: sandbox } }),
      CHANGES_LIVE_DATA,
      'a delete from inside is judged on its target',
    );
  });

  test('the spelled-out forms still block', () => {
    const { base, live, sandbox } = roots();
    const env = { [LIVE]: live, [DATA]: sandbox };
    mkdirSync(path.join(live, 'index'), { recursive: true });
    assertBlockedBecause(guard({ payload: bash(`cd ${live} && rm -rf index`, base), env }), CHANGES_LIVE_DATA, 'absolute cd');
    assertBlockedBecause(
      guard({ payload: bash(`rm -rf ${path.join(live, 'index')}`, base), env }),
      CHANGES_LIVE_DATA,
      'absolute target named outright',
    );
  });

  test('a command that operates outside production data does not block', () => {
    const { base, live, sandbox } = roots();
    const env = { [LIVE]: live, [DATA]: sandbox };
    mkdirSync(path.join(sandbox, 'index'), { recursive: true });
    for (const [command, cwd] of [
      ['rm -rf index', sandbox],
      [`cd ${path.basename(sandbox)} && rm -rf index`, base],
      ['ls', base],
      // An ancestor of production data is not inside it. This rule is one-directional
      // on purpose: refusing an ancestor is refusing `cd ..`.
      ['ls', path.dirname(live)],
    ]) {
      assertAllowed(guard({ payload: bash(command, cwd), env }), `${command} in ${cwd}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Read-only commands may name production data (#216)
// ---------------------------------------------------------------------------
//
// Axial, 2026-09-29: the founder copied results into the live root and a session could
// not confirm the copy. `ls`, `du -sh`, `dir` and `git ls-files` of the live vault were
// each refused for naming it, which read no data that a write could harm. A read may name
// production data and run from inside it.

describe('read-only commands may name production data (#216)', () => {
  const setup = () => {
    const { base, live, sandbox } = roots();
    const vault = path.join(live, 'vault');
    mkdirSync(vault, { recursive: true });
    writeFileSync(path.join(vault, 'a.md'), 'a\n');
    return { base, live, sandbox, vault, env: { [LIVE]: live, [DATA]: sandbox } };
  };

  test('the checks from the issue run', () => {
    const { base, sandbox, vault, env } = setup();
    const a = path.join(vault, 'a.md');
    const other = path.join(sandbox, 'copy');
    for (const command of [
      `ls ${vault}`,
      `ls -la ${vault}`,
      `du -sh ${vault}`,
      `dir ${vault}`,
      `stat ${a}`,
      `sha256sum ${a}`,
      `md5sum ${a}`,
      `cat ${a}`,
      `head -5 ${a}`,
      `tail -n 5 ${a}`,
      `wc -l ${a}`,
      `find ${vault} -type f | wc -l`,
      `find ${vault} -name '*.md' -newer ${path.join(sandbox, 'stamp')}`,
      `robocopy ${vault} ${other} /L /E`,
      `robocopy ${vault} ${other} /l`,
      `cd ${vault} && ls`,
      `/usr/bin/ls ${vault}`,
      `du.exe -sh ${vault}`,
      `ls ${vault} 2>/dev/null`,
      `LC_ALL=C ls ${vault}`,
      `ls ${vault} > ${path.join(sandbox, 'listing.txt')}`,
      // #237: a copy out of the root reads it, and a command after a read is not fed by it.
      `robocopy ${vault} ${other}`,
      `robocopy ${vault} ${other} /L /LOG:${path.join(sandbox, 'log.txt')}`,
      `ls ${vault} ; npm test`,
      `Get-Content ${a}`,
    ]) {
      assertAllowed(guard({ payload: bash(command, base), env }), command);
    }
  });

  // The issue's first example: the live root sits inside the repository, and the relative
  // path is resolved against the session directory.
  test('git reads a live root that sits inside the repository', () => {
    const repo = makeRepo();
    const live = path.join(repo, 'data');
    mkdirSync(path.join(live, 'runs'), { recursive: true });
    for (const command of [
      `git -C ${repo} ls-files data/runs`,
      'git ls-files data/runs',
      'git status data/runs',
      `git --no-pager diff --stat -- ${path.join(live, 'runs')}`,
    ]) {
      assertAllowed(guard({ payload: bash(command, repo), env: { [LIVE]: live } }), command);
    }
  });

  test('a session sitting inside production data may look around', () => {
    const { vault, env } = setup();
    for (const command of ['ls', 'ls -la', 'du -sh .', 'find . -type f | wc -l', 'cat a.md', 'git status']) {
      assertAllowed(guard({ payload: bash(command, vault), env }), `${command} from inside`);
    }
  });

  // The third shape in the issue was fixed by #214 (plugin 0.3.1); the machine that
  // reported it ran 0.3.0. Pinned so it stays fixed.
  test('a pipe with no leading seam runs (#214)', () => {
    const { base, live, sandbox } = setup();
    for (const command of [`find ${sandbox} -type f | wc -l`, 'env | grep AXIAL']) {
      assertAllowed(guard({ payload: bash(command, base), env: { [LIVE]: live } }), command);
    }
  });

  test('a write still refuses by the path it names', () => {
    const { base, vault, env } = setup();
    const a = path.join(vault, 'a.md');
    const b = path.join(vault, 'b.md');
    for (const command of [`ls ${vault} > ${path.join(vault, 'x')}`, `cat ${a} >> ${b}`, `ls ${vault} && rm -rf ${path.join(vault, 'x')}`]) {
      assertBlockedBecause(guard({ payload: bash(command, base), env }), CHANGES_LIVE_DATA, JSON.stringify(command));
    }
  });

  test('from inside production data, a write still refuses', () => {
    const { base, live, vault, env } = setup();
    const rel = path.basename(live);
    for (const [command, cwd] of [
      ['rm -rf x', vault],
      ['ls ; rm -rf x', vault],
      ['ls > out.txt', vault],
      [`cd ${rel} && ls > out.txt`, base],
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, cwd), env }), CHANGES_LIVE_DATA, `${command} in ${cwd}`);
    }
  });

  test('the file tools get no exemption', () => {
    const { base, vault, env } = setup();
    assertBlockedBecause(
      guard({ payload: fileCall('Write', path.join(vault, 'a.md'), base), env }),
      TARGETS_LIVE_DATA,
      'Write into production data',
    );
  });
});

// ---------------------------------------------------------------------------
// The file tools
// ---------------------------------------------------------------------------
//
// A smoke test of the installed plugin proved the hole these cases close. The gate was
// matched on `^Bash$` alone, so `cat <file inside production data>` was refused while a
// Write that CREATED a file inside the production data root was not gated at all, and a
// Read of a file inside it went through freely. Production data does not care which tool
// reached it, and reads are in scope by the gate's own evidence: L-03's second incident
// is six test call-sites silently READING a live 49,674-entry index.

// The same hole, one tool further out (C-07). D22 closed the file-tool half by widening
// the matcher off `^Bash$`; PowerShell is a first-class tool that survives the
// background-subagent filter and was still outside it, so `Get-Content <file inside
// production data>` passed while `cat` of the same file was refused. This gate does not
// exempt the main session, which is what made it the one that was actually open.
//
// The segmenter is a Bash reader. It handles these forms because the two shells agree on
// them, and where they disagree it declines to read rather than guessing.
describe('PowerShell reaches the same rules as Bash', () => {
  const pwsh = (command, cwd, extra = {}) => ({ ...bash(command, cwd, extra), tool_name: 'PowerShell' });

  test('a cmdlet that writes into production data blocks, and one that reads it runs (#237)', () => {
    const { live, sandbox } = roots();
    const target = path.join(live, 'index', 'entries.jsonl');
    const env = { [LIVE]: live, [DATA]: sandbox };
    assertBlockedBecause(guard({ payload: pwsh(`Set-Content ${target} -Value x`, tempDir()), env }), CHANGES_LIVE_DATA, 'Set-Content');
    assertAllowed(guard({ payload: pwsh(`Get-Content ${target}`, tempDir()), env }), 'Get-Content of production data');
  });

  test('a Windows path with backslashes still resolves into the root', (t) => {
    // The segmenter keeps a backslash that is not escaping shell syntax, precisely so a
    // drive path survives (L-09). If it did not, every path here would tokenise to
    // nonsense and the guard would pass everything.
    //
    // Windows only, and not because of the assertion style: this spawns the real guard,
    // which reads the host's path rules. On POSIX a backslash is an ordinary character in
    // a filename, so `<live>\corpus\notes.txt` is one file called that, sitting outside
    // the root — a pass here would be correct behaviour, not the behaviour under test.
    if (process.platform !== 'win32') return t.skip('backslash is not a separator on this platform');
    const { live, sandbox } = roots();
    const target = path.join(live, 'corpus', 'notes.txt').replace(/\//g, '\\');
    // Still spawned: it is the one case that pins a real Windows hook process on backslash paths.
    assertBlockedBecause(
      spawnGuard({ payload: pwsh(`Remove-Item ${target}`, tempDir()), env: { [LIVE]: live, [DATA]: sandbox } }),
      CHANGES_LIVE_DATA,
      'a backslash-separated target',
    );
  });

  test('a cd into production data is honoured on the PowerShell arm too', () => {
    const { live, sandbox } = roots();
    const env = { [LIVE]: live, [DATA]: sandbox };
    assertBlockedBecause(
      guard({ payload: pwsh(`cd ${live}; Remove-Item -Recurse corpus`, tempDir()), env }),
      CHANGES_LIVE_DATA,
      'an absolute cd target through the PowerShell statement separator',
    );
  });

  test('an ordinary command outside production data still passes', () => {
    const { live, sandbox } = roots();
    for (const command of ['Get-ChildItem', 'git status', 'Get-Content README.md']) {
      const r = guard({ payload: pwsh(command, tempDir()), env: { [LIVE]: live, [DATA]: sandbox } });
      assert.equal(r.status, 0, `${command} should not be blocked: ${r.stderr}`);
    }
  });
});

describe('the file tools', () => {
  test('every file tool blocks on a target inside production data', () => {
    const { live, sandbox } = roots();
    const cwd = tempDir();
    const target = path.join(live, 'corpus', 'guard-probe.txt');
    for (const tool of FILE_TOOLS) {
      assertBlockedBecause(
        guard({ payload: fileCall(tool, target, cwd), env: { [LIVE]: live, [DATA]: sandbox } }),
        TARGETS_LIVE_DATA,
        `${tool} into production data`,
      );
    }
  });

  // The probe's exact shape: a Write that CREATES a file that is not there yet, which is
  // the case a containment check over an existing path would miss.
  test('a Write creating a new file inside production data blocks', () => {
    const { live, sandbox } = roots();
    const target = path.join(live, 'corpus', 'guard-probe.txt');
    assert.equal(existsSync(target), false, 'the probe target must not exist for this case to mean anything');
    assertBlockedBecause(
      guard({ payload: fileCall('Write', target, tempDir()), env: { [LIVE]: live, [DATA]: sandbox } }),
      TARGETS_LIVE_DATA,
      'Write of a file that does not exist yet',
    );
  });

  // #167 reversed this case. It used to assert that a Read inside production data blocks,
  // which is not what the wiring does: hooks.json matches no read tool, so no process
  // starts on one and the assertion described a payload that never arrives. L-03's second
  // incident is still judged, because code reading a live index arrives as a Bash call.
  // Both entry points are checked, the rule's own script and the one hooks.json wires.
  test('a Read of a file inside production data allows, from the guard and from the gate', () => {
    const { live, sandbox } = roots();
    const target = path.join(live, 'index', 'entries.jsonl');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '{}\n');
    const payload = fileCall('Read', target, tempDir());
    const env = { [LIVE]: live, [DATA]: sandbox };
    assertAllowed(guard({ payload, env }), 'Read inside production data, through sandbox-guard.mjs');
    assertAllowed(gate({ payload, env }), 'Read inside production data, through gate.mjs');
  });

  test('every file tool allows a target outside production data', () => {
    const { live, sandbox } = roots();
    const cwd = tempDir();
    for (const tool of FILE_TOOLS) {
      assertAllowed(
        guard({ payload: fileCall(tool, path.join(sandbox, 'notes.md'), cwd), env: { [LIVE]: live, [DATA]: sandbox } }),
        `${tool} outside production data`,
      );
    }
  });

  test('with no production data root declared the guard is silent for every file tool', () => {
    const { live, sandbox } = roots();
    const cwd = tempDir();
    for (const tool of FILE_TOOLS) {
      for (const env of [{}, { [LIVE]: '' }, { [DATA]: sandbox }]) {
        assertAllowed(
          guard({ payload: fileCall(tool, path.join(live, 'corpus', 'x.txt'), cwd), env }),
          `${tool} with env ${JSON.stringify(env)}`,
        );
      }
    }
  });

  test('a relative target resolves against the session directory', () => {
    const { live, sandbox } = roots();
    assertBlockedBecause(
      guard({ payload: fileCall('Write', 'corpus/x.txt', live), env: { [LIVE]: live, [DATA]: sandbox } }),
      TARGETS_LIVE_DATA,
      'relative target, session sitting in production data',
    );
    assertAllowed(
      guard({ payload: fileCall('Write', 'corpus/x.txt', sandbox), env: { [LIVE]: live, [DATA]: sandbox } }),
      'relative target, session sitting in the sandbox',
    );
  });

  test('a target reaching production data through a link is caught', (t) => {
    const { base, live, sandbox } = roots();
    const alias = path.join(base, 'shortcut');
    try {
      symlinkSync(live, alias, 'junction');
    } catch {
      return t.skip('this platform would not create a directory link');
    }
    assertBlockedBecause(
      guard({ payload: fileCall('Write', path.join(alias, 'corpus', 'x.txt'), tempDir()), env: { [LIVE]: live, [DATA]: sandbox } }),
      TARGETS_LIVE_DATA,
      'a file tool naming production data through a link',
    );
  });

  test('a file-tool payload that names no target allows', () => {
    const { live, sandbox } = roots();
    const env = { [LIVE]: live, [DATA]: sandbox };
    for (const tool_input of [undefined, null, {}, { file_path: '' }, { file_path: 42 }]) {
      const payload = fileCall('Write', 'x.txt', tempDir());
      if (tool_input === undefined) delete payload.tool_input;
      else payload.tool_input = tool_input;
      assertAllowed(guard({ payload, env }), `Write with tool_input ${JSON.stringify(tool_input)}`);
    }
  });

  test('a file tool writing outside is allowed from a session sitting in production data', () => {
    const { live, sandbox } = roots();
    // The session sits inside production data, and the target is absolute and elsewhere.
    assertAllowed(
      guard({ payload: fileCall('Write', path.join(sandbox, 'notes.md'), live), env: { [LIVE]: live, [DATA]: sandbox } }),
      'absolute target outside, session cwd inside production data',
    );
  });

  // Glob and Grep are deliberately out of scope: they name a pattern plus an optional
  // root, which is a wider surface than this fix. Pinned so their absence is a decision
  // on the record rather than something nobody noticed.
  test('Glob and Grep are not gated, and that is on the record', () => {
    const { live, sandbox } = roots();
    for (const tool of ['Glob', 'Grep']) {
      const payload = { hook_event_name: 'PreToolUse', cwd: tempDir(), tool_name: tool, tool_input: { pattern: '**/*', path: live } };
      assertAllowed(guard({ payload, env: { [LIVE]: live, [DATA]: sandbox } }), tool);
    }
  });

  // Every identity, the orchestrator included. There is no identity test in this gate and
  // the file tools do not introduce one.
  test('every identity is subject to the file-tool rule', () => {
    const { live, sandbox } = roots();
    const target = path.join(live, 'corpus', 'x.txt');
    for (const agent_type of [undefined, 'aeo:builder', 'aeo:reviewer', 'builder', 'Explore']) {
      const extra = agent_type === undefined ? {} : { agent_type };
      assertBlockedBecause(
        guard({ payload: fileCall('Write', target, tempDir(), extra), env: { [LIVE]: live, [DATA]: sandbox } }),
        TARGETS_LIVE_DATA,
        `Write, ${agent_type}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The shell's other separators
// ---------------------------------------------------------------------------
//
// The directory walk once matched `cd X &&` and nothing else. Every shape below deletes
// production data and exited 0, while the one syntax that was patched exited 2.
// Two rounds of fixes each closed the reported shape and left its neighbours open, which
// is why these are pinned one by one: the absence of exactly these cases is what shipped
// the bug twice.

describe('a cd the shell honours, in every syntax that reaches it', () => {
  const setup = () => {
    const { base, live, sandbox } = roots();
    mkdirSync(path.join(live, 'index'), { recursive: true });
    return { base, live, sandbox, prod: path.basename(live), env: { [LIVE]: live, [DATA]: sandbox } };
  };

  test('every separator the shell carries a cd across blocks', () => {
    const { base, prod, env } = setup();
    for (const command of [
      `cd ${prod} && rm -rf index`, // the control: this one always blocked
      `cd ${prod} ; rm -rf index`,
      `cd ${prod}\nrm -rf index`,
      `pushd ${prod} && rm -rf index`,
      `cd -- ${prod} && rm -rf index`,
      `( cd ${prod} && rm -rf index )`,
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, base), env }), CHANGES_LIVE_DATA, JSON.stringify(command));
    }
  });

  // The separators after which the shell does NOT carry the cd. `||` runs its right side
  // only when the cd failed, and `|` and `&` put each side in its own subshell, so in all
  // three `rm` runs where the command started. Blocking these would be a false positive,
  // and a guard that blocks everything is not a working gate.
  test('the separators that end a cd do not block', () => {
    const { base, prod, env } = setup();
    for (const command of [`cd ${prod} || rm -rf corpus`, `cd ${prod} | cat`, `cd ${prod} & rm -rf corpus`]) {
      assertAllowed(guard({ payload: bash(command, base), env }), JSON.stringify(command));
    }
  });

  // The other direction, and it is the reason heredoc bodies are skipped rather than
  // segmented: a script being WRITTEN is data. Reading its lines as commands refuses an
  // ordinary `cat > run.sh` for a `cd` that this call never performs.
  test('a heredoc body is data, not a command that moves the shell', () => {
    const { base, prod, env } = setup();
    const command = `cat > run.sh <<EOF\ncd ${prod}\nrm -rf corpus\nEOF`;
    assertAllowed(guard({ payload: bash(command, base), env }), 'a cd inside a heredoc body');
  });
});

// ---------------------------------------------------------------------------
// A command the guard cannot read is judged on what it can read (#169)
// ---------------------------------------------------------------------------
//
// Refusing outright was the safe-looking answer and it refused `echo "unterminated`,
// which reaches no data at all. The rules below it do not need the parse: a token that
// names a path is a path whether or not the quote closes, the directory the call runs in
// is known from the payload, and the sentinel matches on tokens. So both rules now run
// what they can and say what they could not read.

// ---------------------------------------------------------------------------
// A relative path resolves where its own command runs (#218)
// ---------------------------------------------------------------------------
//
// Axial, 2026-09-29: a session sitting in the checkout whose `data/` is the live root ran
// `cd /d/axial-runs && python -m axial.cli map compare data/map/X ...` and was refused,
// because `data/map/X` was resolved against the session directory rather than the runs
// checkout the `cd` had moved to. Each command's relative paths now resolve against the
// directory that command runs in.

describe('a relative path resolves where its own command runs (#218)', () => {
  const setup = () => {
    const base = tempDir();
    const axial = path.join(base, 'axial');
    const live = path.join(axial, 'data');
    const runs = path.join(base, 'axial-runs');
    for (const d of [path.join(live, 'map', 'X'), path.join(runs, 'data', 'map', 'X')]) mkdirSync(d, { recursive: true });
    return { base, axial, live, runs, env: { [LIVE]: live } };
  };
  // The same directory in the form the Bash tool hands the shell on Windows, `/c/...`. On
  // any other platform the native path is already that form.
  const msys = (p) =>
    process.platform === 'win32' ? p.replace(/^([A-Za-z]):[\\/]/, (_, d) => `/${d.toLowerCase()}/`).replace(/\\/g, '/') : p;
  const compare = 'python -m axial.cli map compare data/map/X data/map/X-category --vocabulary-dir data/vocabulary';

  test("the issue's command runs when the cd leaves the live checkout", () => {
    const { axial, runs, env } = setup();
    for (const command of [
      `cd ${msys(runs)} && ${compare} > out.txt 2>&1`,
      `cd ${runs} && ${compare} > out.txt 2>&1`,
      `cd ${runs.replace(/\\/g, '/')} && ${compare}`,
      `cd ${runs} ; ${compare}`,
      `cd ${runs}\n${compare}`,
    ]) {
      assertAllowed(guard({ payload: bash(command, axial), env }), JSON.stringify(command));
    }
  });

  test('a relative cd target resolves against the session directory first', () => {
    const { axial, env } = setup();
    for (const command of [`cd ../axial-runs && ${compare}`, `cd .. && cd axial-runs && ${compare}`]) {
      assertAllowed(guard({ payload: bash(command, axial), env }), JSON.stringify(command));
    }
  });

  // A command BEFORE a `cd` the guard cannot name runs where the session sits, which the
  // guard does know.
  test('a cd the guard cannot name does not loosen what runs before it', () => {
    const { axial, env } = setup();
    assertBlockedBecause(guard({ payload: bash('rm -rf data/map/X ; cd - && ls', axial), env }), CHANGES_LIVE_DATA, 'a delete before it');
  });
});

// ---------------------------------------------------------------------------
// A relative path after `git -C <dir>` resolves against <dir> (#220)
// ---------------------------------------------------------------------------
//
// Axial, 2026-09-29: from the live checkout, `git -C /d/axial-runs add data/logs/X/summary.md`
// was refused, because `data/logs/X` was resolved against the session directory rather than
// the runs checkout `-C` names. `git -C` moves where a command's relative paths land the way
// `cd` does (#218), each `-C` relative to the one before it.

describe('a relative path after git -C resolves against the -C target (#220)', () => {
  const setup = () => {
    const base = tempDir();
    const axial = path.join(base, 'axial');
    const live = path.join(axial, 'data');
    const runs = path.join(base, 'axial-runs');
    for (const d of [path.join(live, 'logs', 'X'), path.join(runs, 'data', 'logs', 'X')]) mkdirSync(d, { recursive: true });
    return { base, axial, live, runs, env: { [LIVE]: live } };
  };
  const msys = (p) =>
    process.platform === 'win32' ? p.replace(/^([A-Za-z]):[\\/]/, (_, d) => `/${d.toLowerCase()}/`).replace(/\\/g, '/') : p;
  const spec = 'data/logs/X/summary.md';

  test("the issue's command runs when -C leaves the live checkout", () => {
    const { axial, runs, env } = setup();
    for (const command of [
      `git -C ${msys(runs)} add ${spec}`,
      `git -C ${runs} add ${spec}`,
      `git -C ../axial-runs add ${spec}`,
      `git -C ${runs} -c core.autocrlf=false add ${spec}`,
      `git --no-pager -C ${runs} add ${spec}`,
      `git -C .. -C axial-runs add ${spec}`,
      `cd ${msys(runs)} && git -C . add ${spec}`,
    ]) {
      assertAllowed(guard({ payload: bash(command, axial), env }), JSON.stringify(command));
    }
  });

});

// ---------------------------------------------------------------------------
// A relative path in Start-Process resolves against -WorkingDirectory (#227)
// ---------------------------------------------------------------------------
//
// Axial, 2026-09-30: from the live checkout, a `Start-Process ... -WorkingDirectory
// D:\axial-runs` sweep naming `data/runs/881-arm-C` was refused, because the path was
// resolved against the session directory rather than the directory the process runs in.

describe('a relative path in Start-Process resolves against -WorkingDirectory (#227)', () => {
  const pwsh = (command, cwd) => ({ ...bash(command, cwd), tool_name: 'PowerShell' });
  const setup = () => {
    const base = tempDir();
    const axial = path.join(base, 'axial');
    const live = path.join(axial, 'data');
    const runs = path.join(base, 'axial-runs');
    for (const d of [path.join(live, 'runs'), path.join(runs, 'data', 'runs')]) mkdirSync(d, { recursive: true });
    return { base, axial, live, runs, env: { [LIVE]: live } };
  };
  const sweep = (python, wd) =>
    `Start-Process -FilePath "${python}" -ArgumentList "scripts\\watch_run.py", $py, "-m", "axial.cli", "brief", ` +
    `"sweep", "worklist.txt", "--draws", "3", "--sweep-dir", "data/runs/881-arm-C", "--arm", "map", "--workers", "3" ${wd}`;

  test("the issue's command runs when -WorkingDirectory leaves the live checkout", () => {
    const { axial, runs, env } = setup();
    const python = path.join(runs, '.venv', 'Scripts', 'python.exe');
    for (const wd of [
      `-WorkingDirectory "${runs}"`,
      `-WorkingDirectory ${runs}`,
      `-workingdirectory "${runs}"`,
      `-WORKINGDIRECTORY "${runs}"`,
      `-wo "${runs}"`,
      `-WorkingDir "${runs}"`,
      `-WorkingDirectory:"${runs}"`,
      // A backslash separates only on win32; on POSIX it is part of a directory name.
      `-WorkingDirectory ${path.join('..', 'axial-runs')}`,
      `-WorkingDirectory "${runs}" -NoNewWindow -PassThru`,
    ]) {
      assertAllowed(guard({ payload: pwsh(sweep(python, wd), axial), env }), wd);
    }
    for (const alias of ['saps', 'start']) {
      const command = sweep(python, `-WorkingDirectory "${runs}"`).replace(/^Start-Process/, alias);
      assertAllowed(guard({ payload: pwsh(command, axial), env }), alias);
    }
  });

});

// ---------------------------------------------------------------------------
// A run directory inside the production data root is refused (#229)
// ---------------------------------------------------------------------------
//
// `git -C <dir>` (#220) and `Start-Process -WorkingDirectory <dir>` (#227) give one
// command its own directory. The rule that refuses a command running inside the live root
// judged only the directories a `cd` reached, so a run directory inside the root with a
// path argument carrying no separator was allowed. It is now refused the way a `cd` into
// the root is, whatever the arguments.

// ---------------------------------------------------------------------------
// Git index operations may name files under the data root (#234)
// ---------------------------------------------------------------------------
//
// Axial, 2026-09-30: `git add -f data/logs/.../*.py data/runs/883-arm-A/summary.json` was
// refused as a run pointed at production data. `git add` changes no file under the root:
// it writes git's own store, and is not judged on the paths it names. One that discards
// working-tree content is judged on what it reaches, and so is everything around it on the
// line.

describe('git index operations may name files under the data root (#234)', () => {
  const setup = () => {
    const base = tempDir();
    const app = path.join(base, 'app');
    const live = path.join(app, 'data');
    for (const d of [path.join(live, 'logs', 'run'), path.join(live, 'runs', 'arm-A'), path.join(app, 'config')]) {
      mkdirSync(d, { recursive: true });
    }
    return { base, app, live, env: { [LIVE]: live } };
  };
  const x = path.join('data', 'logs', 'run', 'summary.md');
  const y = path.join('data', 'runs', 'arm-A', 'summary.json');

  test("the issue's command runs", () => {
    const { app, env } = setup();
    const command =
      'git pull -q && git add config/briefs/cross && git add -f data/logs/2026-09-30-883-brief-set/*.py ' +
      'data/logs/2026-09-30-883-brief-set/summary.md data/runs/883-arm-A/summary.json ' +
      'data/runs/883-arm-C/summary.json && git status --short';
    assertAllowed(guard({ payload: bash(command, app), env }), 'the issue command');
  });

  test('each subcommand that reads the tree or writes only the index runs', () => {
    const { base, app, live, env } = setup();
    for (const [command, cwd] of [
      [`git add ${x}`, app],
      [`git add -f ${x} ${y}`, app],
      [`git add ${path.join(live, 'logs', 'run', 'summary.md')}`, app],
      [`git commit -m "run log" ${x}`, app],
      [`git commit -F ${x}`, app],
      [`git status ${x}`, app],
      [`git diff --stat -- ${x}`, app],
      [`git log --oneline -- ${x}`, app],
      [`git show HEAD -- ${x}`, app],
      [`git blame ${x}`, app],
      [`git ls-files ${x}`, app],
      [`git stash list`, app],
      [`git stash show -p -- ${x}`, app],
      [`git restore --staged ${x}`, app],
      [`git restore -S -- ${x}`, app],
      [`git reset ${x}`, app],
      [`git reset -q -- ${x}`, app],
      [`git reset --soft HEAD~1`, app],
      [`git reset --mixed HEAD -- ${x}`, app],
      [`git rm --cached ${x}`, app],
      [`git rm -r --cached ${path.join('data', 'logs')}`, app],
      [`git -C ${app} add ${x}`, base],
      [`git -C app add ${x}`, base],
      [`git --no-pager log -- ${x}`, app],
      [`git --git-dir=.git --work-tree=. add ${x}`, app],
      [`git add ${x} && git commit -m "run 883" && git push`, app],
    ]) {
      assertAllowed(guard({ payload: bash(command, cwd), env }), JSON.stringify(command));
    }
  });

  test('a subcommand that discards working-tree content still refuses', () => {
    const { app, env } = setup();
    for (const command of [
      `git checkout -- ${x}`,
      `git checkout HEAD ${x}`,
      `git restore ${x}`,
      `git restore --worktree ${x}`,
      `git restore --staged --worktree ${x}`,
      `git restore -W -S ${x}`,
      `git restore --source=HEAD~1 --staged ${x}`,
      `git reset --hard -- ${x}`,
      `git reset --merge -- ${x}`,
      `git reset --keep -- ${x}`,
      `git reset --ha -- ${x}`,
      `git clean -fd ${path.join('data', 'logs')}`,
      `git stash push -- ${x}`,
      `git stash -- ${x}`,
    ]) {
      // A discard (#237) is judged by git, which cannot read a root outside any repository.
      assertBlockedBecause(guard({ payload: bash(command, app), env }), CHANGES_LIVE_DATA, JSON.stringify(command));
    }
  });

  test('a redirect into the root is still refused', () => {
    const { app, env } = setup();
    for (const command of [`git show HEAD:x > ${y}`, `git diff > ${path.join('data', 'x.patch')}`, `git status >> ${y}`]) {
      assertBlockedBecause(guard({ payload: bash(command, app), env }), CHANGES_LIVE_DATA, JSON.stringify(command));
    }
  });

  test('the commands around a git index operation are judged as before', () => {
    const { app, env } = setup();
    assertBlockedBecause(guard({ payload: bash(`git add ${x}; rm -rf ${y}`, app), env }), CHANGES_LIVE_DATA, 'a delete beside it');
  });

  test('a run directory inside the root is judged by the same subcommand rule', () => {
    const { app, live, env } = setup();
    for (const [command, cwd] of [
      ['git -C data add summary.md', app],
      ['git -C data -C logs status', app],
      ['cd data && git add summary.md', app],
      ['git add summary.md', live],
      ['git commit -m "run log"', live],
    ]) {
      assertAllowed(guard({ payload: bash(command, cwd), env }), JSON.stringify(command));
    }
    for (const [command, cwd] of [
      ['git -C data clean -fd', app],
      ['git -C data checkout -- summary.md', app],
      ['cd data && git clean -fd', app],
      ['git clean -fd', live],
      ['git -C data add summary.md && git -C data clean -fd', app],
    ]) {
      // The discards (#237) are judged by git, which reads no repository here.
      assertBlockedBecause(guard({ payload: bash(command, cwd), env }), CHANGES_LIVE_DATA, JSON.stringify(command));
    }
  });

  // The way a Claude Code session commits: the message is a heredoc read by `cat` inside a
  // command substitution. Its body is message text, not a path to judge.
  const message = (delim, body) => `"$(cat <<${delim}\n${body}\nEOF\n)"`;

  test('a commit message from cat of a heredoc is message text', () => {
    const { app, live, env } = setup();
    const body = `run log for ${x}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
    for (const [command, cwd] of [
      [`git commit -m ${message("'EOF'", body)} ${x}`, app],
      [`git commit -m ${message('EOF', body)} ${x}`, app],
      [`git commit -m ${message('"EOF"', body)}`, app],
      [`git commit -m "$(cat <<-'EOF'\n\t${body}\n\tEOF\n\t)" ${x}`, app],
      [`git add ${x} ${y} && git commit -m ${message("'EOF'", body)}`, app],
      [`git commit -m ${message("'EOF'", 'run log')}`, live],
    ]) {
      assertAllowed(guard({ payload: bash(command, cwd), env }), JSON.stringify(command));
    }
  });

});

// ---------------------------------------------------------------------------
// The guard judges only what git cannot restore (#237)
// ---------------------------------------------------------------------------
//
// Four refusals of legitimate work in Axial (#214, #216, #218, #234) and a fifth (#236):
// each command named the live root and none could lose data git does not hold. The guard
// now refuses a write, move or delete under the root only when git cannot put back what
// it changes: a file git does not track, one with uncommitted changes, or a directory or
// glob that reaches such a file. Tracked status is read from a real repository here, the
// way the guard reads it.

describe('the guard judges only what git cannot restore (#237)', () => {
  const setup = () => {
    const app = makeRepo({
      base: {
        'aeo-tests.json': JSON.stringify({ test: 'npm test' }),
        'docs/reports/dec-75-outcome.md': 'outcome v2\n',
        'data/reports/dec-75-outcome.md': 'outcome v1\n',
        'data/reports/edited.md': 'committed\n',
        'data/clean/c.md': 'tracked\n',
        'data/logs/old/summary.md': 'tracked\n',
        '.gitignore': '*.tmp\n',
      },
    });
    const live = path.join(app, 'data');
    // What git does not hold: run output imported by the founder, and an uncommitted edit.
    for (const [rel, body] of [
      ['data/reports/draft.md', 'untracked\n'],
      ['data/raw/a.json', '{}\n'],
      ['data/logs/2026-09-30-883-brief-set/summary.md', 'untracked\n'],
      ['data/logs/2026-09-30-883-brief-set/x.py', 'print(1)\n'],
      ['data/runs/883-arm-A/summary.json', '{}\n'],
      ['data/map/X/m.json', '{}\n'],
    ]) {
      mkdirSync(path.dirname(path.join(app, rel)), { recursive: true });
      writeFileSync(path.join(app, rel), body);
    }
    writeFileSync(path.join(app, 'data', 'reports', 'edited.md'), 'uncommitted\n');
    const runs = tempDir('aeo-p15-runs-');
    mkdirSync(path.join(runs, 'data', 'map', 'X'), { recursive: true });
    const { sandbox } = roots();
    return { app, live, runs, sandbox, env: { [LIVE]: live } };
  };
  const pwsh = (command, cwd) => ({ ...bash(command, cwd), tool_name: 'PowerShell' });
  const REFUSED = /inside the\s+production data root/;

  test('every command from the five false refusals runs', () => {
    const { app, live, runs, sandbox, env } = setup();
    const compare = 'python -m axial.cli map compare data/map/X data/map/X-category --vocabulary-dir data/vocabulary';
    for (const command of [
      // #236
      'cp docs/reports/dec-75-outcome.md data/reports/dec-75-outcome.md && diff docs/reports/dec-75-outcome.md data/reports/dec-75-outcome.md && echo SAME',
      // #214
      `cd ${app} && gh issue view 853 && gh issue view 855`,
      `cd ${app} && ${DATA}=${sandbox} gh issue view 853`,
      `gh issue create --title "guard" --body "the live root ${path.join(live, 'runs')} was named"`,
      `${DATA}=${sandbox} npm test | tail -5`,
      `${DATA}=${sandbox} npm test ; echo done`,
      // #216
      `git -C ${app} ls-files data/runs`,
      `ls ${live}`,
      `du -sh ${path.join(live, 'raw')}`,
      `dir ${live}`,
      `find ${sandbox} -type f | wc -l`,
      `find ${live} -type f | wc -l`,
      'env | grep AXIAL',
      `robocopy ${live} ${path.join(sandbox, 'copy')} /L /E`,
      // #218
      `cd ${runs} && ${compare} > ${path.join(sandbox, 'compare.txt')} 2>&1`,
      // #234
      'git pull -q && git add config/briefs/cross && git add -f data/logs/2026-09-30-883-brief-set/*.py ' +
        'data/logs/2026-09-30-883-brief-set/summary.md data/runs/883-arm-A/summary.json ' +
        'data/runs/883-arm-C/summary.json && git status --short',
    ]) {
      assertAllowed(guard({ payload: bash(command, app), env }), JSON.stringify(command));
    }
  });

  test('a write, move or delete that git can undo runs', () => {
    const { app, live, sandbox, env } = setup();
    for (const command of [
      'cp docs/reports/dec-75-outcome.md data/reports/',
      'echo more >> data/reports/dec-75-outcome.md',
      'printf x > data/clean/c.md',
      'rm -rf data/clean',
      'rm data/logs/old/summary.md',
      `mv data/clean/c.md ${path.join(sandbox, 'c.md')}`,
      `cp data/raw/a.json ${path.join(sandbox, 'a.json')}`,
      `robocopy ${live} ${path.join(sandbox, 'copy')} /E`,
      `cat data/raw/a.json > ${path.join(sandbox, 'a.json')}`,
      'ls data/raw ; npm test',
      'grep -rn outcome data/reports',
    ]) {
      assertAllowed(guard({ payload: bash(command, app), env }), JSON.stringify(command));
    }
    assertAllowed(
      guard({ payload: pwsh('Copy-Item docs/reports/dec-75-outcome.md -Destination data/reports/dec-75-outcome.md', app), env }),
      'Copy-Item onto a tracked file',
    );
    for (const tool of FILE_TOOLS) {
      assertAllowed(guard({ payload: fileCall(tool, path.join(live, 'reports', 'dec-75-outcome.md'), app), env }), tool);
    }
  });

  test('a write, move or delete that reaches what git does not hold refuses', () => {
    const { app, live, env } = setup();
    for (const command of [
      'cp docs/reports/dec-75-outcome.md data/raw/new.json',
      'cp docs/reports/dec-75-outcome.md data/reports/draft.md',
      'cp docs/reports/dec-75-outcome.md data/reports/edited.md',
      'rm -rf data/reports',
      'rm -rf data/logs/2026-09-30-883-brief-set/*.py',
      'rm -rf data',
      'rm -rf .',
      'rm -rf *',
      'mv data/raw/a.json data/raw/b.json',
      'echo x > data/raw/a.json',
      'ls > data/raw/listing.txt',
      'touch data/raw/new.json',
      'mkdir -p data/raw/new',
      `cat docs/reports/dec-75-outcome.md | tee data/raw/a.json`,
      `cd ${live} && rm -rf raw`,
      `cd data/raw && echo x > a.json`,
      `robocopy ${app} ${live} /MIR`,
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, app), env }), CHANGES_LIVE_DATA, JSON.stringify(command));
    }
    assertBlockedBecause(
      guard({ payload: pwsh('Remove-Item -Recurse -Force data/raw', app), env }),
      CHANGES_LIVE_DATA,
      'Remove-Item of an untracked directory',
    );
    for (const tool of FILE_TOOLS) {
      assertBlockedBecause(
        guard({ payload: fileCall(tool, path.join(live, 'raw', 'new.json'), app), env }),
        /targets .*inside the\s+production data root .*git cannot restore it/,
        tool,
      );
    }
  });

  test('a pure read filter after a read runs', () => {
    const { app, env } = setup();
    for (const command of [
      'head -8 data/reports/dec-75-outcome.md | cut -c1-120',
      'cat data/reports/dec-75-outcome.md | sort | uniq -c',
      'jq . data/raw/a.json',
      'cat data/raw/a.json | tr a b | nl | tac | rev | fold | paste - - | column -t | od -c | less',
      'cat data/raw/a.json | sort -r | uniq',
    ]) {
      assertAllowed(guard({ payload: bash(command, app), env }), JSON.stringify(command));
    }
  });

  test('a new file beside tracked siblings runs, and any other new file refuses', () => {
    const { app, live, env } = setup();
    for (const command of [
      'cp docs/reports/dec-75-outcome.md data/reports/new-report.md',
      'echo x > data/reports/new-report.md',
      'mv docs/reports/dec-75-outcome.md data/reports/moved.md',
      'touch data/reports/new-report.md',
      'cat docs/reports/dec-75-outcome.md | tee data/reports/new-report.md',
    ]) {
      assertAllowed(guard({ payload: bash(command, app), env }), JSON.stringify(command));
    }
    assertAllowed(
      guard({ payload: pwsh('Copy-Item docs/reports/dec-75-outcome.md -Destination data/reports/new-report.md', app), env }),
      'Copy-Item to a new file beside tracked ones',
    );
    for (const tool of FILE_TOOLS) {
      assertAllowed(guard({ payload: fileCall(tool, path.join(live, 'reports', 'new-report.md'), app), env }), tool);
    }
    for (const command of [
      'cp docs/reports/dec-75-outcome.md data/reports/draft.md', // exists, untracked
      'cp docs/reports/dec-75-outcome.md data/reports/scratch.tmp', // git ignores it
      'echo x > data/reports/scratch.tmp',
      'cp docs/reports/dec-75-outcome.md data/newdir/new.md', // its directory does not exist
      'mkdir data/reports/newdir',
      'touch data/raw/new.json', // its directory holds nothing tracked
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, app), env }), CHANGES_LIVE_DATA, JSON.stringify(command));
    }
    for (const rel of ['reports/scratch.tmp', 'reports/draft.md']) {
      assertBlockedBecause(
        guard({ payload: fileCall('Write', path.join(live, rel), app), env }),
        /targets .*inside the\s+production data root .*git cannot restore it/,
        rel,
      );
    }
  });

  test('a variable the session environment defines is read from it', () => {
    const { app, env } = setup();
    assertAllowed(
      guard({ payload: bash('rm -rf "$SCRATCH_DIR/x"', app), env: { ...env, SCRATCH_DIR: tempDir() } }),
      'a defined variable outside the root',
    );
    assertAllowed(
      guard({ payload: pwsh('Remove-Item -Recurse $env:SCRATCH_DIR\\x', app), env: { ...env, SCRATCH_DIR: tempDir() } }),
      'a PowerShell environment variable outside the root',
    );
    assertBlockedBecause(
      guard({ payload: bash('rm -rf "$LIVE_RAW"', app), env: { ...env, LIVE_RAW: path.join(app, 'data', 'raw') } }),
      CHANGES_LIVE_DATA,
      'a defined variable inside the root',
    );
  });

  test('a loop over literal words is judged on each word', () => {
    const { app, env } = setup();
    for (const command of ['for f in a.tmp b.tmp; do rm "$f"; done', 'for f in a.tmp; do rm "docs/$f"; done']) {
      assertAllowed(guard({ payload: bash(command, app), env }), JSON.stringify(command));
    }
    for (const command of ['for f in data/raw/*; do rm "$f"; done', 'for f in x.tmp y.tmp; do rm "data/raw/$f"; done']) {
      assertBlockedBecause(guard({ payload: bash(command, app), env }), REFUSED, JSON.stringify(command));
    }
  });

  test('a git command that discards working-tree content refuses when the root holds what git cannot restore', () => {
    const { app, live, env } = setup();
    for (const [command, cwd] of [
      ['git clean -fdx', app],
      ['git clean -fd', app],
      ['git clean -ffdx .', app],
      ['git -C data clean -fdx', app],
      ['git clean -fdx', live],
      ['git reset --hard', app],
      ['git reset --hard HEAD~1', app],
      ['git reset --merge', app],
      ['git reset --keep HEAD', app],
      ['cd data && git reset --hard', app],
      ['git checkout -- .', app],
      ['git checkout .', app],
      ['git checkout HEAD -- data', app],
      ['git checkout -- data/reports/edited.md', app],
      ['git restore .', app],
      ['git restore --worktree --staged .', app],
      ['git stash', app],
      ['git stash push', app],
      ['git stash -u', app],
      ['git stash push -- data/reports', app],
      ['git switch -f main', app],
      ['git switch --discard-changes main', app],
      ['git checkout -f main', app],
      ['git checkout --force main', app],
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, cwd), env }), CHANGES_LIVE_DATA, JSON.stringify(command));
    }
    for (const command of [
      'git clean -fdx src',
      'git clean -n',
      'git checkout -- docs/reports/dec-75-outcome.md',
      'git checkout -- data/reports/dec-75-outcome.md',
      'git restore docs',
      'git stash push -- docs',
      'git checkout main',
      'git switch main',
      'git stash list',
    ]) {
      assertAllowed(guard({ payload: bash(command, app), env }), JSON.stringify(command));
    }
  });

  test('the same git commands run when the root is clean and fully tracked', () => {
    const app = makeRepo({ base: { 'aeo-tests.json': JSON.stringify({ test: 'npm test' }), 'data/reports/r.md': 'tracked\n' } });
    const env = { [LIVE]: path.join(app, 'data') };
    writeFileSync(path.join(app, 'scratch.tmp'), 'untracked, outside the root\n');
    for (const command of ['git clean -fdx', 'git reset --hard', 'git checkout -- .', 'git restore .', 'git stash -u', 'git switch -f main']) {
      assertAllowed(guard({ payload: bash(command, app), env }), JSON.stringify(command));
    }
  });

  test('a root git cannot read fails closed', () => {
    const { live } = roots();
    const repo = makeRepo();
    mkdirSync(path.join(live, 'index'), { recursive: true });
    writeFileSync(path.join(live, 'index', 'a.json'), '{}\n');
    const r = guard({ payload: bash(`cp README ${path.join(live, 'index', 'a.json')}`, repo), env: { [LIVE]: live } });
    assertBlockedBecause(r, CHANGES_LIVE_DATA, 'no repository around the root');
    assert.match(r.stderr, /git cannot read a repository there/);
  });
});

// ---------------------------------------------------------------------------
// A prefix assignment binds to one command, not to the line
// ---------------------------------------------------------------------------
//
// The seam was read once per line and applied to every command on it, so a safe
// assignment anywhere on the line — before, after, inside a quoted string, inside a
// heredoc body — cleared the whole line. Every shape below ran against production and
// exited 0.

// ---------------------------------------------------------------------------
// Aliased paths: the failure that would be invisible
// ---------------------------------------------------------------------------
//
// isPathInside compares strings and never calls realpath, so two names for one directory
// do not compare equal. For the review jail that costs a review. Here it costs the
// guarantee: a link into production data walks straight past an unresolved check, and the
// data it reaches cannot be un-deleted.

describe('aliased paths', () => {
  function link(target, at) {
    try {
      symlinkSync(target, at, 'junction');
      return true;
    } catch {
      return false;
    }
  }

  test('a production root named through a link still recognises its own contents', (t) => {
    const { base, live, sandbox } = roots();
    const repo = makeRepo();
    const alias = path.join(base, 'prod-alias');
    if (!link(live, alias)) return t.skip('this platform would not create a directory link');
    mkdirSync(path.join(live, 'index'), { recursive: true });
    assertBlockedBecause(
      guard({ payload: bash(`rm -rf ${path.join(live, 'index')}`, repo), env: { [LIVE]: alias, [DATA]: sandbox } }),
      CHANGES_LIVE_DATA,
      'production root declared under its alias, command uses the real name',
    );
  });

  test('a command reaching production data through a link is caught', (t) => {
    const { base, live, sandbox } = roots();
    const repo = makeRepo();
    mkdirSync(path.join(live, 'index'), { recursive: true });
    const alias = path.join(base, 'shortcut');
    if (!link(live, alias)) return t.skip('this platform would not create a directory link');
    assertBlockedBecause(
      guard({ payload: bash(`rm ${path.join(alias, 'index', 'entries.jsonl')}`, repo), env: { [LIVE]: live, [DATA]: sandbox } }),
      CHANGES_LIVE_DATA,
      'command names production data through a link',
    );
  });

  test('a link planted inside the sandbox that points at production data is caught', (t) => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    const trap = path.join(sandbox, 'data');
    if (!link(live, trap)) return t.skip('this platform would not create a directory link');
    assertBlockedBecause(
      guard({ payload: bash(`rm -rf ${path.join(trap, 'index')}`, repo), env: { [LIVE]: live, [DATA]: sandbox } }),
      CHANGES_LIVE_DATA,
      'a sandbox path that is really production data',
    );
  });
});

// ---------------------------------------------------------------------------
// The run-in-progress sentinel (L-02)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// There is no override (L-05)
// ---------------------------------------------------------------------------

describe('no override', () => {
  const disablers = [
    'AEO_SANDBOX_GUARD',
    'AEO_DISABLE_SANDBOX_GUARD',
    'AEO_SKIP_SANDBOX',
    'AEO_ALLOW_LIVE_DATA',
    'AEO_ALLOW_PRODUCTION_DATA',
    'AEO_SANDBOX',
    'AEO_FORCE',
    'AEO_UNSAFE',
    'CLAUDE_DISABLE_HOOKS',
    'DISABLE_HOOKS',
    'SKIP_GATES',
  ];

  test('no environment variable turns the data rule off', () => {
    const { live } = roots();
    const repo = makeRepo();
    for (const name of disablers) {
      for (const value of ['1', 'true']) {
        assertBlockedBecause(
          guard({ payload: bash(`rm ${path.join(live, 'index.json')}`, repo), env: { [LIVE]: live, [name]: value } }),
          CHANGES_LIVE_DATA,
          `${name}=${value}`,
        );
      }
    }
  });

  test('no flag in the command turns anything off', () => {
    const { live } = roots();
    const repo = makeRepo();
    for (const flag of ['--no-sandbox', '--allow-live-data', '--force', '--aeo-skip', '--no-verify', '-f']) {
      assertBlockedBecause(
        guard({ payload: bash(`rm ${flag} ${path.join(live, 'index')}`, repo), env: { [LIVE]: live } }),
        CHANGES_LIVE_DATA,
        `data rule with ${flag}`,
      );
    }
  });

  test('an elevated permission mode does not turn anything off', () => {
    const { live } = roots();
    const repo = makeRepo();
    const extra = { permission_mode: 'bypassPermissions' };
    assertBlockedBecause(
      guard({ payload: bash(`rm -rf ${path.join(live, 'index')}`, repo, extra), env: { [LIVE]: live } }),
      CHANGES_LIVE_DATA,
      'bypassPermissions, data rule',
    );
  });

  // The orchestrator carries no agent_type, and every AEO role carries a namespaced one
  // (C-02). Unlike block-merge, none of them is exempt here: a founder-approved merge is
  // a real workflow, a founder-approved run against production data is not.
  test('every identity is subject to the guard, the orchestrator included', () => {
    const { live } = roots();
    const repo = makeRepo();
    for (const agent_type of [undefined, 'aeo:builder', 'aeo:reviewer', 'aeo:triage', 'builder', 'Explore', 'other:agent']) {
      const extra = agent_type === undefined ? {} : { agent_type };
      assertBlockedBecause(
        guard({ payload: bash(`rm -rf ${path.join(live, 'index')}`, repo, extra), env: { [LIVE]: live } }),
        CHANGES_LIVE_DATA,
        `data rule, ${agent_type}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Malformed payloads
// ---------------------------------------------------------------------------

describe('malformed payloads', () => {
  test('a payload with no usable command allows', () => {
    const { live } = roots();
    const repo = makeRepo();
    for (const tool_input of [undefined, null, {}, { command: 42 }, 'a string']) {
      const payload = bash('placeholder', repo);
      if (tool_input === undefined) delete payload.tool_input;
      else payload.tool_input = tool_input;
      const label = `tool_input ${JSON.stringify(tool_input)}`;
      assertAllowed(guard({ payload, env: { [LIVE]: live } }), label);
    }
  });

  test('a payload with no usable cwd allows', () => {
    const { live, sandbox } = roots();
    for (const cwd of [undefined, '', 42]) {
      const payload = bash('npm test', cwd);
      if (cwd === undefined) delete payload.cwd;
      const label = `cwd ${JSON.stringify(cwd)}`;
      assertAllowed(guard({ payload, env: { [LIVE]: live } }), label);
      assertAllowed(guard({ payload, env: { [LIVE]: live, [DATA]: sandbox } }), `${label}, with a seam`);
    }
  });

  test('extra and unknown payload fields do not disturb the decision', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    const extra = { unknown_future_field: { nested: [1, 2, 3] }, effort: { level: 'max' } };
    assertAllowed(guard({ payload: bash('npm test', repo, extra), env: { [LIVE]: live, [DATA]: sandbox } }), 'extra fields');
    assertBlockedBecause(
      guard({ payload: bash(`rm ${path.join(live, 'index.json')}`, repo, extra), env: { [LIVE]: live } }),
      CHANGES_LIVE_DATA,
      'extra fields, a delete inside production data',
    );
  });

  // Inherited from runGate and deliberately not overridden. An unreadable payload allows,
  // with a line on stderr. The model cannot cause it: Claude Code serialises the payload
  // and every model-controlled string sits inside valid JSON, so a parse failure is a
  // platform fault rather than a bypass. Pinned rather than claimed as covered, because
  // it is the one shape in which this gate does not fire.
  test('an unreadable payload allows and says so, which is the gate not firing', () => {
    for (const raw of ['', '   ', 'not json at all', '[1,2,3]', 'null', '"a string"']) {
      const r = guard({ raw, env: { [LIVE]: 'D:/production' } });
      assert.equal(r.status, 0, `raw ${JSON.stringify(raw)}: expected exit 0`);
      assert.match(r.stderr, /sandbox-guard: (empty|unreadable) hook payload/, `raw ${JSON.stringify(raw)}: silent skip`);
    }
  });
});

// ---------------------------------------------------------------------------
// The pieces, unit level
// ---------------------------------------------------------------------------

describe('resolveRoots', () => {
  test('an MSYS path is normalised on Windows before it is compared', () => {
    const roots = resolveRoots({ env: { [LIVE]: '/d/production' }, platform: 'win32' });
    assert.equal(roots.live.root, 'D:/production');
  });

  // resolveRoots' own file-reading half (#133), isolated from the guard's directory
  // resolution: `dir` is handed in directly, so these run in-process with no subprocess
  // spawn at all.
  describe('resolveRoots reads the live declaration from a file when dir is given', () => {
    function settingsDir(content) {
      const dir = tempDir('aeo-p15-settings-');
      if (content !== undefined) {
        mkdirSync(path.join(dir, '.claude'), { recursive: true });
        writeFileSync(path.join(dir, '.claude', 'settings.json'), content);
      }
      return dir;
    }

    test('no dir passed: behaves exactly as before, straight from env', () => {
      const r = resolveRoots({ env: { [LIVE]: 'D:/production' }, platform: 'win32' });
      assert.equal(r.live.root, 'D:/production');
    });

    test('a dir with no settings file falls back to env', () => {
      const dir = settingsDir(); // no .claude/settings.json at all
      const r = resolveRoots({ env: { [LIVE]: 'D:/production' }, platform: 'win32', dir });
      assert.equal(r.live.root, 'D:/production');
    });

    test('a declared value in the file wins over env', () => {
      const dir = settingsDir(JSON.stringify({ env: { [LIVE]: 'D:/from-file' } }));
      const r = resolveRoots({ env: { [LIVE]: 'D:/from-env' }, platform: 'win32', dir });
      assert.equal(r.live.root, 'D:/from-file');
    });

    test('a blank value in the file means not declared, even with a real value in env', () => {
      const dir = settingsDir(JSON.stringify({ env: { [LIVE]: '' } }));
      const r = resolveRoots({ env: { [LIVE]: 'D:/from-env' }, platform: 'win32', dir });
      assert.equal(r.live.set, false);
    });

    test('the key absent from the file (but the file itself present) falls back to env', () => {
      const dir = settingsDir(JSON.stringify({ env: { SOME_OTHER_KEY: 'x' } }));
      const r = resolveRoots({ env: { [LIVE]: 'D:/from-env' }, platform: 'win32', dir });
      assert.equal(r.live.root, 'D:/from-env');
    });

    test('malformed JSON falls back to env rather than throwing', () => {
      const dir = settingsDir('{not json');
      assert.doesNotThrow(() => resolveRoots({ env: { [LIVE]: 'D:/from-env' }, platform: 'win32', dir }));
      const r = resolveRoots({ env: { [LIVE]: 'D:/from-env' }, platform: 'win32', dir });
      assert.equal(r.live.root, 'D:/from-env');
    });
  });
});

// ---------------------------------------------------------------------------
// Registration (C-01): the gate is only a gate if hooks.json wires it
// ---------------------------------------------------------------------------
//
// These rules no longer have a script of their own in hooks.json. gate.mjs is wired on
// PreToolUse and calls sandboxGuard on the shell arm and the write arm (#167), so what
// registration means here is that the matchers behind gate.mjs reach every tool this
// guard judges and no tool it cannot judge.

describe('hooks.json registration', () => {
  const manifest = path.join(repoRoot, 'plugin', 'hooks', 'hooks.json');

  test('gate.mjs is wired on PreToolUse for the shells and the write tools, with no shell fallback', (t) => {
    if (!existsSync(manifest)) return t.skip('plugin/hooks/hooks.json does not exist yet');
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    const entries = parsed?.hooks?.PreToolUse;
    assert.ok(Array.isArray(entries), 'hooks.json has no PreToolUse array');

    const strings = (node) =>
      typeof node === 'string'
        ? [node]
        : Array.isArray(node)
          ? node.flatMap(strings)
          : node && typeof node === 'object'
            ? Object.values(node).flatMap(strings)
            : [];

    const ours = entries.filter((e) => strings(e).some((str) => str.includes('gate.mjs')));
    assert.ok(ours.length > 0, 'no PreToolUse entry runs gate.mjs');

    // The tools this guard judges must all reach it. A gate the matcher never invokes is
    // not a gate: the file tools were absent here while the guard's own header said
    // production data is not reachable from a session, and a Write into the production
    // root passed with no block at all.
    const reaches = (tool) => ours.some((e) => new RegExp(e.matcher).test(tool));
    // FILE_TOOLS above holds the read tools too, and those are deliberately unmatched
    // now, so this names the write half.
    for (const tool of ['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
      assert.equal(reaches(tool), true, `${tool} never reaches the sandbox rules`);
    }
    // V-12, and the reason the matchers are anchored: BashOutput is not Bash, and a
    // pattern loose enough to catch it would fire the gate on payloads it cannot judge.
    // Read and NotebookRead are out by decision, not by accident: PLAN.md section 2 fires
    // nothing on a read tool, and the L-03 read incident was code reading a live index,
    // which arrives as a Bash call and is still judged.
    for (const tool of ['BashOutput', 'Glob', 'Grep', 'Task', 'WebFetch', 'Read', 'NotebookRead']) {
      assert.equal(reaches(tool), false, `${tool} reaches a gate that does not judge it`);
    }

    for (const entry of ours) {
      for (const str of strings(entry)) {
        assert.doesNotMatch(str, /\|\||&&/, `a shell fallback converts every block into a pass: ${str}`);
      }
      assert.ok(
        strings(entry).some((str) => str.includes('${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs')),
        'the entry must reference ${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs or preflight reports no gate scripts',
      );
    }
  });
});
