// Tests for plugin/hooks/sandbox-guard.mjs and plugin/hooks/sentinel.mjs.
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
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { pathCandidates, shellTokens, invokesDeclaredSuite, resolveRoots, sandboxGuard } from '../../plugin/hooks/sandbox-guard.mjs';
import { parseHookPayload, settleGate } from '../../plugin/hooks/lib.mjs';
import { projectAnchor, sentinelPath } from '../../plugin/hooks/sentinel.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const GUARD = path.join(repoRoot, 'plugin', 'hooks', 'sandbox-guard.mjs');
const GATE = path.join(repoRoot, 'plugin', 'hooks', 'gate.mjs');
const SENTINEL_CLI = path.join(repoRoot, 'plugin', 'scripts', 'run-sentinel.mjs');

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
 * Where every hook child runs. L-03, and this battery is where it bit: the case below
 * that hands the guard a payload with no usable cwd relies on the guard finding no
 * directory, and CLAUDE_PROJECT_DIR being blanked leaves the hook process's own cwd as
 * the last resort. Inherited, that is THIS repository, so the guard read the founder's
 * live sentinel state and those assertions were decided by it. Pinned to scratch.
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

/** Raise a sentinel by writing the file directly, which is what the CLI does. */
function raise(repo, id = 'ingest', record = {}) {
  const file = sentinelPath(repo, id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    typeof record === 'string'
      ? record
      : JSON.stringify({ id, what: 'a long job', started: '2026-08-04T09:00:00Z', pid: null, host: os.hostname(), ...record }),
  );
  return file;
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
 * notes and verdict collected as the text it writes to stderr and stdout. Nothing here
 * touches process.env or process.cwd(), so cases stay isolated from each other.
 */
function decide(options) {
  const { input, childEnv } = hookInput(options);
  const parsed = parseHookPayload('sandbox-guard', input);
  let outcome = parsed.outcome;
  let notes = '';
  if (outcome === null) {
    let caught = null;
    try {
      sandboxGuard(parsed.payload, { env: childEnv, cwd: () => NEUTRAL_CWD, note: (m) => (notes += `${m}\n`) });
    } catch (err) {
      caught = { err };
    }
    outcome = settleGate('sandbox-guard', parsed.payload, caught);
  }
  return { status: outcome.code, stdout: outcome.stdout ?? '', stderr: notes + (outcome.stderr ?? '') };
}

const guard = decide;
const spawnGuard = (options) => runHook(GUARD, options);
// Spawned: gate.mjs also runs block-merge, redirect-guard and path-guard, which read the process's own state.
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

/**
 * A call the guard allowed while saying something about it (#169).
 *
 * The warning reaches the session as one JSON object on stdout. Anything else there, a
 * second object or a line of prose beside it, and the session sees none of it, so this
 * parses stdout rather than matching it.
 */
function assertWarned(result, pattern, message) {
  assert.equal(result.status, 0, `${message}: expected exit 0, got ${result.status}\n${result.stderr}`);
  assert.doesNotMatch(result.stderr, /^BLOCKED: /m, `${message}: blocked when it should have warned`);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    assert.fail(`${message}: stdout is not one JSON object: ${JSON.stringify(result.stdout)}`);
  }
  assert.equal(parsed.hookSpecificOutput.permissionDecision, undefined, `${message}: a warning must not decide permission`);
  assert.match(
    parsed.hookSpecificOutput.additionalContext,
    pattern,
    `${message}: warned, but not about the rule under test\n${result.stdout}`,
  );
  return parsed;
}

// The rule each block message names. Asserting on these is what stops a mutation from
// leaving the battery green because something else happened to block.
const SEAM_OVERLAPS = /One contains the other, so this run is pointed at production data/;
const SEAM_RELATIVE = /is not an absolute\s+path\./;
const LIVE_RELATIVE = /AEO_LIVE_DATA_ROOT is set to .*which is not an absolute path/;
const NAMES_LIVE_DATA = /this command names .*which resolves to .*inside the\s+production data root/;
const TARGETS_LIVE_DATA = /targets .*which resolves to .*inside the\s+production data root/;
const OPERATES_IN = /this command operates in .*inside the production data root/;
// A write, move or delete where git cannot put back what it changes (#237).
const CHANGES_LIVE_DATA = /this command changes .*inside the production data root .*git cannot restore it/;
const LIVE_RUN = /a long job is running and this would execute code alongside it/;
const SENTINEL_UNREADABLE = /sentinel is present but unreadable/;
const SENTINEL_DIR_UNREADABLE = /could not be read \(.*\), so the gate cannot tell whether a long job is running/;
// The two rules that warn instead of refusing (#169). Same wording, read off stdout.
const WARNS_UNNAMED_CD = /changes directory to somewhere the guard cannot name/;
const WARNS_UNREADABLE = /could not be read as a sequence of shell commands/;

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
    for (const payload of [bash(`python read.py ${target}`, tempDir()), pwsh(`python read.py ${target}`, tempDir())]) {
      const r = spawned({ payload, env });
      assertBlockedBecause(r, NAMES_LIVE_DATA, `${payload.tool_name} naming production data`);
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

  test('a warning exits 0 with one JSON object on stdout', () => {
    const { live, sandbox } = roots();
    const r = spawned({ payload: bash('echo "unterminated', tempDir()), env: { [LIVE]: live, [DATA]: sandbox } });
    assertWarned(r, WARNS_UNREADABLE, 'an unreadable command');
    assert.equal(r.stderr, '', 'a warning writes nothing to stderr');
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

  test('a live sentinel blocks, and a stale one allows with a note on stderr', () => {
    const repo = makeRepo();
    raise(repo, 'running', { pid: process.pid, host: os.hostname() });
    assertBlockedBecause(spawned({ payload: bash('npm test', repo) }), LIVE_RUN, 'live owner process');

    const stale = makeRepo();
    raise(stale, 'crashed', { pid: 999_999_999, host: os.hostname() });
    const r = spawned({ payload: bash('npm test', stale) });
    assertAllowed(r, 'stale sentinel');
    assert.match(r.stderr, /^sandbox-guard: .*owner process is gone/m, 'the note did not reach stderr');
  });
});

// ---------------------------------------------------------------------------
// The two cases PLAN's verify line names by name
// ---------------------------------------------------------------------------

describe('the verify line', () => {
  test('the sandbox guard blocks a run pointed at production data', () => {
    const { live } = roots();
    const repo = makeRepo();

    // Pointed at production because the seam resolves inside it.
    assertBlockedBecause(
      guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: path.join(live, 'scratch') } }),
      SEAM_OVERLAPS,
      'suite run with the seam inside production data',
    );

    // No seam at all is not a run pointed at production data: the guard has read nothing
    // that says so, and refusing it refused legitimate work in Axial (#214).
    assertAllowed(guard({ payload: bash('npm test', repo), env: { [LIVE]: live } }), 'suite run with no seam at all');

    // Pointed at production because the command says so outright.
    assertBlockedBecause(
      guard({
        payload: bash(`npm test -- --data-dir=${live}/index`, repo),
        env: { [LIVE]: live, [DATA]: tempDir() },
      }),
      NAMES_LIVE_DATA,
      'suite run naming production data on the command line',
    );
  });

  // D30: this used to also assert that the commit gate blocked a `git commit` attempted
  // while the sentinel was set. commit-gate.mjs is deleted; nothing runs a suite as a
  // side effect of a commit any more, so there is nothing left there for a live sentinel
  // to guard against. sandbox-guard's own sentinel rule (below) still refuses a Bash
  // invocation of the declared suite while a run is live, which is the case that
  // matters: a founder or agent typing the suite directly during a live job.
});

// ---------------------------------------------------------------------------
// The seam (L-03)
// ---------------------------------------------------------------------------

describe('the seam', () => {
  test('with no production data root declared the guard does not fire', () => {
    const repo = makeRepo();
    for (const env of [{}, { [LIVE]: '' }, { [LIVE]: '   ' }, { [DATA]: tempDir() }]) {
      assertAllowed(guard({ payload: bash('npm test', repo), env }), `no declaration, env ${JSON.stringify(env)}`);
    }
  });

  test('a declared production root that is not absolute blocks every command', () => {
    const repo = makeRepo();
    for (const value of ['corpus', './corpus', '../corpus']) {
      for (const command of ['npm test', 'ls']) {
        assertBlockedBecause(
          guard({ payload: bash(command, repo), env: { [LIVE]: value, [DATA]: tempDir() } }),
          LIVE_RELATIVE,
          `live root ${value} with ${command}`,
        );
      }
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

  test('a seam that is not absolute blocks', () => {
    const { live } = roots();
    const repo = makeRepo();
    for (const value of ['sandbox', './sandbox', '../sandbox']) {
      assertBlockedBecause(
        guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: value } }),
        SEAM_RELATIVE,
        `relative seam ${value}`,
      );
    }
  });

  test('a seam disjoint from production data allows', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    for (const command of ['npm test', 'ls', 'git status']) {
      assertAllowed(guard({ payload: bash(command, repo), env: { [LIVE]: live, [DATA]: sandbox } }), command);
    }
  });

  test('a seam inside production data blocks, at every depth', () => {
    const { live } = roots();
    const repo = makeRepo();
    for (const seam of [live, `${live}${path.sep}`, path.join(live, 'tmp'), path.join(live, 'a', 'b', 'c')]) {
      assertBlockedBecause(
        guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: seam } }),
        SEAM_OVERLAPS,
        `seam ${seam}`,
      );
    }
  });

  // The reverse containment is the one that is easy to forget. A seam of `D:/` is not
  // inside the production root, and every byte of production data sits inside it.
  test('a seam that contains production data blocks', () => {
    const { base, live } = roots();
    const repo = makeRepo();
    assertBlockedBecause(
      guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: base } }),
      SEAM_OVERLAPS,
      'seam is the parent of production data',
    );
  });

  // V-12: whole segment, never substring. `production-test` shares every character of
  // `production` and is a different directory.
  test('a sibling whose name merely starts with the production root is not inside it', () => {
    const { base, live } = roots();
    const repo = makeRepo();
    const sibling = `${live}-test`;
    mkdirSync(sibling, { recursive: true });
    assertAllowed(
      guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: sibling } }),
      'name-prefix sibling as the seam',
    );
    assertAllowed(
      guard({ payload: bash(`npm test -- --data-dir=${sibling}/x`, repo), env: { [LIVE]: live, [DATA]: path.join(base, 'sandbox') } }),
      'name-prefix sibling named on the command line',
    );

    // The other direction, which a substring test also gets wrong: a directory whose
    // name is a PREFIX of the production root's name. `<base>/produc` is not an ancestor
    // of `<base>/production`, and one of the two substring comparisons says it is.
    const shorter = path.join(base, 'produc');
    mkdirSync(shorter, { recursive: true });
    assertAllowed(
      guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: shorter } }),
      'a seam whose name is a prefix of the production root',
    );
  });

  // An inline assignment sets the child's environment only in LEADING POSITION. Taking
  // the value from any token that started with the name let the gate be defeated by the
  // remediation the gate itself recommends: writing a settings file changes no running
  // process, so the child still gets the production-pointing seam.
  test('the seam is read only from an assignment in leading position', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    const misconfigured = { [LIVE]: live, [DATA]: path.join(live, 'scratch') };
    for (const command of [
      `echo '${DATA}=${sandbox}' >> .claude/settings.json && npm test`,
      `grep -r ${DATA}=${sandbox} .`,
      `git commit -m "point ${DATA}=${sandbox} at a sandbox"`,
      `echo ${DATA}=${sandbox}`,
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, repo), env: misconfigured }), SEAM_OVERLAPS, command);
    }
  });

  test('an assignment that really is in leading position is still honoured', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    const misconfigured = { [LIVE]: live, [DATA]: path.join(live, 'scratch') };
    for (const command of [`${DATA}=${sandbox} npm test`, `NODE_ENV=ci ${DATA}=${sandbox} npm test`]) {
      assertAllowed(guard({ payload: bash(command, repo), env: misconfigured }), JSON.stringify(command));
    }
  });

  test('an inline assignment in the command is the seam the child will see', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();

    assertAllowed(
      guard({ payload: bash(`${DATA}=${sandbox} npm test`, repo), env: { [LIVE]: live } }),
      'inline seam with none in the session',
    );
    assertBlockedBecause(
      guard({ payload: bash(`${DATA}=${path.join(live, 'x')} npm test`, repo), env: { [LIVE]: live, [DATA]: sandbox } }),
      SEAM_OVERLAPS,
      'a good session seam does not rescue a bad inline one',
    );
    // The shell's own rule: the last assignment wins.
    assertBlockedBecause(
      guard({ payload: bash(`${DATA}=${sandbox} cd x && ${DATA}=${live} npm test`, repo), env: { [LIVE]: live } }),
      SEAM_OVERLAPS,
      'the last inline assignment wins',
    );
  });
});

// ---------------------------------------------------------------------------
// A session with no seam (#214)
// ---------------------------------------------------------------------------
//
// Axial declared AEO_LIVE_DATA_ROOT in its settings file and set no AEO_DATA_ROOT, and the
// guard refused `gh issue view`, then refused it again behind the prefix its own message
// prescribed, because the `cd` before it was judged against the unset session seam. That
// refusal read no production data. It is removed (PLAN section 5, kill line). A seam that
// is set is still judged, and so are the rules that read a path.

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

  test('a seam that is set is still judged', () => {
    const { live, repo } = setup();
    assertBlockedBecause(
      guard({ payload: bash(`${DATA}=${path.join(live, 'x')} npm test`, repo), env: {} }),
      SEAM_OVERLAPS,
      'inline seam inside production data',
    );
    assertBlockedBecause(
      guard({ payload: bash(`${DATA}=relative/dir npm test`, repo), env: {} }),
      SEAM_RELATIVE,
      'inline relative seam',
    );
    assertBlockedBecause(
      guard({ payload: bash(`${DATA}=${path.join(live, 'x')} npm test | tail -5`, repo), env: {} }),
      SEAM_OVERLAPS,
      'inline seam inside production data, piped',
    );
  });

  test('the rules that read a path still refuse', () => {
    const { live, repo } = setup();
    assertBlockedBecause(
      guard({ payload: bash(`python ${path.join(live, 'x')}`, repo), env: {} }),
      NAMES_LIVE_DATA,
      'a path named inside production data',
    );
    assertBlockedBecause(
      guard({ payload: bash('python run.py', live), env: { [LIVE]: live } }),
      OPERATES_IN,
      'a command run from inside production data',
    );
  });
});

// ---------------------------------------------------------------------------
// The declaration file (#133)
// ---------------------------------------------------------------------------
//
// AEO_LIVE_DATA_ROOT is read from .claude/settings.json now, re-resolved on every
// invocation, instead of trusted from process.env. AEO_DATA_ROOT stays exactly where it
// was -- these cases prove the two did not converge. The regression that got this filed:
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

  // The probe for "armed": a command naming a path inside the declared root. With no
  // declaration that path is an ordinary directory and the command runs.
  const probe = (live) => `python read.py ${path.join(live, 'index.json')}`;

  test('a declaration in the file alone arms the guard, with nothing in the environment', () => {
    const { live } = roots();
    const repo = makeRepo();
    writeSettings(repo, { live });
    assertBlockedBecause(guard({ payload: bash(probe(live), repo), env: {} }), NAMES_LIVE_DATA, 'file-only declaration');
  });

  test('the file is re-read on every invocation: a blank rewrite disarms the very next call', () => {
    const { live } = roots();
    const repo = makeRepo();
    const settingsFile = writeSettings(repo, { live });
    assertBlockedBecause(guard({ payload: bash(probe(live), repo), env: {} }), NAMES_LIVE_DATA, 'armed by the file');

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
    const staleEnv = { [LIVE]: live, [DATA]: path.join(live, 'scratch') }; // env still thinks otherwise
    assertAllowed(guard({ payload: bash('npm test', repo), env: staleEnv }), 'file says blank; the guard must not trust the stale env');

    // Control: with no file at all, the stale env is exactly what the guard used to run
    // on, so this proves the ALLOW above came from the file and not from something else.
    const noFile = makeRepo();
    assertBlockedBecause(guard({ payload: bash('npm test', noFile), env: staleEnv }), SEAM_OVERLAPS, 'no file: env is still honoured');
  });

  test('a missing or malformed settings.json defers to the environment, not to a block of its own', () => {
    const { live } = roots();
    const repo = makeRepo(); // no .claude/settings.json at all
    assertBlockedBecause(
      guard({ payload: bash(probe(live), repo), env: { [LIVE]: live } }),
      NAMES_LIVE_DATA,
      'no settings file: env still arms it',
    );

    const file = path.join(repo, '.claude', 'settings.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{not json');
    assertBlockedBecause(
      guard({ payload: bash(probe(live), repo), env: { [LIVE]: live } }),
      NAMES_LIVE_DATA,
      'malformed settings file: env still arms it',
    );
  });

  test('AEO_DATA_ROOT in the file is never read; the seam stays environment-only', () => {
    const { live } = roots();
    const repo = makeRepo();
    // The file's seam points inside production data. Were it read, the seam rule would
    // refuse; it is not, so the command sees no seam and runs.
    writeSettings(repo, { live, data: path.join(live, 'scratch') });
    assertAllowed(guard({ payload: bash('npm test', repo), env: {} }), 'AEO_DATA_ROOT in the file does nothing');
  });

  test('payload.cwd outranks CLAUDE_PROJECT_DIR when locating the declaration file', () => {
    const { live: liveA, sandbox: sandboxA } = roots();
    const { live: liveB } = roots();
    const repoA = makeRepo();
    const repoB = makeRepo();
    writeSettings(repoA, { live: liveA });
    writeSettings(repoB, { live: liveB });
    mkdirSync(path.join(liveA, 'index'), { recursive: true });
    // AEO_DATA_ROOT stays environment-only by design, so the seam is given here rather
    // than in either file, disjoint from both declared roots.
    const env = { CLAUDE_PROJECT_DIR: repoB, [DATA]: sandboxA };
    // The command names liveA outright. If repoA's own declaration governs (payload.cwd
    // wins, as it must), this blocks by naming production data. If CLAUDE_PROJECT_DIR's
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
      NAMES_LIVE_DATA,
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
      NAMES_LIVE_DATA,
      'worktree, same declaration as main, immediately after creation',
    );

    // Editing the worktree's own copy does not touch main's, and vice versa: each
    // resolves independently, which is the guarantee #133 was filed over.
    writeSettings(worktree, { live: liveWt });
    assertBlockedBecause(
      guard({ payload: bash(probe(liveWt), worktree), env: {} }),
      NAMES_LIVE_DATA,
      'worktree, its own edited declaration',
    );
    assertAllowed(guard({ payload: bash(probe(liveMain), worktree), env: {} }), "the worktree no longer reads main's declared root");

    assertBlockedBecause(
      guard({ payload: bash(probe(liveMain), main), env: {} }),
      NAMES_LIVE_DATA,
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
    for (const command of [
      `pytest --data-dir=${inside}`,
      `python -m tool --out "${inside}"`,
      `node read.mjs ${path.join(inside, 'entries.jsonl')}`,
    ]) {
      assertBlockedBecause(
        guard({ payload: bash(command, repo), env: { [LIVE]: live, [DATA]: sandbox } }),
        NAMES_LIVE_DATA,
        command,
      );
    }
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
// The directory the command runs in
// ---------------------------------------------------------------------------
//
// pathCandidates skips a token with no separator in it, which is right on its own and a
// hole in combination with a `cd`: no token in `cd corpus && rm -rf index` carries a
// separator, so the candidate list is empty and the rule above never runs. The guard
// caught the spelled-out forms and missed the ordinary one, and the Bash tool persists
// its working directory between calls, so one `cd corpus` reaches the same place.

describe('the operation directory', () => {
  test('a relative cd into production data blocks', () => {
    const { base, live, sandbox } = roots();
    mkdirSync(path.join(live, 'index'), { recursive: true });
    assertBlockedBecause(
      guard({ payload: bash(`cd ${path.basename(live)} && python run.py index`, base), env: { [LIVE]: live, [DATA]: sandbox } }),
      OPERATES_IN,
      'relative cd into production data; no token carries a separator',
    );
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
    for (const command of ['python run.py', 'sqlite3 entries.db']) {
      assertBlockedBecause(
        guard({ payload: bash(command, live), env: { [LIVE]: live, [DATA]: sandbox } }),
        OPERATES_IN,
        `${command} with the session cwd inside production data`,
      );
    }
  });

  // The two controls from the probe. Both blocked before the rule above existed and must
  // still block, by the more specific rule: they name the path outright.
  test('the spelled-out forms still block by the rule that names the path', () => {
    const { base, live, sandbox } = roots();
    const env = { [LIVE]: live, [DATA]: sandbox };
    mkdirSync(path.join(live, 'index'), { recursive: true });
    assertBlockedBecause(guard({ payload: bash(`cd ${live} && rm -rf index`, base), env }), CHANGES_LIVE_DATA, 'absolute cd');
    assertBlockedBecause(guard({ payload: bash(`cd ${live} && python run.py`, base), env }), OPERATES_IN, 'absolute cd, a run');
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
// each refused for naming it, which read no data that a write could harm. A line whose
// every command is on a short list that cannot write or run project code may now name
// production data and run from inside it. One command off the list and the whole line is
// judged as before, because a read-only command's output can feed one that is not.

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

  test('a write, an interpreter or a project entry point still refuses by the path it names', () => {
    const { base, sandbox, vault, env } = setup();
    const a = path.join(vault, 'a.md');
    const b = path.join(vault, 'b.md');
    for (const command of [`ls ${vault} > ${path.join(vault, 'x')}`, `cat ${a} >> ${b}`, `ls ${vault} && rm -rf ${path.join(vault, 'x')}`]) {
      assertBlockedBecause(guard({ payload: bash(command, base), env }), CHANGES_LIVE_DATA, JSON.stringify(command));
    }
    for (const command of [
      `cat ${a} | tee ${b}`,
      `find ${vault} -delete`,
      `find ${vault} -exec rm {} ;`,
      `find ${vault} -execdir rm {} +`,
      `find ${vault} -fprint ${path.join(sandbox, 'x')}`,
      `find ${vault} -name '*.tmp' | xargs rm`,
      `python ${path.join(vault, 'x.py')}`,
      `uv run axial --root ${vault}`,
      `sqlite3 ${path.join(vault, 'db')}`,
      `node ${path.join(vault, 'x.mjs')}`,
      `git diff --output=${path.join(vault, 'x')}`,
      `git diff --output ${path.join(vault, 'x')}`,
      `git diff --outp=${path.join(vault, 'x')}`,
      `git diff --ext-diff -- ${vault}`,
      `git diff --textconv -- ${vault}`,
      `git -c core.fsmonitor=x status ${vault}`,
      `git rm ${a}`,
      `./ls ${vault}`,
      `${path.join(vault, 'ls')} ${sandbox}`,
      `X=${a} ls ${sandbox}`,
      `ls "${vault}`, // unreadable: no exemption without a parse
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, base), env }), NAMES_LIVE_DATA, JSON.stringify(command));
    }
  });

  test('from inside production data, anything off the list still refuses', () => {
    const { base, live, vault, env } = setup();
    const rel = path.basename(live);
    for (const [command, cwd] of [
      ['python x.py', vault],
      ['ls "$(rm -rf x)"', vault],
      [`cd ${rel} && python x.py`, base],
      [`cd ${live} && python x.py`, base],
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, cwd), env }), OPERATES_IN, `${command} in ${cwd}`);
    }
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
//
// The three rules that stay Bash-only have their own cases below, because each is a
// deliberate decision and a silent change of mind in either direction is the expensive
// kind.

// The same hole, one tool further out (C-07). D22 closed the file-tool half by widening
// the matcher off `^Bash$`; PowerShell is a first-class tool that survives the
// background-subagent filter and was still outside it, so `Get-Content <file inside
// production data>` passed while `cat` of the same file was refused. This gate does not
// exempt the main session, which is what made it the one that was actually open.
//
// The segmenter is a Bash reader. It handles these forms because the two shells agree on
// them, and where they disagree it declines to read rather than guessing: a PowerShell
// backtick reads as a command substitution and errors, and an error blocks.
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
      spawnGuard({ payload: pwsh(`python read.py ${target}`, tempDir()), env: { [LIVE]: live, [DATA]: sandbox } }),
      NAMES_LIVE_DATA,
      'a backslash-separated target',
    );
  });

  test('a cd into production data is honoured on the PowerShell arm too', () => {
    // A relative target, so no token names the root and the directory rule is the one
    // under test. An absolute `cd <live>;` is refused one rule earlier, for naming it (#218).
    const { base, live, sandbox } = roots();
    const env = { [LIVE]: live, [DATA]: sandbox };
    assertBlockedBecause(
      guard({ payload: pwsh(`cd ${path.basename(live)}; python run.py corpus`, base), env }),
      OPERATES_IN,
      'a cd through the PowerShell statement separator',
    );
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

  // L-03's shape is code reading an index. `cat` of one file is on the read-only list
  // now (#216), so the probe is a script, which is what L-03 was.
  test("a Bash call reading the same file still blocks, which is L-03's own shape", () => {
    const { live, sandbox } = roots();
    const target = path.join(live, 'index', 'entries.jsonl');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '{}\n');
    const payload = {
      session_id: 'test-session',
      hook_event_name: 'PreToolUse',
      cwd: tempDir(),
      tool_name: 'Bash',
      tool_input: { command: `node count.mjs ${target}` },
    };
    const env = { [LIVE]: live, [DATA]: sandbox };
    assertBlockedBecause(guard({ payload, env }), NAMES_LIVE_DATA, 'a Bash read of production data');
    assertBlockedBecause(gate({ payload, env }), NAMES_LIVE_DATA, 'a Bash read of production data, through the gate');
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

  // The three Bash-only rules, each pinned in both directions. A file tool spawns no
  // child and runs no suite, and its one target is judged by the rule that reads a path.
  test('the seam rule does not hold a file tool, and still holds Bash', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    const env = { [LIVE]: live, [DATA]: path.join(live, 'scratch') };
    assertAllowed(
      guard({ payload: fileCall('Edit', path.join(sandbox, 'settings.json'), repo), env }),
      'an Edit outside production data with the session seam inside it',
    );
    assertBlockedBecause(guard({ payload: bash('ls', repo), env }), SEAM_OVERLAPS, 'the Bash control');
  });

  test('the sentinel does not hold a file tool, and still holds Bash', () => {
    const repo = makeRepo();
    raise(repo);
    assertAllowed(guard({ payload: fileCall('Write', path.join(repo, 'a.js'), repo) }), 'a Write during a live run');
    assertBlockedBecause(guard({ payload: bash('npm test', repo) }), LIVE_RUN, 'the Bash control');
  });

  test('the operation-directory rule does not hold a file tool writing outside', () => {
    const { live, sandbox } = roots();
    // The session sits inside production data, and the target is absolute and elsewhere.
    // Rule 6 exists for the relative paths a command names and the guard cannot see; a
    // file tool names exactly one target and the case above already judges it.
    assertAllowed(
      guard({ payload: fileCall('Write', path.join(sandbox, 'notes.md'), live), env: { [LIVE]: live, [DATA]: sandbox } }),
      'absolute target outside, session cwd inside production data',
    );
    assertBlockedBecause(
      guard({ payload: bash('python run.py index', live), env: { [LIVE]: live, [DATA]: sandbox } }),
      OPERATES_IN,
      'the Bash control',
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
// The operation-directory rule matched `cd X &&` and nothing else. Every shape below
// deletes production data and exited 0, while the one syntax that was patched exited 2.
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
      `cd ${prod} && python run.py corpus`, // the control: this one always blocked
      `cd ${prod} ; python run.py corpus`,
      `cd ${prod}\npython run.py corpus`,
      `pushd ${prod} && python run.py corpus`,
      `cd -- ${prod} && python run.py corpus`,
      `( cd ${prod} && python run.py corpus )`,
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, base), env }), OPERATES_IN, JSON.stringify(command));
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

  // #169: a directory the guard cannot name is judged on the directories it did name,
  // and the session is told which one could not be read.
  test('a cd to somewhere the guard cannot name warns and allows', () => {
    const { base, env } = setup();
    // A write after it is refused instead (#237): where it lands cannot be decided.
    for (const command of ['cd $PROD && python run.py corpus', 'cd && python run.py corpus', 'cd - && python run.py corpus']) {
      assertWarned(guard({ payload: bash(command, base), env }), WARNS_UNNAMED_CD, JSON.stringify(command));
    }
  });

  test('a command that cannot be read at all warns and allows', () => {
    const { base, env } = setup();
    for (const command of ['rm -rf `cat target.txt`', "rm -rf 'corpus", 'cd "prod && rm -rf corpus']) {
      assertWarned(guard({ payload: bash(command, base), env }), WARNS_UNREADABLE, JSON.stringify(command));
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

describe('a command the guard cannot read is judged on what it can read (#169)', () => {
  const setup = () => {
    const { base, live, sandbox } = roots();
    mkdirSync(path.join(live, 'index'), { recursive: true });
    return { base, live, sandbox, env: { [LIVE]: live, [DATA]: sandbox } };
  };

  test('an unreadable command that reaches nothing runs, and the warning names it', () => {
    const { base, env } = setup();
    const parsed = assertWarned(guard({ payload: bash('echo "unterminated', base), env }), WARNS_UNREADABLE, 'echo');
    assert.match(parsed.hookSpecificOutput.additionalContext, /echo "unterminated/);
  });

  test('an unreadable command still blocks on a path inside production data', () => {
    const { base, live, env } = setup();
    const command = `cat "unterminated ${path.join(live, 'index.json')}`;
    assertBlockedBecause(guard({ payload: bash(command, base), env }), NAMES_LIVE_DATA, command);
  });

  // The adversarial read on this slice: a quote is not a way past the token judgement.
  // The token regex takes no opinion from an opening quote it never sees closed, so the
  // path inside it is still a token. A path with a space in it splits at the space, and
  // the left half is still inside the production root, which is what blocks.
  test('an unterminated quote does not hide a path inside production data', () => {
    const { base, live, env } = setup();
    mkdirSync(path.join(live, 'my data'), { recursive: true });
    for (const command of [
      `cat "${path.join(live, 'index.json')}`,
      `cat '${path.join(live, 'index.json')}`,
      `cat "${path.join(live, 'my data', 'index.json')}`,
      `cat "unterminated ${path.join(live, 'index.json')} and more`,
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, base), env }), NAMES_LIVE_DATA, command);
    }
  });

  // The shape that does escape, pinned rather than claimed as fixed: a production root
  // whose OWN path contains a space. The split then leaves a left half that is a sibling
  // of the root rather than a child of it, and a right half that is relative. The seam
  // rule still covers the ordinary way a run reaches production data; what escapes here
  // is one command naming one path by hand inside a quote that never closes.
  test('a production root whose own path contains a space is a known miss', () => {
    const base = tempDir();
    const live = path.join(base, 'my production');
    const sandbox = path.join(base, 'sandbox');
    mkdirSync(live, { recursive: true });
    mkdirSync(sandbox, { recursive: true });
    const command = `cat "${path.join(live, 'index.json')}`;
    assertWarned(
      guard({ payload: bash(command, base), env: { [LIVE]: live, [DATA]: sandbox } }),
      WARNS_UNREADABLE,
      command,
    );
  });

  test('an unreadable command still blocks on the directory it runs in', () => {
    const { live, env } = setup();
    assertBlockedBecause(guard({ payload: bash('echo "unterminated', live), env }), OPERATES_IN, 'run from inside');
  });

  test('an unreadable command still blocks on a seam inside production data', () => {
    const { base, live } = setup();
    assertBlockedBecause(
      guard({ payload: bash('echo "unterminated', base), env: { [LIVE]: live, [DATA]: path.join(live, 'scratch') } }),
      SEAM_OVERLAPS,
      'the seam rule needs no parse',
    );
  });

  test('an unreadable command with no seam warns and runs (#214)', () => {
    const { base, live } = setup();
    assertWarned(
      guard({ payload: bash('echo "unterminated', base), env: { [LIVE]: live, [DATA]: undefined } }),
      WARNS_UNREADABLE,
      'no seam, nothing named inside production data',
    );
  });

  test('an unreadable command still blocks the declared suite during a live run', () => {
    const repo = makeRepo();
    raise(repo);
    assertBlockedBecause(guard({ payload: bash('npm test "unterminated', repo) }), LIVE_RUN, 'sentinel on tokens');
  });

  test('a cd the guard cannot name runs, and the warning names the command', () => {
    const { base, env } = setup();
    const parsed = assertWarned(guard({ payload: bash('cd $DIR && ls', base), env }), WARNS_UNNAMED_CD, 'cd $DIR && ls');
    assert.match(parsed.hookSpecificOutput.additionalContext, /cd \$DIR && ls/);
  });

  test('a cd the guard cannot name still blocks on an absolute path inside production data', () => {
    const { base, live, env } = setup();
    const command = `cd $DIR && python run.py ${path.join(live, 'x')}`;
    assertBlockedBecause(guard({ payload: bash(command, base), env }), NAMES_LIVE_DATA, command);
  });

  test('a cd the guard cannot name still blocks on a directory the walk did resolve', () => {
    const { live, env } = setup();
    assertBlockedBecause(guard({ payload: bash('cd $DIR && python run.py index', live), env }), OPERATES_IN, 'started inside');
  });

  // A KNOWN MISS, pinned rather than claimed as covered. The tokeniser splits on a space
  // it sees outside a quote, so an unterminated quote around a path whose PRODUCTION ROOT
  // ITSELF contains a space leaves two tokens, and neither of them resolves inside that
  // root. The command reaches production data and gets a warning instead of a refusal. A
  // space below the root is caught, because the token left of it is still inside the root
  // (the test above). What still covers the ordinary shape of this is the seam rule,
  // which needs no parse; what escapes is one command naming one path by hand.
  test('an unterminated quote around a production root whose own path contains a space is not caught', () => {
    const base = tempDir();
    const live = path.join(base, 'live data');
    const sandbox = path.join(base, 'sandbox');
    mkdirSync(live, { recursive: true });
    mkdirSync(sandbox, { recursive: true });
    assertWarned(
      guard({ payload: bash(`cat "${path.join(live, 'index.json')}`, base), env: { [LIVE]: live, [DATA]: sandbox } }),
      WARNS_UNREADABLE,
      'a space inside the production root defeats the token split',
    );
  });

  // With nothing declared there is nothing to protect and nothing to say. A guard that
  // narrated every backtick in a project with no production data is a guard people delete.
  test('with no declaration at all an unreadable command says nothing', () => {
    const { base } = setup();
    const r = guard({ payload: bash('echo "unterminated', base) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
  });
});

// ---------------------------------------------------------------------------
// A relative path resolves where its own command runs (#218)
// ---------------------------------------------------------------------------
//
// Axial, 2026-09-29: a session sitting in the checkout whose `data/` is the live root ran
// `cd /d/axial-runs && python -m axial.cli map compare data/map/X ...` and was refused,
// because `data/map/X` was resolved against the session directory rather than the runs
// checkout the `cd` had moved to. Each command's relative paths now resolve against the
// directory that command runs in. The same rule refuses the mirror image, a `cd` INTO the
// live checkout from outside it, which the old resolution let through.

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

  test('a cd into the live checkout from outside it refuses a relative path inside the live root', () => {
    const { base, axial, runs, env } = setup();
    for (const [command, cwd] of [
      [`cd ${msys(axial)} && ${compare}`, runs],
      [`cd ${axial} && python run.py --out data/map/X`, runs],
      [`cd ../axial && ${compare}`, runs],
      [`cd axial && ${compare}`, base],
      [`cd .. && cd axial && ${compare}`, runs],
      [`cd ${runs} && ls && cd ${axial} && ${compare}`, base],
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, cwd), env }), NAMES_LIVE_DATA, JSON.stringify(command));
    }
  });

  test('a command the cd does not reach still resolves against where it runs', () => {
    const { axial, runs, env } = setup();
    for (const command of [
      `cd ${runs} || ${compare}`, // runs only when the cd failed, so in the session directory
      `( cd ${runs} ) && ${compare}`, // the cd dies with the subshell
      `( cd ${runs} && ls ) ; ${compare}`,
      `${compare} && cd ${runs}`, // before the cd
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, axial), env }), NAMES_LIVE_DATA, JSON.stringify(command));
    }
    assertAllowed(guard({ payload: bash(`( cd ${runs} && ${compare} ) && ls`, axial), env }), 'inside the subshell');
  });

  // #169: a `cd` the guard cannot name gives a relative path after it no directory, so it
  // is not resolved, and the warning says so. That stays. What changes is the command
  // BEFORE such a `cd`: it runs where the session sits, which the guard does know.
  test('a cd the guard cannot name does not loosen what runs before it', () => {
    const { axial, env } = setup();
    for (const command of [`cd $RUNS && ${compare}`, `cd - && ${compare}`]) {
      assertWarned(guard({ payload: bash(command, axial), env }), WARNS_UNNAMED_CD, JSON.stringify(command));
    }
    assertBlockedBecause(guard({ payload: bash(`${compare} && cd $RUNS && ls`, axial), env }), NAMES_LIVE_DATA, 'a run before it');
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
// `cd` does (#218), each `-C` relative to the one before it. The mirror image, `git -C <live
// checkout> add data/...` from outside it, is refused.

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

  test('a -C into the live checkout from outside it refuses a relative path inside the live root', () => {
    const { base, axial, runs, env } = setup();
    for (const [command, cwd] of [
      [`git -C ${msys(axial)} rm ${spec}`, runs],
      [`git -C ../axial rm ${spec}`, runs],
      [`git -C axial rm ${spec}`, base],
      [`git -C .. -C axial rm ${spec}`, runs],
      [`git -C ${runs} -C ../axial rm ${spec}`, base],
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, cwd), env }), NAMES_LIVE_DATA, JSON.stringify(command));
    }
  });

  // A global option that takes its value as a separate word must not end the scan for -C:
  // a scan that stops at the value sees no -C and resolves against the session directory,
  // which allows a write into the live root.
  test('a -C after a global option with a separate value is still read', () => {
    const { base, axial, runs, env } = setup();
    for (const opt of ['--git-dir .git', '--work-tree .', '--namespace ns', '--super-prefix p/', '--config-env core.x=VAR']) {
      assertBlockedBecause(
        guard({ payload: bash(`git ${opt} -C ../axial rm ${spec}`, runs), env }),
        NAMES_LIVE_DATA,
        opt,
      );
      assertAllowed(guard({ payload: bash(`git ${opt} -C ${runs} add ${spec}`, axial), env }), opt);
    }
    assertAllowed(
      guard({ payload: bash(`git --git-dir ${msys(runs)}/.git -C ${msys(runs)} add ${spec}`, axial), env }),
      'a --git-dir inside the runs checkout',
    );
    assertBlockedBecause(
      guard({ payload: bash(`git --git-dir=.git -C axial rm ${spec}`, base), env }),
      NAMES_LIVE_DATA,
      'the = form',
    );
  });

  test('a -C does not reach the commands around it', () => {
    const { axial, runs, env } = setup();
    for (const command of [`git -C ${runs} status && git rm ${spec}`, `git rm ${spec} && git -C ${runs} status`]) {
      assertBlockedBecause(guard({ payload: bash(command, axial), env }), NAMES_LIVE_DATA, JSON.stringify(command));
    }
    assertAllowed(guard({ payload: bash(`git -C ${runs} status && git -C ${runs} add ${spec}`, axial), env }), 'each -C on its own');
  });

  test('a -C the guard cannot name gives a relative path no directory, and warns', () => {
    const { axial, env } = setup();
    for (const command of [`git -C $RUNS add ${spec}`, `git -C "$RUNS" add ${spec}`]) {
      assertWarned(guard({ payload: bash(command, axial), env }), WARNS_UNNAMED_CD, JSON.stringify(command));
    }
    assertBlockedBecause(guard({ payload: bash(`git -C $RUNS status && git rm ${spec}`, axial), env }), NAMES_LIVE_DATA, 'a later command');
  });
});

// ---------------------------------------------------------------------------
// A relative path in Start-Process resolves against -WorkingDirectory (#227)
// ---------------------------------------------------------------------------
//
// Axial, 2026-09-30: from the live checkout, a `Start-Process ... -WorkingDirectory
// D:\axial-runs` sweep naming `data/runs/881-arm-C` was refused, because the path was
// resolved against the session directory rather than the directory the process runs in.
// The refusal also named `data/runs/881-arm-C,`: the comma that separates a PowerShell
// argument list was kept as part of the path. The mirror image, a -WorkingDirectory into
// the live checkout from outside it, is refused.

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

  test('a -WorkingDirectory into the live checkout from outside it refuses a relative path inside the live root', () => {
    const { base, axial, runs, env } = setup();
    const python = path.join(runs, '.venv', 'Scripts', 'python.exe');
    for (const [wd, cwd] of [
      [`-WorkingDirectory "${axial}"`, runs],
      [`-WorkingDirectory ${path.join('..', 'axial')}`, runs],
      ['-WorkingDirectory axial', base],
      [`-wo ${axial}`, runs],
      [`-WorkingDirectory:${axial}`, runs],
    ]) {
      assertBlockedBecause(guard({ payload: pwsh(sweep(python, wd), cwd), env }), NAMES_LIVE_DATA, wd);
    }
  });

  test('a -WorkingDirectory does not reach the commands around it', () => {
    const { axial, runs, env } = setup();
    const python = path.join(runs, '.venv', 'Scripts', 'python.exe');
    const other = 'python -m axial.cli brief sweep --sweep-dir data/runs/881-arm-C';
    for (const command of [
      `${sweep(python, `-WorkingDirectory "${runs}"`)}; ${other}`,
      `${other}; ${sweep(python, `-WorkingDirectory "${runs}"`)}`,
    ]) {
      assertBlockedBecause(guard({ payload: pwsh(command, axial), env }), NAMES_LIVE_DATA, JSON.stringify(command));
    }
  });

  test('a -WorkingDirectory the guard cannot name gives a relative path no directory, and warns', () => {
    const { axial, runs, env } = setup();
    const python = path.join(runs, '.venv', 'Scripts', 'python.exe');
    for (const wd of ['-WorkingDirectory $runs', '-WorkingDirectory "$runs"', '-WorkingDirectory:$runs']) {
      assertWarned(guard({ payload: pwsh(sweep(python, wd), axial), env }), WARNS_UNNAMED_CD, wd);
    }
  });

  test('a PowerShell list separator is not part of the path it follows', () => {
    const { axial, live, runs, env } = setup();
    const python = path.join(runs, '.venv', 'Scripts', 'python.exe');
    const result = guard({ payload: pwsh(sweep(python, ''), axial), env });
    assertBlockedBecause(result, NAMES_LIVE_DATA, 'no -WorkingDirectory: the session directory');
    assert.match(result.stderr, /names "data\/runs\/881-arm-C",/, 'the refusal names the path without its comma');
    assert.deepEqual(pathCandidates(shellTokens('x -ArgumentList "a/b", "c/d",')), ['a/b', 'c/d']);
    assert.deepEqual(pathCandidates(shellTokens('x -ArgumentList ,"a/b"')), ['a/b']);
    // Two quoted items with no space between them are one word to the scanner; each is judged.
    assertBlockedBecause(
      guard({ payload: pwsh(`Start-Process python -ArgumentList "run.py","${path.join(live, 'runs')}"`, runs), env }),
      NAMES_LIVE_DATA,
      'a live path joined to the item before it by a comma',
    );
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

describe('a run directory inside the production data root is refused (#229)', () => {
  const pwsh = (command, cwd) => ({ ...bash(command, cwd), tool_name: 'PowerShell' });
  const setup = () => {
    const base = tempDir();
    const app = path.join(base, 'app');
    const live = path.join(app, 'data');
    const tools = path.join(base, 'tools');
    for (const d of [path.join(live, 'logs'), path.join(app, 'src'), path.join(app, 'data-archive'), tools]) {
      mkdirSync(d, { recursive: true });
    }
    return { base, app, live, tools, env: { [LIVE]: live } };
  };
  const saps = (wd) => `Start-Process python -ArgumentList "x.py","summary.md" -WorkingDirectory ${wd}`;

  test('a cd into the root with a bare filename is refused, the baseline the others match', () => {
    const { app, env } = setup();
    for (const command of ['cd data; python x.py summary.md', 'cd data && git rm summary.md']) {
      assertBlockedBecause(guard({ payload: bash(command, app), env }), OPERATES_IN, JSON.stringify(command));
    }
  });

  test('git -C into the root with a bare filename is refused', () => {
    const { app, tools, env } = setup();
    for (const [command, cwd] of [
      ['git -C data rm summary.md', app],
      ['git -C .. -C app -C data rm summary.md', tools],
      [`git -C ${path.join('..', 'app', 'data')} rm summary.md`, tools],
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, cwd), env }), OPERATES_IN, JSON.stringify(command));
    }
  });

  test('Start-Process -WorkingDirectory into the root with a bare filename is refused', () => {
    const { app, tools, env } = setup();
    for (const [command, cwd] of [
      [saps('data'), app],
      [saps('"data"'), app],
      [`Start-Process python -ArgumentList "x.py","summary.md" -WorkingDirectory:data`, app],
      [saps(path.join('..', 'app', 'data')), tools],
    ]) {
      assertBlockedBecause(guard({ payload: pwsh(command, cwd), env }), OPERATES_IN, JSON.stringify(command));
    }
  });

  test('a run directory nested inside the root is refused', () => {
    const { app, tools, env } = setup();
    for (const [command, cwd] of [
      ['git -C data -C logs rm summary.md', app],
      ['git -C .. -C app -C data -C logs rm summary.md', tools],
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, cwd), env }), OPERATES_IN, JSON.stringify(command));
    }
  });

  test('a run directory outside the root with a bare filename is still allowed', () => {
    const { app, tools, env } = setup();
    for (const [command, cwd] of [
      ['git -C src add summary.md', app],
      ['git -C data-archive add summary.md', app],
      [`git -C ${path.join('..', 'app')} add summary.md`, tools],
      ['git -C data -C .. add summary.md', app],
    ]) {
      assertAllowed(guard({ payload: bash(command, cwd), env }), JSON.stringify(command));
    }
    for (const [command, cwd] of [
      [saps('src'), app],
      [saps('data-archive'), app],
      [saps(path.join('..', 'app')), tools],
    ]) {
      assertAllowed(guard({ payload: pwsh(command, cwd), env }), JSON.stringify(command));
    }
  });
});

// ---------------------------------------------------------------------------
// Git index operations may name files under the data root (#234)
// ---------------------------------------------------------------------------
//
// Axial, 2026-09-30: `git add -f data/logs/.../*.py data/runs/883-arm-A/summary.json` was
// refused as a run pointed at production data. `git add` changes no file under the root:
// it writes git's own store. A git command that only reads the working tree or writes
// git's store is no longer judged on the paths it names. One that rewrites or deletes
// working-tree files keeps today's judgement, and so does everything around it on the line.

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

  test('a subcommand that rewrites or deletes working-tree files still refuses', () => {
    const { app, env } = setup();
    for (const command of [
      `git rm ${x}`,
      `git rm -f ${x}`,
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
      `git mv ${x} ${y}`,
      `git stash push -- ${x}`,
      `git stash -- ${x}`,
      `git stash pop -- ${x}`,
      `git diff --output=${y}`,
      `git log --output ${y}`,
      `git show --outp=${y}`,
      `git diff --ext-diff -- ${x}`,
      `git -c core.hooksPath=${path.join('data', 'hooks')} commit -m x`,
      `git -c core.pager=less add ${x}`,
      `git --git-dir=${path.join('data', 'repo.git')} add summary.md`,
      `git --work-tree ${path.join('data', 'logs')} checkout .`,
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, app), env }), NAMES_LIVE_DATA, JSON.stringify(command));
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
    for (const command of [
      `git add ${x} && python run.py ${y}`,
      `git ls-files ${path.join('data', 'logs')} | xargs rm`,
      `( git ls-files ${path.join('data', 'logs')} ) | xargs rm`,
      `git diff --name-only -- ${x} | xargs rm`,
      `git commit -m "$(cat notes.txt)" ${x}`,
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, app), env }), NAMES_LIVE_DATA, JSON.stringify(command));
    }
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
      ['git -C data rm summary.md', app],
      ['git -C data checkout -- summary.md', app],
      ['cd data && git clean -fd', app],
      ['git clean -fd', live],
      ['git -C data add summary.md && git -C data clean -fd', app],
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, cwd), env }), OPERATES_IN, JSON.stringify(command));
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

  test('any other command substitution keeps the judgement', () => {
    const { app, live, env } = setup();
    const rmY = `rm -rf ${y}`;
    for (const command of [
      `git commit -m "$(sh <<'EOF'\n${rmY}\nEOF\n)" ${x}`,
      `git commit -m "$(cat <<'EOF' | sh\n${rmY}\nEOF\n)" ${x}`,
      `git commit -m "$(cat <<'EOF'\nmsg\nEOF\n; ${rmY})" ${x}`,
      `git commit -m "$(cat <<EOF\nmsg $(${rmY})\nEOF\n)" ${x}`,
      `git commit -m ${message("'EOF'", 'msg')}"$(${rmY})" ${x}`,
      `git commit -m "\`cat notes.txt\`" ${x}`,
      `python run.py ${message("'EOF'", 'msg')} ${y}`,
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, app), env }), NAMES_LIVE_DATA, JSON.stringify(command));
    }
    // A backtick inside double quotes is a command substitution the parser does not open,
    // so a line carrying one is no longer read-only either.
    for (const command of ['ls "`rm -rf summary.md`"', 'git status "`rm -rf summary.md`"']) {
      assertBlockedBecause(guard({ payload: bash(command, live), env }), OPERATES_IN, JSON.stringify(command));
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
// glob that reaches such a file. A run against the root is refused whatever git holds.
// Tracked status is read from a real repository here, the way the guard reads it.

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
  const UNDECIDED = /cannot tell whether .* lands inside the production data root/;
  const UNLOCATED = /cannot tell where .* lands, and nothing on the line reaches the production data root/;
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

  test('a run against the root refuses whatever git holds', () => {
    const { app, env } = setup();
    for (const command of [
      'python run.py data/reports/dec-75-outcome.md',
      'python run.py < data/raw/a.json',
      'cat data/raw/a.json | python x.py',
      `find data/raw -name '*.tmp' | xargs rm`,
      'git ls-files data/logs | xargs rm',
      'for f in data/raw/*; do rm $f; done',
      'ls "$(rm -rf data/raw)"',
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, app), env }), NAMES_LIVE_DATA, JSON.stringify(command));
    }
    for (const command of ['cd data && python run.py', 'git -C data clean -fd', 'cd data && sqlite3 entries.db']) {
      assertBlockedBecause(guard({ payload: bash(command, app), env }), OPERATES_IN, JSON.stringify(command));
    }
  });

  test('a write the guard cannot locate refuses only when the line could reach the root', () => {
    const { app, live, env } = setup();
    // Nothing on the line reaches the root: allowed, and the session is told.
    for (const command of ['cd $DIR && rm -rf raw', 'cd - && touch x', 'rm -rf "$NOT_SET_ANYWHERE/raw"', 'rm "$UNSET"']) {
      assertWarned(guard({ payload: bash(command, app), env }), UNLOCATED, JSON.stringify(command));
    }
    // The line names the root, or runs from inside it.
    for (const [command, cwd] of [
      ['ls data/raw ; rm -rf "$UNSET"', app],
      [`cd ${live} && cd $DIR && rm -rf raw`, app],
      ['rm "$UNSET"', live],
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, cwd), env }), UNDECIDED, JSON.stringify(command));
    }
    // A variable the session environment defines is read from it.
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

describe('the seam is per command, not per line', () => {
  const setup = () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    // The session is misconfigured: its seam points inside production data.
    return { repo, sandbox, env: { [LIVE]: live, [DATA]: path.join(live, 'scratch') } };
  };

  test('an assignment does not reach the commands beside it', () => {
    const { repo, sandbox, env } = setup();
    for (const command of [
      'npm test', // the control: a bare suite run always blocked
      `${DATA}=${sandbox} npm run build && npm test`,
      `npm test && ${DATA}=${sandbox} echo ok`,
      `npm test || ${DATA}=${sandbox} true`,
      `echo '\n${DATA}=${sandbox}\n' > f && npm test`,
      `cd sub && ${DATA}=${sandbox} npm test`, // backwards, to the cd
      `ls\n${DATA}=${sandbox} npm test`, // backwards, across a newline
    ]) {
      assertBlockedBecause(guard({ payload: bash(command, repo), env }), SEAM_OVERLAPS, JSON.stringify(command));
    }
  });

  // A heredoc body is data. Splitting the raw command on newlines walked it straight into
  // leading position, where a line spelling the variable read as an assignment.
  test('a heredoc body is not an assignment', () => {
    const { repo, sandbox, env } = setup();
    const command = `cat <<EOF > notes.txt\n${DATA}=${sandbox}\nEOF\nnpm test`;
    assertBlockedBecause(guard({ payload: bash(command, repo), env }), SEAM_OVERLAPS, 'heredoc body');
  });

  // The control in the other direction. A genuinely leading assignment is still the seam
  // the child will see, and it still allows.
  test('a genuinely leading assignment still allows', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    const env = { [LIVE]: live, [DATA]: path.join(live, 'scratch') };
    assertAllowed(guard({ payload: bash(`${DATA}=${sandbox} npm test`, repo), env }), 'leading assignment');
    assertAllowed(
      guard({ payload: bash(`${DATA}=${sandbox} npm run build && ${DATA}=${sandbox} npm test`, repo), env }),
      'one assignment per command',
    );
  });
});

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

  test('a seam that is a link into production data is caught', (t) => {
    const { base, live } = roots();
    const repo = makeRepo();
    const alias = path.join(base, 'looks-like-a-sandbox');
    if (!link(path.join(live), alias)) return t.skip('this platform would not create a directory link');
    assertBlockedBecause(
      guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: alias } }),
      SEAM_OVERLAPS,
      'seam aliased onto production data',
    );
  });

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

describe('the sentinel', () => {
  test('a live sentinel blocks the project test command from any session', () => {
    const repo = makeRepo();
    raise(repo);
    for (const command of ['npm test', 'npm run test', 'cd sub && npm test']) {
      assertBlockedBecause(guard({ payload: bash(command, repo) }), LIVE_RUN, command);
    }
  });

  test('a live sentinel blocks a python project\'s own recorded command', () => {
    const repo = makeRepo({ base: { 'aeo-tests.json': JSON.stringify({ test: 'pytest' }) } });
    raise(repo);
    for (const command of ['pytest', 'pytest -k thing', 'python -m pytest tests/']) {
      assertBlockedBecause(guard({ payload: bash(command, repo) }), LIVE_RUN, command);
    }
  });

  // Flags and globs are dropped from the declared command, so its final significant
  // token is the literal `test` for Node, Go, Rust and Maven. Matching that token
  // anywhere in the command refused ordinary work during a live run, and named a command
  // the operator did not type. A guard people cannot work around is a guard people
  // delete.
  test('a live sentinel does not block a command that merely contains the word test', () => {
    const repo = makeRepo();
    raise(repo);
    for (const command of ['grep -r test .', 'mkdir test', 'git add test', 'ls test', 'cat test/fixtures.json']) {
      assertAllowed(guard({ payload: bash(command, repo) }), command);
    }
  });

  // #134: the live repro. A declared suite of `bash scripts/check.sh` used to collapse to
  // just `bash`, so a supervisor's own `status` and `stop` commands were refused for the
  // life of a run — `stop` being unreachable is what pushed an operator toward killing the
  // process tree by hand, the exact failure this gate exists to prevent.
  test('a live sentinel does not block a supervisor script that merely shares the suite\'s interpreter', () => {
    const repo = makeRepo({ base: { 'aeo-tests.json': JSON.stringify({ test: 'bash scripts/check.sh' }) } });
    raise(repo);
    for (const command of [
      'bash scripts/run_876_supervisor.sh status --run-id x',
      'bash scripts/run_876_supervisor.sh stop --run-id x',
      'bash scripts/deploy.sh',
    ]) {
      assertAllowed(guard({ payload: bash(command, repo) }), command);
    }
    assertBlockedBecause(
      guard({ payload: bash('bash scripts/check.sh', repo) }),
      LIVE_RUN,
      'the declared suite itself still blocks',
    );
  });

  test('a live sentinel blocks the declared suite\'s program wherever a command runs it', () => {
    const repo = makeRepo({ base: { 'aeo-tests.json': JSON.stringify({ test: 'pytest' }) } });
    raise(repo);
    for (const command of ['pytest', 'pytest -k thing', 'cd sub && pytest', 'AEO_DATA_ROOT=/tmp/s pytest']) {
      assertBlockedBecause(guard({ payload: bash(command, repo) }), LIVE_RUN, command);
    }
  });

  // Both tiers are the project's suite. The full tier is the one most likely to launch
  // real runs, so a guard that only knew the fast tier would miss the very command whose
  // overlap with a live run L-02 exists to refuse (D31).
  test('a live sentinel blocks either declared tier', () => {
    const repo = makeRepo({
      base: { 'aeo-tests.json': JSON.stringify({ test: 'pytest', test_full: 'tox' }) },
    });
    raise(repo);
    for (const command of ['pytest', 'tox', 'cd sub && tox']) {
      assertBlockedBecause(guard({ payload: bash(command, repo) }), LIVE_RUN, command);
    }
  });

  test('a live sentinel does not block reading, browsing or version control', () => {
    const repo = makeRepo();
    raise(repo);
    for (const command of ['ls -la', 'git status', 'git log --oneline', 'cat package.json']) {
      assertAllowed(guard({ payload: bash(command, repo) }), command);
    }
  });

  test('no sentinel means no block', () => {
    const repo = makeRepo();
    assertAllowed(guard({ payload: bash('npm test', repo) }), 'no sentinel directory at all');
    mkdirSync(path.join(repo, '.aeo', 'runs'), { recursive: true });
    assertAllowed(guard({ payload: bash('npm test', repo) }), 'an empty sentinel directory');
  });

  test('a sentinel whose owner process is gone is stale: it allows, loudly', () => {
    const repo = makeRepo();
    raise(repo, 'crashed', { pid: 999_999_999, host: os.hostname() });
    const r = guard({ payload: bash('npm test', repo) });
    assertAllowed(r, 'stale sentinel');
    assert.match(r.stderr, /owner process is gone/, 'a stale sentinel passed silently');
    assert.match(r.stderr, /run-sentinel\.mjs stop/, 'the note does not say how to clear it');
  });

  test('a sentinel owned by a process that is alive blocks', () => {
    const repo = makeRepo();
    raise(repo, 'running', { pid: process.pid, host: os.hostname() });
    assertBlockedBecause(guard({ payload: bash('npm test', repo) }), LIVE_RUN, 'live owner process');
  });

  // Everything the guard cannot verify blocks. A sentinel from another machine cannot
  // have its process checked, and one with no pid recorded never expires on its own.
  test('a sentinel the guard cannot decide about blocks', () => {
    const repo = makeRepo();
    for (const record of [
      { pid: 999_999_999, host: 'some-other-machine' },
      { pid: null, host: os.hostname() },
      { pid: 'not a number', host: os.hostname() },
      { pid: -1, host: os.hostname() },
      { pid: 999_999_999, host: undefined },
      {},
    ]) {
      rmSync(path.join(repo, '.aeo', 'runs'), { recursive: true, force: true });
      raise(repo, 'undecidable', record);
      assertBlockedBecause(guard({ payload: bash('npm test', repo) }), LIVE_RUN, `record ${JSON.stringify(record)}`);
    }
  });

  test('an unreadable sentinel blocks rather than being ignored', () => {
    const repo = makeRepo();
    for (const body of ['not json', '[1,2,3]', 'null', '{"id":']) {
      rmSync(path.join(repo, '.aeo', 'runs'), { recursive: true, force: true });
      raise(repo, 'broken', body);
      assertBlockedBecause(guard({ payload: bash('npm test', repo) }), SENTINEL_UNREADABLE, `body ${JSON.stringify(body)}`);
    }
  });

  // A guard that cannot read its own marker cannot say the machine is free. That branch
  // existed and was unreachable: ENOTDIR was forgiven alongside ENOENT, so `.aeo/runs`
  // sitting there as a FILE read as "no sentinel directory" and allowed. Deleting the
  // branch entirely left all 107 tests green.
  test('a sentinel directory that is really a file blocks', () => {
    const repo = makeRepo();
    mkdirSync(path.join(repo, '.aeo'), { recursive: true });
    writeFileSync(path.join(repo, '.aeo', 'runs'), 'not a directory\n');
    assertBlockedBecause(guard({ payload: bash('npm test', repo) }), SENTINEL_DIR_UNREADABLE, 'runs is a file');
  });

  test('a sentinel directory the process may not read blocks', (t) => {
    const repo = makeRepo();
    const dir = path.join(repo, '.aeo', 'runs');
    mkdirSync(dir, { recursive: true });
    try {
      chmodSync(dir, 0o000);
      readdirSync(dir); // root, or a platform that ignores the mode: nothing was made unreadable
      return t.skip('this platform would not make a directory unreadable');
    } catch (err) {
      if (err?.code !== 'EACCES' && err?.code !== 'EPERM') return t.skip(`unreadable in an untested way: ${err?.code}`);
    }
    try {
      assertBlockedBecause(guard({ payload: bash('npm test', repo) }), SENTINEL_DIR_UNREADABLE, 'unreadable runs dir');
    } finally {
      chmodSync(dir, 0o700); // so the scratch cleanup can remove it
    }
  });

  test('one run finishing does not clear another run\'s sentinel', () => {
    const repo = makeRepo();
    raise(repo, 'ingest-a', { what: 'corpus A' });
    raise(repo, 'ingest-b', { what: 'corpus B' });
    const both = guard({ payload: bash('npm test', repo) });
    assertBlockedBecause(both, LIVE_RUN, 'two live runs');
    assert.match(both.stderr, /corpus A/);
    assert.match(both.stderr, /corpus B/);

    rmSync(sentinelPath(repo, 'ingest-a'));
    const one = guard({ payload: bash('npm test', repo) });
    assertBlockedBecause(one, LIVE_RUN, 'one run still live');
    assert.match(one.stderr, /corpus B/);
    assert.doesNotMatch(one.stderr, /corpus A/);
  });

  // D30: commit-gate.mjs is deleted, and with it the documentation-only fast path that
  // used to skip a commit's test run — nothing runs a suite as a side effect of a commit
  // any more, so there is no longer a "docs-only commit during a live run" case to prove.

  test('the sentinel is shared with every worktree of the project', () => {
    const main = makeRepo();
    const worktree = path.join(tempDir(), 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feat/other', worktree);
    raise(main, 'ingest', { what: 'corpus ingest' });

    assert.equal(projectAnchor(worktree), main, 'a linked worktree did not resolve to its main checkout');
    assertBlockedBecause(guard({ payload: bash('npm test', worktree) }), LIVE_RUN, 'suite run from a sibling worktree');
  });

  test('the CLI raises, lists and clears a sentinel', () => {
    const repo = makeRepo();
    // Spawned: the CLI is the thing under test, and it is a separate program.
    const run = (...args) =>
      spawnSync(process.execPath, [SENTINEL_CLI, ...args], { cwd: repo, encoding: 'utf8', windowsHide: true });

    const started = run('start', 'corpus ingest!', '--what', 'four hours');
    assert.equal(started.status, 0, started.stderr);
    assert.ok(existsSync(sentinelPath(repo, 'corpus ingest!')), 'start wrote no sentinel file');
    assertBlockedBecause(guard({ payload: bash('npm test', repo) }), LIVE_RUN, 'after start');

    const listed = run('list');
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /LIVE .*four hours/);

    assert.equal(run('stop', 'corpus ingest!').status, 0);
    assertAllowed(guard({ payload: bash('npm test', repo) }), 'after stop');
  });
});

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
          guard({ payload: bash(`python read.py ${path.join(live, 'index.json')}`, repo), env: { [LIVE]: live, [name]: value } }),
          NAMES_LIVE_DATA,
          `${name}=${value}`,
        );
      }
    }
  });

  test('no environment variable turns the sentinel off', () => {
    const repo = makeRepo();
    raise(repo);
    for (const name of disablers) {
      assertBlockedBecause(guard({ payload: bash('npm test', repo), env: { [name]: '1' } }), LIVE_RUN, name);
    }
  });

  test('no flag in the command turns anything off', () => {
    const { live } = roots();
    const repo = makeRepo();
    raise(repo);
    for (const flag of ['--no-sandbox', '--allow-live-data', '--force', '--aeo-skip', '--no-verify', '-f']) {
      assertBlockedBecause(guard({ payload: bash(`npm test ${flag}`, repo) }), LIVE_RUN, `sentinel with ${flag}`);
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
    raise(repo);
    const extra = { permission_mode: 'bypassPermissions' };
    assertBlockedBecause(guard({ payload: bash('npm test', repo, extra) }), LIVE_RUN, 'bypassPermissions, sentinel');
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
    raise(repo);
    for (const agent_type of [undefined, 'aeo:builder', 'aeo:reviewer', 'aeo:triage', 'builder', 'Explore', 'other:agent']) {
      const extra = agent_type === undefined ? {} : { agent_type };
      assertBlockedBecause(guard({ payload: bash('npm test', repo, extra) }), LIVE_RUN, `sentinel, ${agent_type}`);
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
  test('a payload with no usable command still applies the environment rule', () => {
    const { live } = roots();
    const repo = makeRepo();
    for (const tool_input of [undefined, null, {}, { command: 42 }, 'a string']) {
      const payload = bash('placeholder', repo);
      if (tool_input === undefined) delete payload.tool_input;
      else payload.tool_input = tool_input;
      const label = `tool_input ${JSON.stringify(tool_input)}`;
      assertBlockedBecause(guard({ payload, env: { [LIVE]: live, [DATA]: path.join(live, 'x') } }), SEAM_OVERLAPS, label);
      assertAllowed(guard({ payload, env: { [LIVE]: live } }), `${label}, no seam (#214)`);
    }
  });

  test('a payload with no usable cwd still applies the environment rule', () => {
    const { live, sandbox } = roots();
    for (const cwd of [undefined, '', 42]) {
      const payload = bash('npm test', cwd);
      if (cwd === undefined) delete payload.cwd;
      const label = `cwd ${JSON.stringify(cwd)}`;
      assertBlockedBecause(guard({ payload, env: { [LIVE]: live, [DATA]: path.join(live, 'x') } }), SEAM_OVERLAPS, label);
      assertAllowed(guard({ payload, env: { [LIVE]: live } }), `${label}, no seam (#214)`);
      assertAllowed(guard({ payload, env: { [LIVE]: live, [DATA]: sandbox } }), `${label}, good seam`);
    }
  });

  test('extra and unknown payload fields do not disturb the decision', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    const extra = { unknown_future_field: { nested: [1, 2, 3] }, effort: { level: 'max' } };
    assertAllowed(guard({ payload: bash('npm test', repo, extra), env: { [LIVE]: live, [DATA]: sandbox } }), 'extra fields');
    assertBlockedBecause(
      guard({ payload: bash('npm test', repo, extra), env: { [LIVE]: live, [DATA]: path.join(live, 'x') } }),
      SEAM_OVERLAPS,
      'extra fields, seam inside production data',
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

describe('tokenising and matching', () => {
  test('quoted spans stay in one token', () => {
    assert.deepEqual(shellTokens('cp "a b/c" d'), ['cp', 'a b/c', 'd']);
    assert.deepEqual(shellTokens('x --out="a b" y'), ['x', '--out=a b', 'y']);
    assert.deepEqual(shellTokens(''), []);
    assert.deepEqual(shellTokens(null), []);
  });

  test('path candidates take the right-hand side of an assignment', () => {
    assert.deepEqual(pathCandidates(shellTokens('pytest --data-dir=D:/corpus')), ['D:/corpus']);
    assert.deepEqual(pathCandidates(shellTokens('AEO_DATA_ROOT=/tmp/x npm test')), ['/tmp/x']);
    assert.deepEqual(pathCandidates(shellTokens('echo hello world')), []);
    assert.deepEqual(pathCandidates(shellTokens('curl https://example.invalid/a/b')), []);
  });

  test('a declared command is recognised as a whole token, never a substring', () => {
    const declared = [['uv', 'run', 'pytest']];
    assert.equal(invokesDeclaredSuite('uv run pytest', declared), 'uv run pytest');
    assert.equal(invokesDeclaredSuite('pytest -k x', declared), 'uv run pytest');
    assert.equal(invokesDeclaredSuite('echo pytestsuite', declared), null);
    assert.equal(invokesDeclaredSuite('ls', declared), null);
    assert.equal(invokesDeclaredSuite('go test ./pkg', [['go', 'test', './...']]), 'go test ./...');
    assert.equal(invokesDeclaredSuite('cargo build', [['cargo', 'test']]), null);
  });

  test('the declared command\'s final program token matches in program position only', () => {
    const node = [['npm', 'test']];
    assert.equal(invokesDeclaredSuite('npm test', node), 'npm test');
    assert.equal(invokesDeclaredSuite('grep -r test .', node), null);
    assert.equal(invokesDeclaredSuite('mkdir test', node), null);
    assert.equal(invokesDeclaredSuite('git add test', node), null);

    const py = [['uv', 'run', 'pytest']];
    assert.equal(invokesDeclaredSuite('cd sub && pytest', py), 'uv run pytest');
    assert.equal(invokesDeclaredSuite('AEO_DATA_ROOT=/tmp/s pytest', py), 'uv run pytest');
    assert.equal(invokesDeclaredSuite('ls pytest', py), null);
  });

  // #134: a declared command whose distinguishing token is path-shaped and whose
  // interpreter is generic (`bash scripts/check.sh`) used to collapse to just the
  // interpreter, because the script argument was the only slashed token and got dropped
  // whenever a plain token survived. The declared suite became `bash`, so any `bash
  // <anything>` matched — a supervisor's own `status` and `stop` commands included,
  // unreachable for the life of a run.
  describe('a path-shaped declared token (#134)', () => {
    const declared = [['bash', 'scripts/check.sh']];

    test('still recognised: the interpreter and the script, in the shapes that are honestly reachable', () => {
      assert.equal(invokesDeclaredSuite('bash scripts/check.sh', declared), 'bash scripts/check.sh');
      assert.equal(invokesDeclaredSuite('bash scripts/check.sh --full', declared), 'bash scripts/check.sh');
      assert.equal(invokesDeclaredSuite('cd sub && bash scripts/check.sh', declared), 'bash scripts/check.sh');
      // The script run directly: its basename is the program, the same mechanism that
      // already matches a bare `phpunit` against a declared `vendor/bin/phpunit`.
      assert.equal(invokesDeclaredSuite('./scripts/check.sh', declared), 'bash scripts/check.sh');
    });

    // A different interpreter for the same script is a known miss, not a regression.
    // `scripts/check.sh` is an ARGUMENT to `sh` there, not the program in program
    // position, so the second matching form does not reach it either — matching it would
    // mean treating `sh` and `bash` as equivalent, the same kind of table this function
    // already declines to carry for `node --test`.
    test('a different interpreter for the same script is a known miss, not a block', () => {
      assert.equal(invokesDeclaredSuite('sh scripts/check.sh', declared), null);
    });

    test('a bare interpreter invocation of anything else is no longer treated as the declared suite', () => {
      assert.equal(invokesDeclaredSuite('bash scripts/run_876_supervisor.sh status --run-id x', declared), null);
      assert.equal(invokesDeclaredSuite('bash scripts/run_876_supervisor.sh stop --run-id x', declared), null);
      assert.equal(invokesDeclaredSuite('bash scripts/deploy.sh', declared), null);
    });
  });

  // #136: reviewer finding on #134's fix. Keeping every surviving path-shaped token,
  // unconditionally, made a path ARGUMENT part of the declared identity too, so a
  // declared command with a directory target stopped matching its own plain invocations.
  // The seam between "an interpreter's script" and "the suite's own target" is not
  // decidable from shape — both are a plain program followed by a path-shaped token — so
  // it is read off GENERIC_INTERPRETERS, a fixed set, rather than guessed at.
  describe('a declared command with a path target, not an interpreter (#136)', () => {
    test('a directory argument does not become part of the suite\'s identity', () => {
      const declared = [['pytest', 'tests/']];
      assert.equal(invokesDeclaredSuite('pytest', declared), 'pytest tests/');
      assert.equal(invokesDeclaredSuite('pytest -k x', declared), 'pytest tests/');
      assert.equal(invokesDeclaredSuite('pytest tests/unit/test_api.py', declared), 'pytest tests/');
    });

    test('a package path argument does not become part of the suite\'s identity', () => {
      assert.equal(invokesDeclaredSuite('go test ./pkg', [['go', 'test', 'pkg/...']]), 'go test pkg/...');
    });
  });

  // F3: reducing every invoked token to its basename, rather than only the ones that
  // follow a generic interpreter, made a path ARGUMENT to an unrelated program match a
  // single-token declared suite by basename alone. Pinned allowed, not accepted as a
  // trade-off: `tools/pytest` here is `git add`'s and `cat`'s argument, not an
  // interpreter's script, and reduceInterpreterScript does not reduce it.
  describe('an unrelated command naming a path that merely ends in the suite\'s name (#136)', () => {
    const declared = [['pytest']];

    test('the path stays an argument to its own command, not the declared suite', () => {
      assert.equal(invokesDeclaredSuite('git add tools/pytest', declared), null);
      assert.equal(invokesDeclaredSuite('cat .venv/bin/pytest', declared), null);
    });
  });

  // N1: reviewer finding on #136's fix. The declared and invoked sides disagreed about
  // adjacency across a flag — significantTokens computed it AFTER filtering flags out of
  // the declared tokens, invokesDeclaredSuite computed it over the raw invoked tokens with
  // no flag skipping at all. A flag typed between an interpreter and its script defeated
  // recognition on the invoked side (`bash -x scripts/check.sh`).
  //
  // The fix reads adjacency the same way on both sides: walk back past any flags to find
  // the nearest real predecessor, on the declared tokens as well as the invoked ones
  // (reduceInterpreterScript, shared). That is what lets `node --experimental-vm-modules
  // node_modules/.bin/jest` — the standard way to declare an ESM Jest suite — keep `jest`
  // as part of its identity instead of collapsing to `node` alone, which would have
  // reopened #134 for every project shaped this way: any `node <anything>` would have
  // matched, refusing a supervisor's own status checks during a run exactly like #134 did
  // for a bare `bash`.
  describe('a flag between an interpreter and a path (#136)', () => {
    test('an extra flag at invocation time does not defeat a script the declared side has no flag before', () => {
      const declared = [['bash', 'scripts/check.sh']];
      assert.equal(invokesDeclaredSuite('bash -x scripts/check.sh', declared), 'bash scripts/check.sh');
    });

    // `node --test tests/`: reading the same flag-skipping adjacency on the declared side
    // means `tests/` is `node`'s own script argument too, the same as `scripts/check.sh`
    // is `bash`'s, so the declared suite's identity is `['node', 'tests']` and the
    // command's own full invocation blocks. The accepted cost: a bare `node --test`, with
    // no target at all, no longer carries the `tests` token the identity needs, so it
    // becomes a miss of the same shape the KNOWN MISS paragraph already documents for
    // `node --test` against a declared `npm test` — extended there rather than repeated
    // here.
    test('a flag between the interpreter and a path is part of the interpreter\'s script on both sides', () => {
      const declared = [['node', '--test', 'tests/']];
      assert.equal(invokesDeclaredSuite('node --test tests/', declared), 'node --test tests/');
      assert.equal(invokesDeclaredSuite('node --test', declared), null);
    });

    // The standard way to declare an ESM Jest suite: a flag between the interpreter and
    // the script it runs. `jest` stays part of the identity, so a supervisor's unrelated
    // `node` invocation during a run is not held by it.
    test('a flag before the script keeps the script in the suite\'s identity (ESM Jest)', () => {
      const declared = [['node', '--experimental-vm-modules', 'node_modules/.bin/jest']];
      assert.equal(
        invokesDeclaredSuite('node --experimental-vm-modules node_modules/.bin/jest', declared),
        'node --experimental-vm-modules node_modules/.bin/jest',
      );
      assert.equal(invokesDeclaredSuite('node scripts/supervisor.mjs status', declared), null);
    });
  });

  // N2: reviewer finding on #136's fix. The relative-path pre-filter ran before the
  // interpreter rule, so a script written the ordinary way, with a leading `./`, lost its
  // own identity: `bash ./scripts/check.sh` collapsed to `['bash']` and reopened #134 for
  // every project that writes its declared script path that way.
  describe('an interpreter\'s script keeps its identity whatever prefix it carries (#136)', () => {
    const declared = [['bash', './scripts/check.sh']];

    test('a leading ./ on the declared script does not drop it from the suite\'s identity', () => {
      assert.equal(invokesDeclaredSuite('bash scripts/check.sh', declared), 'bash ./scripts/check.sh');
      assert.equal(invokesDeclaredSuite('bash deploy.sh', declared), null);
      assert.equal(invokesDeclaredSuite('bash scripts/deploy.sh', declared), null);
    });
  });

  // R1: the empty-fallback branch used to run BEFORE the primary loop existed to give
  // path arguments their own treatment, and it went stale once that loop owned the
  // interpreter+script case. Two defects followed. A declared script with no interpreter
  // at all, `./scripts/check.sh`, has no predecessor for the primary loop to check, so it
  // fell through to the fallback — which then dropped it AGAIN as a relative argument,
  // leaving the declaration matching nothing. And the fallback basenamed every kept
  // token, not just the first, so a declared `vendor/bin/phpunit tests/` reduced to
  // `['phpunit', 'tests']` instead of `['phpunit']`, reopening F1's defect (a path
  // argument silently required, so the bare form of the suite stopped matching) inside
  // the one branch meant to be its fallback.
  describe('the fallback keeps only the first token\'s basename (#136)', () => {
    test('a bare script with no interpreter still identifies the suite', () => {
      const declared = [['./scripts/check.sh']];
      assert.equal(invokesDeclaredSuite('./scripts/check.sh', declared), './scripts/check.sh');
      assert.equal(invokesDeclaredSuite('bash scripts/check.sh', declared), './scripts/check.sh');
      assert.equal(invokesDeclaredSuite('git add scripts/check.sh', declared), null);
    });

    test('a path argument after a bare program does not become part of the suite\'s identity', () => {
      const declared = [['vendor/bin/phpunit', 'tests/']];
      assert.equal(invokesDeclaredSuite('phpunit', declared), 'vendor/bin/phpunit tests/');
    });
  });

  // One seam per command on the line, in the order the shell runs them.
  const seams = (command, env) =>
    resolveRoots({ command, env, platform: 'win32' }).seams.map((s) => s.data.root);

  test('the seam is read from the command before the environment', () => {
    const env = { [LIVE]: 'D:/production', [DATA]: 'D:/sandbox' };
    assert.deepEqual(seams('npm test', env), ['D:/sandbox']);
    assert.deepEqual(seams(`${DATA}=D:/other npm test`, env), ['D:/other']);
    assert.equal(resolveRoots({ command: 'npm test', env, platform: 'win32' }).seams[0].dataSource, 'session environment');
    assert.equal(resolveRoots({ command: `${DATA}=D:/other x`, env, platform: 'win32' }).seams[0].dataSource, 'the command');
  });

  test('an inline seam is read only in leading position', () => {
    const env = { [LIVE]: 'D:/production', [DATA]: 'D:/sandbox' };

    // Not an assignment: an argument that happens to spell one.
    assert.deepEqual(seams(`echo '${DATA}=D:/other' >> settings.json && npm test`, env), ['D:/sandbox']);
    assert.deepEqual(seams(`grep -r ${DATA}=D:/other .`, env), ['D:/sandbox']);
    assert.deepEqual(seams(`git commit -m "set ${DATA}=D:/other here"`, env), ['D:/sandbox']);

    // Leading position: start of the command, and after another assignment.
    assert.deepEqual(seams(`${DATA}=D:/other npm test`, env), ['D:/other']);
    assert.deepEqual(seams(`FOO=1 ${DATA}=D:/other npm test`, env), ['D:/other']);
  });

  test('an MSYS path is normalised on Windows before it is compared', () => {
    const roots = resolveRoots({ command: '', env: { [LIVE]: '/d/production', [DATA]: '/d/sandbox' }, platform: 'win32' });
    assert.equal(roots.live.root, 'D:/production');
    assert.equal(roots.seams[0].data.root, 'D:/sandbox');
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
      const r = resolveRoots({ command: '', env: { [LIVE]: 'D:/production' }, platform: 'win32' });
      assert.equal(r.live.root, 'D:/production');
    });

    test('a dir with no settings file falls back to env', () => {
      const dir = settingsDir(); // no .claude/settings.json at all
      const r = resolveRoots({ command: '', env: { [LIVE]: 'D:/production' }, platform: 'win32', dir });
      assert.equal(r.live.root, 'D:/production');
    });

    test('a declared value in the file wins over env', () => {
      const dir = settingsDir(JSON.stringify({ env: { [LIVE]: 'D:/from-file' } }));
      const r = resolveRoots({ command: '', env: { [LIVE]: 'D:/from-env' }, platform: 'win32', dir });
      assert.equal(r.live.root, 'D:/from-file');
    });

    test('a blank value in the file means not declared, even with a real value in env', () => {
      const dir = settingsDir(JSON.stringify({ env: { [LIVE]: '' } }));
      const r = resolveRoots({ command: '', env: { [LIVE]: 'D:/from-env' }, platform: 'win32', dir });
      assert.equal(r.live.set, false);
    });

    test('the key absent from the file (but the file itself present) falls back to env', () => {
      const dir = settingsDir(JSON.stringify({ env: { SOME_OTHER_KEY: 'x' } }));
      const r = resolveRoots({ command: '', env: { [LIVE]: 'D:/from-env' }, platform: 'win32', dir });
      assert.equal(r.live.root, 'D:/from-env');
    });

    test('AEO_DATA_ROOT in the file is never read', () => {
      const dir = settingsDir(JSON.stringify({ env: { [LIVE]: 'D:/from-file', [DATA]: 'D:/from-file-seam' } }));
      const r = resolveRoots({ command: '', env: { [LIVE]: 'D:/x', [DATA]: 'D:/from-env-seam' }, platform: 'win32', dir });
      assert.equal(r.seams[0].data.root, 'D:/from-env-seam');
    });

    test('malformed JSON falls back to env rather than throwing', () => {
      const dir = settingsDir('{not json');
      assert.doesNotThrow(() => resolveRoots({ command: '', env: { [LIVE]: 'D:/from-env' }, platform: 'win32', dir }));
      const r = resolveRoots({ command: '', env: { [LIVE]: 'D:/from-env' }, platform: 'win32', dir });
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
