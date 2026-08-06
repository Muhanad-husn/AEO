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

import { HOOK_TIMEOUT_SECONDS } from '../../plugin/hooks/commit-gate.mjs';
import { RUNTIME_MISSING_BANNER, preflight } from '../../plugin/hooks/lib.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugin');
const hooksJsonPath = path.join(pluginRoot, 'hooks', 'hooks.json');
const rawText = readFileSync(hooksJsonPath, 'utf8');
const parsed = JSON.parse(rawText);

// Scripts P1.2/P1.3/P1.6 own and were building in sibling worktrees while P1.7 wrote
// this file. They are wired here deliberately -- single ownership of hooks.json is the
// point (L-04) -- but they did not exist on disk in that worktree until those branches
// merged. A missing file for one of these was a scheduling fact, not a defect, so its
// existence check skips loudly (L-08: a loud skip, never a silent pass) instead of
// failing red. All three have now merged, so nothing here skips; the allowance stays
// only because the next slice to be wired ahead of its merge needs it.
const PENDING_SIBLING_SLICES = new Set(['hooks/commit-gate.mjs', 'hooks/block-merge.mjs', 'hooks/review-jail.mjs']);

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

const isGateScript = (rel) => rel !== null && /\/(commit-gate|block-merge|review-jail|path-guard|sandbox-guard)\.mjs$/.test(`/${rel}`);

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
    const exists = existsSync(abs);
    const pending = !exists && PENDING_SIBLING_SLICES.has(rel);
    test(
      `${event}: ${rel}`,
      { skip: pending ? `not yet merged into this worktree (parallel Phase 1 slice; verified at integration)` : false },
      () => {
        assert.ok(exists, `${rel} is wired in hooks.json but not present at ${abs}`);
      },
    );
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

  test('the Bash gates are anchored, not a bare substring (V-12: BashOutput is not Bash)', () => {
    const group = parsed.hooks.PreToolUse.find((g) => g.hooks.some((h) => scriptOf(h)?.endsWith('commit-gate.mjs')));
    assert.equal(group.matcher, '^Bash$');
  });

  test('the forge-tool matcher matches D14\'s namespace-agnostic pattern, not one literal server name', () => {
    const group = parsed.hooks.PreToolUse.find((g) => g.matcher?.includes('github'));
    assert.ok(group, 'expected a PreToolUse group matching github-namespaced tools');
    // Every github-namespaced tool, not the subset of action names block-merge blocks
    // today. C-04: the matcher is a best-effort pre-filter and never the security
    // boundary, so a looser one that invokes the gate more often is safe while a
    // tighter one that misses is not. Naming the action list here would also be the
    // same list in two files, and the copy in this one goes stale silently the first
    // time the gate learns a new action.
    assert.equal(group.matcher, 'mcp__.*github.*__.*');
  });

  test('review-jail fires for every tool, asserted by matching rather than by spelling', () => {
    // The matcher is omitted, not `"*"`. All three all-tools forms are documented, but
    // every shipped official plugin that fires on all tools omits the field -- hookify,
    // the reference PreToolUse plugin, is the clearest case -- and an omitted matcher
    // leaves no string for anything to interpret. `"*"` is only correct as a special
    // case: hand it to `new RegExp` and it raises "Nothing to repeat", and the jail
    // stops running with every test still green, which is what the old assertion (the
    // literal `"*"` compared against itself) could not see.
    const group = parsed.hooks.PreToolUse.find((g) => g.hooks.some((h) => scriptOf(h)?.endsWith('review-jail.mjs')));
    assert.ok(group, 'review-jail is not registered on PreToolUse at all');
    for (const tool of ['Bash', 'Edit', 'NotebookEdit', 'Read', 'Task', 'WebFetch', 'mcp__github__create_pull_request']) {
      assert.equal(toolMatches(group.matcher, tool), true, `${tool} would reach the reviewer with no jail in front of it`);
    }
  });

  test('the path guard fires for every write tool this environment has', () => {
    // C-04: the matcher is a best-effort pre-filter and never the boundary, so a looser
    // one costs an extra process and a tighter one costs the gate outright. NotebookEdit
    // is a live write tool here and `^(Edit|Write)$` never saw it; the official
    // security-guidance plugin names the same four.
    const group = parsed.hooks.PreToolUse.find((g) => g.hooks.some((h) => scriptOf(h)?.endsWith('path-guard.mjs')));
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
      assert.equal(toolMatches(group.matcher, tool), true, `${tool} can write under .claude/ without the path guard firing`);
    }
    assert.equal(toolMatches(group.matcher, 'Read'), false, 'the guard has no business on a read tool');
  });

  test('block-merge is wired on both arms it decides: Bash and the forge', () => {
    const matchers = parsed.hooks.PreToolUse.filter((g) =>
      g.hooks.some((h) => scriptOf(h)?.endsWith('block-merge.mjs')),
    ).map((g) => g.matcher);
    assert.deepEqual(matchers.sort(), ['^Bash$', 'mcp__.*github.*__.*']);
  });
});

// ---------------------------------------------------------------------------
// Timeouts -- each one is the value the slice that built the gate asked for
// ---------------------------------------------------------------------------

describe('timeouts', () => {
  const timeoutOf = (suffix) => {
    for (const { hook } of allCommandHooks(parsed)) {
      if (scriptOf(hook)?.endsWith(suffix)) return hook.timeout;
    }
    return undefined;
  };

  test('commit-gate declares the timeout its own code is written against', () => {
    // Not a tuned number: it is the documented default for a command hook, stated so
    // that the gate's internal suite budget can be checked against it in one place.
    // What Claude Code does on a hook timeout is undocumented, so the gate does not
    // rely on it -- it holds its own 570s budget, sees the overrun itself and blocks.
    assert.equal(timeoutOf('commit-gate.mjs'), HOOK_TIMEOUT_SECONDS);
    assert.equal(timeoutOf('commit-gate.mjs'), 600);
  });

  test('review-jail declares the short timeout its slice specified', () => {
    // The jail reads a payload and compares two paths. It spawns nothing, so there is
    // nothing for a long timeout to protect.
    assert.equal(timeoutOf('review-jail.mjs'), 10);
  });

  test('block-merge declares no timeout override', () => {
    for (const { hook } of allCommandHooks(parsed)) {
      if (scriptOf(hook)?.endsWith('block-merge.mjs')) assert.equal(hook.timeout, undefined);
    }
  });
});
