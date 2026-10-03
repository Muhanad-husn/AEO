// Runs the tests for the area a task touches instead of the whole battery.
//
//   npm run test:area -- <area> [<area> ...]   the test files of the named areas
//   npm run test:changed                        the areas of the files changed against main
//
// AREAS is the one mapping: for each area, the source globs it covers and the test files
// it owns. A changed file selects an area when it lies in that area's import closure:
// the area's source and test files plus every file they import, followed transitively.
// So a change to plugin/hooks/lib.mjs selects every area whose source imports it, with no
// second list to keep in step. A changed file in no area's closure runs the fast tier only.
//
// Plain node, no dependencies. CI keeps running `npm run test:all` and does not use this.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = 'plugin/hooks';
const T = 'tests';

export const AREAS = {
  'sandbox-guard': { src: [`${H}/sandbox-guard.mjs`], tests: [`${T}/hooks/sandbox-guard.test.mjs`] },
  'sandbox-session': { src: ['plugin/scripts/sandbox-session.mjs'], tests: [`${T}/hooks/sandbox-session.test.mjs`] },
  'block-merge': {
    src: [`${H}/block-merge.mjs`, `${T}/hooks/fixtures/**`],
    tests: [`${T}/hooks/block-merge.test.mjs`],
  },
  gate: { src: [`${H}/gate.mjs`], tests: [`${T}/hooks/gate.test.mjs`] },
  'hooks-json': { src: [`${H}/hooks.json`], tests: [`${T}/hooks/hooks-json.test.mjs`] },
  lib: { src: [`${H}/lib.mjs`], tests: [`${T}/hooks/lib.test.mjs`, `${T}/hooks/runtime-fallback.test.mjs`] },
  stack: { src: [`${H}/stack.mjs`], tests: [`${T}/hooks/stack.test.mjs`] },
  'test-tiers': {
    src: ['package.json', '.github/workflows/**'],
    tests: [`${T}/hooks/test-tiers.test.mjs`],
  },
  'test-area': { src: ['scripts/test-area.mjs'], tests: [`${T}/scripts/test-area.test.mjs`] },
  'session-status': { src: [`${H}/session-status.mjs`], tests: [`${T}/hooks/session-status.test.mjs`] },
  status: {
    src: [`${H}/status-render.mjs`, 'plugin/skills/status/**'],
    tests: [`${T}/skills/status.test.mjs`, `${T}/skills/status-render-smoke.test.mjs`],
  },
  sensorium: {
    src: [`${H}/sensorium.mjs`, `${H}/sensorium/**`, `${H}/ledger.mjs`,
      `${H}/status-table.mjs`, `${H}/harness-cost.mjs`, `${T}/fixtures/sensorium/**`],
    tests: [`${T}/hooks/sensorium.test.mjs`, `${T}/hooks/sensorium-dollars.test.mjs`,
      `${T}/hooks/sensorium-runs.test.mjs`,
      `${T}/hooks/sensorium-harness.test.mjs`],
  },
  score: {
    src: ['scripts/score.mjs', 'scripts/score/**', `${T}/fixtures/score/**`],
    tests: [`${T}/scripts/score.test.mjs`, `${T}/scripts/score-interventions.test.mjs`,
      `${T}/scripts/score-harness.test.mjs`, `${T}/scripts/score-record.test.mjs`,
      `${T}/scripts/score-milestone.test.mjs`, `${T}/scripts/score-synthetic.test.mjs`,
      `${T}/scripts/score-rules.test.mjs`],
  },
  independence: { src: ['plugin/scripts/independence.mjs'], tests: [`${T}/scripts/independence.test.mjs`] },
  runlog: {
    src: [`${H}/sentinel.mjs`, 'plugin/scripts/runlog.mjs', 'plugin/scripts/run-monitor.mjs',
      'plugin/scripts/run-sentinel.mjs', `${T}/scripts/runlog-harness.mjs`],
    tests: [`${T}/scripts/runlog.test.mjs`, `${T}/scripts/runlog-worker.test.mjs`,
      `${T}/scripts/run-monitor.test.mjs`, `${T}/scripts/run-sentinel.test.mjs`],
  },
  'worktree-links': { src: ['plugin/scripts/worktree-links.mjs'], tests: [`${T}/scripts/worktree-links.test.mjs`] },
  evals: {
    src: ['evals/**'],
    tests: [`${T}/evals/grade-plugin.test.mjs`, `${T}/evals/trigger-eval.test.mjs`],
  },
  'new-project': {
    src: ['plugin/skills/new-project/**', `${T}/fixtures/new-project/**`],
    tests: [`${T}/skills/new-project-commands.test.mjs`, `${T}/skills/new-project-plan-smoke.test.mjs`,
      `${T}/skills/new-project-scaffold.test.mjs`],
  },
  'classify-branches': { src: ['plugin/skills/safe-cleanup/**'], tests: [`${T}/skills/classify-branches.test.mjs`] },
  'collect-evidence': { src: ['plugin/skills/pr/**'], tests: [`${T}/skills/collect-evidence.test.mjs`] },
  'plugin-manifest': {
    src: ['plugin/skills/*/SKILL.md', 'plugin/VENDORED.md', 'plugin/UPSTREAM-LICENSE',
      'plugin/.claude-plugin/**'],
    tests: [`${T}/skills/skill-frontmatter.test.mjs`, `${T}/skills/retired-skill-names.test.mjs`, `${T}/skills/vendored-manifest.test.mjs`],
  },
};

/** `*` stays inside a directory, `**` crosses directories. */
export function globToRegExp(glob) {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${body}$`);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.claude', 'source', 'logs']);

function walk(root, dir = '') {
  const out = [];
  for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(root, rel));
    else out.push(rel);
  }
  return out;
}

const IMPORT_RE = /(?:\bfrom|\bimport\s*\(|\bimport)\s*['"](\.{1,2}\/[^'"]+)['"]/g;

/** Relative files (posix, root-relative) that `file` imports. */
function importsOf(root, file) {
  if (!/\.(mjs|js)$/.test(file)) return [];
  const text = readFileSync(path.join(root, file), 'utf8');
  const out = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    out.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
  }
  return out;
}

function closureOf(root, seeds) {
  const seen = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (existsSync(path.join(root, f))) queue.push(...importsOf(root, f));
  }
  return seen;
}

/**
 * Areas selected by a list of changed paths (posix, root-relative), plus the paths that
 * fall in no area's closure.
 */
export function selectAreas(changed, { root = REPO, areas = AREAS } = {}) {
  const files = walk(root);
  const closures = Object.entries(areas).map(([name, a]) => {
    const res = a.src.map(globToRegExp);
    const seeds = [...a.tests, ...files.filter((f) => res.some((re) => re.test(f)))];
    return [name, closureOf(root, seeds), res];
  });
  const picked = new Set();
  const unmapped = [];
  for (const file of changed) {
    let hit = false;
    for (const [name, closure, res] of closures) {
      if (closure.has(file) || res.some((re) => re.test(file))) {
        picked.add(name);
        hit = true;
      }
    }
    if (!hit) unmapped.push(file);
  }
  return { areas: Object.keys(areas).filter((n) => picked.has(n)), unmapped };
}

/** De-duplicated test files (root-relative) for the named areas. */
export function testFilesFor(names, areas = AREAS) {
  const files = [];
  for (const n of names) {
    if (!areas[n]) throw new Error(`unknown area "${n}". Areas: ${Object.keys(areas).join(', ')}`);
    for (const f of areas[n].tests) if (!files.includes(f)) files.push(f);
  }
  return files;
}

function fastTierFiles(root = REPO) {
  const { scripts } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return scripts.test.split(/\s+/).filter((t) => t.endsWith('.test.mjs'));
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
}

/** Files changed against main: committed on the branch, in the working tree, and untracked. */
function changedAgainstMain() {
  let base = 'main';
  try { git(['rev-parse', '--verify', '-q', 'main']); } catch { base = 'origin/main'; }
  const mergeBase = git(['merge-base', base, 'HEAD'])[0];
  return [...new Set([...git(['diff', '--name-only', mergeBase]),
    ...git(['ls-files', '--others', '--exclude-standard'])])];
}

function run(files) {
  const r = spawnSync(process.execPath, ['--test', ...files], { cwd: REPO, stdio: 'inherit' });
  return r.status ?? 1;
}

function main(argv) {
  const [mode, ...rest] = argv;
  if (mode === 'area') {
    if (!rest.length) {
      console.error(`usage: npm run test:area -- <area> [<area> ...]\nAreas: ${Object.keys(AREAS).join(', ')}`);
      return 1;
    }
    const files = testFilesFor(rest);
    console.log(`areas: ${rest.join(', ')}\nfiles: ${files.join(' ')}`);
    return run(files);
  }
  if (mode === 'changed') {
    const changed = changedAgainstMain();
    if (!changed.length) {
      console.log('nothing changed against main; nothing to run');
      return 0;
    }
    const { areas, unmapped } = selectAreas(changed);
    console.log(`changed: ${changed.length} file(s)`);
    let files = testFilesFor(areas);
    if (unmapped.length) {
      console.log(`in no area: ${unmapped.join(', ')}`);
      console.log(areas.length ? 'adding the fast tier for them' : 'no changed file maps to an area; running the fast tier only');
      files = [...new Set([...files, ...fastTierFiles()])];
    }
    if (!files.length) return 0;
    console.log(`areas: ${areas.join(', ')}\nfiles: ${files.join(' ')}`);
    return run(files);
  }
  console.error('usage: test-area.mjs area <area>... | changed');
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
