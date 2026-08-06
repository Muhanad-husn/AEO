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
// gh is called nowhere else in the plugin (lib.mjs's git() is git-only). Two rules
// govern every call here: never report a gh failure as a confident zero -- the same
// negative-signal discipline L-08 states for a monitor reporting IDLE applies to "gh
// could not tell me" versus "gh told me there are none" -- and never let gh flood
// stdout into the session's context (L-09).

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { currentBranch, git, preflight, resolveWorktree, runReporter } from './lib.mjs';
import { LIVE_DATA_ROOT_ENV, resolveRoots } from './sandbox-guard.mjs';

const execFileAsync = promisify(execFile);

// The command actually spawned for every gh call, and the args prepended ahead of the
// real gh arguments. Both default to plain `gh` with nothing prepended -- production
// behaviour is unchanged when neither is set. The seam exists because in-process
// mocking cannot reach a subprocess CLI child (L-03's pattern, applied here to `gh`
// instead of the sandbox guard's data path): tests point AEO_GH_COMMAND at `node` and
// AEO_GH_PREFIX_ARGS at a fixture script, which is the only way to substitute a fake
// `gh` that also runs correctly on Windows, where a `.cmd` shim is not directly
// executable without a shell.
const GH_COMMAND = process.env.AEO_GH_COMMAND || 'gh';
// KNOWN GAP, left open deliberately: this JSON.parse runs at module scope, before
// runReporter is entered, so a malformed AEO_GH_PREFIX_ARGS throws where nothing catches
// it and Node exits 1 -- narrowing this file's header claim that the reporter always
// exits 0. Exit 1 is a non-blocking hook error, so it costs a report and never a
// session, and lib.mjs already names module-scope crashes as a class its guarantees do
// not reach. The variable is a test seam that production never sets.
const GH_PREFIX_ARGS = process.env.AEO_GH_PREFIX_ARGS ? JSON.parse(process.env.AEO_GH_PREFIX_ARGS) : [];

// Three gh calls run concurrently (Promise.all below), so this is the worst-case added
// latency at session start, not three times it. The override exists purely as a test
// seam, not a supported setting -- a config nobody sets is exactly what D10 and L-08
// warn against, so this is not exposed anywhere a user would find it.
const GH_TIMEOUT_MS = Number(process.env.AEO_GH_TIMEOUT_MS) || 3000;
// gh has no reason to emit more than this for the queries below. Anything past it is
// truncated before it is even attempted to parse (L-09, "a CLI flooding stdout floods
// an agent's context").
const GH_MAX_BUFFER = 200_000;
const RUN_LOG_HEAD_LINES = 8;

// How many items each section asks gh for. The request sends one MORE than the number
// rendered, which is the whole point: a list cut off at its cap is indistinguishable
// from a list that happened to end there, and `Open issues (40)` in the one hook whose
// job is to be believed over memory reads as "there are forty" (L-08 -- every cap that
// drops input reports a count on both sides of the cut).
// The merged-PR cap below stays a plain 10: that section is labelled "Last N merged",
// which claims recency and never a total, so there is nothing there to misread.
const ISSUE_LIMIT = 40;
const OPEN_PR_LIMIT = 20;

/**
 * One gh call, JSON out. Never throws.
 *
 * `ok: false` means "could not determine" -- missing binary, no auth, no remote, a
 * timeout, or output this cannot use -- and every caller renders that as unknown, never
 * as a confident zero. `ok: true, data: []` means gh answered with a list and the list
 * was empty; that is the only path that is allowed to say "none".
 *
 * Two shapes reach here as output rather than as an error, and both are "could not
 * determine" rather than zero. `gh ... --json` always emits at least `[]`, so silence on
 * a zero exit is not an empty answer, it is no answer. And a JSON object -- the shape
 * `{"message":"Not Found"}` arrives in -- parses fine and is still not a list; any gh on
 * PATH can produce it (a version change, an extension, a wrapper shim), and rendering it
 * as an empty array would state there are no open issues on the strength of an error
 * message.
 */
async function ghJson(dir, args) {
  try {
    const { stdout } = await execFileAsync(GH_COMMAND, [...GH_PREFIX_ARGS, ...args], {
      cwd: dir || undefined,
      timeout: GH_TIMEOUT_MS,
      maxBuffer: GH_MAX_BUFFER,
      windowsHide: true,
      encoding: 'utf8',
    });
    const text = stdout ?? '';
    if (!text.trim()) return { ok: false, reason: 'gh exited 0 but printed nothing, where --json always prints at least []' };
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return { ok: false, reason: `gh returned unparseable output (${err.message})` };
    }
    if (!Array.isArray(data)) {
      return { ok: false, reason: `gh returned a JSON ${data === null ? 'null' : typeof data} where a list was expected` };
    }
    return { ok: true, data };
  } catch (err) {
    if (err?.code === 'ENOENT') return { ok: false, reason: 'gh is not installed or not on PATH' };
    if (err?.killed || err?.signal) return { ok: false, reason: `gh did not answer within ${GH_TIMEOUT_MS}ms` };
    const detail = String(err?.stderr || err?.message || 'unknown error')
      .trim()
      .split(/\r?\n/)[0];
    return { ok: false, reason: (detail || `gh exited with an error`).slice(0, 200) };
  }
}

/**
 * One gh-backed list section. Unknown, empty and populated are three distinct outputs;
 * none collapses into another.
 *
 * `limit` is how many items get rendered, and the caller has already asked gh for
 * `limit + 1`. Getting that extra one back is the proof the list was cut, and it is the
 * only way this hook can tell a repo with exactly `limit` open issues from a repo with
 * hundreds. When it is cut, the header says so instead of printing the cap as a total.
 */
function renderSection(label, result, limit, formatItem) {
  if (!result.ok) return [`**${label}:** unknown (${result.reason}).`, ''];
  if (result.data.length === 0) return [`**${label}:** none.`, ''];
  const shown = result.data.slice(0, limit);
  const truncated = result.data.length > limit;
  const header = truncated
    ? `**${label} (showing ${shown.length} of more than ${limit}):**`
    : `**${label} (${shown.length}):**`;
  return [header, ...shown.map(formatItem), ''];
}

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
 */
function renderDataRoot() {
  const { live } = resolveRoots({ command: '', env: process.env });

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

async function run(payload) {
  const lines = [];

  // Gate health first (D8), so a broken runtime is the first thing read rather than
  // buried under repo state that may itself be stale if the gates are open.
  const health = preflight();
  if (!health.ok) lines.push(health.banner, '');

  // Then the sandbox guard's one precondition (D18). Both of these are facts about
  // whether enforcement is running at all, so they belong above repo state and ahead of
  // the not-a-worktree return below: an undeclared production root is worth saying even
  // in a session that has no git repository to report on.
  lines.push(...renderDataRoot());

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
  // extra item only to know the list was cut.
  const [issues, openPrs, mergedPrs] = await Promise.all([
    ghJson(root, ['issue', 'list', '--state', 'open', '--limit', String(ISSUE_LIMIT + 1), '--json', 'number,title,labels']),
    ghJson(root, ['pr', 'list', '--state', 'open', '--limit', String(OPEN_PR_LIMIT + 1), '--json', 'number,title,isDraft']),
    ghJson(root, ['pr', 'list', '--state', 'merged', '--limit', '10', '--json', 'number,title,mergedAt']),
  ]);

  lines.push(
    ...renderSection('Open issues', issues, ISSUE_LIMIT, (i) => {
      const labels = (i.labels ?? []).map((l) => l.name).join(', ');
      return `- #${i.number} ${i.title}${labels ? `  [${labels}]` : ''}`;
    }),
  );

  lines.push(
    ...renderSection(
      'Open PRs -- awaiting founder approval',
      openPrs,
      OPEN_PR_LIMIT,
      (p) => `- #${p.number} ${p.title}${p.isDraft ? ' (draft)' : ''}`,
    ),
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
