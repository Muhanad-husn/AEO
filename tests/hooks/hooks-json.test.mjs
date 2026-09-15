// Tests for plugin/hooks/hooks.json -- the whole of Phase 1's wiring (P1.7 owns this
// file; see its header comment in the slice brief and D8/C-05/C-09 in DECISIONS.md and
// EVIDENCE.md for why each shape below is required, not stylistic).
//
// Three things this file cannot get wrong, each with its own test group:
//
// 1. It parses, and every gate script it names is found by preflight() the same way
//    preflight() itself looks for one -- the brace form plus the `.mjs` extension.
// 2. Every gate entry uses the exec form (`command` + `args`, no shell), because that
//    is what removes the `||` hazard entirely rather than merely avoiding it by hand.
// 3. No gate entry carries a `||` fallback. tests/hooks/runtime-fallback.test.mjs
//    demonstrates why: `||` fires on any non-zero exit, so on a gate it would convert
//    every exit-2 block into a silent pass. The fallback belongs only on the
//    SessionStart reporter, which never blocks. This is a regression test for that
//    trap and it must fail loudly if anyone ever adds `||` to a gate entry.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RUNTIME_MISSING_BANNER, SHELL_TOOLS, preflight } from '../../plugin/hooks/lib.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugin');
const hooksJsonPath = path.join(pluginRoot, 'hooks', 'hooks.json');
const rawText = readFileSync(hooksJsonPath, 'utf8');
const parsed = JSON.parse(rawText);

// ---------------------------------------------------------------------------
// scratch space
// ---------------------------------------------------------------------------

const scratch = [];
function tempDir(prefix = 'aeo-p17-hooksjson-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// helpers over the parsed manifest
// ---------------------------------------------------------------------------

/** Every {event, matcher, hook} triple in the manifest, command hooks only. */
function allCommandHooks(manifest) {
  const out = [];
  for (const [event, groups] of Object.entries(manifest.hooks ?? {})) {
    for (const group of groups ?? []) {
      for (const hook of group.hooks ?? []) {
        if (hook.type === 'command') out.push({ event, matcher: group.matcher, hook });
      }
    }
  }
  return out;
}

/** The `${CLAUDE_PLUGIN_ROOT}/...mjs` path a command hook names, from `command` or `args`. */
function scriptOf(hook) {
  const strings = [hook.command, ...(hook.args ?? [])].filter((s) => typeof s === 'string');
  for (const s of strings) {
    const m = /\$\{CLAUDE_PLUGIN_ROOT\}([^\s"']*\.mjs)/.exec(s);
    if (m) return m[1].replace(/^[/\\]/, '');
  }
  return null;
}

// One script is wired on PreToolUse now (#167), so the gate-entry group below has one
// subject. The pattern stays a pattern rather than an equality so a second gate script,
// if one is ever wired, is checked by these tests without being added here first.
const isGateScript = (rel) => rel !== null && /\/gate\.mjs$/.test(`/${rel}`);

/** A scratch plugin root with this real hooks.json plus a stub for every script it names. */
function makePassingPluginRoot() {
  const root = tempDir();
  const hooksDir = path.join(root, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(path.join(hooksDir, 'hooks.json'), rawText);
  for (const { hook } of allCommandHooks(parsed)) {
    const rel = scriptOf(hook);
    if (!rel) continue;
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, '// stub\n');
  }
  return root;
}

// ---------------------------------------------------------------------------
// It parses
// ---------------------------------------------------------------------------

describe('hooks.json parses', () => {
  test('is valid JSON with a hooks object', () => {
    assert.equal(typeof parsed, 'object');
    assert.equal(typeof parsed.hooks, 'object');
  });

  test('registers at least one gate script preflight can find (does not cry wolf)', () => {
    const health = preflight({ pluginRoot });
    const wiring = health.checks.find((c) => c.name === 'hook wiring');
    assert.ok(wiring, 'preflight should report a hook-wiring check');
    assert.notEqual(wiring.detail, 'hooks.json registers no gate scripts');
  });
});

// ---------------------------------------------------------------------------
// Every named script resolves to a file -- loudly skipped for pending sibling slices
// ---------------------------------------------------------------------------

describe('every named script resolves to a file', () => {
  for (const { event, hook } of allCommandHooks(parsed)) {
    const rel = scriptOf(hook);
    if (rel === null) continue; // no ${CLAUDE_PLUGIN_ROOT}...mjs reference in this hook to check
    const abs = path.join(pluginRoot, rel);
    test(`${event}: ${rel}`, () => {
      assert.ok(existsSync(abs), `${rel} is wired in hooks.json but not present at ${abs}`);
    });
  }
});

describe('preflight resolves once every referenced script exists', () => {
  test('a fully-stubbed plugin root reports gate health ok', () => {
    const health = preflight({ pluginRoot: makePassingPluginRoot() });
    const wiring = health.checks.find((c) => c.name === 'hook wiring');
    assert.equal(wiring.ok, true, wiring.detail);
    assert.match(wiring.detail, /gate script\(s\) present/);
  });
});

// ---------------------------------------------------------------------------
// Gate entries: exec form, brace form, .mjs extension, and never a `||`
// ---------------------------------------------------------------------------

describe('gate entries use the exec form, never the shell fallback', () => {
  const gateHooks = allCommandHooks(parsed).filter(({ hook }) => isGateScript(scriptOf(hook)));

  test('at least one gate is wired (this test is not vacuous)', () => {
    assert.ok(gateHooks.length > 0);
  });

  for (const { event, matcher, hook } of gateHooks) {
    const rel = scriptOf(hook);
    describe(`${event} ${matcher ?? '(no matcher)'} -> ${rel}`, () => {
      test('uses the exec form: args present, no shell field', () => {
        assert.ok(Array.isArray(hook.args) && hook.args.length > 0, 'gate hooks must use command+args, not a bare shell string');
        assert.equal(hook.shell, undefined, 'the exec form takes no shell field');
      });

      test('command is the bare interpreter, with the script in args', () => {
        assert.equal(hook.command, 'node');
      });

      test('references the brace form and the .mjs extension', () => {
        assert.match(hook.args.join(' '), /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[\w-]+\.mjs/);
      });

      test('carries no || fallback anywhere in the hook', () => {
        const haystack = [hook.command, ...(hook.args ?? [])].join(' ');
        assert.doesNotMatch(haystack, /\|\|/, 'a gate must never carry the shell-fallback `||` form (see runtime-fallback.test.mjs)');
      });
    });
  }
});

// ---------------------------------------------------------------------------
// SessionStart: the report and the banner are two entries, not one
// ---------------------------------------------------------------------------
//
// A `shell` field wraps the WHOLE command, so a single shell-form entry put the report
// behind bash as well as the banner. On a Windows session started outside Git Bash,
// `bash` resolves to the WSL launcher and `sh` is not on PATH at all, so that entry
// produced no branch, no HEAD, no issues, no PRs, no run log and no gate-health banner
// -- the L-08 failure this hook exists to prevent -- while preflight() still reported
// ok, because hooks.json parsed and every script was present.
//
// The split bounds that. The report runs in exec form, which no shell can defeat. The
// banner keeps the shell it genuinely needs, and a broken shell now costs the banner
// alone. `||` is still correct here and nowhere else, and the gate group above is the
// regression test for the nowhere-else half.

describe('SessionStart splits the report from the banner', () => {
  const sessionStartHooks = allCommandHooks(parsed).filter(({ event }) => event === 'SessionStart');
  const reportHook = sessionStartHooks.find(({ hook }) => scriptOf(hook) === 'hooks/session-status.mjs')?.hook;
  const bannerHook = sessionStartHooks.find(({ hook }) => scriptOf(hook) === null)?.hook;

  test('two entries are wired: one report, one banner', () => {
    assert.equal(sessionStartHooks.length, 2);
    assert.ok(reportHook, 'no SessionStart hook names hooks/session-status.mjs');
    assert.ok(bannerHook, 'no shell-form SessionStart banner entry');
  });

  test('the report runs in exec form, so a missing shell cannot silence it', () => {
    assert.equal(reportHook.command, 'node');
    assert.match(reportHook.args.join(' '), /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/session-status\.mjs/);
    assert.equal(reportHook.shell, undefined, 'a shell field would gate the whole report on a shell that may not exist');
    assert.doesNotMatch([reportHook.command, ...reportHook.args].join(' '), /\|\|/);
  });

  test('the banner is shell form, echoes the exact banner, and does not rerun the report', () => {
    assert.equal(bannerHook.shell, 'bash');
    assert.equal(bannerHook.args, undefined, 'shell is ignored when args is set, so the banner must stay in shell form');
    assert.doesNotMatch(bannerHook.command, /session-status/);
    const m = /\|\|\s*echo\s+"([^"]*)"\s*$/.exec(bannerHook.command.trim());
    assert.ok(m, 'expected a trailing `|| echo "<banner>"`, double-quoted: cmd.exe does not treat `\'` as quoting');
    assert.equal(m[1], RUNTIME_MISSING_BANNER, 'hooks.json and lib.mjs must share one banner string');
  });
});

// ---------------------------------------------------------------------------
// Matchers -- spot checks against the specs each entry is derived from
// ---------------------------------------------------------------------------

// The documented matching rule. `"*"`, `""` and an omitted matcher all match every
// tool; a matcher made only of letters, digits, `_`, `-`, spaces, `,` and `|` is an
// exact string or list match; anything else is compiled and run as a JavaScript regex.
const SIMPLE_MATCHER = /^[A-Za-z0-9_\- ,|]*$/;
const matchesEveryTool = (m) => m === undefined || m === '' || m === '*';

function toolMatches(matcher, tool) {
  if (matchesEveryTool(matcher)) return true;
  if (SIMPLE_MATCHER.test(matcher)) return matcher.split(/[,|]/).map((s) => s.trim()).includes(tool);
  return new RegExp(matcher).test(tool); // throws on an invalid pattern, which is the finding
}

describe('matchers', () => {
  test('every matcher in the manifest is one the platform can actually use', () => {
    // The failure this catches, and the one a string pinned to itself could not: a
    // matcher that is neither an all-tools form nor a compilable regex registers
    // nothing, and the gate behind it silently stops running.
    for (const { matcher } of Object.values(parsed.hooks).flat()) {
      if (matchesEveryTool(matcher) || SIMPLE_MATCHER.test(matcher)) continue;
      assert.doesNotThrow(() => new RegExp(matcher), `matcher ${JSON.stringify(matcher)} does not compile as a regular expression`);
    }
  });

  test('the shell gate is anchored, not a bare substring (V-12: BashOutput is not Bash)', () => {
    const group = parsed.hooks.PreToolUse.find((g) => g.matcher === `^(${[...SHELL_TOOLS].join('|')})$`);
    assert.ok(group, 'no PreToolUse group is matched on exactly lib.mjs SHELL_TOOLS');
    assert.equal(toolMatches(group.matcher, 'BashOutput'), false, 'BashOutput reaches a gate that cannot judge it');
  });

  // C-07. PowerShell is a first-class tool that survives the background-subagent filter,
  // and every rule the gate runs was written against Bash alone. The matcher is asserted
  // against lib's SHELL_TOOLS rather than a literal, so a third shell tool cannot be
  // added to the set and quietly left out of the wiring. A matcher and a set maintained
  // in two files is V-13's failure with new names.
  test('the shell matcher is exactly lib.mjs SHELL_TOOLS', () => {
    const groups = parsed.hooks.PreToolUse.filter((g) => [...SHELL_TOOLS].some((t) => toolMatches(g.matcher, t)));
    assert.equal(groups.length, 1, 'exactly one PreToolUse group covers the shell tools');
    assert.equal(groups[0].matcher, `^(${[...SHELL_TOOLS].join('|')})$`);
  });

  test('the write matcher fires for every write tool this environment has, and no read tool', () => {
    // C-04: the matcher is a best-effort pre-filter and never the boundary, so a looser
    // one costs an extra process and a tighter one costs the gate outright. NotebookEdit
    // is a live write tool here and `^(Edit|Write)$` never saw it; the official
    // security-guidance plugin names the same four.
    const group = parsed.hooks.PreToolUse.find((g) => toolMatches(g.matcher, 'Write'));
    assert.ok(group, 'expected a PreToolUse group matching the write tools');
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
      assert.equal(toolMatches(group.matcher, tool), true, `${tool} can write under .claude/ without the gate firing`);
    }
    for (const tool of ['Read', 'NotebookRead']) {
      assert.equal(toolMatches(group.matcher, tool), false, 'the gate has no business on a read tool');
    }
  });

  test('the forge matcher names the merge, so a forge call that is not a merge starts no process', () => {
    // Narrowed from `mcp__.*github.*__.*` in #167. The matcher only stops the spawn:
    // gate.mjs still hands every forge tool name to block-merge, which decides on the
    // action itself, so a looser matcher was never the boundary and a tighter one costs
    // nothing but the processes it saves.
    const group = parsed.hooks.PreToolUse.find((g) => g.matcher?.includes('github'));
    assert.ok(group, 'expected a PreToolUse group matching github-namespaced tools');
    assert.equal(group.matcher, '^mcp__.*github.*__merge');
    assert.equal(toolMatches(group.matcher, 'mcp__plugin_github_github__merge_pull_request'), true);
    assert.equal(toolMatches(group.matcher, 'mcp__plugin_github_github__get_pull_request'), false);
  });

  test('no PreToolUse entry fires on every tool', () => {
    // review-jail was wired with no matcher at all, which started a node process on
    // every Grep, Read and Task in a session. Nothing is wired that way any more, and
    // this is the regression test for it.
    for (const group of parsed.hooks.PreToolUse) {
      assert.equal(matchesEveryTool(group.matcher), false, 'an all-tools matcher starts a process on every tool call');
    }
  });

  test('one script is wired on PreToolUse, once per matcher', () => {
    const scripts = new Set();
    for (const group of parsed.hooks.PreToolUse) {
      assert.equal(group.hooks.length, 1, 'a second hook on a matcher is a second node process');
      scripts.add(scriptOf(group.hooks[0]));
    }
    assert.deepEqual([...scripts], ['hooks/gate.mjs']);
  });
});

// ---------------------------------------------------------------------------
// Timeouts -- each one is the value the slice that built the gate asked for
// ---------------------------------------------------------------------------

describe('timeouts', () => {
  test('every gate entry declares the same short timeout', () => {
    // The gate parses a string and resolves a handful of git toplevels. It spawns no
    // test suite and no long subprocess, so there is nothing for a long timeout to
    // protect, and one value across the three entries means there is no per-entry
    // number to keep in step.
    for (const group of parsed.hooks.PreToolUse) {
      for (const hook of group.hooks) assert.equal(hook.timeout, 10);
    }
  });
});
