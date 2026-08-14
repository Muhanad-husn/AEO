// Tests for plugin/hooks/path-guard.mjs.
//
// Run from the repo root:
//   node --test                              # everything
//   node --test "tests/hooks/*.test.mjs"     # this directory only
//
// Every case spawns the real gate as its own process and asserts a real exit code
// (runGate owns process.exit; there is no in-process shortcut). This gate's whole
// job is a single fence, and V-11 is a specific way that fence can stop matching with
// no other symptom: `.claude/` made its own git repository. The battery is organised
// so that failure mode has its own section and its own real-repo regression test,
// not a mock standing in for `git rev-parse --show-toplevel`.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const GATE = path.join(repoRoot, 'plugin', 'hooks', 'path-guard.mjs');

// ---------------------------------------------------------------------------
// scratch repos
// ---------------------------------------------------------------------------

const scratch = [];
function tempDir(prefix = 'aeo-p14-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? r.error}`);
  return (r.stdout ?? '').trim();
}

/** Turn `dir` (already existing) into a real git repo with one commit. */
function initRepoAt(dir) {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'aeo-test');
  git(dir, 'config', 'user.email', 'aeo-test@example.invalid');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

/** A throwaway repo at a fresh temp directory. */
function makeRepo() {
  return initRepoAt(tempDir());
}

/**
 * Where every hook child runs, and what it may see of this machine's session. L-03:
 * resolveOperationDir falls back to CLAUDE_PROJECT_DIR and then to the hook process's
 * own cwd, so a child that pins neither resolves a directory-less payload to THIS
 * repository. Both point at a directory the test created and owns.
 */
const NEUTRAL_CWD = tempDir('aeo-p14-nowhere-');
const neutralEnv = () => ({ ...process.env, CLAUDE_PROJECT_DIR: '' });

/** Run the real gate in its own process and report exactly what a hook would see. */
function runHook(payload) {
  const r = spawnSync(process.execPath, [GATE], {
    input: payload === undefined ? '' : JSON.stringify(payload),
    encoding: 'utf8',
    cwd: NEUTRAL_CWD,
    env: neutralEnv(),
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// Passed as `{ agent_type: NO_AGENT_TYPE }` to build a payload with no `agent_type`
// field at all (the orchestrator's shape). A plain `undefined` cannot mean this: JS
// default-parameter destructuring treats an explicit `undefined` value the same as
// an absent key, so `{ agent_type: undefined }` would silently fall through to the
// `'aeo:builder'` default below instead of omitting the field.
const NO_AGENT_TYPE = Symbol('no agent_type');

/** The tool_input shape each fenced tool really carries. NotebookEdit is the odd one. */
function toolInput(tool_name, file_path) {
  if (tool_name === 'Edit') return { file_path, old_string: 'a', new_string: 'b' };
  if (tool_name === 'MultiEdit') return { file_path, edits: [{ old_string: 'a', new_string: 'b' }] };
  if (tool_name === 'NotebookEdit') return { notebook_path: file_path, new_source: 'x', edit_mode: 'replace' };
  return { file_path, content: 'x' };
}

/** A PreToolUse file-writing call from a role subagent. Defaults to aeo:builder. */
function roleCall(tool_name, file_path, { agent_type = 'aeo:builder', ...extra } = {}) {
  const payload = {
    session_id: 'test-session',
    hook_event_name: 'PreToolUse',
    tool_name,
    tool_input: toolInput(tool_name, file_path),
    ...extra,
  };
  if (agent_type !== NO_AGENT_TYPE) payload.agent_type = agent_type;
  return payload;
}

function assertBlocked(result, pattern) {
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}\n${result.stderr}`);
  assert.match(result.stderr, /^BLOCKED: /m, 'no BLOCKED line on stderr');
  if (pattern) assert.match(result.stderr, pattern, `blocked, but not by the rule under test:\n${result.stderr}`);
}

function assertAllowed(result) {
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
  assert.doesNotMatch(result.stderr, /^BLOCKED: /m, 'blocked when it should have allowed');
}

const HARNESS_FENCE = /role subagents may not touch \.claude\//;

// ---------------------------------------------------------------------------
// the verify line: a role subagent fenced from .claude/, free in product code
// ---------------------------------------------------------------------------

describe('the verify line', () => {
  test('a role subagent is blocked writing under .claude/', () => {
    const repo = makeRepo();
    const target = path.join(repo, '.claude', 'agents', 'builder.md');
    const r = runHook(roleCall('Write', target));
    assertBlocked(r, HARNESS_FENCE);
    assert.match(r.stderr, /tried: \.claude\/agents\/builder\.md/);
  });

  test('the same role is free to write product code', () => {
    const repo = makeRepo();
    const target = path.join(repo, 'src', 'index.js');
    const r = runHook(roleCall('Write', target));
    assertAllowed(r);
  });

  test('Edit is fenced the same way Write is', () => {
    const repo = makeRepo();
    mkdirSync(path.join(repo, '.claude'), { recursive: true });
    const target = path.join(repo, '.claude', 'settings.json');
    writeFileSync(target, '{}');
    const r = runHook(roleCall('Edit', target));
    assertBlocked(r, HARNESS_FENCE);
  });

  // hooks.json's matcher covers four writing tools. A matcher wider than the gate is
  // worse than a narrow one: it fires the gate for a tool the gate ignores, which reads
  // as covered and is not. NotebookEdit is the case that would have slipped, because it
  // names its target `notebook_path`, not `file_path`.
  for (const tool of ['MultiEdit', 'NotebookEdit']) {
    test(`${tool} is fenced under .claude/ and free in product code`, () => {
      const repo = makeRepo();
      assertBlocked(runHook(roleCall(tool, path.join(repo, '.claude', 'x.ipynb'))), HARNESS_FENCE);
      assertAllowed(runHook(roleCall(tool, path.join(repo, 'src', 'x.ipynb'))));
    });
  }
});

// ---------------------------------------------------------------------------
// V-11: the root-named-.claude regression, against a real git toplevel
// ---------------------------------------------------------------------------
//
// If `.claude/` is ever made its own git repository, `rev-parse --show-toplevel`
// for anything under it resolves to `<root>/.claude` itself, not the project root.
// A bare `rel.startsWith('.claude/')` test then never sees the substring `.claude/`
// again, because the resolved root IS the harness dir. This is a real repo, not a
// mocked toplevel, because that is exactly the mechanism that has to be proven.

describe('V-11: the resolved toplevel is itself named .claude', () => {
  test('every write inside a .claude-as-its-own-repo worktree is blocked', () => {
    const container = tempDir();
    const dotClaudeRoot = path.join(container, '.claude');
    mkdirSync(dotClaudeRoot, { recursive: true });
    initRepoAt(dotClaudeRoot);

    // Directly under the root: the case a bare '^\.claude/' relative-path test
    // would silently stop catching, because relative to THIS root there is no
    // leading '.claude/' segment at all.
    const direct = path.join(dotClaudeRoot, 'roster.md');
    assertBlocked(runHook(roleCall('Write', direct)), HARNESS_FENCE);

    // Nested, to show it isn't limited to the immediate children.
    const nested = path.join(dotClaudeRoot, 'agents', 'builder.md');
    assertBlocked(runHook(roleCall('Write', nested)), HARNESS_FENCE);
  });

  test('without the root-named check, containment alone would miss this (documented, not asserted)', () => {
    // Left as documentation: plugin/hooks/path-guard.mjs's `isHarnessNamed` check
    // exists specifically because `isPathInside(path.join(root, '.claude'), full)`
    // is false here: full is a direct child of root, not of root/.claude. That is
    // the silent-stop-matching bug V-11 describes; the test above is the proof the
    // fix holds, and the mutation battery (see the slice log) proves it regresses
    // the instant the root-named check is removed.
  });

  // V-11's text is about the mechanism, not about one shape of it: a git repo must not
  // be nested inside `.claude/`, because `rev-parse --show-toplevel` then resolves
  // below the project root and defeats the fence. Vendoring a skill as its own clone is
  // exactly that. The resolved toplevel is then named `rgr`, so the root-named check is
  // false, and `<toplevel>/.claude` does not contain the target, so containment is
  // false too: the write was allowed. Real temp git repos, because a mocked `rev-parse`
  // cannot prove what git genuinely answers for a nested checkout.

  test('a git repo nested UNDER .claude/ is fenced by the enclosing project root', () => {
    const project = makeRepo();
    const vendored = path.join(project, '.claude', 'skills', 'rgr');
    mkdirSync(vendored, { recursive: true });
    initRepoAt(vendored);

    const r = runHook(roleCall('Write', path.join(vendored, 'SKILL.md')));
    assertBlocked(r, HARNESS_FENCE);
    // Reported relative to the root that actually fenced it, not the inner toplevel.
    assert.match(r.stderr, /tried: \.claude\/skills\/rgr\/SKILL\.md/);
  });

  test('the same nesting under a .claude-evil/ segment is not fenced (V-12, one level up)', () => {
    const project = makeRepo();
    const vendored = path.join(project, '.claude-evil', 'vendored');
    mkdirSync(vendored, { recursive: true });
    initRepoAt(vendored);

    assertAllowed(runHook(roleCall('Write', path.join(vendored, 'file.js'))));
  });
});

// ---------------------------------------------------------------------------
// #113: a session's own worktree, parked under .claude/worktrees/, is not the V-11
// vendored-repo case -- it is an ordinary checkout of the project itself, and its
// content must resolve normally even though its toplevel sits under the project's
// .claude/. Real worktrees throughout: `git worktree add` produces the exact
// `--git-common-dir` shape the fix reads, which a mocked `rev-parse` cannot.
// ---------------------------------------------------------------------------

describe('#113: a linked worktree parked under .claude/worktrees/', () => {
  /** A project with one real linked worktree cut at .claude/worktrees/<name>. */
  function makeProjectWithWorktree(name = 'agent-1') {
    const project = makeRepo();
    const worktree = path.join(project, '.claude', 'worktrees', name);
    mkdirSync(path.dirname(worktree), { recursive: true });
    git(project, 'worktree', 'add', '-q', '-b', `feat/${name}`, worktree);
    return { project, worktree };
  }

  test('an ordinary project file inside the worktree is allowed, not fenced by the project root', () => {
    const { worktree } = makeProjectWithWorktree();
    const target = path.join(worktree, 'plugin', 'agents', 'reviewer.md');
    assertAllowed(runHook(roleCall('Write', target)));
  });

  test('a new file under a not-yet-existing directory inside the worktree is allowed too', () => {
    const { worktree } = makeProjectWithWorktree();
    const target = path.join(worktree, 'plugin', 'skills', 'new-thing', 'SKILL.md');
    assertAllowed(runHook(roleCall('Write', target)));
  });

  // What must not move: the worktree's OWN .claude/ is still the worktree's own
  // harness config, and this containment check fires on the very first loop
  // iteration -- before any escalation, so there is no inner root yet for the
  // bypass to apply to.
  test("the worktree's own .claude/ is still fenced, not swept up in the allow", () => {
    const { worktree } = makeProjectWithWorktree();
    const target = path.join(worktree, '.claude', 'settings.json');
    const r = runHook(roleCall('Write', target));
    assertBlocked(r, HARNESS_FENCE);
    assert.match(r.stderr, /tried: \.claude\/settings\.json/);
  });

  // What must not move: a role writing the enclosing project's own .claude/ directly
  // (never through the worktree at all) is unaffected by the discriminator.
  test("the project's own .claude/, reached from an ordinary checkout, is still fenced", () => {
    const { project } = makeProjectWithWorktree();
    const target = path.join(project, '.claude', 'agents', 'builder.md');
    assertBlocked(runHook(roleCall('Write', target)), HARNESS_FENCE);
  });

  // What must not move: a genuinely separate repository vendored under the SAME
  // project's .claude/, alongside a real worktree, is not mistaken for one. This is
  // V-11's own case (tested above with no worktree present); repeating it here proves
  // the new discriminator doesn't widen the allow when a worktree is also nearby.
  test('a repository vendored under .claude/ is still fenced even though the project also has a worktree', () => {
    const { project } = makeProjectWithWorktree();
    const vendored = path.join(project, '.claude', 'skills', 'rgr');
    mkdirSync(vendored, { recursive: true });
    initRepoAt(vendored);
    const r = runHook(roleCall('Write', path.join(vendored, 'SKILL.md')));
    assertBlocked(r, HARNESS_FENCE);
  });

  test('a file at the project root, outside the worktree entirely, is unaffected', () => {
    const { project } = makeProjectWithWorktree();
    const target = path.join(project, 'src', 'index.js');
    assertAllowed(runHook(roleCall('Write', target)));
  });

  // The gap the review named (Finding 1): a bypass that RETURNED out of the whole
  // loop would silently drop every fence beyond the level it fired at. Here a
  // genuinely separate repository `vendored` is nested under project `O`'s .claude/
  // (case #2, the one this change must not move), and `vendored` itself has a real
  // linked worktree parked under ITS OWN .claude/worktrees/. Writing into that
  // worktree escalates worktree -> vendored (bypassed: the worktree IS vendored's
  // own checkout) -> O (NOT bypassed: vendored is a separate repo, not a worktree of
  // O). Only a loop that keeps walking past the first bypass reaches O's own fence.
  test('a vendored repository with its own linked worktree is still fenced by the project enclosing it', () => {
    const project = makeRepo();
    const vendored = path.join(project, '.claude', 'skills', 'rgr');
    mkdirSync(vendored, { recursive: true });
    initRepoAt(vendored);

    const innerWorktree = path.join(vendored, '.claude', 'worktrees', 'inner');
    mkdirSync(path.dirname(innerWorktree), { recursive: true });
    git(vendored, 'worktree', 'add', '-q', '-b', 'feat/inner', innerWorktree);

    const target = path.join(innerWorktree, 'src', 'index.js');
    const r = runHook(roleCall('Write', target));
    assertBlocked(r, HARNESS_FENCE);
  });
});

// ---------------------------------------------------------------------------
// A .claude ancestor that is NOT the resolved toplevel must resolve normally
// ---------------------------------------------------------------------------

describe('a plugin checkout under a .claude ancestor', () => {
  test('a repo checked out under ~/.claude/plugins/<name>/ is not fenced by the ancestor name', () => {
    const container = tempDir();
    const checkout = path.join(container, '.claude', 'plugins', 'aeo-checkout');
    mkdirSync(checkout, { recursive: true });
    initRepoAt(checkout);

    const target = path.join(checkout, 'src', 'index.js');
    assertAllowed(runHook(roleCall('Write', target)));
  });

  test('the same checkout still fences its OWN .claude/ normally', () => {
    const container = tempDir();
    const checkout = path.join(container, '.claude', 'plugins', 'aeo-checkout');
    mkdirSync(checkout, { recursive: true });
    initRepoAt(checkout);

    const target = path.join(checkout, '.claude', 'settings.json');
    assertBlocked(runHook(roleCall('Write', target)), HARNESS_FENCE);
  });
});

// ---------------------------------------------------------------------------
// The containment check itself: trailing separators and sibling prefixes (V-12)
// ---------------------------------------------------------------------------

describe('containment edges (V-12)', () => {
  test('a sibling directory sharing .claude as a name prefix is not fenced', () => {
    const repo = makeRepo();
    const target = path.join(repo, '.claude-evil', 'file.js');
    assertAllowed(runHook(roleCall('Write', target)));
  });

  test('a redundant separator inside the .claude path does not defeat the fence', () => {
    const repo = makeRepo();
    const target = `${path.join(repo, '.claude')}${path.sep}${path.sep}nested.md`;
    assertBlocked(runHook(roleCall('Write', target)), HARNESS_FENCE);
  });

  test('a write to the harness directory path itself, with no further segment, is fenced', () => {
    const repo = makeRepo();
    const target = path.join(repo, '.claude');
    assertBlocked(runHook(roleCall('Write', target)), HARNESS_FENCE);
  });

  test('a deeply nested .claude write is still fenced', () => {
    const repo = makeRepo();
    const target = path.join(repo, '.claude', 'skills', 'safe-pr', 'SKILL.md');
    assertBlocked(runHook(roleCall('Write', target)), HARNESS_FENCE);
  });

  // The substring mutation (`isPathInside(harnessDir, full)` replaced by
  // `full.includes(harnessDir)`) was previously killed by one test, and that test was
  // fail-CLOSED: `.claude-evil/` wrongly blocked. These two close the gap.

  test('siblings that extend .claude as a name prefix are not fenced', () => {
    // More fail-closed cases, so the mutation dies on every platform, not only win32.
    const repo = makeRepo();
    for (const parts of [['.claude-notes.md'], ['.claudex', 'notes.md'], ['.claude.bak', 'settings.json']]) {
      assertAllowed(runHook(roleCall('Write', path.join(repo, ...parts))));
    }
  });

  // The fail-OPEN direction, which is the one that matters and which nothing asserted.
  // On Windows the filesystem is case-insensitive, so `<repo>\.CLAUDE\` IS the harness
  // directory; `isPathInside` lowercases on win32 and fences it. The substring form
  // does not, because `'...\.CLAUDE\...'.includes('...\.claude')` is false, so the same
  // file on NTFS would be allowed. lib.mjs has a case test for the primitive, but the
  // mutation REPLACES the primitive, so that test never fires.
  //
  // On a case-sensitive host `.CLAUDE/` is a genuinely different directory and must be
  // allowed, so the assertion follows the platform, which is the contract the gate
  // states. This case therefore kills the mutation on win32 only.
  test('a case variant of .claude follows the filesystem: fenced on Windows, a different directory elsewhere', () => {
    const repo = makeRepo();
    const r = runHook(roleCall('Write', path.join(repo, '.CLAUDE', 'settings.json')));
    if (process.platform === 'win32') assertBlocked(r, HARNESS_FENCE);
    else assertAllowed(r);
  });
});

// ---------------------------------------------------------------------------
// The target may not exist yet
// ---------------------------------------------------------------------------

describe('a target that does not exist yet', () => {
  test('a new file under an existing directory is resolved and fenced normally', () => {
    const repo = makeRepo();
    const target = path.join(repo, '.claude', 'agents', 'new-role.md'); // .claude/agents/ not created
    assertBlocked(runHook(roleCall('Write', target)), HARNESS_FENCE);
  });

  test('a new file whose parent directory also does not exist yet is still resolved', () => {
    const repo = makeRepo();
    const target = path.join(repo, 'brand', 'new', 'dirs', 'file.md');
    assertAllowed(runHook(roleCall('Write', target)));
  });

  test('the same missing-ancestor case under .claude/ is fenced, not allowed by accident', () => {
    const repo = makeRepo();
    const target = path.join(repo, '.claude', 'brand', 'new', 'dirs', 'file.md');
    assertBlocked(runHook(roleCall('Write', target)), HARNESS_FENCE);
  });
});

// ---------------------------------------------------------------------------
// Outside any git worktree
// ---------------------------------------------------------------------------
//
// The PowerShell original blocked on "not inside a git worktree", which contradicts
// this gate's allow-by-default posture and, concretely, blocks a role's first write to
// the scratchpad directory every agent in this environment is told to use. The fence
// survives the divergence: with no root to be relative to, the same whole-segment
// `.claude` test runs against the absolute path, so `~/.claude/settings.json` on a
// machine where `$HOME` is not a repository is still fenced.

describe('a target outside any git worktree', () => {
  test('a plain scratch directory with no git repo is allowed, not blocked', () => {
    const plain = tempDir('aeo-p14-noworktree-');
    assertAllowed(runHook(roleCall('Write', path.join(plain, 'notes.md'))));
  });

  test('a .claude/ path outside any worktree is still fenced: the ~/.claude case', () => {
    const home = tempDir('aeo-p14-nohome-'); // not a git repo, standing in for $HOME
    const r = runHook(roleCall('Write', path.join(home, '.claude', 'settings.json')));
    assertBlocked(r, HARNESS_FENCE);
    assert.match(r.stderr, /outside any git worktree/);
  });

  test('the whole-segment rule holds in the no-worktree path as well (V-12)', () => {
    const home = tempDir('aeo-p14-nohome-');
    for (const parts of [['.claude-evil', 'file.js'], ['.claudex', 'file.js'], ['.claude-notes.md']]) {
      assertAllowed(runHook(roleCall('Write', path.join(home, ...parts))));
    }
  });
});

// ---------------------------------------------------------------------------
// Identity (C-02): who this gate fences, and who it must not
// ---------------------------------------------------------------------------

describe('identity', () => {
  for (const role of ['builder', 'reviewer', 'triage']) {
    test(`aeo:${role} is fenced from .claude/`, () => {
      const repo = makeRepo();
      const target = path.join(repo, '.claude', 'x.md');
      const r = runHook(roleCall('Write', target, { agent_type: `aeo:${role}` }));
      assertBlocked(r, HARNESS_FENCE);
    });
  }

  const unaffected = [
    ['no agent_type at all, the orchestrator', NO_AGENT_TYPE],
    ["a bare 'builder' from --agent (C-02: not this plugin's role)", 'builder'],
    ['another plugin\'s builder', 'some-plugin:builder'],
    ['a name with our role as a suffix', 'senior-aeo:builder'],
    ['a different namespace ending in ours', 'not-aeo:builder'],
    ['a case variant, which Claude Code does not emit', 'aeo:Builder'],
    ['a built-in agent', 'Explore'],
  ];

  for (const [label, agent_type] of unaffected) {
    test(`${label} passes through`, () => {
      const repo = makeRepo();
      const target = path.join(repo, '.claude', 'x.md');
      const r = runHook(roleCall('Write', target, { agent_type }));
      assertAllowed(r);
    });
  }

  // isAnyAeoRole matches any lowercase `aeo:<role>`-shaped identity, not a
  // hard-coded three-role roster (P1.1: "would rot if it did"). This gate enforces
  // against that broader set on purpose, the same call P1.2's block-merge made, so a
  // role name this plugin has not shipped yet is still fenced.
  test("a longer aeo-namespaced identity ('aeo:builder-assistant') is still fenced, not treated as foreign", () => {
    const repo = makeRepo();
    const target = path.join(repo, '.claude', 'x.md');
    const r = runHook(roleCall('Write', target, { agent_type: 'aeo:builder-assistant' }));
    assertBlocked(r, HARNESS_FENCE);
  });

  test('surrounding whitespace on the identity does not slip the fence', () => {
    const repo = makeRepo();
    const target = path.join(repo, '.claude', 'x.md');
    for (const agent_type of [' aeo:builder', 'aeo:builder ', 'aeo:builder\n', '\taeo:builder\t']) {
      assertBlocked(runHook(roleCall('Write', target, { agent_type })), HARNESS_FENCE);
    }
  });

  test('a tool outside the fenced set is never fenced, even under .claude/', () => {
    const repo = makeRepo();
    const target = path.join(repo, '.claude', 'x.md');
    for (const tool_name of ['Read', 'Grep', 'Bash', 'Glob']) {
      const payload = {
        tool_name,
        tool_input: { file_path: target, path: target, command: `cat ${target}` },
        agent_type: 'aeo:builder',
      };
      assertAllowed(runHook(payload));
    }
  });
});

// ---------------------------------------------------------------------------
// Malformed and empty payloads
// ---------------------------------------------------------------------------

describe('malformed payloads', () => {
  test('an unreadable payload allows and says so, which is the gate not firing', () => {
    for (const raw of ['', '   ', 'not json at all', '[1,2,3]', 'null', '"a string"']) {
      const r = spawnSync(process.execPath, [GATE], { input: raw, encoding: 'utf8', cwd: NEUTRAL_CWD, env: neutralEnv() });
      assert.equal(r.status, 0, `raw ${JSON.stringify(raw)}: expected exit 0`);
      assert.match(r.stderr ?? '', /path-guard: (empty|unreadable) hook payload/, `raw ${JSON.stringify(raw)}: silent skip`);
    }
  });

  test('a missing or unusable file_path allows: nothing named, nothing to fence', () => {
    const repo = makeRepo();
    for (const tool_input of [{}, { file_path: '' }, { file_path: '   ' }, { file_path: 42 }, { file_path: null }]) {
      const payload = { tool_name: 'Write', tool_input, agent_type: 'aeo:builder' };
      assertAllowed(runHook(payload));
    }
    void repo; // no target is ever resolved in this branch; the repo exists only for symmetry with the other cases
  });

  test('a missing tool_input entirely allows for the same reason', () => {
    const payload = { tool_name: 'Write', agent_type: 'aeo:builder' };
    assertAllowed(runHook(payload));
  });

  test('extra and unexpected payload fields do not disturb the decision', () => {
    const repo = makeRepo();
    const blocked = path.join(repo, '.claude', 'x.md');
    const allowed = path.join(repo, 'src', 'x.md');
    const extra = { permission_mode: 'bypassPermissions', effort: { level: 'max' }, unknown_future_field: { a: [1, 2] } };
    assertBlocked(runHook(roleCall('Write', blocked, extra)), HARNESS_FENCE);
    assertAllowed(runHook(roleCall('Write', allowed, extra)));
  });
});

// ---------------------------------------------------------------------------
// Relative file_path resolution
// ---------------------------------------------------------------------------

describe('a relative file_path', () => {
  test('resolves against payload.cwd, so a repo-relative write under .claude/ is still fenced', () => {
    const repo = makeRepo();
    const r = runHook(roleCall('Write', path.join('.claude', 'x.md'), { cwd: repo }));
    assertBlocked(r, HARNESS_FENCE);
  });

  test('resolves against payload.cwd for an allowed product-code write too', () => {
    const repo = makeRepo();
    const r = runHook(roleCall('Write', path.join('src', 'x.md'), { cwd: repo }));
    assertAllowed(r);
  });
});

// ---------------------------------------------------------------------------
// hooks.json registration (C-01): not owned by this slice
// ---------------------------------------------------------------------------
//
// plugin/hooks/hooks.json is reconciled by whoever integrates the Phase 1 gates, not
// by this slice (L-04: a second writer to that file is the hazard already paid for).
// This test skips quietly until an entry naming path-guard.mjs exists, and then
// checks the shape that entry has to have: a matcher scoped to Edit and Write (a
// bare "*" would refire this gate on every tool, including ones that carry no
// file_path at all), the exec form, and no `|| echo` fallback, which would convert
// every exit 2 here into a silent pass.

describe('hooks.json registration', () => {
  const manifest = path.join(repoRoot, 'plugin', 'hooks', 'hooks.json');

  test('path-guard, once registered, is scoped to Edit and Write with no shell fallback', (t) => {
    if (!existsSync(manifest)) {
      return t.skip('plugin/hooks/hooks.json does not exist yet; not owned by this slice');
    }
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    const entries = parsed?.hooks?.PreToolUse ?? [];

    const strings = (node) =>
      typeof node === 'string'
        ? [node]
        : Array.isArray(node)
          ? node.flatMap(strings)
          : node && typeof node === 'object'
            ? Object.values(node).flatMap(strings)
            : [];

    const ours = entries.filter((e) => strings(e).some((s) => s.includes('path-guard.mjs')));
    if (ours.length === 0) {
      return t.skip('hooks.json exists but has no path-guard.mjs entry yet; owned by whoever reconciles hooks.json');
    }

    assert.equal(ours.length, 1, 'exactly one PreToolUse entry must run path-guard.mjs');
    const matcher = ours[0].matcher;
    assert.ok(
      typeof matcher === 'string' && /Edit/.test(matcher) && /Write/.test(matcher),
      `path-guard's matcher must scope to Edit and Write; found ${JSON.stringify(matcher)}`,
    );
    for (const s of strings(ours[0])) {
      assert.doesNotMatch(s, /\|\||&&/, `a shell fallback in the path-guard entry converts a block into a pass: ${s}`);
    }
  });
});
