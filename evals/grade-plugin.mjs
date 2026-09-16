#!/usr/bin/env node
// evals/grade-plugin.mjs — the shape grader for the second build.
//
// It reads a plugin root and prints one expectation per claim PLAN.md section 5 makes for
// phase 3, plus the three structural checks that survive from the first build: the
// manifest parses, every gate script hooks.json names exists, and every SKILL.md
// frontmatter block parses.
//
// What it no longer does: count skills, count agents, know which skills are lanes, or read
// an agent charter. The second build has no agent charters and no fixed roster, so a number
// in this file would only have measured this file. What is left is the shape the plan
// commits to and nothing about inventory.
//
// The number it prints is read and reported, never protected (RULES.md). A failing check is
// a finding, not an instruction to edit the plugin until it passes.
//
// Deterministic and read-only over the plugin root. No model calls, no network, and the
// plugin is never installed to run this. The one write is a throwaway temp directory the
// read-budget check builds and removes; see measureReadBudget.
//
// Usage:
//   node evals/grade-plugin.mjs <plugin-root> [out.json]
//
// Envelope, unchanged:
//   { "expectations": [{ "text", "passed", "evidence" }, ...] }

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { measureCost } from '../plugin/hooks/harness-cost.mjs';

// ---------------------------------------------------------------------------
// The phase 3 constants
// ---------------------------------------------------------------------------

// The one skill the founder types. Every other skill is advisory and triggers on its
// description, so the three prohibitions below exempt this directory and nothing else.
const OPERATOR_SKILL = 'sprint-plan';

// PLAN.md section 9: a skill says what this shop wants and why, and refuses nothing. The
// hook refuses; prose does not. Case-insensitive, because a sentence-initial "Refuses" is
// the same word.
const REFUSE_RE = /\brefus(?:e|es|ed|ing)\b/i;

// PLAN.md section 9: no lane that orders steps. An ordered list of three or more items in a
// skill body is a lane wearing Markdown.
const ORDERED_ITEM_RE = /^\s*\d+[.)]\s+\S/;
const ORDERED_LIST_MINIMUM = 3;

// The word the plan names: "it never says 'then'". Counted and printed beside the ordered
// list check as evidence. It is not a pass or a fail, because "then" has honest uses in
// English prose and the ordered list is what actually makes a lane.
const THEN_RE = /\bthen\b/gi;

// A reference earns its place by carrying an incident or a measurement. An EVIDENCE.md id
// (C-, V-, L-), a decision id, or a number with a unit, within the first five lines.
const REFERENCE_LINES_CHECKED = 5;
const CITATION_ID_RE = /\b(?:C-\d{1,3}|V-\d{1,3}|L-\d{1,3}|DEC-\d{1,3}|EN-\d{1,3}|D\d{1,3})\b/;
const NUMBER_WITH_UNIT_RE =
  /(?:\$\s?\d|\b\d+(?:[.,]\d+)?\s*(?:%|x\b|lines?\b|days?\b|hours?\b|minutes?\b|seconds?\b|ms\b|dollars?\b|prs?\b|pull requests?\b|issues?\b|commits?\b|files?\b|calls?\b|runs?\b|sessions?\b|processes\b|tokens?\b|attempts?\b|interventions?\b))/i;

// PLAN.md section 5, phase 3: "Session-start read budget under 150 lines."
const READ_BUDGET_LINES = 150;

const CLAUDE_PLUGIN_ROOT_SCRIPT_RE = /\$\{CLAUDE_PLUGIN_ROOT\}([^\s"']*\.mjs)/g;

// ---------------------------------------------------------------------------
// Small filesystem and frontmatter helpers. No dependencies.
// ---------------------------------------------------------------------------

function safeRead(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function listDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Every file under `dir`, recursively, as absolute paths. */
function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function relative(pluginRoot, file) {
  return path.relative(pluginRoot, file).split(path.sep).join('/');
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// A top-level mapping entry. The separator is required: `name:fix` is a plain scalar to
// YAML, not a key, and a block whose first line is a scalar is not a mapping at all.
const KEY_LINE_RE = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/;
const DOUBLE_QUOTED_RE = /^"(?:[^"\\]|\\.)*"$/;
const SINGLE_QUOTED_RE = /^'(?:[^']|'')*'$/;

/**
 * Would YAML reject `raw` as the value of a mapping entry? Returns a reason, or null.
 *
 * Narrow on purpose. This is not a YAML grammar, it is the set of malformations a one-line
 * frontmatter value can actually hit, each one confirmed against
 * `claude plugin validate --strict` rather than reasoned about: an unquoted ": " opens a
 * nested mapping, an unquoted trailing ":" is a dangling mapping key, and a quote that
 * never closes is an unexpected character. A `#` comment is deliberately absent from the
 * list: it parses fine, it just truncates, which `plainValue` models.
 */
function scalarProblem(raw) {
  if (raw === '') return null;
  if (DOUBLE_QUOTED_RE.test(raw) || SINGLE_QUOTED_RE.test(raw)) return null;
  if (raw.startsWith('"') || raw.startsWith("'")) return 'opens a quote it never closes';
  const value = plainValue(raw);
  if (value.includes(': ')) return 'holds ": " in an unquoted value, which YAML reads as opening a nested mapping';
  if (value.endsWith(':')) return 'ends in a bare ":" in an unquoted value, which YAML reads as a dangling mapping key';
  return null;
}

/** A plain (unquoted) scalar as YAML yields it: everything before an unquoted `#` comment. */
function plainValue(raw) {
  const comment = /(?:^|\s)#/.exec(raw);
  return (comment ? raw.slice(0, comment.index) : raw).trim();
}

/** A quoted scalar as YAML yields it, or null when `raw` is not a quoted scalar. */
function quotedValue(raw) {
  if (DOUBLE_QUOTED_RE.test(raw)) {
    return raw.slice(1, -1).replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r' })[c] ?? c);
  }
  if (SINGLE_QUOTED_RE.test(raw)) return raw.slice(1, -1).replace(/''/g, "'");
  return null;
}

/**
 * Read a Markdown frontmatter block the way the runtime reads it.
 *
 * The runtime hands the block to a real YAML parser and, when that throws, loads the file
 * with no fields at all, not with the fields a reader would see on the page. So this
 * returns `fields: {}` whenever `errors` is non-empty. Reporting the text of a
 * `description:` line from a block that does not parse is how a broken skill scored green
 * for three phases: the number was not merely unchecked, it was wrong.
 */
function parseFrontmatter(text) {
  if (text === null) return { fields: {}, present: false, errors: [] };
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { fields: {}, present: false, errors: [] };
  const fields = {};
  const errors = [];
  m[1].split(/\r?\n/).forEach((line, idx) => {
    const at = `line ${idx + 1}`;
    if (line.trim() === '' || line.startsWith('#')) return;
    if (line.startsWith('\t')) {
      errors.push(`${at}: indented with a tab, which YAML forbids for indentation`);
      return;
    }
    if (/^\s/.test(line)) return; // nested block or folded scalar: legal, no top-level field
    const km = KEY_LINE_RE.exec(line);
    if (!km) {
      errors.push(`${at}: ${JSON.stringify(line.slice(0, 60))} is not a "key: value" mapping entry`);
      return;
    }
    const [, key, rawValue] = km;
    const raw = (rawValue ?? '').trim();
    const problem = scalarProblem(raw);
    if (problem) errors.push(`${at}: "${key}" ${problem}`);
    fields[key] = quotedValue(raw) ?? plainValue(raw);
  });
  return { fields: errors.length > 0 ? {} : fields, present: true, errors };
}

/** The text after the frontmatter block, or the whole file when there is none. */
function bodyOf(text) {
  if (text === null) return '';
  const m = FRONTMATTER_RE.exec(text);
  return m ? text.slice(m[0].length) : text;
}

function collectStrings(node, out) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) for (const v of node) collectStrings(v, out);
  else if (node && typeof node === 'object') for (const v of Object.values(node)) collectStrings(v, out);
}

function add(results, text, passed, evidence) {
  results.push({ text, passed: Boolean(passed), evidence: String(evidence) });
}

// ---------------------------------------------------------------------------
// Inventory, without a count
// ---------------------------------------------------------------------------

function findSkillDirs(pluginRoot) {
  const skillsDir = path.join(pluginRoot, 'skills');
  return listDirs(skillsDir).filter((name) => existsSync(path.join(skillsDir, name, 'SKILL.md')));
}

// ---------------------------------------------------------------------------
// Manifest — .claude-plugin/plugin.json
// ---------------------------------------------------------------------------

function checkManifest(pluginRoot, results) {
  const manifestPath = path.join(pluginRoot, '.claude-plugin', 'plugin.json');
  const raw = safeRead(manifestPath);
  let manifest = null;
  let parseError = null;
  if (raw !== null) {
    try {
      manifest = JSON.parse(raw);
    } catch (err) {
      parseError = err.message;
    }
  }

  add(
    results,
    '.claude-plugin/plugin.json exists and parses as JSON',
    manifest !== null,
    raw === null ? `no readable file at ${manifestPath}` : parseError ? `${manifestPath}: ${parseError}` : `${manifestPath} parses`,
  );

  add(
    results,
    'plugin.json declares a non-empty "name" (name is its only required field)',
    !!manifest && typeof manifest.name === 'string' && manifest.name.trim() !== '',
    manifest ? `name=${JSON.stringify(manifest.name)}` : 'plugin.json did not parse',
  );

  add(
    results,
    'plugin.json declares an explicit, non-empty "version" (omit it and every commit looks like a new version)',
    !!manifest && typeof manifest.version === 'string' && manifest.version.trim() !== '',
    manifest ? `version=${JSON.stringify(manifest.version)}` : 'plugin.json did not parse',
  );

  add(
    results,
    'plugin.json declares "$schema"',
    !!manifest && typeof manifest.$schema === 'string' && manifest.$schema.trim() !== '',
    manifest ? `$schema=${JSON.stringify(manifest.$schema)}` : 'plugin.json did not parse',
  );
}

// ---------------------------------------------------------------------------
// hooks/hooks.json: parses, and every gate script it names exists on disk
// ---------------------------------------------------------------------------

function checkHooksJson(pluginRoot, results) {
  const hooksJsonPath = path.join(pluginRoot, 'hooks', 'hooks.json');
  const raw = safeRead(hooksJsonPath);
  let manifest = null;
  let parseError = null;
  if (raw !== null) {
    try {
      manifest = JSON.parse(raw);
    } catch (err) {
      parseError = err.message;
    }
  }

  add(
    results,
    'hooks/hooks.json exists and parses as JSON with a "hooks" object',
    !!manifest && typeof manifest.hooks === 'object' && manifest.hooks !== null,
    raw === null
      ? `no readable file at ${hooksJsonPath}`
      : parseError
        ? `${hooksJsonPath}: ${parseError}`
        : manifest?.hooks
          ? 'parses, "hooks" object present'
          : `${hooksJsonPath}: no "hooks" object`,
  );

  if (!manifest) return;

  const strings = [];
  collectStrings(manifest, strings);
  // Stripped of the leading separator here, once, so the expectation text and the
  // existence check read the same relative path.
  const scripts = [
    ...new Set(strings.flatMap((s) => [...s.matchAll(CLAUDE_PLUGIN_ROOT_SCRIPT_RE)].map((m) => m[1].replace(/^[/\\]/, '')))),
  ].sort();

  add(
    results,
    'hooks.json registers at least one gate script',
    scripts.length > 0,
    scripts.length > 0 ? `registers ${scripts.length}: ${scripts.join(', ')}` : 'no ${CLAUDE_PLUGIN_ROOT}/...mjs references found',
  );

  for (const rel of scripts) {
    const abs = path.join(pluginRoot, rel);
    add(results, `hooks.json's reference to ${rel} exists on disk`, existsSync(abs), existsSync(abs) ? abs : `missing: ${abs}`);
  }
}

// ---------------------------------------------------------------------------
// The phase 3 checks
// ---------------------------------------------------------------------------

function checkNoAgents(pluginRoot, results) {
  const agentsDir = path.join(pluginRoot, 'agents');
  const files = walk(agentsDir).map((f) => relative(pluginRoot, f));
  add(
    results,
    'the plugin ships no agents/ directory (PLAN.md section 9: no agent charters; dispatch is a call with a prompt and a tier)',
    !existsSync(agentsDir),
    existsSync(agentsDir)
      ? `found ${relative(pluginRoot, agentsDir)}/${files.length > 0 ? `, holding ${files.join(', ')}` : ', empty'}`
      : `no agents/ under ${pluginRoot}`,
  );
}

/** Every Markdown and text file under skills/ and references/, as absolute paths. */
function proseFiles(pluginRoot) {
  return [...walk(path.join(pluginRoot, 'skills')), ...walk(path.join(pluginRoot, 'references'))];
}

function checkNoRefusal(pluginRoot, results) {
  const hits = [];
  for (const file of proseFiles(pluginRoot)) {
    const text = safeRead(file);
    if (text === null) continue;
    text.split(/\r?\n/).forEach((line, idx) => {
      if (REFUSE_RE.test(line)) hits.push(`${relative(pluginRoot, file)}:${idx + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  add(
    results,
    'no file under skills/ or references/ uses a word from the refuse family (PLAN.md section 9: a skill says what this shop wants and why; the hook refuses, prose does not)',
    hits.length === 0,
    hits.length === 0 ? 'none found' : hits.join(' | '),
  );
}

function skillBodies(pluginRoot, skillDirs) {
  const skillsDir = path.join(pluginRoot, 'skills');
  return skillDirs.map((name) => {
    const file = path.join(skillsDir, name, 'SKILL.md');
    const text = safeRead(file);
    return { name, file, rel: relative(pluginRoot, file), text, body: bodyOf(text), fm: parseFrontmatter(text) };
  });
}

function checkDisableModelInvocation(pluginRoot, skills, results) {
  const carried = skills.filter((s) => s.name !== OPERATOR_SKILL && s.fm.fields['disable-model-invocation'] === 'true');
  const onSprintPlan = skills.find((s) => s.name === OPERATOR_SKILL);
  add(
    results,
    `no SKILL.md outside ${OPERATOR_SKILL} carries disable-model-invocation: true (${OPERATOR_SKILL} is the one skill the founder types; everything else is advisory and triggers on its description)`,
    carried.length === 0,
    carried.length === 0
      ? `checked ${skills.length} skill(s); ${OPERATOR_SKILL}=${onSprintPlan ? onSprintPlan.fm.fields['disable-model-invocation'] ?? '(absent)' : '(no sprint-plan skill)'}`
      : carried.map((s) => `${s.rel}: disable-model-invocation: true`).join(' | '),
  );
}

/**
 * The longest run of ordered-list items in `body`. A run survives blank lines and
 * space-indented continuation lines, which is how Markdown writes a list with prose under
 * each item; any other line ends it.
 */
function longestOrderedRun(body) {
  let longest = 0;
  let run = 0;
  for (const line of body.split(/\r?\n/)) {
    if (ORDERED_ITEM_RE.test(line)) {
      run += 1;
      if (run > longest) longest = run;
    } else if (line.trim() === '' || /^\s/.test(line)) {
      // blank or indented: the list may continue
    } else {
      run = 0;
    }
  }
  return longest;
}

function checkNoOrderedSteps(pluginRoot, skills, results) {
  const others = skills.filter((s) => s.name !== OPERATOR_SKILL);
  const offenders = others
    .map((s) => ({ rel: s.rel, items: longestOrderedRun(s.body) }))
    .filter((s) => s.items >= ORDERED_LIST_MINIMUM);
  const thenCount = others.reduce((n, s) => n + (s.body.match(THEN_RE) ?? []).length, 0);

  add(
    results,
    `no SKILL.md body outside ${OPERATOR_SKILL} holds an ordered list of three or more items (PLAN.md section 9: no lane that orders steps)`,
    offenders.length === 0,
    `then: ${thenCount}; ` +
      (offenders.length === 0
        ? `no ordered list of three or more items in ${others.length} body/bodies`
        : offenders.map((s) => `${s.rel}: ordered list of ${s.items} items`).join(' | ')),
  );
}

function checkReferencesCite(pluginRoot, results) {
  const refsDir = path.join(pluginRoot, 'references');
  const files = walk(refsDir);
  const uncited = [];
  for (const file of files) {
    const text = safeRead(file);
    if (text === null) continue;
    const head = text.split(/\r?\n/).slice(0, REFERENCE_LINES_CHECKED).join('\n');
    if (!CITATION_ID_RE.test(head) && !NUMBER_WITH_UNIT_RE.test(head)) uncited.push(relative(pluginRoot, file));
  }
  add(
    results,
    `every file under references/ cites an EVIDENCE.md id (C-, V-, L-), a decision id, or a number with a unit within its first ${REFERENCE_LINES_CHECKED} lines (a reference earns its place by carrying an incident or a measurement)`,
    uncited.length === 0,
    files.length === 0
      ? `no references/ under ${pluginRoot} (nothing to check)`
      : uncited.length === 0
        ? `checked ${files.length}: all cite`
        : `no citation in the first ${REFERENCE_LINES_CHECKED} lines: ${uncited.join(', ')}`,
  );
}

/**
 * The plugin's own share of the session-start read budget.
 *
 * `measureCost` measures a machine: it reads a home settings file, a consumer directory and
 * an installed-plugins index, and adds up what a session loads before its first action. To
 * get the plugin's share alone, it is handed an empty home, an empty consumer and an index
 * whose one enabled plugin is the root being graded. Nothing on the real machine is read,
 * so the number is the plugin's and no one else's. The scaffolding is a temp directory,
 * built and removed inside this call.
 */
function measureReadBudget(pluginRoot) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'aeo-grade-budget-'));
  try {
    const homeDir = path.join(scratch, 'home');
    const pluginsDir = path.join(homeDir, 'plugins');
    const consumerDir = path.join(scratch, 'consumer');
    mkdirSync(pluginsDir, { recursive: true });
    mkdirSync(consumerDir, { recursive: true });
    writeFileSync(path.join(homeDir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'graded@local': true } }), 'utf8');
    writeFileSync(
      path.join(pluginsDir, 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'graded@local': [{ installPath: path.resolve(pluginRoot) }] } }),
      'utf8',
    );
    return measureCost(consumerDir, { homeDir, pluginRoot: pluginsDir }).sessionStartLines;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function checkReadBudget(pluginRoot, results) {
  const lines = measureReadBudget(pluginRoot);
  add(
    results,
    `the session-start read budget this plugin adds is under ${READ_BUDGET_LINES} lines (PLAN.md section 5, phase 3)`,
    lines < READ_BUDGET_LINES,
    `${lines} lines, against a budget of ${READ_BUDGET_LINES}`,
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Grade one plugin root. Every fact comes from files under `pluginRoot`; nothing is
 * installed and nothing else on the machine is read.
 *
 * @param {string} pluginRoot Path to a plugin root (the directory holding
 *   `.claude-plugin/`, `skills/`, `references/`, `hooks/`).
 * @returns {{plugin_root: string, summary: object, expectations: Array<{text: string, passed: boolean, evidence: string}>}}
 */
export function gradePlugin(pluginRoot) {
  const results = [];

  checkManifest(pluginRoot, results);
  checkHooksJson(pluginRoot, results);

  const skillDirs = findSkillDirs(pluginRoot);
  const skills = skillBodies(pluginRoot, skillDirs);
  for (const skill of skills) {
    const fm = skill.fm;
    add(
      results,
      `${skill.rel} frontmatter parses as YAML (a block that does not parse loads with zero fields, so every field it appears to declare is silently dropped)`,
      fm.present && fm.errors.length === 0,
      !fm.present
        ? `${skill.rel}: no frontmatter block found`
        : fm.errors.length > 0
          ? `${skill.rel}: frontmatter did not parse: ${fm.errors.join('; ')}`
          : `${skill.rel}: parses, ${Object.keys(fm.fields).length} field(s): ${Object.keys(fm.fields).join(', ')}`,
    );
  }

  checkNoAgents(pluginRoot, results);
  checkNoRefusal(pluginRoot, results);
  checkDisableModelInvocation(pluginRoot, skills, results);
  checkNoOrderedSteps(pluginRoot, skills, results);
  checkReferencesCite(pluginRoot, results);
  checkReadBudget(pluginRoot, results);

  const passed = results.filter((e) => e.passed).length;
  const total = results.length;
  return {
    plugin_root: pluginRoot,
    summary: { passed, failed: total - passed, total, pass_rate: total ? Number((passed / total).toFixed(4)) : 0 },
    expectations: results,
  };
}

function main() {
  const [, , pluginRootArg, outArg] = process.argv;
  if (!pluginRootArg) {
    console.error('usage: node evals/grade-plugin.mjs <plugin-root> [out.json]');
    process.exitCode = 1;
    return;
  }
  const pluginRoot = path.resolve(pluginRootArg);
  const report = gradePlugin(pluginRoot);
  const json = JSON.stringify(report, null, 2);
  if (outArg) {
    writeFileSync(path.resolve(outArg), json, 'utf8');
    console.log(`${pluginRoot}: ${report.summary.passed}/${report.summary.total} passed (written to ${outArg})`);
  } else {
    console.log(json);
  }
  process.exitCode = report.summary.failed > 0 ? 1 : 0;
}

// Importing this file (as the tests do) must not run the grader.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
