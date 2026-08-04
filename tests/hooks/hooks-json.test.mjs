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

import { RUNTIME_MISSING_BANNER, preflight } from '../../plugin/hooks/lib.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugin');
const hooksJsonPath = path.join(pluginRoot, 'hooks', 'hooks.json');
const rawText = readFileSync(hooksJsonPath, 'utf8');
const parsed = JSON.parse(rawText);

// Scripts P1.2/P1.3/P1.6 own and are building in sibling worktrees at the same time as
// this slice (see PLAN.md's concurrency schedule). They are wired here deliberately --
// single ownership of hooks.json is the point (L-04) -- but they will not exist on disk
// in THIS worktree until those branches merge. A missing file for one of these is a
// scheduling fact, not a defect in this slice, so its existence check skips loudly
// (L-08: a loud skip, never a silent pass) instead of failing red.
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
// The SessionStart reporter: the one place `||` is correct
// ---------------------------------------------------------------------------

describe('SessionStart carries the || fallback, and only there', () => {
  const sessionStartHooks = allCommandHooks(parsed).filter(({ event }) => event === 'SessionStart');

  test('exactly one SessionStart command hook is wired', () => {
    assert.equal(sessionStartHooks.length, 1);
  });

  const { hook } = sessionStartHooks[0];

  test('runs in shell form (bash), because the || fallback needs a shell', () => {
    assert.equal(hook.shell, 'bash');
    assert.equal(hook.args, undefined);
  });

  test('names session-status.mjs with the brace form', () => {
    assert.equal(scriptOf(hook), 'hooks/session-status.mjs');
  });

  test('falls back to the exact RUNTIME_MISSING_BANNER string on any non-zero exit', () => {
    const m = /\|\|\s*echo\s+'([^']*)'\s*$/.exec(hook.command.trim());
    assert.ok(m, 'expected a trailing `|| echo \'<banner>\'`');
    assert.equal(m[1], RUNTIME_MISSING_BANNER, 'hooks.json and lib.mjs must share one banner string');
  });

  test('quotes ${CLAUDE_PLUGIN_ROOT} in the shell-form command (C-09: install paths contain spaces)', () => {
    assert.match(hook.command, /"\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/session-status\.mjs"/);
  });
});

// ---------------------------------------------------------------------------
// Matchers -- spot checks against the specs each entry is derived from
// ---------------------------------------------------------------------------

describe('matchers', () => {
  test('the Bash gates are anchored, not a bare substring (V-12: BashOutput is not Bash)', () => {
    const group = parsed.hooks.PreToolUse.find((g) => g.hooks.some((h) => scriptOf(h)?.endsWith('commit-gate.mjs')));
    assert.equal(group.matcher, '^Bash$');
  });

  test('the forge-tool matcher matches D14\'s namespace-agnostic pattern, not one literal server name', () => {
    const group = parsed.hooks.PreToolUse.find((g) => g.matcher?.includes('github'));
    assert.ok(group, 'expected a PreToolUse group matching github-namespaced tools');
    assert.equal(group.matcher, 'mcp__.*github.*__.*(merge|create_or_update_file|push_files|delete_file)');
  });

  test('review-jail is wired against every tool, not a named subset', () => {
    const group = parsed.hooks.PreToolUse.find((g) => g.hooks.some((h) => scriptOf(h)?.endsWith('review-jail.mjs')));
    assert.equal(group.matcher, '*');
  });
});
