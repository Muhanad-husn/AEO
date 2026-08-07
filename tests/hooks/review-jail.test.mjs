// Tests for plugin/hooks/review-jail.mjs.
//
// Run from the repo root:
//   node --test                              # everything
//   node --test "tests/hooks/*.test.mjs"     # this directory only
//
// Every test runs the real gate in its own process and asserts an exit code, because an
// exit code is the behaviour. 2 blocks; anything else lets the tool call through (C-06).
// The gate also runs on import, so there is no in-process option here anyway.
//
// The battery is organised around the question this gate has to keep answering: how
// could it silently stop firing? A jail that quietly stops matching is worse than no
// jail, because its product is a guarantee about what an agent could not see. Each
// section below is one way that could happen.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const GATE = path.join(repoRoot, 'plugin', 'hooks', 'review-jail.mjs');

const PACKET_DIR_ENV = 'AEO_REVIEW_PACKET_DIR';
const PACKET_DIRNAME = 'aeo-review-packets';

// The identity the gate jails, derived from the manifest rather than typed twice. A
// rename of the plugin changes what a subagent reports, and a jail matching the old
// name fires on nothing at all while every test written against the old literal still
// passes. This is the single place the literal is allowed to come from.
const NAMESPACE = JSON.parse(
  readFileSync(path.join(repoRoot, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'),
).name;
const REVIEWER = `${NAMESPACE}:reviewer`;

// ---------------------------------------------------------------------------
// scratch space and the runner
// ---------------------------------------------------------------------------

const scratch = [];
function tempDir(prefix = 'aeo-p16-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A packet directory with one staged file in it, plus the file's path. */
function stagePacket(name = 'packet.md') {
  const root = path.join(tempDir(), PACKET_DIRNAME);
  mkdirSync(root, { recursive: true });
  const file = path.join(root, name);
  writeFileSync(file, '# the staged review packet\n');
  return { root, file };
}

/**
 * Run the gate as a hook. `env` entries override the inherited environment; an entry
 * whose value is undefined is removed, which is how "the packet path is unset" is tested
 * on a machine that happens to have it set.
 */
/**
 * Where every hook child runs. L-03: resolveOperationDir falls back to
 * CLAUDE_PROJECT_DIR and then to the hook process's own cwd, so a child that pins
 * neither resolves a directory-less payload to THIS repository. Both point at a
 * directory the test created and owns.
 */
const NEUTRAL_CWD = tempDir('aeo-p16-nowhere-');

function runJail({ payload, raw, env = {} } = {}) {
  const input = raw !== undefined ? raw : payload === undefined ? '' : JSON.stringify(payload);
  const childEnv = { ...process.env, CLAUDE_PROJECT_DIR: '' };
  delete childEnv[PACKET_DIR_ENV]; // never inherited; every test states its own
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  const r = spawnSync(process.execPath, [GATE], { input, encoding: 'utf8', cwd: NEUTRAL_CWD, env: childEnv });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A PreToolUse payload in the shape Claude Code sends, with the reviewer's identity. */
function reviewerCall(tool_name, tool_input, extra = {}) {
  return {
    session_id: 'test-session',
    hook_event_name: 'PreToolUse',
    cwd: repoRoot,
    tool_name,
    tool_input,
    agent_id: 'agent-test',
    agent_type: REVIEWER,
    ...extra,
  };
}

function assertBlocked(result, message) {
  assert.equal(result.status, 2, `${message}: expected exit 2, got ${result.status}\n${result.stderr}`);
  assert.match(result.stderr, /^BLOCKED: /m, `${message}: no BLOCKED line on stderr`);
}

/**
 * Blocked, and blocked for the stated reason.
 *
 * Asserting only the exit code is not enough here, and the gap is not academic: an
 * experiment that replaced deny-by-default with a blocklist of three tools left almost
 * every deny-by-default test green, because the payloads used in them carry no absolute
 * file_path and so blocked one branch later on the path check instead. The test would
 * have reported a jail while the polarity was inverted. That is the L-08 shape, an
 * assertion made over the wrong thing, so every block asserts which rule fired.
 */
function assertBlockedBecause(result, pattern, message) {
  assertBlocked(result, message);
  assert.match(result.stderr, pattern, `${message}: blocked, but not by the rule under test`);
}

const NOT_THE_ALLOWED_TOOL = /is not available to the reviewer role/;
const OUTSIDE_THE_PACKET = /outside the staged review packet/;
const NO_READABLE_PATH = /Read without a readable file_path/;
const UNRESOLVABLE_PATH = /cannot resolve to a location/;

function assertAllowed(result, message) {
  assert.equal(result.status, 0, `${message}: expected exit 0, got ${result.status}\n${result.stderr}`);
  assert.doesNotMatch(result.stderr, /^BLOCKED: /m, `${message}: blocked when it should have allowed`);
}

// ---------------------------------------------------------------------------
// The two cases PLAN's verify line names by name
// ---------------------------------------------------------------------------

describe('the verify line', () => {
  test('a reviewer Grep is blocked', () => {
    const { root } = stagePacket();
    const r = runJail({
      payload: reviewerCall('Grep', { pattern: 'block', path: repoRoot }),
      env: { [PACKET_DIR_ENV]: root },
    });
    assertBlocked(r, 'reviewer Grep');
    assert.match(r.stderr, /"Grep" is not available to the reviewer role/);
  });

  test('a reviewer Read of the staged packet is allowed', () => {
    const { root, file } = stagePacket();
    const r = runJail({
      payload: reviewerCall('Read', { file_path: file }),
      env: { [PACKET_DIR_ENV]: root },
    });
    assertAllowed(r, 'staged Read');
  });
});

// ---------------------------------------------------------------------------
// Deny by default
// ---------------------------------------------------------------------------

describe('deny by default', () => {
  // Read is deliberately absent: it is the one allowance and has its own section.
  const tools = [
    ['Bash', { command: 'git log --oneline' }],
    ['Write', { file_path: 'x.md', content: 'x' }],
    ['Edit', { file_path: 'x.md', old_string: 'a', new_string: 'b' }],
    ['Glob', { pattern: '**/*.mjs' }],
    ['WebFetch', { url: 'https://example.invalid', prompt: 'p' }],
    ['WebSearch', { query: 'the builder branch' }],
    // A reviewer that can spawn a helper has no jail at all: the helper is not the
    // reviewer, so nothing constrains it. Deny by default covers this without the gate
    // ever having to know what Task is.
    ['Task', { description: 'read the repo', prompt: 'go read the branch' }],
    ['NotebookEdit', { notebook_path: 'x.ipynb', new_source: 'x' }],
    ['mcp__plugin_github_github__pull_request_read', { pullNumber: 1 }],
    // A tool that does not exist. If this one ever passes, the polarity has been
    // inverted and every tool Claude Code ships next also passes.
    ['AeoToolInventedForThisTestAndNotYetWritten', { anything: true }],
  ];

  for (const [name, input] of tools) {
    test(`${name} is blocked for the reviewer`, () => {
      const { root, file } = stagePacket();
      // The staged packet path is planted in every field a tool might read a path from,
      // so a tool that slipped past the allowance could not then be blocked by the path
      // check by accident. Only the tool rule can block these.
      const r = runJail({
        payload: reviewerCall(name, { ...input, file_path: file, path: file, notebook_path: file }),
        env: { [PACKET_DIR_ENV]: root },
      });
      assertBlockedBecause(r, NOT_THE_ALLOWED_TOOL, name);
    });
  }

  test('a tool name that differs from Read only in case is blocked', () => {
    const { root, file } = stagePacket();
    for (const name of ['read', 'READ', 'ReaD']) {
      const r = runJail({ payload: reviewerCall(name, { file_path: file }), env: { [PACKET_DIR_ENV]: root } });
      assertBlockedBecause(r, NOT_THE_ALLOWED_TOOL, name);
    }
  });

  test('a tool name padded with whitespace is blocked rather than trimmed into Read', () => {
    const { root, file } = stagePacket();
    const r = runJail({ payload: reviewerCall(' Read ', { file_path: file }), env: { [PACKET_DIR_ENV]: root } });
    assertBlockedBecause(r, NOT_THE_ALLOWED_TOOL, 'padded Read');
  });

  test('a missing or non-string tool_name is blocked', () => {
    const { root, file } = stagePacket();
    for (const tool_name of [undefined, null, 42, {}, ['Read']]) {
      const payload = reviewerCall('placeholder', { file_path: file });
      payload.tool_name = tool_name;
      if (tool_name === undefined) delete payload.tool_name;
      const r = runJail({ payload, env: { [PACKET_DIR_ENV]: root } });
      assertBlockedBecause(r, NOT_THE_ALLOWED_TOOL, `tool_name ${JSON.stringify(tool_name) ?? 'undefined'}`);
    }
  });
});

// ---------------------------------------------------------------------------
// The one allowance, and its edges
// ---------------------------------------------------------------------------

describe('the staged Read allowance', () => {
  test('a nested file under the packet root is allowed', () => {
    const { root } = stagePacket();
    const nested = path.join(root, 'diff', 'p1.6.patch');
    mkdirSync(path.dirname(nested), { recursive: true });
    writeFileSync(nested, 'diff --git a b\n');
    const r = runJail({ payload: reviewerCall('Read', { file_path: nested }), env: { [PACKET_DIR_ENV]: root } });
    assertAllowed(r, 'nested staged Read');
  });

  test('a file the orchestrator has not written yet is allowed, so a stale name fails at Read', () => {
    const { root } = stagePacket();
    const r = runJail({
      payload: reviewerCall('Read', { file_path: path.join(root, 'not-staged-yet.md') }),
      env: { [PACKET_DIR_ENV]: root },
    });
    assertAllowed(r, 'unwritten staged path');
  });

  test('a Read of a repo path is blocked', () => {
    const { root } = stagePacket();
    for (const file of [
      path.join(repoRoot, 'CLAUDE.md'),
      path.join(repoRoot, 'plugin', 'hooks', 'lib.mjs'),
      path.join(repoRoot, 'docs', 'EVIDENCE.md'),
    ]) {
      const r = runJail({ payload: reviewerCall('Read', { file_path: file }), env: { [PACKET_DIR_ENV]: root } });
      assertBlockedBecause(r, OUTSIDE_THE_PACKET, );
    }
  });

  test('a Read just outside the packet root is blocked', () => {
    const { root } = stagePacket();
    const outside = path.join(path.dirname(root), 'not-the-packet.md');
    writeFileSync(outside, 'x');
    const r = runJail({ payload: reviewerCall('Read', { file_path: outside }), env: { [PACKET_DIR_ENV]: root } });
    assertBlockedBecause(r, OUTSIDE_THE_PACKET, 'sibling of the packet root');
  });

  test('the packet root itself given with a trailing separator still allows a staged Read', () => {
    const { root, file } = stagePacket();
    for (const form of [`${root}${path.sep}`, `${root}${path.sep}${path.sep}`]) {
      const r = runJail({ payload: reviewerCall('Read', { file_path: file }), env: { [PACKET_DIR_ENV]: form } });
      assertAllowed(r, `trailing separator ${JSON.stringify(form)}`);
    }
  });

  // V-12: a prefix match is not a containment check. `<root>-evil` shares every
  // character of the root and is a different directory.
  test('a sibling directory sharing the root as a name prefix is blocked', () => {
    const { root, file } = stagePacket();
    const evil = `${root}-evil`;
    mkdirSync(evil, { recursive: true });
    const planted = path.join(evil, path.basename(file));
    writeFileSync(planted, 'not the packet');
    const r = runJail({ payload: reviewerCall('Read', { file_path: planted }), env: { [PACKET_DIR_ENV]: root } });
    assertBlockedBecause(r, OUTSIDE_THE_PACKET, 'name-prefix sibling');
  });

  test('a parent-traversal path out of the packet root is blocked', () => {
    const { root } = stagePacket();
    const escape = path.join(root, '..', '..', 'CLAUDE.md');
    const r = runJail({ payload: reviewerCall('Read', { file_path: escape }), env: { [PACKET_DIR_ENV]: root } });
    assertBlockedBecause(r, OUTSIDE_THE_PACKET, 'parent traversal');
  });

  test('a Read with no file_path, or an unusable one, is blocked', () => {
    const { root } = stagePacket();
    for (const tool_input of [{}, { file_path: '' }, { file_path: '   ' }, { file_path: 42 }, { file_path: null }]) {
      const r = runJail({ payload: reviewerCall('Read', tool_input), env: { [PACKET_DIR_ENV]: root } });
      assertBlockedBecause(r, NO_READABLE_PATH, `file_path ${JSON.stringify(tool_input)}`);
    }
  });

  test('a relative file_path resolves against payload.cwd, so a repo-relative Read is blocked', () => {
    const { root } = stagePacket();
    const r = runJail({
      payload: reviewerCall('Read', { file_path: 'plugin/hooks/lib.mjs' }, { cwd: repoRoot }),
      env: { [PACKET_DIR_ENV]: root },
    });
    assertBlockedBecause(r, OUTSIDE_THE_PACKET, 'repo-relative Read');
  });

  test('a relative file_path with no usable cwd is blocked rather than resolved against the hook process', () => {
    const { root } = stagePacket();
    for (const cwd of [undefined, '', '   ', 'also/relative', 42]) {
      const payload = reviewerCall('Read', { file_path: 'packet.md' }, { cwd });
      if (cwd === undefined) delete payload.cwd;
      const r = runJail({ payload, env: { [PACKET_DIR_ENV]: root } });
      assertBlockedBecause(r, UNRESOLVABLE_PATH, `relative path with cwd ${JSON.stringify(cwd)}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Path normalisation: the failure that would be invisible
// ---------------------------------------------------------------------------
//
// isPathInside compares strings and does not call realpath. If the packet root and the
// requested file arrive under two different names for one directory, the comparison
// never matches. In one direction that denies every staged read, which is loud. In the
// other it lets an escape look staged, which is not. macOS tmpdir is a symlink and a
// Windows TEMP can be an 8.3 short name, so this is the default condition on one of the
// three platforms, not an exotic one. A link makes the same condition reproducible
// everywhere.

describe('path normalisation', () => {
  /** A directory plus a second name for it, or null where links are unavailable. */
  function linkedPacket() {
    const base = tempDir();
    const real = path.join(base, PACKET_DIRNAME);
    mkdirSync(real, { recursive: true });
    const file = path.join(real, 'packet.md');
    writeFileSync(file, '# staged\n');
    const alias = path.join(base, 'alias');
    try {
      symlinkSync(real, alias, 'junction');
    } catch {
      return null;
    }
    return { real, alias, file, aliasFile: path.join(alias, 'packet.md') };
  }

  test('the packet root named through a link still allows a staged Read', (t) => {
    const p = linkedPacket();
    if (p === null) return t.skip('this platform would not create a directory link');
    const r = runJail({ payload: reviewerCall('Read', { file_path: p.file }), env: { [PACKET_DIR_ENV]: p.alias } });
    assertAllowed(r, 'root named through a link');
  });

  test('a staged file named through a link is allowed when the root is the real path', (t) => {
    const p = linkedPacket();
    if (p === null) return t.skip('this platform would not create a directory link');
    const r = runJail({ payload: reviewerCall('Read', { file_path: p.aliasFile }), env: { [PACKET_DIR_ENV]: p.real } });
    assertAllowed(r, 'file named through a link');
  });

  test('a link inside the packet root pointing at the repo does not smuggle a repo Read', (t) => {
    const { root } = stagePacket();
    const escape = path.join(root, 'escape');
    try {
      symlinkSync(repoRoot, escape, 'junction');
    } catch {
      return t.skip('this platform would not create a directory link');
    }
    const r = runJail({
      payload: reviewerCall('Read', { file_path: path.join(escape, 'CLAUDE.md') }),
      env: { [PACKET_DIR_ENV]: root },
    });
    assertBlockedBecause(r, OUTSIDE_THE_PACKET, 'link out of the packet root');
  });
});

// ---------------------------------------------------------------------------
// The packet path unset, blank, or nonsense
// ---------------------------------------------------------------------------

describe('the packet path', () => {
  /** Point os.tmpdir() at `dir` for the child, on either platform's variable set. */
  const tmpEnv = (dir) => ({ TMPDIR: dir, TMP: dir, TEMP: dir });

  test('unset falls back to the convention rather than to allowing everything', () => {
    const base = tempDir();
    const root = path.join(base, PACKET_DIRNAME);
    mkdirSync(root, { recursive: true });
    const file = path.join(root, 'packet.md');
    writeFileSync(file, '# staged\n');

    assertAllowed(
      runJail({
        payload: reviewerCall('Read', { file_path: file }),
        env: { [PACKET_DIR_ENV]: undefined, ...tmpEnv(base) },
      }),
      'convention root allows its own staged Read',
    );
    assertBlockedBecause(
      runJail({
        payload: reviewerCall('Grep', { pattern: 'x' }),
        env: { [PACKET_DIR_ENV]: undefined, ...tmpEnv(base) },
      }),
      NOT_THE_ALLOWED_TOOL,
      'unset still blocks Grep',
    );
    assertBlockedBecause(
      runJail({
        payload: reviewerCall('Read', { file_path: path.join(repoRoot, 'CLAUDE.md') }),
        env: { [PACKET_DIR_ENV]: undefined, ...tmpEnv(base) },
      }),
      OUTSIDE_THE_PACKET,
      'unset still blocks a repo Read',
    );
  });

  test('blank or whitespace reads as unset, and still jails', () => {
    for (const value of ['', '   ', '\t\n']) {
      assertBlockedBecause(
        runJail({ payload: reviewerCall('Grep', { pattern: 'x' }), env: { [PACKET_DIR_ENV]: value } }),
        NOT_THE_ALLOWED_TOOL,
        `blank packet dir ${JSON.stringify(value)} blocks Grep`,
      );
      assertBlockedBecause(
        runJail({
          payload: reviewerCall('Read', { file_path: path.join(repoRoot, 'CLAUDE.md') }),
          env: { [PACKET_DIR_ENV]: value },
        }),
        OUTSIDE_THE_PACKET,
        `blank packet dir ${JSON.stringify(value)} blocks a repo Read`,
      );
    }
  });

  test('a relative value blocks every tool, Read included', () => {
    const { file } = stagePacket();
    for (const value of ['packets', './packets', '../packets']) {
      const grep = runJail({ payload: reviewerCall('Grep', { pattern: 'x' }), env: { [PACKET_DIR_ENV]: value } });
      assertBlockedBecause(grep, /set to a relative path/, `relative packet dir ${value} blocks Grep`);
      // The staged file is genuinely staged and would be allowed under a good root, so
      // this asserts the misconfiguration closes the allowance rather than widening it.
      const read = runJail({ payload: reviewerCall('Read', { file_path: file }), env: { [PACKET_DIR_ENV]: value } });
      assertBlockedBecause(read, /set to a relative path/, `relative packet dir ${value} blocks Read`);
    }
  });

  test('a packet root that does not exist blocks rather than allows', () => {
    const missing = path.join(tempDir(), 'never-created');
    const r = runJail({
      payload: reviewerCall('Read', { file_path: path.join(repoRoot, 'CLAUDE.md') }),
      env: { [PACKET_DIR_ENV]: missing },
    });
    assertBlockedBecause(r, OUTSIDE_THE_PACKET, 'missing packet root');
  });
});

// ---------------------------------------------------------------------------
// Identity (C-02): who is jailed, and who must not be
// ---------------------------------------------------------------------------

describe('identity', () => {
  test('the manifest name is what the jail matches', () => {
    assert.equal(NAMESPACE, 'aeo', 'plugin.json name changed; JAILED_ROLE matching in review-jail.mjs is namespaced by it');
    const { root } = stagePacket();
    assertBlockedBecause(
      runJail({ payload: reviewerCall('Grep', { pattern: 'x' }), env: { [PACKET_DIR_ENV]: root } }),
      NOT_THE_ALLOWED_TOOL,
      `${REVIEWER} is jailed`,
    );
  });

  const unaffected = [
    ['no agent_type at all, the orchestrator', undefined],
    ['a bare reviewer from --agent (C-02: the bare name is not this plugin\'s role)', 'reviewer'],
    ['another plugin\'s reviewer', 'some-plugin:reviewer'],
    ['our builder', `${NAMESPACE}:builder`],
    ['our triage', `${NAMESPACE}:triage`],
    ['a longer name with our reviewer as a prefix', `${NAMESPACE}:reviewer-assistant`],
    ['a name with our reviewer as a suffix', `senior-${NAMESPACE}:reviewer`],
    ['a different namespace ending in ours', `not-${NAMESPACE}:reviewer`],
    ['a case variant, which Claude Code does not emit', `${NAMESPACE}:Reviewer`],
    ['a built-in agent', 'Explore'],
  ];

  for (const [label, agent_type] of unaffected) {
    test(`${label} is unaffected`, () => {
      const { root } = stagePacket();
      for (const [name, input] of [
        ['Grep', { pattern: 'x' }],
        ['Bash', { command: 'git log' }],
        ['Write', { file_path: 'x', content: 'y' }],
        ['Read', { file_path: path.join(repoRoot, 'CLAUDE.md') }],
      ]) {
        const payload = reviewerCall(name, input, { agent_type });
        if (agent_type === undefined) delete payload.agent_type;
        assertAllowed(runJail({ payload, env: { [PACKET_DIR_ENV]: root } }), `${label} calling ${name}`);
      }
    });
  }

  test('surrounding whitespace on the identity does not slip the jail', () => {
    const { root } = stagePacket();
    for (const agent_type of [` ${REVIEWER}`, `${REVIEWER} `, `${REVIEWER}\n`, `\t${REVIEWER}\t`]) {
      assertBlockedBecause(
        runJail({ payload: reviewerCall('Grep', { pattern: 'x' }, { agent_type }), env: { [PACKET_DIR_ENV]: root } }),
        NOT_THE_ALLOWED_TOOL,
        `padded identity ${JSON.stringify(agent_type)}`,
      );
    }
  });

  test('a smuggled second line in the identity is not our reviewer', () => {
    const { root } = stagePacket();
    const r = runJail({
      payload: reviewerCall('Grep', { pattern: 'x' }, { agent_type: `${REVIEWER}\nsomething-else` }),
      env: { [PACKET_DIR_ENV]: root },
    });
    assertAllowed(r, 'multi-line identity is a different agent, not ours');
  });
});

// ---------------------------------------------------------------------------
// Malformed payloads
// ---------------------------------------------------------------------------

describe('malformed payloads', () => {
  test('a reviewer call whose tool_input is missing or the wrong shape is blocked', () => {
    const { root } = stagePacket();
    for (const tool_input of [undefined, null, 'a string', 42, ['file_path']]) {
      const payload = reviewerCall('Read', tool_input);
      if (tool_input === undefined) delete payload.tool_input;
      assertBlockedBecause(
        runJail({ payload, env: { [PACKET_DIR_ENV]: root } }),
        NO_READABLE_PATH,
        `tool_input ${JSON.stringify(tool_input) ?? 'undefined'}`,
      );
    }
  });

  test('extra and unexpected payload fields do not disturb the decision', () => {
    const { root, file } = stagePacket();
    const payload = reviewerCall('Read', { file_path: file, offset: 1, limit: 20 }, {
      permission_mode: 'bypassPermissions',
      effort: { level: 'max' },
      unknown_future_field: { nested: [1, 2, 3] },
    });
    assertAllowed(runJail({ payload, env: { [PACKET_DIR_ENV]: root } }), 'staged Read with extra fields');
    payload.tool_name = 'Grep';
    assertBlockedBecause(runJail({ payload, env: { [PACKET_DIR_ENV]: root } }), NOT_THE_ALLOWED_TOOL, 'Grep with extra fields');
  });

  test('bypassPermissions does not unjail the reviewer', () => {
    const { root } = stagePacket();
    const r = runJail({
      payload: reviewerCall('Bash', { command: 'git log' }, { permission_mode: 'bypassPermissions' }),
      env: { [PACKET_DIR_ENV]: root },
    });
    assertBlockedBecause(r, NOT_THE_ALLOWED_TOOL, 'bypassPermissions');
  });

  // Inherited from runGate and deliberately not overridden here. An unreadable payload
  // allows, with a line on stderr. The model cannot cause it: Claude Code serialises the
  // payload and every model-controlled string sits inside valid JSON, so a parse failure
  // is a platform fault rather than a bypass. It is pinned rather than claimed as covered,
  // because it is the one shape in which this gate does not fire and nobody is jailed.
  test('an unreadable payload allows and says so, which is the gate not firing', () => {
    for (const raw of ['', '   ', 'not json at all', '[1,2,3]', 'null', '"a string"']) {
      const r = runJail({ raw });
      assert.equal(r.status, 0, `raw ${JSON.stringify(raw)}: expected exit 0`);
      assert.match(r.stderr, /review-jail: (empty|unreadable) hook payload/, `raw ${JSON.stringify(raw)}: silent skip`);
    }
  });
});

// ---------------------------------------------------------------------------
// Registration (C-01): the gate is only a gate if hooks.json wires it
// ---------------------------------------------------------------------------
//
// Plugin subagents cannot carry `hooks:` frontmatter, so hooks/hooks.json is the whole
// gate. A jail that is not registered, or is registered against a matcher that names
// specific tools, stops firing with no other symptom. P1.7 owns that file and writes
// every entry including this one; this test is the assertion its entry has to satisfy.

describe('hooks.json registration', () => {
  const manifest = path.join(repoRoot, 'plugin', 'hooks', 'hooks.json');

  test('review-jail is registered on PreToolUse with a matcher that matches all tools', (t) => {
    if (!existsSync(manifest)) {
      return t.skip('plugin/hooks/hooks.json does not exist yet; P1.7 owns it and this test arms when it lands');
    }
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    const entries = parsed?.hooks?.PreToolUse;
    assert.ok(Array.isArray(entries), 'hooks.json has no PreToolUse array, so the review-jail cannot be wired');

    const strings = (node) =>
      typeof node === 'string'
        ? [node]
        : Array.isArray(node)
          ? node.flatMap(strings)
          : node && typeof node === 'object'
            ? Object.values(node).flatMap(strings)
            : [];

    const ours = entries.filter((e) => strings(e).some((s) => s.includes('review-jail.mjs')));
    assert.equal(ours.length, 1, 'exactly one PreToolUse entry must run review-jail.mjs');

    // "*", "" and an omitted matcher all match every tool. Anything else names a tool
    // set, and a tool outside it is unjailed.
    const matcher = ours[0].matcher;
    assert.ok(
      matcher === undefined || matcher === '*' || matcher === '',
      `review-jail's matcher must match all tools ("*", "" or omitted); found ${JSON.stringify(matcher)}. ` +
        'A matcher naming specific tools leaves every other tool available to the reviewer.',
    );

    // The `|| echo` fallback belongs on the reporter and would turn every exit 2 here
    // into a pass.
    for (const s of strings(ours[0])) {
      assert.doesNotMatch(s, /\|\||&&/, `a shell fallback in the review-jail entry converts a block into a pass: ${s}`);
    }
  });
});
