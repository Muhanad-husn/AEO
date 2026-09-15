// Tests for plugin/hooks/gate.mjs and the wiring that starts it.
//
// The slice's product is a count, not a new rule: one node process on a shell call, one
// on a write call, none on a read, a search, a Task or a forge call that is not a merge.
// So the first group measures the count with `measure` from scripts/score/harness.mjs,
// reading a stand-in home directory that enables this repository's own `plugin/`
// directory. The second group reads every PreToolUse matcher and asserts the tools that
// must not start a process.
//
// The remaining groups spawn the real gate, because a gate's decision is only observable
// as an exit code from a real process (runGate owns process.exit). They check that the
// rules the one script now dispatches to still refuse what they refused when each had
// its own process: a merge on a shell call, a write into `.claude/`. A Read of the same
// file exits 0, which is the count's other half stated as behaviour.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { measure } from '../../scripts/score/harness.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const pluginRoot = path.join(repoRoot, 'plugin');
const gatePath = path.join(pluginRoot, 'hooks', 'gate.mjs');
const hooksJsonPath = path.join(pluginRoot, 'hooks', 'hooks.json');
const manifest = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));

const scratch = [];
function tempDir(prefix = 'aeo-167-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The count
// ---------------------------------------------------------------------------

// `measure`'s `homeDir` is the directory that holds settings.json and plugins/, so a
// stand-in needs only those two things: a settings file that enables one plugin key and
// an installed_plugins.json whose installPath is this repository's plugin directory.
// Pointing at the real `plugin/` is the point: the number measured is the shipped
// wiring's, not a fixture copy's.
function standInHome() {
  const home = tempDir('aeo-167-home-');
  const plugins = path.join(home, 'plugins');
  mkdirSync(plugins, { recursive: true });
  writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { 'aeo@aeo': true } }));
  writeFileSync(
    path.join(plugins, 'installed_plugins.json'),
    JSON.stringify({ plugins: { 'aeo@aeo': [{ installPath: pluginRoot }] } }),
  );
  return { homeDir: home, pluginRoot: plugins };
}

describe('the plugin starts one node process on a shell call and none on a read', () => {
  test('measure reports bash 1, grep 0, read 0, task 0', () => {
    const { homeDir, pluginRoot: pluginsDir } = standInHome();
    const consumer = tempDir('aeo-167-consumer-');
    const snapshot = measure(consumer, { homeDir, pluginRoot: pluginsDir });
    assert.deepEqual(snapshot.processes, { bash: 1, grep: 0, read: 0, task: 0 });
  });
});

// ---------------------------------------------------------------------------
// The matchers
// ---------------------------------------------------------------------------

// The documented matching rule, the same reading tests/hooks/hooks-json.test.mjs uses:
// an omitted matcher, `""` and `"*"` all match every tool; a matcher made only of
// letters, digits, `_`, `-`, spaces, `,` and `|` is an exact string or list match;
// anything else is compiled as a JavaScript regex.
const SIMPLE_MATCHER = /^[A-Za-z0-9_\- ,|]*$/;
const matchesEveryTool = (m) => m === undefined || m === '' || m === '*';

function toolMatches(matcher, tool) {
  if (matchesEveryTool(matcher)) return true;
  if (SIMPLE_MATCHER.test(matcher)) return matcher.split(/[,|]/).map((s) => s.trim()).includes(tool);
  return new RegExp(matcher).test(tool);
}

const UNMATCHED_TOOLS = [
  'Read',
  'NotebookRead',
  'Grep',
  'Glob',
  'Task',
  'WebFetch',
  'BashOutput',
  'mcp__plugin_github_github__get_pull_request',
];

describe('no PreToolUse matcher starts a process on a tool the gate does not judge', () => {
  for (const tool of UNMATCHED_TOOLS) {
    test(`${tool} matches no PreToolUse entry`, () => {
      for (const group of manifest.hooks.PreToolUse) {
        assert.equal(
          toolMatches(group.matcher, tool),
          false,
          `${tool} starts a process through matcher ${JSON.stringify(group.matcher)}`,
        );
      }
    });
  }

  test('PreToolUse has exactly the three matchers the slice wires', () => {
    assert.deepEqual(
      manifest.hooks.PreToolUse.map((g) => g.matcher),
      ['^(Bash|PowerShell)$', '^(Edit|Write|MultiEdit|NotebookEdit)$', '^mcp__.*github.*__merge'],
    );
  });

  test('every PreToolUse entry runs gate.mjs and nothing else', () => {
    for (const group of manifest.hooks.PreToolUse) {
      assert.equal(group.hooks.length, 1);
      const [hook] = group.hooks;
      assert.equal(hook.command, 'node');
      assert.deepEqual(hook.args, ['${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs']);
    }
  });
});

// ---------------------------------------------------------------------------
// The rules the one script dispatches to
// ---------------------------------------------------------------------------

// L-03: a child spawned with neither CLAUDE_PROJECT_DIR nor a cwd of its own inherits
// the runner's, which is this repository, so a payload naming no directory would point
// the sandbox rules at the tree the suite runs in. Both are pinned to scratch.
const NEUTRAL_CWD = tempDir('aeo-167-nowhere-');
const neutralEnv = () => ({ ...process.env, CLAUDE_PROJECT_DIR: '' });

function runGateScript(payload) {
  const r = spawnSync(process.execPath, [gatePath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: NEUTRAL_CWD,
    env: neutralEnv(),
  });
  return { status: r.status, stderr: r.stderr ?? '' };
}

const settingsFile = path.join(repoRoot, '.claude', 'settings.json');

describe('gate.mjs refuses through the rules it now runs in one process', () => {
  test('a shell merge from a role subagent exits 2', () => {
    const r = runGateScript({
      tool_name: 'Bash',
      tool_input: { command: 'git merge feat' },
      agent_type: 'aeo:builder',
    });
    assert.equal(r.status, 2, r.stderr);
  });

  test('a shell call that merges nothing exits 0', () => {
    const r = runGateScript({
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
      agent_type: 'aeo:builder',
    });
    assert.equal(r.status, 0, r.stderr);
  });

  test('a write into the repository\'s own .claude/ exits 2', () => {
    const r = runGateScript({
      tool_name: 'Write',
      tool_input: { file_path: settingsFile },
      agent_type: 'aeo:builder',
    });
    assert.equal(r.status, 2, r.stderr);
  });

  test('a Read of that same file exits 0', () => {
    const r = runGateScript({
      tool_name: 'Read',
      tool_input: { file_path: settingsFile },
      agent_type: 'aeo:builder',
    });
    assert.equal(r.status, 0, r.stderr);
  });
});

// ---------------------------------------------------------------------------
// review-jail is gone
// ---------------------------------------------------------------------------

describe('review-jail is deleted, script and tier entry', () => {
  test('plugin/hooks/review-jail.mjs does not exist', () => {
    assert.equal(existsSync(path.join(pluginRoot, 'hooks', 'review-jail.mjs')), false);
  });

  test('neither npm script names a review-jail test', () => {
    const { scripts } = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    for (const name of ['test', 'test:integration']) {
      assert.doesNotMatch(scripts[name], /review-jail/, `"${name}" still names a review-jail test`);
    }
  });
});
