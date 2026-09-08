// Cost of the harness itself: node processes fired per tool call, lines a
// session reads before its first action, and lines of tests over lines of
// source for the consumer as configured on this machine.
//
// `measure` is pure node:fs over the two roots it is given (`homeDir` and
// `pluginRoot`). Naming note: `homeDir` here is the directory that holds
// `settings.json`, `CLAUDE.md` and (by default) the `plugins` folder — on a
// real machine that is `<os.homedir()>/.claude`, not `os.homedir()` itself.
// The default below makes that concrete so a fixture can pass a stand-in
// directory with the same flat shape (settings.json, CLAUDE.md, plugins/)
// without needing a nested `.claude` folder of its own.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const TOOLS = ['Bash', 'Grep', 'Read', 'Task'];

function readJSON(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

// A file ending in a newline has no extra empty trailing line.
function countLines(text) {
  if (text === '') return 0;
  const normalised = text.replace(/\r\n/g, '\n');
  const parts = normalised.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

function isNodeCommand(command) {
  return typeof command === 'string' && /^node(\s|$)/.test(command.trim());
}

// Tally every PreToolUse/PostToolUse node hook in one `{ hooks: {...} }` (or
// bare `{...}`) object into `counts`.
function tallyHooks(hooksHolder, counts) {
  const hooks = hooksHolder?.hooks ?? hooksHolder;
  if (!hooks) return;
  for (const event of ['PreToolUse', 'PostToolUse']) {
    for (const entry of hooks[event] ?? []) {
      const matcher = entry.matcher;
      let regex = null;
      if (matcher) {
        try {
          regex = new RegExp(matcher);
        } catch {
          continue;
        }
      }
      for (const hook of entry.hooks ?? []) {
        if (hook.type !== 'command' || !isNodeCommand(hook.command)) continue;
        for (const tool of TOOLS) {
          if (!regex || regex.test(tool)) counts[tool] += 1;
        }
      }
    }
  }
}

// Enabled-plugin keys, home settings taking effect unless the consumer's own
// settings (settings.json or settings.local.json) turn a plugin off, or turn
// it on when home does not mention it.
function enabledPluginKeys(homeSettings, consumerSettings, consumerLocalSettings) {
  const homeMap = homeSettings?.enabledPlugins ?? {};
  const consumerMap = { ...(consumerSettings?.enabledPlugins ?? {}), ...(consumerLocalSettings?.enabledPlugins ?? {}) };
  const keys = new Set([...Object.keys(homeMap), ...Object.keys(consumerMap)]);
  const enabled = [];
  for (const key of keys) {
    if (consumerMap[key] === false) continue;
    if (consumerMap[key] === true || homeMap[key] === true) enabled.push(key);
  }
  return enabled;
}

function pluginRootFor(entry, pluginRoot) {
  const installPath = entry?.installPath;
  if (!installPath) return null;
  return isAbsolute(installPath) ? installPath : resolve(dirname(pluginRoot), installPath);
}

function listMarkdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(dir, name))
    .filter((full) => statSync(full).isFile());
}

function listSkillFiles(skillsDir) {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .map((name) => join(skillsDir, name, 'SKILL.md'))
    .filter((full) => existsSync(full));
}

const EXCLUDED_DIRS = new Set(['node_modules', '.venv', 'source', '.git']);

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, base, out);
    } else if (stat.isFile()) {
      out.push(full.slice(base.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

function listConsumerFiles(dir) {
  if (existsSync(join(dir, '.git'))) {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
    return out === '' ? [] : out.split('\n').filter((f) => !f.split('/').some((seg) => EXCLUDED_DIRS.has(seg)));
  }
  return walk(dir);
}

function testsOverSource(dir) {
  const hasPackageJson = existsSync(join(dir, 'package.json'));
  const hasPyproject = existsSync(join(dir, 'pyproject.toml'));
  let extensions;
  if (hasPackageJson) extensions = ['.mjs', '.js', '.cjs', '.ts'];
  else if (hasPyproject) extensions = ['.py'];
  else return null;

  const files = listConsumerFiles(dir).filter((f) => extensions.some((ext) => f.endsWith(ext)));
  let testLines = 0;
  let sourceLines = 0;
  for (const file of files) {
    const top = file.split('/')[0];
    const lines = countLines(readText(join(dir, file)));
    if (top === 'tests' || top === 'test') testLines += lines;
    else sourceLines += lines;
  }
  return { testLines, sourceLines };
}

// Pure filesystem read of the harness a consumer runs on this machine.
// `homeDir` defaults to `<os.homedir()>/.claude` and `pluginRoot` to
// `<homeDir>/plugins` — see the module comment for why `homeDir` is that
// directory rather than the OS home directory itself.
export function measure(dir, { homeDir = join(homedir(), '.claude'), pluginRoot = join(homeDir, 'plugins') } = {}) {
  const homeSettings = readJSON(join(homeDir, 'settings.json'));
  const consumerSettings = readJSON(join(dir, '.claude', 'settings.json'));
  const consumerLocalSettings = readJSON(join(dir, '.claude', 'settings.local.json'));

  const counts = { Bash: 0, Grep: 0, Read: 0, Task: 0 };
  tallyHooks(homeSettings, counts);
  tallyHooks(consumerSettings, counts);
  tallyHooks(consumerLocalSettings, counts);

  let sessionStartLines = countLines(readText(join(homeDir, 'CLAUDE.md'))) + countLines(readText(join(dir, 'CLAUDE.md')));

  const installed = readJSON(join(pluginRoot, 'installed_plugins.json'));
  const enabledKeys = enabledPluginKeys(homeSettings, consumerSettings, consumerLocalSettings);
  for (const key of enabledKeys) {
    const entries = installed?.plugins?.[key];
    if (!entries || entries.length === 0) continue;
    const root = pluginRootFor(entries[0], pluginRoot);
    if (!root) continue;

    tallyHooks(readJSON(join(root, 'hooks', 'hooks.json')), counts);

    for (const agentFile of listMarkdownFiles(join(root, 'agents'))) {
      sessionStartLines += countLines(readText(agentFile));
    }
    sessionStartLines += listSkillFiles(join(root, 'skills')).length;
  }

  return {
    processes: { bash: counts.Bash, grep: counts.Grep, read: counts.Read, task: counts.Task },
    sessionStartLines,
    tests: testsOverSource(dir),
  };
}

export function line(snapshot) {
  const harness = snapshot.harness;
  if (!harness) return 'harness: not measured';
  const { processes, sessionStartLines, tests } = harness;
  const testsPart = tests === null
    ? 'tests: no manifest'
    : `tests ${(tests.sourceLines === 0 ? 0 : tests.testLines / tests.sourceLines).toFixed(2)} of source (${tests.testLines} / ${tests.sourceLines})`;
  return [
    `harness: bash ${processes.bash} node, grep ${processes.grep}, read ${processes.read}, task ${processes.task}`,
    `session start ${sessionStartLines} lines`,
    testsPart,
  ].join('; ');
}
