// The shared status renderer (P6.3).
//
// "One renderer, two callers" (issue #81): session-status.mjs (SessionStart) and the
// `status` skill's script both need to answer "what are the open issues, what are the
// open PRs, and what state are they in" from git and GitHub, read fresh every time.
// Writing that gh-calling and rendering logic twice is exactly the failure D5 exists to
// kill for a hand-maintained tracker -- two answers to one question that will drift.
// So ghJson and renderSection (originally P1.7's, in session-status.mjs) live here now,
// unchanged in contract, plus the fetch/format helpers both callers share.
//
// What differs between the two callers is deliberate, not an oversight:
//   - session-status.mjs renders open issues flat and open PRs without check state,
//     because SessionStart already has a stated budget (GH_TIMEOUT_MS, L-09's "don't
//     flood context") and the stub `status` never bound it to more than that.
//   - the `status` skill triages issues into open/in-flight/blocked and shows PR check
//     state, because issue #81's own "What" section asks for exactly that, and it runs
//     on demand rather than at every session start.
// Both read the SAME gh answer for open PRs (statusCheckRollup rides along in the one
// `gh pr list` call already being made, so showing it costs no extra process) --
// formatPrLine's `showChecks` flag is the only difference, not a second fetch.
//
// D5's hard constraint applies here too: nothing below writes, caches, or hand-
// maintains anything. Every exported function re-reads git, gh, or the Decision Log
// file on every call and returns text -- never a stored value.

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Same seam session-status.mjs's tests already depend on (see that file's header):
// AEO_GH_COMMAND / AEO_GH_PREFIX_ARGS point `gh` at a fixture script for tests, and
// default to the real `gh` in production. Moving here does not change either default.
const GH_COMMAND = process.env.AEO_GH_COMMAND || 'gh';
// KNOWN GAP, carried from P1.7 unchanged: this JSON.parse runs at module scope, so a
// malformed AEO_GH_PREFIX_ARGS throws before anything can catch it. The variable is a
// test seam production never sets; see session-status.mjs's original comment on it.
const GH_PREFIX_ARGS = process.env.AEO_GH_PREFIX_ARGS ? JSON.parse(process.env.AEO_GH_PREFIX_ARGS) : [];
const GH_TIMEOUT_MS = Number(process.env.AEO_GH_TIMEOUT_MS) || 3000;
const GH_MAX_BUFFER = 200_000; // L-09: a CLI flooding stdout floods an agent's context.

// One more than each cap is requested, so a list cut off at its cap is never confused
// with a list that happened to end there (L-08).
export const ISSUE_LIMIT = 40;
export const OPEN_PR_LIMIT = 20;

const ISSUE_FIELDS = 'number,title,labels,assignees,blockedBy,closedByPullRequestsReferences';
const PR_FIELDS = 'number,title,isDraft,statusCheckRollup';

/**
 * One gh call, JSON out. Never throws. Moved verbatim from session-status.mjs (P1.7);
 * see that file's git history for the reasoning behind every branch here.
 *
 * `ok: false` means "could not determine" and every caller renders that as unknown,
 * never as a confident zero. `ok: true, data: []` is the only path allowed to say
 * "none".
 */
export async function ghJson(dir, args) {
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
 * One gh-backed list section. Unknown, empty and populated are three distinct outputs.
 * Moved verbatim from session-status.mjs (P1.7).
 */
export function renderSection(label, result, limit, formatItem) {
  if (!result.ok) return [`**${label}:** unknown (${result.reason}).`, ''];
  if (result.data.length === 0) return [`**${label}:** none.`, ''];
  const shown = result.data.slice(0, limit);
  const truncated = result.data.length > limit;
  const header = truncated
    ? `**${label} (showing ${shown.length} of more than ${limit}):**`
    : `**${label} (${shown.length}):**`;
  return [header, ...shown.map(formatItem), ''];
}

/** Open issues, with the fields both the flat render and the triage render need. */
export async function fetchOpenIssues(root, { limit = ISSUE_LIMIT } = {}) {
  return ghJson(root, ['issue', 'list', '--state', 'open', '--limit', String(limit + 1), '--json', ISSUE_FIELDS]);
}

/** Open PRs, with statusCheckRollup riding along so showing check state costs nothing extra. */
export async function fetchOpenPrs(root, { limit = OPEN_PR_LIMIT } = {}) {
  return ghJson(root, ['pr', 'list', '--state', 'open', '--limit', String(limit + 1), '--json', PR_FIELDS]);
}

/**
 * A check rollup collapsed to one word. GitHub's own rollup semantics: any failure wins
 * over any pending, and only an all-success (or a rollup with nothing in it, which is
 * "no checks" rather than "passing" -- a PR nothing has run against has not passed
 * anything) reads as passing. Handles both shapes gh's `statusCheckRollup` can return --
 * legacy status contexts (`state`) and check runs (`conclusion` + `status`).
 */
export function summarizeChecks(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'no checks';
  const FAILING = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED']);
  const PENDING = new Set(['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'STALE']);
  let hasFailure = false;
  let hasPending = false;
  for (const c of rollup) {
    const state = String(c?.conclusion || c?.state || '').toUpperCase();
    const status = String(c?.status || '').toUpperCase();
    if (FAILING.has(state)) hasFailure = true;
    else if (state === '' || PENDING.has(state) || (status !== '' && status !== 'COMPLETED')) hasPending = true;
  }
  if (hasFailure) return 'failing';
  if (hasPending) return 'pending';
  return 'passing';
}

/** One open-PR line. `showChecks` is the only thing that differs between the two callers. */
export function formatPrLine(p, { showChecks } = {}) {
  const draft = p.isDraft ? ' (draft)' : '';
  const checks = showChecks ? `  [checks: ${summarizeChecks(p.statusCheckRollup)}]` : '';
  return `- #${p.number} ${p.title}${draft}${checks}`;
}

// ---------------------------------------------------------------------------
// Issue triage -- open / in flight / blocked (issue #81's "What" section)
// ---------------------------------------------------------------------------

/**
 * Which of the three buckets an open issue falls in, using only fields GitHub already
 * computes -- no invented convention, no label an issue has to remember to carry.
 *
 * Blocked wins over in-flight: an issue with an open PR against it that is also
 * blocked-by another open issue still cannot land, and saying so once is more useful
 * than saying it is being worked on.
 *
 *   - Blocked: `blockedBy.totalCount > 0` (GitHub's own issue-dependency field).
 *   - In flight: a PR already references it (`closedByPullRequestsReferences`,
 *     GitHub's own "Closes #N" cross-reference -- populated for an open PR too, not
 *     only a merged one) or it carries an assignee.
 *   - Open: neither of the above -- plain backlog.
 */
function triageIssue(issue) {
  const blockedCount = issue?.blockedBy?.totalCount ?? 0;
  if (blockedCount > 0) return 'blocked';
  const hasLinkedPr = Array.isArray(issue?.closedByPullRequestsReferences) && issue.closedByPullRequestsReferences.length > 0;
  const hasAssignee = Array.isArray(issue?.assignees) && issue.assignees.length > 0;
  if (hasLinkedPr || hasAssignee) return 'in flight';
  return 'open';
}

function formatIssueLine(issue) {
  const labels = (issue.labels ?? []).map((l) => l.name).join(', ');
  return `- #${issue.number} ${issue.title}${labels ? `  [${labels}]` : ''}`;
}

function formatBlockedIssueLine(issue) {
  const by = (issue?.blockedBy?.nodes ?? [])
    .map((n) => (n?.number ? `#${n.number}` : null))
    .filter(Boolean)
    .join(', ');
  return `${formatIssueLine(issue)}${by ? `  (blocked by ${by})` : ''}`;
}

/**
 * Open issues, triaged into open / in flight / blocked. Same unknown-vs-empty-vs-
 * populated discipline as `renderSection`, over three buckets instead of one list --
 * a bucket with nothing in it is simply omitted, which is a real computed zero (the
 * gh answer was read in full), never the "could not determine" case.
 */
export function renderIssueTriage(result, limit = ISSUE_LIMIT) {
  if (!result.ok) return [`**Issues:** unknown (${result.reason}).`, ''];
  if (result.data.length === 0) return [`**Issues:** none open.`, ''];

  const shown = result.data.slice(0, limit);
  const truncated = result.data.length > limit;
  const header = truncated
    ? `**Issues (showing ${shown.length} of more than ${limit}):**`
    : `**Issues (${shown.length}):**`;

  const buckets = { open: [], 'in flight': [], blocked: [] };
  for (const issue of shown) buckets[triageIssue(issue)].push(issue);

  const lines = [header, ''];
  if (buckets.open.length > 0) {
    lines.push(`Open (${buckets.open.length}):`, ...buckets.open.map(formatIssueLine), '');
  }
  if (buckets['in flight'].length > 0) {
    lines.push(`In flight (${buckets['in flight'].length}):`, ...buckets['in flight'].map(formatIssueLine), '');
  }
  if (buckets.blocked.length > 0) {
    lines.push(`Blocked (${buckets.blocked.length}):`, ...buckets.blocked.map(formatBlockedIssueLine), '');
  }
  return lines;
}

/** Open PRs with check state, reusing the same unknown/empty/truncation handling. */
export function renderOpenPrsWithChecks(result, limit = OPEN_PR_LIMIT) {
  return renderSection('Open PRs', result, limit, (p) => formatPrLine(p, { showChecks: true }));
}

// ---------------------------------------------------------------------------
// Decision Log (D5, EN-7)
// ---------------------------------------------------------------------------

// Common names for a project's decision log. "Detect, do not assume" (issue #81): a
// freshly scaffolded project may not have settled on one yet, and this plugin does not
// impose a project config file (D10) to declare it in either. This list is short on
// purpose -- guessing forever is its own failure mode -- and every name tried is named
// back to the reader when none of them exist.
export const DECISION_LOG_CANDIDATES = ['docs/DECISIONS.md', 'DECISIONS.md', 'docs/decisions.md', 'decisions.md'];

// `### D5 — Title`, the convention this project's own docs/DECISIONS.md uses. Any
// heading level 1-6, and any of a hyphen, an en dash or an em dash as the separator, so
// a plain-ASCII log is read the same as this project's. `DEC-*` (the vendored skill's
// own identifier, quoted rather than owned here) never matches: it is not `D` followed
// immediately by a digit.
const DECISION_HEADING = /^#{1,6}\s+(D\d+)\s*(?:[—–-]+)\s*(.+?)\s*$/gm;

/** The first candidate that exists under `root`, or null. */
export function findDecisionLog(root, candidates = DECISION_LOG_CANDIDATES) {
  for (const rel of candidates) {
    const abs = path.join(root, rel);
    if (existsSync(abs)) return { rel, abs };
  }
  return null;
}

/** Every `### D<n> — <title>` heading in `text`, sorted by identifier ascending. */
export function parseDecisionLog(text) {
  const decisions = [];
  for (const m of text.matchAll(DECISION_HEADING)) {
    decisions.push({ id: m[1], number: Number(m[1].slice(1)), title: m[2].trim() });
  }
  decisions.sort((a, b) => a.number - b.number);
  return decisions;
}

/**
 * The Decision Log, one line per decision. Three outcomes, none silent (L-08's rule
 * against an omitted section reading as "nothing there" applies here as much as it does
 * to a gh answer): not found (names every candidate looked for), found but unparseable
 * (names the file and the pattern that found nothing), or found and rendered.
 */
export function renderDecisionLog(root, candidates = DECISION_LOG_CANDIDATES) {
  const found = findDecisionLog(root, candidates);
  if (!found) {
    return [`**Decision Log:** not found. Looked for ${candidates.join(', ')}.`, ''];
  }
  let text;
  try {
    text = readFileSync(found.abs, 'utf8');
  } catch (err) {
    return [`**Decision Log:** found \`${found.rel}\` but could not read it (${err.message}).`, ''];
  }
  const decisions = parseDecisionLog(text);
  if (decisions.length === 0) {
    return [`**Decision Log** (\`${found.rel}\`): present, but no `+ '`### D<n> — <title>`' + ' heading matched.', ''];
  }
  return [`**Decision Log** (\`${found.rel}\`, ${decisions.length}):`, ...decisions.map((d) => `- ${d.id} — ${d.title}`), ''];
}

// ---------------------------------------------------------------------------
// The status skill's own render (issue #81) -- Issues, PRs, Decision Log. Nothing more:
// the SKILL.md stub's contract is exactly these three, and the render stays inside it
// (an addition beyond what the stub promised is a founder scope question, not something
// to add quietly here).
// ---------------------------------------------------------------------------

/**
 * The full status view for the `status` skill. `root` is the git worktree toplevel (or
 * null, meaning the caller is not inside a git worktree at all -- reported rather than
 * crashing on it).
 */
export async function renderStatusView(root) {
  if (!root) {
    return ['**Status:** not inside a git worktree; nothing to render.', ''].join('\n');
  }

  const lines = [
    '## Project status (generated just now -- nothing here is stored)',
    '',
    'Issues, PR state and the Decision Log, read fresh from git and GitHub on this run.',
    'Nothing below is cached, hand-maintained, or carried over from a previous answer.',
    '',
  ];

  const [issues, prs] = await Promise.all([fetchOpenIssues(root), fetchOpenPrs(root)]);

  lines.push(...renderIssueTriage(issues));
  lines.push(...renderOpenPrsWithChecks(prs));
  lines.push(...renderDecisionLog(root));

  return lines.join('\n');
}
