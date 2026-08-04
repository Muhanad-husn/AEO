// commit-gate: no commit on the protected branch, and no commit on a red suite.
//
// PreToolUse on Bash. The gate decides from stdin rather than from an `if:` filter,
// because `if:` fails open on an unparseable command and is never the security
// boundary (C-04).
//
// Ported from source/axial/dot-claude/hooks/commit-gate.ps1 with three deliberate
// changes.
//
// 1. THE RED-COMMIT ESCAPE HATCH IS DELETED (V-01). The original carried
//    `if (Test-Path '.claude/allow-red-commit') { exit 0 }`, a v1 flag file the v1->v2
//    migration missed, advertised in the header of a hook whose own design rules say
//    flag files are gone and must not be reintroduced. It is one file creation from
//    silently disabling the tests-green gate. Nothing here replaces it. If a red
//    commit is ever genuinely required, the answer is a test marked expected-to-fail,
//    which is green to the gate and visible in the repo.
//
// 2. THE TEST COMMAND IS DETECTED, NOT HARD-CODED (V-05, D10). `uv run pytest` and
//    `ruff` are gone. See stack.mjs. When detection resolves nothing the gate blocks
//    and names what it looked for; it never guesses and never passes quietly.
//
// 3. THE DOCS-ONLY PATH NO LONGER OPENS THE PROTECTED BRANCH. The original let a
//    docs-only commit land on main with no branch, which was a founder policy for one
//    repo. Here the protected branch blocks unconditionally. The suite skip survives,
//    narrowed: see isDocumentation.
//
// WHAT THIS GATE RUNS, AND WHAT IT DOES NOT. It runs the project's own declared test
// command at the manifest nearest the change. It does not run the repo-wide tree in a
// mono-repo, and it does not run an acceptance or e2e layer the project keeps behind a
// separate script. That is PLAN's efficiency spine item 1, and L-06 is its stated cost:
// an acceptance regression is then only ever discovered in CI. The countermeasure is
// Phase 2's, not this gate's. Nothing here widens the default to compensate.

import { spawnSync } from 'node:child_process';
import { writeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { block, currentBranch, defaultBranch, git, matchesGitSubcommand, resolveWorktree, runGate } from './lib.mjs';
import { LOOKED_FOR, resolveTestPlan } from './stack.mjs';

/**
 * The `timeout` P1.7 must write into this gate's hooks.json entry, in seconds.
 *
 * This is the documented default for a command hook (C-09), chosen rather than tuned.
 * A lower number would be a constant fitted to no measurement, and it would convert a
 * slow-but-passing suite into a block. The exact value is not safety-critical because
 * of SUITE_BUDGET_MS below; what matters is that it is stated in one place that the
 * gate and the manifest can both be checked against.
 */
export const HOOK_TIMEOUT_SECONDS = 600;

/**
 * How long the suite itself may run before the gate stops waiting and blocks.
 *
 * This is the whole reason an explicit hook timeout matters. When Claude Code's own
 * timeout fires it kills the hook, and a killed hook exits non-zero but not 2, which
 * is a NON-blocking error: the tool call proceeds and the commit lands untested
 * (C-06). A test suite that overruns would become a silent pass. So the gate keeps its
 * own budget strictly inside the hook's, observes the overrun itself, and blocks.
 *
 * The margin is 5% of the hook timeout, which is time for the gate to write its reason
 * and exit rather than a tuned threshold.
 */
const SUITE_BUDGET_CEILING_MS = Math.round(HOOK_TIMEOUT_SECONDS * 1000 * 0.95);

// A test seam, so the fail-closed-on-overrun path above can be exercised in under a
// second. Clamped to the ceiling, so it can only ever shorten the budget. Lengthening
// it past the hook timeout is what would reintroduce the fail-open, and that is exactly
// what the clamp forbids.
const requestedBudget = Number(process.env.AEO_TEST_SUITE_BUDGET_MS);
export const SUITE_BUDGET_MS =
  Number.isFinite(requestedBudget) && requestedBudget > 0
    ? Math.min(requestedBudget, SUITE_BUDGET_CEILING_MS)
    : SUITE_BUDGET_CEILING_MS;

// A verbose suite must not be reported as a failure because its output overflowed
// Node's 1 MB default capture buffer.
const MAX_SUITE_OUTPUT = 32 * 1024 * 1024;

// An unbounded test log floods the agent's context, which is the one L-09 lesson that
// does not evaporate with the PowerShell. Fifteen lines is the v1 gate's cap, carried.
const LOG_TAIL_LINES = 15;

// `git commit -a` / `--all` sweeps in tracked-but-unstaged edits, so the file set has
// to include them. Deliberately generous: this also matches an `-a` inside a quoted
// commit message, and a false positive only ever widens the set, which runs more of
// the suite rather than less.
const COMMIT_ALL = /(^|\s)-[A-Za-z]*a[A-Za-z]*(\s|$)|--all\b/;

const DOCS_EXTENSION = /\.(md|txt|rst)$/i;

// A dot-directory holds configuration, whatever the extension inside it. The original
// denied `.claude/` specifically, for a reason worth keeping: agent roles and skill
// definitions are all `.md`, so the extension test alone classified the harness's own
// rules as documentation and let a change to them land with no suite run. Generalised
// to any dot-directory rather than a name list, because `.agents/` is the same hazard
// in the upstream layout and a list of names is a list that rots. The cost is that a
// `.github/CONTRIBUTING.md` commit runs the suite, which is the safe direction.
const DOT_DIRECTORY = /(^|\/)\.[^/]+\//;

function note(message) {
  try {
    writeSync(2, `${message}\n`);
  } catch {
    // Losing the note must not change the decision. runGate owns the exit.
  }
}

/** Repo-relative paths this commit will record. Empty on any git failure, which is safe. */
function changedFiles(toplevel, command) {
  const paths = [];
  // -z keeps paths raw. Without it git quotes and escapes anything non-ASCII, and the
  // quoted form does not resolve against the filesystem.
  const staged = git(toplevel, 'diff', '--cached', '--name-only', '-z');
  if (staged) paths.push(...staged.split('\0'));
  if (COMMIT_ALL.test(command)) {
    const unstaged = git(toplevel, 'diff', '--name-only', '-z');
    if (unstaged) paths.push(...unstaged.split('\0'));
  }
  return [...new Set(paths.filter((p) => p !== ''))];
}

function isDocumentation(file) {
  return !DOT_DIRECTORY.test(file) && DOCS_EXTENSION.test(file);
}

function detectionFailure(plan, toplevel) {
  const lines = [
    'no test command could be resolved for this change, so the gate cannot confirm the suite is green.',
    `  repository:   ${toplevel}`,
    `  searched:     ${plan.searched.join(', ') || '(nothing)'}`,
    `  looked for:   ${LOOKED_FOR.join(', ')}`,
  ];
  for (const unit of plan.units) {
    if (unit.command === null) lines.push(`  at ${unit.root}: ${unit.reason}`);
  }
  for (const dir of plan.missing) lines.push(`  at ${dir}: no manifest at or above it`);
  lines.push(
    'Declare the project\'s test command in its manifest (for example "scripts.test" in package.json, or a pytest section in pyproject.toml), or commit documentation only.',
  );
  return lines.join('\n');
}

function tail(text) {
  const lines = String(text ?? '').replace(/\s+$/, '').split(/\r?\n/);
  return lines.slice(-LOG_TAIL_LINES).join('\n');
}

/**
 * Run one project's suite. Every outcome other than a clean exit 0 is a block, so a
 * runner that is missing, a suite that overruns and a suite that fails all fail closed.
 */
function runSuite(unit) {
  const shown = unit.command.join(' ');
  const result = spawnSync(unit.command[0], unit.command.slice(1), {
    cwd: unit.root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: SUITE_BUDGET_MS,
    maxBuffer: MAX_SUITE_OUTPUT,
    // Windows cannot spawn npm, gradlew or any other .cmd shim without a shell. Every
    // argument here comes from stack.mjs's own table, never from the model or the
    // repo, so there is nothing to quote-escape.
    shell: process.platform === 'win32',
  });

  const output = tail(`${result.stdout ?? ''}${result.stderr ?? ''}`);

  if (result.error?.code === 'ETIMEDOUT' || (result.status === null && result.signal)) {
    block(
      `\`${shown}\` in ${unit.root} did not finish within ${Math.round(SUITE_BUDGET_MS / 1000)}s, so the gate cannot confirm the suite is green. This is the project's fast tier; if it takes this long, it is an acceptance suite and belongs in CI.`,
    );
  }
  if (result.error) {
    block(`\`${shown}\` could not be started in ${unit.root} (${result.error.message}). The gate cannot confirm the suite is green.`);
  }
  if (result.status !== 0) {
    block(
      `the ${unit.stack ?? 'project'} test suite is red. Get to green before committing.\n  ran: ${shown}\n  in:  ${unit.root}\n  exit: ${result.status}\n--- last ${LOG_TAIL_LINES} lines ---\n${output}`,
    );
  }
}

/** @param {object} payload */
export function commitGate(payload) {
  const command = payload?.tool_input?.command;
  if (!matchesGitSubcommand(command, 'commit')) return;

  const { dir, source, toplevel } = resolveWorktree(payload);
  if (!toplevel) {
    block(
      `this commit's working directory did not resolve to a git repository (tried ${dir ?? 'nothing'}, from ${source}). The gate can check neither the branch nor the suite.`,
    );
  }

  // D14: the protected branch is resolved, never the literal `main`. On a detached
  // HEAD currentBranch reports the literal `HEAD`, which is not the default branch and
  // is the right answer here, since such a commit lands on no branch at all.
  const branch = currentBranch(toplevel);
  const protectedBranch = defaultBranch(toplevel);
  if (branch !== null && branch === protectedBranch) {
    block(`no direct commits on ${protectedBranch}. Work on a branch and merge via PR after founder approval.`);
  }

  // Fails safe in every direction: an empty set, any non-documentation file, any path
  // under a dot-directory, or a git failure that empties the set all fall through to
  // detection and the suite.
  const files = changedFiles(toplevel, command);
  if (files.length > 0 && files.every(isDocumentation)) {
    note(`commit-gate: documentation only (${files.length} file(s)); no code changed, so the suite is not run.`);
    return;
  }

  const plan = resolveTestPlan({ toplevel, files });
  if (plan.missing.length > 0 || plan.units.some((u) => u.command === null)) {
    block(detectionFailure(plan, toplevel));
  }

  for (const unit of plan.units) runSuite(unit);
}

// Importing this file must not run the gate, so the tests can read the timeout it
// requires without spawning it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runGate({ name: 'commit-gate', run: commitGate });
}
