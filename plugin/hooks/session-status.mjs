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

/**
 * One gh call, JSON out. Never throws.
 *
 * `ok: false` means "could not determine" -- missing binary, no auth, no remote, a
 * timeout, or unparseable output -- and every caller renders that as unknown, never as
 * a confident zero. `ok: true, data: []` means gh answered and the answer was empty;
 * that is the only path that is allowed to say "none".
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
    if (!text.trim()) return { ok: true, data: [] };
    try {
      const data = JSON.parse(text);
      return { ok: true, data: Array.isArray(data) ? data : [] };
    } catch (err) {
      return { ok: false, reason: `gh returned unparseable output (${err.message})` };
    }
  } catch (err) {
    if (err?.code === 'ENOENT') return { ok: false, reason: 'gh is not installed or not on PATH' };
    if (err?.killed || err?.signal) return { ok: false, reason: `gh did not answer within ${GH_TIMEOUT_MS}ms` };
    const detail = String(err?.stderr || err?.message || 'unknown error')
      .trim()
      .split(/\r?\n/)[0];
    return { ok: false, reason: (detail || `gh exited with an error`).slice(0, 200) };
  }
}

/** One gh-backed list section. Unknown, empty and populated are three distinct outputs; none collapses into another. */
function renderSection(label, result, formatItem) {
  if (!result.ok) return [`**${label}:** unknown (${result.reason}).`, ''];
  if (result.data.length === 0) return [`**${label}:** none.`, ''];
  return [`**${label} (${result.data.length}):**`, ...result.data.map(formatItem), ''];
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

  let head = [];
  try {
    head = readFileSync(newest.summaryPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .slice(0, RUN_LOG_HEAD_LINES);
  } catch {
    head = [];
  }
  return { rel: path.relative(root, newest.summaryPath).replace(/\\/g, '/'), head };
}

async function run(payload) {
  const lines = [];

  // Gate health first (D8), so a broken runtime is the first thing read rather than
  // buried under repo state that may itself be stale if the gates are open.
  const health = preflight();
  if (!health.ok) lines.push(health.banner, '');

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

  const branch = currentBranch(root);
  if (branch) {
    const head = git(root, 'log', '-1', '--format=%h %s');
    lines.push(`**Branch:** ${branch}  |  **HEAD:** ${head ?? 'unknown'}`, '');
  }

  const [issues, openPrs, mergedPrs] = await Promise.all([
    ghJson(root, ['issue', 'list', '--state', 'open', '--limit', '40', '--json', 'number,title,labels']),
    ghJson(root, ['pr', 'list', '--state', 'open', '--limit', '20', '--json', 'number,title,isDraft']),
    ghJson(root, ['pr', 'list', '--state', 'merged', '--limit', '10', '--json', 'number,title,mergedAt']),
  ]);

  lines.push(
    ...renderSection('Open issues', issues, (i) => {
      const labels = (i.labels ?? []).map((l) => l.name).join(', ');
      return `- #${i.number} ${i.title}${labels ? `  [${labels}]` : ''}`;
    }),
  );

  lines.push(
    ...renderSection(
      'Open PRs -- awaiting founder approval',
      openPrs,
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
    lines.push('');
  }

  return lines.join('\n');
}

await runReporter({ name: 'session-status', run });
