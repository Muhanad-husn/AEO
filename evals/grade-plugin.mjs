#!/usr/bin/env node
// evals/grade-plugin.mjs — the P2.M acceptance grader.
//
// source/global-workspace/grade_repo.py graded a scaffolded `.claude/{agents,skills,hooks}`
// tree that the plugin no longer produces: it looks for `repo/.claude/agents/*.md`, a
// `.claude/hooks/` directory, and so on, and every one of those checks fails by design once
// the plugin ships as an installed unit instead (docs/PLAN.md Phase 2, "the measurement
// slice"). This grades the shape that actually exists: a plugin root with a manifest,
// `skills/`, `agents/` and `hooks/`, checked against the claims docs/PLAN.md Phase 0 and
// Phase 2 make for it and the currency findings in docs/EVIDENCE.md that bind them.
//
// Deterministic and read-only. No model calls, no network, and the plugin is never
// installed to run this (D21) — every check reads files under the given plugin root and
// nothing else.
//
// Usage:
//   node evals/grade-plugin.mjs <plugin-root> [out.json]
//
// Emits the same envelope shape source/global-workspace/grade_repo.py did:
//   { "expectations": [{ "text", "passed", "evidence" }, ...] }
// so historical results stay comparable in SHAPE. The pass rate is not comparable in
// substance — see docs/EVIDENCE.md L-10. This grades a different artifact than the number
// it replaces was measured against, and reproducing that number is not what this file does.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Constants drawn from the acceptance bar (docs/PLAN.md Phase 0 / Phase 2) and the
// currency findings that bind Phase 2 (docs/EVIDENCE.md C-01, C-07, C-09, V-09).
// ---------------------------------------------------------------------------

// PLAN P0.1 opened with "eleven skill stubs" and P0.3 with a "roster reduced to three".
// Phase 3 added one of each: the monitor-design skill and the monitor-designer agent. Phase
// 4 adds one of each again: the verify lane and the verifier. Phase 5 adds a skill and no
// agent: worker-dispatch is the operation-worker fan-out pattern, and it deliberately has no
// charter of its own, because a worker's count and model tier are set by the task rather
// than fixed by a role. These are the current inventory, not the Phase 0 inventory, and the
// expectation text below says where each part of the number comes from so the citation stays
// honest as the plugin grows.
const EXPECTED_SKILL_COUNT = 14;
const EXPECTED_AGENT_COUNT = 5;

// The operator lanes: deterministic, user-invoked only. PLAN Phase 0's six, plus Phase 4's
// verify. Phase 3's monitor-design triggers on description and is deliberately not one of
// these. verify is one, because whether a verification runs is decided by the risk rubric
// at a known point in the workflow, not by a phrase in somebody's message.
const OPERATOR_LANES = new Set(['sprint-plan', 'sprint-start', 'fix', 'review', 'triage', 'status', 'verify']);

const MODEL_ALIASES = ['haiku', 'sonnet', 'opus']; // EN-9: pinned by alias, not a raw model id
const MODEL_TIER = { haiku: 0, sonnet: 1, opus: 2 };

// C-07: the tool set that survives the background-subagent filter, as stated in the P2.M
// brief this file was built against. A tool named in an agent's `tools:` frontmatter
// outside this set is silently dropped at runtime — the agent reads as capable of it and
// is not.
const BACKGROUND_SURVIVING_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit',
  'WebFetch', 'WebSearch', 'TodoWrite', 'Skill', 'ToolSearch', 'EnterWorktree',
  'ExitWorktree', 'Monitor', 'TaskStop', 'SendMessage', 'Artifact',
]);
const isMcpTool = (name) => /^mcp__[A-Za-z0-9._-]+(__.*)?$/.test(name);

// C-01: these frontmatter fields are silently ignored for plugin subagents. An agent file
// carrying one reads as guarded and is not.
const IGNORED_AGENT_FRONTMATTER_KEYS = ['hooks', 'mcpServers', 'permissionMode'];

// V-09: dead references into the Axial source product. Not bare "pytest" or "ruff" — those
// are legitimate stack-detection vocabulary (V-08's Node/Playwright/Python table) and
// appear in tdd-ci's own CI templates. What's dead is the literal Axial tool invocation.
const AXIAL_TOKENS = ['llm.py', 'cli.py', 'uv run', 'find-docs', 'ctx7'];

// docs/ does not ship with the plugin, so an id in a Markdown instruction is resolvable for
// an installed session only where the plugin ships the decision itself. It does, for the
// decisions its own prose depends on, in DECISIONS.md at the plugin root. An id that
// resolves to an entry there is a citation. An id that resolves to nothing is dangling, and
// dangling still fails, which is the whole of the rule this replaces. Scoped to .md by file
// KIND, not by location: a .mjs comment is source, read by whoever maintains the script, and
// every citation in this codebase's .mjs comments is followed by a sentence stating the
// lesson itself, so nothing there depends on fetching the doc. That is a property of the
// file, not of which directory it happens to sit under.
// Every identifier scheme this repo uses (see docs/DECISIONS.md's own header): D-n,
// DEC-n, EN-n, L-nn, C-nn, V-nn.
const DECISION_ID_RE = /\b(?:D\d{1,3}|DEC-\d{1,3}|EN-\d{1,3}|L-\d{1,2}|C-\d{1,2}|V-\d{1,2})\b/g;

// The shipped decisions file, flat at the plugin root beside VENDORED.md. It sits outside
// skills/ and agents/, so scanUnit never reaches it and it needs no exemption from the rule
// it makes resolvable. One entry per decision, keyed by the id in its heading.
const SHIPPED_DECISIONS_FILE = 'DECISIONS.md';
const DECISION_HEADING_RE = /^#{1,6}[ \t]+(D\d{1,3}|DEC-\d{1,3}|EN-\d{1,3}|L-\d{1,2}|C-\d{1,2}|V-\d{1,2})\b/;

const CLAUDE_PLUGIN_ROOT_RE = /\$\{CLAUDE_PLUGIN_ROOT\}([^\s"'`)]*)/g;

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

function listFiles(dir, ext) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && (!ext || e.name.endsWith(ext)))
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

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * A flat `key: value` reading of a Markdown frontmatter block. Every SKILL.md and agent
 * file in this plugin uses single-line scalar values only (no nested YAML, no block
 * scalars), so a line parser is the whole job — pulling in a YAML dependency for this
 * would be exactly the "new dependency" the founder's principles ask to justify first.
 */
function parseFrontmatter(text) {
  if (text === null) return { fields: {}, present: false };
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { fields: {}, present: false };
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const km = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]?(.*)$/.exec(line);
    if (km) fields[km[1]] = km[2].trim();
  }
  return { fields, present: true };
}

function splitTools(value) {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
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
// Inventory: what skills and agents actually exist
// ---------------------------------------------------------------------------

function findSkillDirs(pluginRoot) {
  const skillsDir = path.join(pluginRoot, 'skills');
  return listDirs(skillsDir).filter((name) => existsSync(path.join(skillsDir, name, 'SKILL.md')));
}

function findAgentFiles(pluginRoot) {
  return listFiles(path.join(pluginRoot, 'agents'), '.md');
}

/** The set of decision ids the plugin ships an entry for. Empty when it ships no file. */
function readShippedDecisionIds(pluginRoot) {
  const text = safeRead(path.join(pluginRoot, SHIPPED_DECISIONS_FILE));
  const ids = new Set();
  if (text === null) return ids;
  for (const line of text.split(/\r?\n/)) {
    const m = DECISION_HEADING_RE.exec(line);
    if (m) ids.add(m[1]);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Manifest — .claude-plugin/plugin.json (C-09)
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
    'plugin.json declares a non-empty "name" (C-09: name is its only required field)',
    !!manifest && typeof manifest.name === 'string' && manifest.name.trim() !== '',
    manifest ? `name=${JSON.stringify(manifest.name)}` : 'plugin.json did not parse',
  );

  add(
    results,
    'plugin.json declares an explicit, non-empty "version" (C-09: omit it and every commit looks like a new version)',
    !!manifest && typeof manifest.version === 'string' && manifest.version.trim() !== '',
    manifest ? `version=${JSON.stringify(manifest.version)}` : 'plugin.json did not parse',
  );

  add(
    results,
    'plugin.json declares "$schema" (C-09)',
    !!manifest && typeof manifest.$schema === 'string' && manifest.$schema.trim() !== '',
    manifest ? `$schema=${JSON.stringify(manifest.$schema)}` : 'plugin.json did not parse',
  );
}

// ---------------------------------------------------------------------------
// Inventory counts and the commands/ prohibition (C-03 / D9)
// ---------------------------------------------------------------------------

function checkInventory(pluginRoot, results) {
  const skillDirs = findSkillDirs(pluginRoot);
  const agentFiles = findAgentFiles(pluginRoot);

  add(
    results,
    `the plugin ships exactly ${EXPECTED_SKILL_COUNT} skills (docs/PLAN.md Phase 0's eleven, plus Phase 3's monitor-design, Phase 4's verify and Phase 5's worker-dispatch)`,
    skillDirs.length === EXPECTED_SKILL_COUNT,
    `found ${skillDirs.length}: ${skillDirs.join(', ') || '(none)'}`,
  );

  add(
    results,
    `the plugin ships exactly ${EXPECTED_AGENT_COUNT} agents (docs/PLAN.md P0.3's three, plus Phase 3's monitor-designer and Phase 4's verifier)`,
    agentFiles.length === EXPECTED_AGENT_COUNT,
    `found ${agentFiles.length}: ${agentFiles.join(', ') || '(none)'}`,
  );

  const commandsDir = path.join(pluginRoot, 'commands');
  add(
    results,
    'the plugin ships no commands/ directory (C-03 / D9: commands have been merged into skills)',
    !existsSync(commandsDir),
    existsSync(commandsDir) ? `found ${commandsDir}` : `no commands/ under ${pluginRoot}`,
  );

  return { skillDirs, agentFiles };
}

// ---------------------------------------------------------------------------
// Per-skill: SKILL.md frontmatter, and the six-lane disable-model-invocation split
// ---------------------------------------------------------------------------

function checkSkills(pluginRoot, skillDirs, results) {
  const skillsDir = path.join(pluginRoot, 'skills');
  for (const name of skillDirs) {
    const file = path.join(skillsDir, name, 'SKILL.md');
    const fm = parseFrontmatter(safeRead(file));
    const fmName = fm.fields.name;
    const fmDesc = fm.fields.description;

    add(
      results,
      `skills/${name}/SKILL.md declares a "name" and a non-empty "description"`,
      fm.present && typeof fmName === 'string' && fmName.trim() !== '' && typeof fmDesc === 'string' && fmDesc.trim() !== '',
      fm.present
        ? `name=${JSON.stringify(fmName)}, description=${fmDesc ? `${fmDesc.length} chars` : '(missing)'}`
        : `${file}: no frontmatter block found`,
    );

    const isLane = OPERATOR_LANES.has(name);
    const raw = fm.fields['disable-model-invocation'];
    const isTrue = raw === 'true';
    add(
      results,
      isLane
        ? `skills/${name} is an operator lane and carries disable-model-invocation: true`
        : `skills/${name} is not an operator lane and does not carry disable-model-invocation: true`,
      isLane ? isTrue : !isTrue,
      `disable-model-invocation=${raw === undefined ? '(absent)' : raw}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Per-agent: C-01 frontmatter safety, C-07 tool survival, EN-9 model alias
// ---------------------------------------------------------------------------

function checkAgents(pluginRoot, agentFiles, results) {
  const agentsDir = path.join(pluginRoot, 'agents');
  for (const fname of agentFiles) {
    const file = path.join(agentsDir, fname);
    const fm = parseFrontmatter(safeRead(file));
    const fields = fm.fields;

    const carried = IGNORED_AGENT_FRONTMATTER_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(fields, k));
    add(
      results,
      `agents/${fname} carries none of hooks:/mcpServers:/permissionMode: (C-01: silently ignored for plugin subagents, so an agent carrying one reads as guarded and is not)`,
      carried.length === 0,
      carried.length === 0 ? 'none present' : `found: ${carried.join(', ')}`,
    );

    const tools = splitTools(fields.tools);
    const dropped = tools.filter((t) => !BACKGROUND_SURVIVING_TOOLS.has(t) && !isMcpTool(t));
    add(
      results,
      `agents/${fname}'s tools: frontmatter lists only tools that survive the background-subagent filter (C-07)`,
      tools.length > 0 && dropped.length === 0,
      tools.length === 0
        ? `no tools: frontmatter found in ${file}`
        : dropped.length === 0
          ? `tools: ${tools.join(', ')}`
          : `dropped at runtime: ${dropped.join(', ')} (declared: ${tools.join(', ')})`,
    );

    const model = fields.model;
    add(
      results,
      `agents/${fname} pins its model to an alias, not a raw model id (EN-9)`,
      MODEL_ALIASES.includes(model),
      `model=${JSON.stringify(model)}`,
    );
  }
}

/** Structural checks specific to named roles, beyond the generic per-agent pass above. */
function checkRoleStructure(pluginRoot, agentFiles, results) {
  const agentsDir = path.join(pluginRoot, 'agents');
  const readRole = (role) => {
    const fname = agentFiles.find((f) => f.toLowerCase() === `${role}.md`);
    if (!fname) return null;
    return parseFrontmatter(safeRead(path.join(agentsDir, fname)));
  };

  const reviewer = readRole('reviewer');
  const reviewerTools = splitTools(reviewer?.fields.tools);
  add(
    results,
    'agents/reviewer.md tools: frontmatter is exactly Read (L-01: reviewer isolation from the repository is a hook, not a convention, and the dispatch call carries no tools it could hand over by mistake)',
    reviewerTools.length === 1 && reviewerTools[0] === 'Read',
    reviewer ? `tools: ${reviewerTools.join(', ') || '(none)'}` : 'agents/reviewer.md not found',
  );

  const verifier = readRole('verifier');
  const verifierTools = splitTools(verifier?.fields.tools);
  add(
    results,
    'agents/verifier.md tools: frontmatter is exactly Read (the verifier is jailed by the same hook as the reviewer, for the same reason: an agent holding file tools reads the repository whatever its charter says, and a verifier that has read the branch is no longer verifying the packet it was handed)',
    verifierTools.length === 1 && verifierTools[0] === 'Read',
    verifier ? `tools: ${verifierTools.join(', ') || '(none)'}` : 'agents/verifier.md not found',
  );

  const triage = readRole('triage');
  const triageTools = splitTools(triage?.fields.tools);
  const writeTools = triageTools.filter((t) => ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(t));
  add(
    results,
    'agents/triage.md tools: frontmatter carries no write-capable tool (triage writes no code and edits no files)',
    !!triage && writeTools.length === 0,
    triage ? `tools: ${triageTools.join(', ') || '(none)'}` : 'agents/triage.md not found',
  );

  const builder = readRole('builder');
  const builderModel = builder?.fields.model;
  const reviewerModel = reviewer?.fields.model;
  const builderTier = MODEL_TIER[builderModel];
  const reviewerTier = MODEL_TIER[reviewerModel];
  add(
    results,
    'the reviewer sits a model tier above the builder (docs/PLAN.md Phase 2: "the reviewer sits a tier above the builder")',
    Number.isInteger(builderTier) && Number.isInteger(reviewerTier) && reviewerTier > builderTier,
    `builder=${builderModel ?? '(none)'}, reviewer=${reviewerModel ?? '(none)'}`,
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
  // Stripped of the leading separator right here, once, so every consumer -- the
  // expectation text and the existence check alike -- reads and resolves the same
  // relative path rather than the text showing a leading slash the disk check silently
  // dropped.
  const scripts = [
    ...new Set(
      strings.flatMap((s) => [...s.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}([^\s"']*\.mjs)/g)].map((m) => m[1].replace(/^[/\\]/, ''))),
    ),
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
// Cross-cutting text scans, run once per skill directory and once per agent file:
// no Axial-product reference (V-09), every decision id cited in a Markdown file resolves
// to a shipped entry, every ${CLAUDE_PLUGIN_ROOT} path resolves. Scoped to skills/ and
// agents/ only.
// ---------------------------------------------------------------------------

/**
 * @param {Set<string>} shippedIds Decision ids the plugin ships an entry for.
 * @param {Map<string, string[]>} cited Accumulator, id -> the places citing it. The
 *   reverse check needs every unit's citations, so it is filled here and read once after
 *   every unit has been scanned.
 */
function scanUnit(unitLabel, files, pluginRoot, results, shippedIds, cited) {
  const axialHits = [];
  const danglingHits = [];
  const pathChecks = [];

  for (const file of files) {
    const text = safeRead(file);
    if (text === null) continue;
    const rel = path.relative(pluginRoot, file).split(path.sep).join('/');
    const isMarkdown = rel.toLowerCase().endsWith('.md');
    const lines = text.split(/\r?\n/);

    lines.forEach((line, idx) => {
      for (const token of AXIAL_TOKENS) {
        if (line.includes(token)) axialHits.push(`${rel}:${idx + 1}: "${token}" — ${line.trim().slice(0, 120)}`);
      }
      if (isMarkdown) {
        for (const m of line.matchAll(DECISION_ID_RE)) {
          const id = m[0];
          if (!cited.has(id)) cited.set(id, []);
          cited.get(id).push(`${rel}:${idx + 1}`);
          if (!shippedIds.has(id)) danglingHits.push(`${rel}:${idx + 1}: ${id} — ${line.trim().slice(0, 120)}`);
        }
      }
      for (const m of line.matchAll(CLAUDE_PLUGIN_ROOT_RE)) {
        const refRel = m[1].replace(/\/+$/, ''); // trailing slash on a directory reference
        const abs = path.join(pluginRoot, refRel.replace(/^[/\\]/, ''));
        pathChecks.push({ rel, line: idx + 1, ref: m[1], exists: existsSync(abs), abs });
      }
    });
  }

  add(
    results,
    `no file under ${unitLabel} references the Axial source product (V-09: llm.py / cli.py / uv run / find-docs / ctx7)`,
    axialHits.length === 0,
    axialHits.length === 0 ? 'none found' : axialHits.join(' | '),
  );

  add(
    results,
    `every decision id cited in Markdown under ${unitLabel} resolves to an entry in ${SHIPPED_DECISIONS_FILE} (docs/ does not ship with the plugin, so an id with no shipped entry is dangling for an installer; a .mjs comment is source for whoever maintains the script, not an installer-facing instruction, and is out of scope by design)`,
    danglingHits.length === 0,
    danglingHits.length === 0 ? 'none dangling' : danglingHits.join(' | '),
  );

  const badPaths = pathChecks.filter((c) => !c.exists);
  add(
    results,
    `every \${CLAUDE_PLUGIN_ROOT} path referenced under ${unitLabel} resolves to a file or directory that exists`,
    badPaths.length === 0,
    pathChecks.length === 0
      ? 'no ${CLAUDE_PLUGIN_ROOT} reference under this unit (nothing to check)'
      : badPaths.length === 0
        ? `checked ${pathChecks.length}: all resolve`
        : badPaths.map((c) => `${c.rel}:${c.line}: \${CLAUDE_PLUGIN_ROOT}${c.ref} -> missing at ${c.abs}`).join(' | '),
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Grade one plugin root. Pure and read-only: every fact comes from files under
 * `pluginRoot`, nothing is installed, and nothing else on the machine is touched.
 *
 * @param {string} pluginRoot Absolute or relative path to a plugin root (the directory
 *   holding `.claude-plugin/`, `agents/`, `skills/`, `hooks/`) — e.g. this repo's `plugin/`.
 * @returns {{plugin_root: string, summary: object, expectations: Array<{text: string, passed: boolean, evidence: string}>}}
 */
export function gradePlugin(pluginRoot) {
  const results = [];

  checkManifest(pluginRoot, results);
  const { skillDirs, agentFiles } = checkInventory(pluginRoot, results);
  checkSkills(pluginRoot, skillDirs, results);
  checkAgents(pluginRoot, agentFiles, results);
  checkRoleStructure(pluginRoot, agentFiles, results);
  checkHooksJson(pluginRoot, results);

  const shippedIds = readShippedDecisionIds(pluginRoot);
  const cited = new Map();

  const skillsDir = path.join(pluginRoot, 'skills');
  for (const name of skillDirs) {
    scanUnit(`skills/${name}`, walk(path.join(skillsDir, name)), pluginRoot, results, shippedIds, cited);
  }
  const agentsDir = path.join(pluginRoot, 'agents');
  for (const fname of agentFiles) {
    scanUnit(`agents/${fname}`, [path.join(agentsDir, fname)], pluginRoot, results, shippedIds, cited);
  }

  // The reverse of the resolution rule, and the thing that keeps the shipped file honest.
  // Without it the file has no upper bound: every decision the repository ever records
  // could be copied in, and it would grade the same. What earns an entry its place is a
  // shipped instruction that cites it.
  const orphans = [...shippedIds].filter((id) => !cited.has(id));
  add(
    results,
    `every entry in ${SHIPPED_DECISIONS_FILE} is cited by at least one Markdown file under skills/ or agents/ (an entry nothing cites is the shipped file growing into a copy of the repository's decision log)`,
    orphans.length === 0,
    shippedIds.size === 0
      ? `no ${SHIPPED_DECISIONS_FILE} at the plugin root (nothing to check)`
      : orphans.length === 0
        ? `checked ${shippedIds.size}: all cited`
        : `cited by nothing: ${orphans.join(', ')}`,
  );

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
