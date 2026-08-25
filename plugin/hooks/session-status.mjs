// SessionStart reporter. Injects the repo's live ground truth into context before the
// first prompt: branch, HEAD, open issues, open and merged PRs, gate health, and the
// newest run log.
//
// This hook never blocks. That is structural, not a promise: it is built on
// runReporter (lib.mjs), which owns every exit and always returns 0; there is no
// process.exit anywhere below and no path into runGate.
//
// Why this exists (L-08): a status answer once repeated a five-day-old memory and a
// never-ticked plan checkbox about work that had already shipped. Hooks cannot inspect
// prose, so nothing can block a stale claim directly -- this instead front-loads ground
// truth, read from git and GitHub just now, so recall is never the cheap path. The
// header below says so explicitly and labels memory files and plan checkboxes as
// neither ground truth, carrying the PowerShell original's rationale across.
//
// gh is called nowhere else in the plugin outside status-render.mjs (lib.mjs's git() is
// git-only). Two rules govern every gh call: never report a gh failure as a confident
// zero -- the same negative-signal discipline L-08 states for a monitor reporting IDLE
// applies to "gh could not tell me" versus "gh told me there are none" -- and never let
// gh flood stdout into the session's context (L-09).
//
// ghJson, renderSection, and the issue/PR fetch helpers live in status-render.mjs now,
// shared with the `status` skill's own script (issue #81, "one renderer, two callers").
// AEO_GH_COMMAND / AEO_GH_PREFIX_ARGS / AEO_GH_TIMEOUT_MS are read there; nothing in
// this file sets them directly any more, but this hook's own tests still set the same
// env vars to reach the fake `gh` the shared module spawns.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { currentBranch, git, preflight, resolveWorktree, runReporter } from './lib.mjs';
import { LIVE_DATA_ROOT_ENV, resolveRoots, settingsDeclarationDir } from './sandbox-guard.mjs';
import { ISSUE_LIMIT, OPEN_PR_LIMIT, fetchOpenIssues, fetchOpenPrs, formatPrLine, ghJson, renderSection } from './status-render.mjs';

const RUN_LOG_HEAD_LINES = 8;

// A run log directory is named `<YYYY-MM-DD>-<job>`. That date is the primary ordering
// key because mtime alone cannot order these at all: two summaries written in the same
// millisecond carry the same mtime, and the tie then falls to readdir order, which is
// the filesystem's business and not a fact about the runs.
const RUN_LOG_DATE = /^(\d{4}-\d{2}-\d{2})\b/;

/**
 * Newest first. Four keys, each doing work the one before it could not:
 *
 * 1. Dated directories outrank undated ones. `<date>-<job>` is the convention this
 *    hook reports on; a directory that does not follow it is not a run log by name.
 * 2. Date descending. This is what makes the answer deterministic, and it is what a
 *    reader means by "newest run log": the run's own date, not when the file was last
 *    touched. Re-editing an old summary does not make it the current one.
 * 3. mtime descending. Real signal within one date, and the only signal at all for
 *    undated directories.
 * 4. Name descending. Directory names are unique, so this always decides, which is
 *    the property the old comparison lacked.
 */
function compareRunLogs(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1; // '' sorts last, so undated ranks below dated
  if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
  return a.name < b.name ? 1 : a.name > b.name ? -1 : 0;
}

/**
 * The newest `logs/<job>/summary.md` under the repo root, and its first few non-blank
 * lines.
 *
 * Reporting a stale log as the current one is the exact failure this hook exists to
 * prevent (L-08), so "newest" here is a total order rather than a comparison that can
 * tie.
 */
function findNewestRunLog(root) {
  const logsDir = path.join(root, 'logs');
  if (!existsSync(logsDir)) return null;

  let entries;
  try {
    entries = readdirSync(logsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const summaryPath = path.join(logsDir, entry.name, 'summary.md');
    if (!existsSync(summaryPath)) continue;
    let mtimeMs;
    try {
      mtimeMs = statSync(summaryPath).mtimeMs;
    } catch {
      continue;
    }
    candidates.push({
      name: entry.name,
      date: RUN_LOG_DATE.exec(entry.name)?.[1] ?? '',
      mtimeMs,
      summaryPath,
    });
  }
  if (candidates.length === 0) return null;
  const newest = candidates.sort(compareRunLogs)[0];

  // `omitted` exists for the same reason the list sections report both sides of their
  // cap: an excerpt with no marker reads as the whole summary, and the ninth line of a
  // run log is exactly where "3 acceptance tests still failing" lives.
  let head = [];
  let omitted = 0;
  try {
    const lines = readFileSync(newest.summaryPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '');
    head = lines.slice(0, RUN_LOG_HEAD_LINES);
    omitted = lines.length - head.length;
  } catch {
    head = [];
    omitted = 0;
  }
  return { rel: path.relative(root, newest.summaryPath).replace(/\\/g, '/'), head, omitted };
}

/**
 * Whether this session has declared where production data is (D18).
 *
 * The sandbox guard compares an effective data root against a declared one, so with
 * AEO_LIVE_DATA_ROOT unset it has nothing to compare and does nothing at all. Unset
 * stays permitted: a project with no production data has nothing to protect, and
 * demanding a declaration before anything may run is a config option nobody sets that
 * then blocks everything. What it must not be is invisible. The guard exists because a
 * run resolved its data path through a default and 19,000 documents went with it, and a
 * guard that is one unset variable away from silence should say so out loud.
 *
 * Three states, none collapsing into another, and none of the three reading as an
 * all-clear -- L-08's rule that an unconfigured threshold is a loud skip, never a quiet
 * pass. A declared root is reported as declared, not as safe; where it points is the
 * declaration's business and this hook does not vouch for it.
 *
 * Reads the declaration the same way the gate itself does (#133): from
 * .claude/settings.json first, via settingsDeclarationDir -- the one place that
 * directory-resolution decision is made -- falling back to process.env only when the
 * file has nothing to say. A session start that reports a value the very next Bash call
 * would refuse to honour is worse than reporting nothing.
 */
function renderDataRoot(payload) {
  const { live } = resolveRoots({ command: '', env: process.env, dir: settingsDeclarationDir(payload, process.env) });

  if (!live.set) {
    return [
      `**Production data root: NOT DECLARED.** \`${LIVE_DATA_ROOT_ENV}\` is unset, so the sandbox`,
      'guard has nothing to compare a run against and does nothing for this whole session.',
      'A command pointed at production data would not be refused. That is a gap in cover,',
      'not a clean bill of health; the guard exists because such a run once cost 19,000',
      `documents. If this project touches production data, declare \`${LIVE_DATA_ROOT_ENV}\`.`,
      '',
    ];
  }

  if (live.root === null) {
    return [
      `**Production data root: DECLARED BUT UNUSABLE.** \`${LIVE_DATA_ROOT_ENV}\` is set to`,
      `\`${live.raw}\`, which is not an absolute path. The sandbox guard cannot tell production`,
      'data from a sandbox with it, so it is refusing every command until this is set to an',
      'absolute path or unset.',
      '',
    ];
  }

  return [
    `**Production data root: declared** at \`${live.root}\` (\`${LIVE_DATA_ROOT_ENV}\`). The sandbox`,
    "guard is comparing every run's data root against it. That the declaration exists is",
    'what is being reported here; whether it names the right directory is not something',
    'this hook can check.',
    '',
  ];
}

// The names are read out of the manifest, never listed here. A copy of the gate list in
// this file would be a second source of truth that goes stale the first time a gate is
// added or renamed, and nothing would notice -- which is the same duplication this
// report exists to stop the reader making from memory.
const PLUGIN_SCRIPT = /\$\{CLAUDE_PLUGIN_ROOT\}([^\s"']*\.mjs)/g;

/**
 * The hook scripts this session actually has, grouped by event, from the loaded
 * hooks.json. Never throws; "could not read it" is an answer and is rendered as one.
 */
function readWiredGates(pluginRoot = process.env.CLAUDE_PLUGIN_ROOT) {
  if (!pluginRoot) return { ok: false, reason: 'CLAUDE_PLUGIN_ROOT is unset, so hooks.json cannot be located' };
  const manifest = path.join(pluginRoot, 'hooks', 'hooks.json');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `hooks/hooks.json could not be read (${err.message})` };
  }
  const events = [];
  for (const [event, entries] of Object.entries(parsed?.hooks ?? {})) {
    // Re-serialising is how every string under one event is reached without this having
    // to know the shell form from the exec form, or where in the entry a path may sit.
    const names = new Set([...JSON.stringify(entries).matchAll(PLUGIN_SCRIPT)].map((m) => path.basename(m[1], '.mjs')));
    if (names.size > 0) events.push({ event, names: [...names].sort() });
  }
  if (events.length === 0) return { ok: false, reason: 'hooks/hooks.json registers no hook scripts' };
  return { ok: true, events };
}

/**
 * Which gates are wired, stated positively.
 *
 * A PreToolUse gate that allows a call prints nothing, so an actor asked which gates
 * fired for it reads an ordinary session as "none are wired" -- L-08's negative signal
 * that cannot be told from "not instrumented", in the gate-reporting path. Two of four
 * actors in the Checkpoint 5 run made exactly that call, and both were wrong. Naming the
 * gates at session start turns "I saw nothing" into something checkable.
 */
function renderGates() {
  const wired = readWiredGates();
  if (!wired.ok) {
    return [
      `**Gates wired: unknown.** ${wired.reason}. This report cannot say which gates are`,
      'running; that is a gap in the report and not a finding that none of them are.',
      '',
    ];
  }
  return [
    "**Gates wired for this session,** read just now from the plugin's own `hooks/hooks.json`:",
    ...wired.events.map((e) => `- ${e.event}: ${e.names.join(', ')}`),
    '', // without it the sentence below renders as a continuation of the last bullet
    'A PreToolUse gate prints nothing when it allows a call, so a session with no gate',
    'message is one where these ran and allowed -- not one where none was wired.',
    '',
  ];
}

async function run(payload) {
  const lines = [];

  // Gate health first (D8), so a broken runtime is the first thing read rather than
  // buried under repo state that may itself be stale if the gates are open.
  //
  // The banner replaces the gate list rather than sitting above it. When preflight
  // fails the gates are failing open, and a list of their names under that warning
  // reads as reassurance for enforcement that is not happening.
  const health = preflight();
  if (!health.ok) lines.push(health.banner, '');
  else lines.push(...renderGates());

  // Then the sandbox guard's one precondition (D18). Both of these are facts about
  // whether enforcement is running at all, so they belong above repo state and ahead of
  // the not-a-worktree return below: an undeclared production root is worth saying even
  // in a session that has no git repository to report on.
  lines.push(...renderDataRoot(payload ?? {}));

  // Resolved from the session's own cwd via lib.mjs, never CLAUDE_PROJECT_DIR or this
  // script's own location -- both are session-fixed and wrong for a worktree session,
  // the same bug already fixed twice in commit-gate and block-merge (V-02).
  const { toplevel: root } = resolveWorktree(payload ?? {});
  if (!root) return lines.join('\n'); // not a git worktree; nothing more to report

  lines.push(
    '## Live repo state (fetched at session start)',
    '',
    'Ground truth, read from git and GitHub just now. Memory files and plan',
    'checkboxes are neither -- they lag merged reality and have caused wrong status',
    'answers before. Prefer what follows; verify anything older against it.',
    '',
  );

  // Unconditional. Skipping the line when git names no branch (an unborn HEAD) left the
  // reader unable to tell "unborn" from "not reported", which is the unknown-read-as-
  // zero the gh sections below take such care to avoid.
  const branch = currentBranch(root);
  const head = git(root, 'log', '-1', '--format=%h %s');
  lines.push(`**Branch:** ${branch ?? 'unknown (unborn HEAD, or git did not answer)'}  |  **HEAD:** ${head ?? 'unknown'}`, '');

  // One more than each cap is requested; renderSection renders the cap and uses the
  // extra item only to know the list was cut. Issues and open PRs go through the
  // shared fetch helpers (status-render.mjs) so this hook and the `status` skill read
  // gh the same way; the merged-PR call stays here since only this hook renders it.
  const [issues, openPrs, mergedPrs] = await Promise.all([
    fetchOpenIssues(root),
    fetchOpenPrs(root),
    ghJson(root, ['pr', 'list', '--state', 'merged', '--limit', '10', '--json', 'number,title,mergedAt']),
  ]);

  lines.push(
    ...renderSection('Open issues', issues, ISSUE_LIMIT, (i) => {
      const labels = (i.labels ?? []).map((l) => l.name).join(', ');
      return `- #${i.number} ${i.title}${labels ? `  [${labels}]` : ''}`;
    }),
  );

  // showChecks stays false here: SessionStart has a stated latency budget and the
  // stub this hook has always rendered against never promised check state. The
  // `status` skill (on demand, no such budget) turns it on via the same formatter.
  lines.push(
    ...renderSection('Open PRs -- awaiting founder approval', openPrs, OPEN_PR_LIMIT, (p) => formatPrLine(p, { showChecks: false })),
  );

  // Merged PRs render inline rather than through renderSection: an empty result says
  // nothing at all (there is nothing to warn about "already shipped"), while an
  // unknown result still has to say so -- the one section where "none" and "no signal"
  // both stay silent except that unknown must not.
  if (mergedPrs.ok && mergedPrs.data.length > 0) {
    lines.push(`**Last ${mergedPrs.data.length} merged PRs (already shipped):**`);
    for (const m of mergedPrs.data) {
      const when = typeof m.mergedAt === 'string' && m.mergedAt.length >= 10 ? m.mergedAt.slice(0, 10) : 'unknown date';
      lines.push(`- #${m.number} ${m.title}  _(${when})_`);
    }
    lines.push('');
  } else if (!mergedPrs.ok) {
    lines.push(`**Recently merged PRs:** unknown (${mergedPrs.reason}).`, '');
  }

  const newestLog = findNewestRunLog(root);
  if (newestLog) {
    lines.push(`**Newest run log:** \`${newestLog.rel}\``);
    for (const line of newestLog.head) lines.push(`> ${line}`);
    if (newestLog.omitted > 0) lines.push(`> _(excerpt: ${newestLog.omitted} more line(s) in the summary)_`);
    lines.push('');
  }

  return lines.join('\n');
}

await runReporter({ name: 'session-status', run });
