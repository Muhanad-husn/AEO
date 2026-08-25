// Tests for plugin/hooks/sandbox-guard.mjs and plugin/hooks/sentinel.mjs.
//
//   node --test                              # everything, from the repo root
//   node --test "tests/hooks/*.test.mjs"     # this directory only
//
// Every case spawns the real gate and asserts an exit code, because the exit code is the
// behaviour. 2 blocks; anything else lets the tool call through (C-06).
//
// This gate's product is a guarantee about data that cannot be un-deleted, so a suite
// that passes for the wrong reason is worth more here than a bug. Every block therefore
// asserts WHICH rule fired, not just that something did. P1.6 shipped a first battery
// that stayed green under an inverted gate because its payloads blocked one branch later
// for an unrelated reason; the fix is the same one applied throughout below.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { pathCandidates, shellTokens, invokesDeclaredSuite, resolveRoots } from '../../plugin/hooks/sandbox-guard.mjs';
import { projectAnchor, sentinelPath } from '../../plugin/hooks/sentinel.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const GUARD = path.join(repoRoot, 'plugin', 'hooks', 'sandbox-guard.mjs');
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

/** A real repository on a feature branch, recording a Node test command by default. */
function makeRepo({ base = { 'aeo-tests.json': JSON.stringify({ test: 'npm test' }) }, branch = 'feat/slice', change = {} } = {}) {
  const dir = tempDir();
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
  for (const [rel, body] of Object.entries(change)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  if (Object.keys(change).length > 0) git(dir, 'add', '-A');
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
function runHook(script, { payload, raw, env = {} } = {}) {
  const input = raw !== undefined ? raw : payload === undefined ? '' : JSON.stringify(payload);
  const childEnv = { ...process.env, CLAUDE_PROJECT_DIR: '' };
  delete childEnv[LIVE];
  delete childEnv[DATA];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  const r = spawnSync(process.execPath, [script], { input, encoding: 'utf8', cwd: NEUTRAL_CWD, env: childEnv, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const guard = (options) => runHook(GUARD, options);

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

const FILE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read', 'NotebookRead'];

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
const NO_SEAM = /sets no AEO_DATA_ROOT/;
const SEAM_OVERLAPS = /One contains the other, so this run is pointed at production data/;
const SEAM_RELATIVE = /is not an absolute\s+path\./;
const LIVE_RELATIVE = /AEO_LIVE_DATA_ROOT is set to .*which is not an absolute path/;
const NAMES_LIVE_DATA = /this command names .*which resolves to .*inside the\s+production data root/;
const TARGETS_LIVE_DATA = /targets .*which resolves to .*inside the\s+production data root/;
const OPERATES_IN = /this command operates in .*inside the production data root/;
const LIVE_RUN = /a long job is running and this would execute code alongside it/;
const SENTINEL_UNREADABLE = /sentinel is present but unreadable/;
const SENTINEL_DIR_UNREADABLE = /could not be read \(.*\), so the gate cannot tell whether a long job is running/;
const CD_UNNAMEABLE = /changes directory to somewhere the guard cannot name/;
const UNREADABLE_COMMAND = /could not be read as a sequence of shell commands/;

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

    // Pointed at production because the seam is absent, so the project's own defaults
    // decide. That is L-03's second incident and it is a block, not a warning.
    assertBlockedBecause(
      guard({ payload: bash('npm test', repo), env: { [LIVE]: live } }),
      NO_SEAM,
      'suite run with no seam at all',
    );

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

  test('a declared production root with no seam blocks every command', () => {
    const { live } = roots();
    const repo = makeRepo();
    for (const command of ['npm test', 'ls', 'git status', 'cat README.md']) {
      assertBlockedBecause(guard({ payload: bash(command, repo), env: { [LIVE]: live } }), NO_SEAM, command);
    }
    for (const value of ['', '   ', '\t']) {
      assertBlockedBecause(
        guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: value } }),
        NO_SEAM,
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
// A command that names production data outright
// ---------------------------------------------------------------------------

describe('paths named in the command', () => {
  test('an absolute path inside production data blocks whatever the seam says', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    const inside = path.join(live, 'index');
    mkdirSync(inside, { recursive: true });
    for (const command of [
      `ls ${inside}`,
      `rm -rf ${inside}`,
      `pytest --data-dir=${inside}`,
      `python -m tool --out "${inside}"`,
      `cat ${path.join(inside, 'entries.jsonl')}`,
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
      guard({ payload: bash('ls ./index', path.join(live)), env: { [LIVE]: live, [DATA]: sandbox } }),
      NAMES_LIVE_DATA,
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
      guard({ payload: bash(`cd ${path.basename(live)} && rm -rf index`, base), env: { [LIVE]: live, [DATA]: sandbox } }),
      OPERATES_IN,
      'relative cd into production data; no token carries a separator',
    );
  });

  // The Bash tool persists its working directory between calls, so the two-step form
  // reaches the same place, and so does a session that never types `cd` at all.
  test('a session already sitting in production data blocks with no cd at all', () => {
    const { live, sandbox } = roots();
    mkdirSync(path.join(live, 'index'), { recursive: true });
    // No token here carries a separator, so the rule that names a path sees nothing.
    for (const command of ['rm -rf index', 'ls', 'cat entries.jsonl']) {
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
    assertBlockedBecause(guard({ payload: bash(`cd ${live} && rm -rf index`, base), env }), NAMES_LIVE_DATA, 'absolute cd');
    assertBlockedBecause(
      guard({ payload: bash(`rm -rf ${path.join(live, 'index')}`, base), env }),
      NAMES_LIVE_DATA,
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

  test('a cmdlet reading a file inside production data blocks, as `cat` does', () => {
    const { live, sandbox } = roots();
    const target = path.join(live, 'index', 'entries.jsonl');
    assertBlockedBecause(
      guard({ payload: pwsh(`Get-Content ${target}`, tempDir()), env: { [LIVE]: live, [DATA]: sandbox } }),
      NAMES_LIVE_DATA,
      'Get-Content of production data',
    );
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
    assertBlockedBecause(
      guard({ payload: pwsh(`Get-Content ${target}`, tempDir()), env: { [LIVE]: live, [DATA]: sandbox } }),
      NAMES_LIVE_DATA,
      'a backslash-separated target',
    );
  });

  test('a cd into production data is honoured on the PowerShell arm too', () => {
    const { live, sandbox } = roots();
    assertBlockedBecause(
      guard({ payload: pwsh(`cd ${live}; Remove-Item -Recurse corpus`, tempDir()), env: { [LIVE]: live, [DATA]: sandbox } }),
      OPERATES_IN,
      'a cd through the PowerShell statement separator',
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

  test('a Read of a file inside production data blocks, and names it', () => {
    const { live, sandbox } = roots();
    const target = path.join(live, 'index', 'entries.jsonl');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '{}\n');
    const r = guard({ payload: fileCall('Read', target, tempDir()), env: { [LIVE]: live, [DATA]: sandbox } });
    assertBlockedBecause(r, TARGETS_LIVE_DATA, 'Read inside production data');
    assert.match(r.stderr, /49,674-entry index/, 'the block does not say why a read is in scope');
    assert.match(r.stderr, /There is no override flag/, 'the block does not end with the no-override sentence');
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

  // The three Bash-only rules, each pinned in both directions. Each block message tells
  // the reader to edit .claude/settings.json, so a gate that also refused the Edit would
  // be unfixable from inside the session.
  test('the seam rule does not hold a file tool, and still holds Bash', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    assertAllowed(
      guard({ payload: fileCall('Edit', path.join(sandbox, 'settings.json'), repo), env: { [LIVE]: live } }),
      'an Edit outside production data with no seam declared',
    );
    assertBlockedBecause(guard({ payload: bash('ls', repo), env: { [LIVE]: live } }), NO_SEAM, 'the Bash control');
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
      guard({ payload: bash('ls', live), env: { [LIVE]: live, [DATA]: sandbox } }),
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
      `cd ${prod} && rm -rf corpus`, // the control: this one always blocked
      `cd ${prod} ; rm -rf corpus`,
      `cd ${prod}\nrm -rf corpus`,
      `pushd ${prod} && rm -rf corpus`,
      `cd -- ${prod} && rm -rf corpus`,
      `( cd ${prod} && rm -rf corpus )`,
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

  // Fail closed: a directory the guard cannot name is not a directory it can clear.
  test('a cd to somewhere the guard cannot name blocks', () => {
    const { base, env } = setup();
    for (const command of ['cd $PROD && rm -rf corpus', 'cd && rm -rf corpus', 'cd - && rm -rf corpus']) {
      assertBlockedBecause(guard({ payload: bash(command, base), env }), CD_UNNAMEABLE, JSON.stringify(command));
    }
  });

  test('a command that cannot be read at all blocks', () => {
    const { base, env } = setup();
    for (const command of ['rm -rf `cat target.txt`', "rm -rf 'corpus", 'cd "prod && rm -rf corpus']) {
      assertBlockedBecause(guard({ payload: bash(command, base), env }), UNREADABLE_COMMAND, JSON.stringify(command));
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
      guard({ payload: bash(`ls ${path.join(live, 'index')}`, repo), env: { [LIVE]: alias, [DATA]: sandbox } }),
      NAMES_LIVE_DATA,
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
      guard({ payload: bash(`cat ${path.join(alias, 'index', 'entries.jsonl')}`, repo), env: { [LIVE]: live, [DATA]: sandbox } }),
      NAMES_LIVE_DATA,
      'command names production data through a link',
    );
  });

  test('a link planted inside the sandbox that points at production data is caught', (t) => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    const trap = path.join(sandbox, 'data');
    if (!link(live, trap)) return t.skip('this platform would not create a directory link');
    assertBlockedBecause(
      guard({ payload: bash(`ls ${path.join(trap, 'index')}`, repo), env: { [LIVE]: live, [DATA]: sandbox } }),
      NAMES_LIVE_DATA,
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
          guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [name]: value } }),
          NO_SEAM,
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
        guard({ payload: bash(`ls ${flag}`, repo), env: { [LIVE]: live } }),
        NO_SEAM,
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
      guard({ payload: bash('ls', repo, extra), env: { [LIVE]: live } }),
      NO_SEAM,
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
        guard({ payload: bash('ls', repo, extra), env: { [LIVE]: live } }),
        NO_SEAM,
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
      assertBlockedBecause(guard({ payload, env: { [LIVE]: live } }), NO_SEAM, `tool_input ${JSON.stringify(tool_input)}`);
    }
  });

  test('a payload with no usable cwd still applies the environment rule', () => {
    const { live, sandbox } = roots();
    for (const cwd of [undefined, '', 42]) {
      const payload = bash('npm test', cwd);
      if (cwd === undefined) delete payload.cwd;
      assertBlockedBecause(guard({ payload, env: { [LIVE]: live } }), NO_SEAM, `cwd ${JSON.stringify(cwd)}`);
      assertAllowed(guard({ payload, env: { [LIVE]: live, [DATA]: sandbox } }), `cwd ${JSON.stringify(cwd)}, good seam`);
    }
  });

  test('extra and unknown payload fields do not disturb the decision', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    const extra = { unknown_future_field: { nested: [1, 2, 3] }, effort: { level: 'max' } };
    assertAllowed(guard({ payload: bash('npm test', repo, extra), env: { [LIVE]: live, [DATA]: sandbox } }), 'extra fields');
    assertBlockedBecause(guard({ payload: bash('npm test', repo, extra), env: { [LIVE]: live } }), NO_SEAM, 'extra fields, no seam');
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
  // interpreter's script, and reduceInvokedToken does not reduce it.
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
  // recognition on the invoked side (`bash -x scripts/check.sh`), and a flag between an
  // interpreter and its own FLAG's target was silently treated as adjacency on the
  // declared side, producing an identity nothing could ever satisfy twice consistently.
  describe('a flag between an interpreter and a path (#136)', () => {
    test('an extra flag at invocation time does not defeat a script the declared side has no flag before', () => {
      const declared = [['bash', 'scripts/check.sh']];
      assert.equal(invokesDeclaredSuite('bash -x scripts/check.sh', declared), 'bash scripts/check.sh');
    });

    // `node --test tests/`: `--test` sits between `node` and `tests/`, so `tests/` is
    // `--test`'s own target, not `node`'s script — the same role a path plays in `pytest
    // tests/`. The declared suite's identity is `node` alone, so a bare `node --test`,
    // with no target at all, still names it.
    test('a flag between the interpreter and a path makes the path the flag\'s target, not the interpreter\'s script', () => {
      const declared = [['node', '--test', 'tests/']];
      assert.equal(invokesDeclaredSuite('node --test tests/', declared), 'node --test tests/');
      assert.equal(invokesDeclaredSuite('node --test', declared), 'node --test tests/');
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
});

// ---------------------------------------------------------------------------
// Registration (C-01): the gate is only a gate if hooks.json wires it
// ---------------------------------------------------------------------------

describe('hooks.json registration', () => {
  const manifest = path.join(repoRoot, 'plugin', 'hooks', 'hooks.json');

  test('sandbox-guard is registered on PreToolUse for Bash, with no shell fallback', (t) => {
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

    const ours = entries.filter((e) => strings(e).some((s) => s.includes('sandbox-guard.mjs')));
    if (ours.length === 0) {
      return t.skip('sandbox-guard.mjs is not wired yet; whoever reconciles hooks.json owns that entry');
    }
    assert.equal(ours.length, 1, 'exactly one PreToolUse entry must run sandbox-guard.mjs');
    assert.ok(
      ours[0].matcher === undefined || ours[0].matcher === '*' || ours[0].matcher === '' || /Bash/.test(ours[0].matcher),
      `sandbox-guard must be matched on Bash; found ${JSON.stringify(ours[0].matcher)}`,
    );
    // The tools the gate judges must all reach it. A gate the matcher never invokes is
    // not a gate: the file tools were absent here while the guard's own header said
    // production data is not reachable from a session, and a Write into the production
    // root passed with no block at all.
    const matcher = ours[0].matcher;
    for (const tool of ['Bash', ...FILE_TOOLS]) {
      assert.equal(new RegExp(matcher).test(tool), true, `${tool} never reaches the sandbox guard`);
    }
    // V-12, and the reason the matcher is anchored: BashOutput is not Bash, and a
    // pattern loose enough to catch it would fire the gate on payloads it cannot judge.
    for (const tool of ['BashOutput', 'Glob', 'Grep', 'Task', 'WebFetch']) {
      assert.equal(new RegExp(matcher).test(tool), false, `${tool} reaches a gate that does not judge it`);
    }

    for (const s of strings(ours[0])) {
      assert.doesNotMatch(s, /\|\||&&/, `a shell fallback converts every block into a pass: ${s}`);
    }
    assert.ok(
      strings(ours[0]).some((s) => s.includes('${CLAUDE_PLUGIN_ROOT}/hooks/sandbox-guard.mjs')),
      'the entry must reference ${CLAUDE_PLUGIN_ROOT}/hooks/sandbox-guard.mjs or preflight reports no gate scripts',
    );
  });
});
