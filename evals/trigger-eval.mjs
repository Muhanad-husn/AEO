#!/usr/bin/env node
// evals/trigger-eval.mjs — the P6.4 trigger-accuracy eval.
//
// A second, different measurement from evals/grade-plugin.mjs. The acceptance grader asks
// whether the shipped tree has the right shape; this asks whether the descriptions in that
// tree actually fire on the prompts they are meant to catch, and stay quiet on prompts that
// belong to a neighbour. Neither file imports the other and neither replaces the other.
//
// D23 moved this measurement out of P2.M and into Phase 6 so the number lands against the
// descriptions the tuning pass is judged by. This slice measures. It does not tune. Nothing
// here writes to plugin/skills/.
//
// ---------------------------------------------------------------------------
// What is measured, and why it is measured this way
// ---------------------------------------------------------------------------
//
// The roster is read from the shipped tree, never hardcoded: every skill whose SKILL.md
// does NOT carry `disable-model-invocation: true` is a candidate, because those are exactly
// the skills the runtime offers for automatic invocation. The operator lanes carry that
// field and are reachable only by name, so they are not in the roster and cannot be a
// correct answer. A prompt that belongs to a lane is therefore expected to select nothing —
// and an auto-triggered skill grabbing a lane's prompt is a real defect, which is why
// several of the hardest cases are shaped that way.
//
// The judge is a model, not a string matcher. A keyword-overlap scorer dressed up as a
// trigger eval would be measuring the case file against itself; docs/EVIDENCE.md L-10 is
// the record of what that kind of self-cheating costs. The judge sees the roster and one
// user message and answers with one skill name or NONE. It never sees the expected answer,
// the case's kind, or its rationale — L-10: "a judge shown a pre-fill rubber-stamps it."
//
// Because the judge is a model, the run is not deterministic, and the noise floor is not
// optional. Run the unchanged set several times and read the spread before reading any
// score; a difference smaller than the floor is not a difference. `aggregateRuns` reports
// the per-skill spread and the per-case flip list for exactly that reason, and the flip
// list is there because L-10 also says to diff the entries that flipped, never the totals.
//
// One definition worth stating outright, because recomputing it is the only other way to
// find out: the precision this harness reports is the mean of the per-repeat precision
// ratios — `scoreRun` computes precision within one repeat and `aggregateRuns` averages
// those — not a single ratio pooled over every case-repeat pair. The two differ by up to
// 1.8 points on the denominators this case set produces, so a figure from here should
// never be compared against a pooled precision computed some other way.
//
// Roster order is fixed alphabetical rather than shuffled per repeat. Shuffling would fold
// list-position noise into the floor and make it larger than the thing being measured; a
// fixed order means the floor reports the judge's own instability against one presentation.
//
// ---------------------------------------------------------------------------
// Judge isolation
// ---------------------------------------------------------------------------
//
// The judge subprocess runs with --safe-mode, an explicit --system-prompt, and no tools.
// Without that it inherits this machine's global CLAUDE.md, project memory, installed
// plugins and skills, and answers as whatever persona those configure — a probe run without
// the flag came back in the voice of an installed plugin instead of answering the question.
// A judge contaminated by local configuration is measuring the configuration.
//
// Usage:
//   node evals/trigger-eval.mjs [options]
//     --plugin <dir>      plugin root to read descriptions from   (default: plugin)
//     --cases <file>      authored case file                      (default: evals/trigger-cases.json)
//     --repeats <n>       identical runs, for the noise floor     (default: 5)
//     --model <alias>     judge model                             (default: sonnet)
//     --concurrency <n>   judge calls in flight                   (default: 4)
//     --out <file.json>   write the full result envelope
//     --dry-run           print one built judge prompt and exit; makes no model calls
//
// Importing this file runs nothing. tests/evals/trigger-eval.test.mjs drives the scoring
// and aggregation against fixtures, with no live model calls, which is why that test sits
// in the fast tier (D17).

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Defaults. These are run-shape knobs exposed on the command line, not constants inside a
// heuristic: nothing in the scoring below reads any of them.
// ---------------------------------------------------------------------------

/** Smallest repeat count that yields both a min-max range and a usable spread per skill. */
export const DEFAULT_REPEATS = 5;
/** Judge calls in flight. Matches the founder's habitual four; raise it if the run is slow. */
export const DEFAULT_CONCURRENCY = 4;
/** Judge model alias. Recorded in the envelope so a later run can be compared honestly. */
export const DEFAULT_MODEL = 'sonnet';
/** Per-call wall clock ceiling. A hung judge call becomes an unparseable verdict, not a hang. */
export const JUDGE_TIMEOUT_MS = 180_000;

/** The literal a case uses, and the judge answers, to mean "no skill should fire". */
export const NONE = 'NONE';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

/**
 * Read `name`, `description` and `disable-model-invocation` out of a SKILL.md frontmatter
 * block.
 *
 * Deliberately not shared with evals/grade-plugin.mjs. That file's parser is bound to the
 * grader's contract — it returns zero fields when the block does not parse, so no check can
 * report a fact the runtime never sees — and this slice may not edit grade-plugin.mjs to
 * export it. Three fields off a well-formed block is a smaller job than that parser does,
 * and `loadRoster` fails loudly rather than silently if a block ever stops parsing.
 */
export function readSkillFields(text) {
  const fields = {};
  if (typeof text !== 'string') return fields;
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return fields;
  for (const line of m[1].split(/\r?\n/)) {
    if (line.trim() === '' || line.startsWith('#') || /^\s/.test(line)) continue;
    const km = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!km) continue;
    const [, key, rawValue] = km;
    let value = (rawValue ?? '').trim();
    if ((value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
      const inner = value.slice(1, -1);
      value = value[0] === '"'
        ? inner.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
        : inner.replace(/''/g, "'");
    }
    fields[key] = value;
  }
  return fields;
}

/**
 * The set of skills the runtime may invoke on description alone, read from the shipped tree.
 *
 * Returns `{ candidates, lanes }`, both sorted by name. `candidates` is the roster the judge
 * is shown; `lanes` is reported alongside so the write-up can state the split it measured
 * rather than the split a doc claims.
 */
export function loadRoster(pluginRoot) {
  const skillsDir = path.join(pluginRoot, 'skills');
  if (!existsSync(skillsDir)) throw new Error(`no skills directory under ${pluginRoot}`);
  const candidates = [];
  const lanes = [];
  for (const entry of readdirSync(skillsDir).sort()) {
    const file = path.join(skillsDir, entry, 'SKILL.md');
    if (!existsSync(file) || !statSync(path.join(skillsDir, entry)).isDirectory()) continue;
    const fields = readSkillFields(readFileSync(file, 'utf8'));
    const name = fields.name || entry;
    const description = fields.description || '';
    if (!description) throw new Error(`${file}: no description field parsed; the roster would be wrong`);
    if (fields['disable-model-invocation'] === 'true') lanes.push({ name, description });
    else candidates.push({ name, description });
  }
  candidates.sort((a, b) => a.name.localeCompare(b.name));
  lanes.sort((a, b) => a.name.localeCompare(b.name));
  return { candidates, lanes };
}

// ---------------------------------------------------------------------------
// The judge prompt
// ---------------------------------------------------------------------------

export const JUDGE_SYSTEM_PROMPT = [
  'You are the skill-selection step of an agentic coding assistant.',
  'You are shown a roster of available skills and one message a user has just sent.',
  'You decide which single skill, if any, the assistant should invoke.',
  'You answer with one line and nothing else: the skill name exactly as written, or NONE.',
].join(' ');

/**
 * Build the message handed to the judge for one case.
 *
 * Takes the prompt text, never the case object, so there is no path by which the expected
 * answer, the case kind, or the authoring rationale can reach the judge.
 */
export function buildJudgePrompt(roster, promptText) {
  const lines = [];
  lines.push('Here is the roster of skills available for automatic invocation. Each is shown');
  lines.push('with the exact description its author wrote.');
  lines.push('');
  lines.push('<roster>');
  for (const skill of roster) {
    lines.push(`- ${skill.name}: ${skill.description}`);
  }
  lines.push('</roster>');
  lines.push('');
  lines.push('A user has just sent this message.');
  lines.push('');
  lines.push('<user_message>');
  lines.push(promptText);
  lines.push('</user_message>');
  lines.push('');
  lines.push('Which single skill from the roster, if any, would you invoke to handle this message?');
  lines.push('Judge only on whether a description covers the message. If none of them does, the');
  lines.push('assistant should handle the message itself, and the answer is NONE.');
  lines.push('');
  lines.push('Reply with exactly one line: the skill name, or NONE. No explanation.');
  return lines.join('\n');
}

/**
 * Turn raw judge output into a verdict.
 *
 * Returns a roster skill name, the NONE literal, or `null` when the output cannot be read as
 * either. A null verdict is counted and reported rather than quietly folded into NONE: a
 * judge that failed to answer is not a judge that declined to fire.
 */
export function parseVerdict(raw, rosterNames) {
  if (typeof raw !== 'string') return null;
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length === 0) return null;
  const token = lines[lines.length - 1]
    .replace(/[`*"']/g, '')
    .replace(/[.,;:!]+$/, '')
    .trim();
  if (token.toLowerCase() === 'none') return NONE;
  const hit = rosterNames.find((n) => n.toLowerCase() === token.toLowerCase());
  return hit ?? null;
}

// ---------------------------------------------------------------------------
// Scoring — pure, and the part the tests cover
// ---------------------------------------------------------------------------

function round(n) {
  return Number.isFinite(n) ? Number(n.toFixed(4)) : 0;
}

/**
 * Score one pass over the case set.
 *
 * `verdicts` is aligned to `cases` by index; each entry is a skill name, the NONE literal, or
 * null for an unreadable answer.
 *
 * Per skill it reports both directions, because one number cannot say which description is
 * competing with which:
 *   - `recall`   — of the cases that should have selected this skill, how many did.
 *   - `falseFires` — cases that selected this skill and should not have, whatever they should
 *                    have selected instead. Reported as a raw count as well as a rate over
 *                    the cases where firing was wrong, since the two denominators differ per
 *                    skill and a rate alone hides how many prompts are actually at stake.
 *   - `precision` — of every case that selected this skill, how many were right to.
 *
 * `wrongFirings` is the by-name list P6.5 works from: each entry names the skill that fired,
 * the case it fired on, and what should have happened instead.
 */
export function scoreRun(cases, verdicts) {
  if (cases.length !== verdicts.length) {
    throw new Error(`scoreRun: ${cases.length} cases but ${verdicts.length} verdicts`);
  }
  const skills = new Set();
  for (const c of cases) if (c.expect !== NONE) skills.add(c.expect);
  for (const v of verdicts) if (v && v !== NONE) skills.add(v);

  const perSkill = {};
  for (const name of [...skills].sort()) {
    perSkill[name] = {
      shouldFire: 0, caught: 0, recall: 0,
      shouldNotFire: 0, falseFires: 0, falseFireRate: 0,
      picked: 0, correctPicks: 0, precision: 0,
    };
  }

  const wrongFirings = [];
  const misses = [];
  const unparseable = [];
  let correct = 0;
  let noneTotal = 0;
  let noneCorrect = 0;

  cases.forEach((c, i) => {
    const fired = verdicts[i];
    const expected = c.expect;
    const right = fired === expected;
    if (right) correct += 1;
    if (fired === null || fired === undefined) unparseable.push(c.id);

    if (expected === NONE) {
      noneTotal += 1;
      if (right) noneCorrect += 1;
    }

    for (const name of Object.keys(perSkill)) {
      if (expected === name) {
        perSkill[name].shouldFire += 1;
        if (fired === name) perSkill[name].caught += 1;
      } else {
        perSkill[name].shouldNotFire += 1;
        if (fired === name) perSkill[name].falseFires += 1;
      }
      if (fired === name) {
        perSkill[name].picked += 1;
        if (expected === name) perSkill[name].correctPicks += 1;
      }
    }

    if (!right) {
      const record = {
        id: c.id, kind: c.kind, prompt: c.prompt, expected, fired: fired ?? '(unreadable)',
      };
      if (fired && fired !== NONE) wrongFirings.push(record);
      if (expected !== NONE) misses.push(record);
    }
  });

  for (const s of Object.values(perSkill)) {
    s.recall = s.shouldFire ? round(s.caught / s.shouldFire) : 0;
    s.falseFireRate = s.shouldNotFire ? round(s.falseFires / s.shouldNotFire) : 0;
    s.precision = s.picked ? round(s.correctPicks / s.picked) : 0;
  }

  return {
    overall: { total: cases.length, correct, accuracy: cases.length ? round(correct / cases.length) : 0 },
    none: { total: noneTotal, correct: noneCorrect, accuracy: noneTotal ? round(noneCorrect / noneTotal) : 0 },
    perSkill,
    wrongFirings,
    misses,
    unparseable,
  };
}

function spread(values) {
  if (values.length === 0) return { min: 0, max: 0, spread: 0, mean: 0, stdev: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { min: round(min), max: round(max), spread: round(max - min), mean: round(mean), stdev: round(Math.sqrt(variance)) };
}

/**
 * Fold several identical passes into the noise floor.
 *
 * The floor is three numbers, and all three are reported before any score is read:
 *   - the min-max spread of overall accuracy across repeats;
 *   - the same spread per skill, on recall and on false fires, because a floor that is small
 *     overall can still be wide on one description;
 *   - the share of cases whose verdict was not unanimous across repeats, with those cases
 *     listed. That list is the "diff the entries that flipped" half of L-10; a set that is
 *     stable in aggregate while half its cases re-roll is not stable.
 */
export function aggregateRuns(cases, verdictSets) {
  if (verdictSets.length === 0) throw new Error('aggregateRuns: no runs');
  const perRun = verdictSets.map((v) => scoreRun(cases, v));

  const skillNames = [...new Set(perRun.flatMap((r) => Object.keys(r.perSkill)))].sort();
  const perSkill = {};
  for (const name of skillNames) {
    const recalls = perRun.map((r) => r.perSkill[name]?.recall ?? 0);
    const falseFires = perRun.map((r) => r.perSkill[name]?.falseFires ?? 0);
    const precisions = perRun.map((r) => r.perSkill[name]?.precision ?? 0);
    perSkill[name] = {
      shouldFire: perRun[0].perSkill[name]?.shouldFire ?? 0,
      recalls,
      recall: spread(recalls),
      falseFireCounts: falseFires,
      falseFire: spread(falseFires),
      precisions,
      precision: spread(precisions),
    };
  }

  const flipped = [];
  cases.forEach((c, i) => {
    const seen = verdictSets.map((v) => v[i] ?? '(unreadable)');
    if (new Set(seen).size > 1) flipped.push({ id: c.id, expect: c.expect, verdicts: seen });
  });

  // Union of failures across every repeat, with how many repeats each survived. Both
  // directions are kept: a skill firing where it should not, and a skill staying quiet where
  // it was owed the case. Only the first is a wrong firing, but P6.5 has to fix both, and a
  // report showing only firings would hide every description that is merely too narrow.
  const union = (pick) => {
    const byKey = new Map();
    perRun.forEach((r, runIndex) => {
      for (const w of pick(r)) {
        const key = `${w.fired}|${w.expected}|${w.id}`;
        if (!byKey.has(key)) byKey.set(key, { ...w, runs: [], count: 0 });
        const rec = byKey.get(key);
        rec.runs.push(runIndex);
        rec.count += 1;
      }
    });
    return [...byKey.values()].sort(
      (a, b) => b.count - a.count || String(a.fired).localeCompare(String(b.fired)) || a.id.localeCompare(b.id),
    );
  };
  const wrongFirings = union((r) => r.wrongFirings);
  const misses = union((r) => r.misses);

  return {
    repeats: verdictSets.length,
    perRun,
    overall: { accuracies: perRun.map((r) => r.overall.accuracy), ...spread(perRun.map((r) => r.overall.accuracy)) },
    noneAccuracy: { values: perRun.map((r) => r.none.accuracy), ...spread(perRun.map((r) => r.none.accuracy)) },
    perSkill,
    stability: {
      cases: cases.length,
      unanimous: cases.length - flipped.length,
      flipped: flipped.length,
      flipRate: cases.length ? round(flipped.length / cases.length) : 0,
      flippedCases: flipped,
    },
    wrongFirings,
    misses,
  };
}

// ---------------------------------------------------------------------------
// Case-file validation. A case set that names a skill the tree does not ship, or that
// duplicates an id, produces a number about nothing.
// ---------------------------------------------------------------------------

export const CASE_KINDS = new Set(['positive', 'near-miss', 'control-none']);

export function validateCases(caseFile, roster) {
  const problems = [];
  const names = new Set(roster.map((s) => s.name));
  const seen = new Set();
  const cases = caseFile?.cases;
  if (!Array.isArray(cases) || cases.length === 0) return ['case file has no "cases" array'];
  for (const c of cases) {
    if (!c.id) { problems.push(`a case has no id: ${JSON.stringify(c).slice(0, 80)}`); continue; }
    if (seen.has(c.id)) problems.push(`${c.id}: duplicate id`);
    seen.add(c.id);
    if (typeof c.prompt !== 'string' || c.prompt.trim() === '') problems.push(`${c.id}: empty prompt`);
    if (typeof c.why !== 'string' || c.why.trim() === '') problems.push(`${c.id}: no authoring rationale`);
    if (!CASE_KINDS.has(c.kind)) problems.push(`${c.id}: unknown kind ${JSON.stringify(c.kind)}`);
    if (c.expect !== NONE && !names.has(c.expect)) problems.push(`${c.id}: expects ${JSON.stringify(c.expect)}, which the roster does not contain`);
    if (c.kind === 'near-miss') {
      // `competes` names where a wrong answer would plausibly go: a neighbouring skill, or the
      // NONE literal when the risk is that the right skill goes quiet instead. A near miss
      // that names nothing is a positive wearing a label, and the field is what makes the
      // coverage claim below checkable rather than asserted in prose.
      if (!Array.isArray(c.competes) || c.competes.length === 0) {
        problems.push(`${c.id}: a near miss must name where a wrong answer would go — a neighbouring skill, or ${NONE}`);
      } else {
        for (const n of c.competes) {
          if (n !== NONE && !names.has(n)) problems.push(`${c.id}: competes with ${JSON.stringify(n)}, which the roster does not contain`);
          if (n === c.expect) problems.push(`${c.id}: names its own expected answer as the competitor`);
        }
      }
    }
  }
  for (const name of names) {
    const positives = cases.filter((c) => c.expect === name).length;
    if (positives < 2) problems.push(`${name}: only ${positives} case(s) expect it to fire; a recall number off fewer than two cases says nothing`);
  }
  const nearMisses = cases.filter((c) => c.kind === 'near-miss');
  if (nearMisses.length < cases.length / 3) {
    problems.push(`only ${nearMisses.length} of ${cases.length} cases are near misses; a set of obvious positives scores high and means nothing`);
  }
  // Every candidate must be put under competitive pressure somewhere: either it has to win a
  // near miss, or a near miss has to tempt it and be refused.
  const exercised = new Set();
  for (const c of nearMisses) {
    if (c.expect !== NONE) exercised.add(c.expect);
    for (const n of c.competes ?? []) if (n !== NONE) exercised.add(n);
  }
  for (const name of names) {
    if (!exercised.has(name)) problems.push(`${name}: no near-miss case either expects it or tempts it, so nothing tests it under competition`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The judge subprocess
// ---------------------------------------------------------------------------

function runJudge(promptText, { model, cwd }) {
  return new Promise((resolve) => {
    const args = [
      '-p',
      '--safe-mode',
      '--no-session-persistence',
      '--strict-mcp-config',
      '--tools', '',
      '--model', model,
      '--system-prompt', JUDGE_SYSTEM_PROMPT,
    ];
    const child = spawn(process.env.AEO_JUDGE_BIN || 'claude', args, { cwd });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); }, JUDGE_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, text: '', error: err.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? { ok: true, text: stdout } : { ok: false, text: stdout, error: stderr.trim().slice(0, 300) || `exit ${code}` });
    });
    child.stdin.end(promptText);
  });
}

async function pooled(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function formatReport(envelope) {
  const { roster, aggregate: agg, model, repeats } = envelope;
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  const out = [];
  out.push(`Trigger eval — ${roster.length} description-triggered skills, ${agg.stability.cases} cases, ${repeats} repeats, judge ${model}`);
  out.push('');
  out.push('NOISE FLOOR (read this before any score)');
  out.push(`  overall accuracy across repeats: ${agg.overall.accuracies.map(pct).join(', ')}`);
  out.push(`  spread ${pct(agg.overall.spread)} (min ${pct(agg.overall.min)}, max ${pct(agg.overall.max)}, stdev ${pct(agg.overall.stdev)})`);
  out.push(`  cases whose verdict re-rolled: ${agg.stability.flipped}/${agg.stability.cases} (${pct(agg.stability.flipRate)})`);
  out.push('');
  out.push('PER SKILL');
  const pad = Math.max(...Object.keys(agg.perSkill).map((n) => n.length), 5);
  out.push(`  ${'skill'.padEnd(pad)}  n  recall (spread)        false fires (spread)`);
  for (const [name, s] of Object.entries(agg.perSkill)) {
    out.push(`  ${name.padEnd(pad)}  ${String(s.shouldFire).padStart(1)}  ${pct(s.recall.mean).padStart(6)} (±${pct(s.recall.spread).padStart(6)})   ${s.falseFire.mean.toFixed(1).padStart(4)} (±${s.falseFire.spread.toFixed(1)})`);
  }
  out.push('');
  out.push('FIRED WHERE IT SHOULD NOT — the P6.5 work order, first half');
  if (agg.wrongFirings.length === 0) out.push('  none');
  for (const w of agg.wrongFirings) {
    out.push(`  ${w.fired} on ${w.id} (${w.count}/${repeats} repeats) — should have been ${w.expected}`);
    out.push(`      "${w.prompt}"`);
  }
  out.push('');
  out.push('DID NOT FIRE WHERE IT SHOULD — the second half');
  if (agg.misses.length === 0) out.push('  none');
  for (const m of agg.misses) {
    out.push(`  ${m.expected} missed ${m.id} (${m.count}/${repeats} repeats), ${m.fired} took it instead`);
    out.push(`      "${m.prompt}"`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    plugin: 'plugin',
    cases: path.join('evals', 'trigger-cases.json'),
    repeats: DEFAULT_REPEATS,
    model: DEFAULT_MODEL,
    concurrency: DEFAULT_CONCURRENCY,
    out: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--plugin') opts.plugin = argv[++i];
    else if (a === '--cases') opts.cases = argv[++i];
    else if (a === '--repeats') opts.repeats = Number(argv[++i]);
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--concurrency') opts.concurrency = Number(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pluginRoot = path.resolve(opts.plugin);
  const { candidates, lanes } = loadRoster(pluginRoot);
  const caseFile = JSON.parse(readFileSync(path.resolve(opts.cases), 'utf8'));
  const problems = validateCases(caseFile, candidates);
  if (problems.length > 0) {
    console.error('case file rejected:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  const cases = caseFile.cases;
  const rosterNames = candidates.map((s) => s.name);

  if (opts.dryRun) {
    console.log(`roster (${candidates.length}): ${rosterNames.join(', ')}`);
    console.log(`operator lanes, excluded (${lanes.length}): ${lanes.map((s) => s.name).join(', ')}`);
    console.log(`cases: ${cases.length}`);
    console.log('');
    console.log('--- one built judge prompt ---');
    console.log(buildJudgePrompt(candidates, cases[0].prompt));
    return;
  }

  // A neutral cwd so the judge cannot pick up this repo's CLAUDE.md even if --safe-mode
  // ever stops covering it.
  const cwd = os.tmpdir();
  const verdictSets = [];
  const rawSets = [];
  const startedAt = new Date().toISOString();
  for (let r = 0; r < opts.repeats; r += 1) {
    const results = await pooled(cases, opts.concurrency, async (c) => {
      const res = await runJudge(buildJudgePrompt(candidates, c.prompt), { model: opts.model, cwd });
      return { raw: res.text, error: res.ok ? null : res.error };
    });
    verdictSets.push(results.map((r2) => parseVerdict(r2.raw, rosterNames)));
    rawSets.push(results);
    process.stderr.write(`repeat ${r + 1}/${opts.repeats} done\n`);
  }

  const aggregate = aggregateRuns(cases, verdictSets);
  const envelope = {
    tool: 'evals/trigger-eval.mjs',
    plugin_root: pluginRoot,
    case_file: path.resolve(opts.cases),
    model: opts.model,
    // The CLI exposes no temperature or seed control, so none was set. That absence is the
    // reason the noise floor above exists and is reported first.
    sampling: 'claude -p defaults; no temperature or seed control is exposed',
    judge_flags: ['--safe-mode', '--no-session-persistence', '--strict-mcp-config', '--tools ""', '--system-prompt'],
    repeats: opts.repeats,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    roster: candidates,
    operator_lanes: lanes.map((s) => s.name),
    cases,
    verdicts: verdictSets,
    raw: rawSets,
    aggregate,
  };
  if (opts.out) writeFileSync(path.resolve(opts.out), JSON.stringify(envelope, null, 2), 'utf8');
  console.log(formatReport(envelope));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.stack || String(err));
    process.exitCode = 1;
  });
}
