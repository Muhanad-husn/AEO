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
// 2. THE TEST COMMAND IS THE PROJECT'S OWN RECORD, NOT A GUESS (V-05, D10, D29).
//    `uv run pytest` and `ruff` are gone, and so is the table that replaced them. The
//    gate reads `aeo-tests.json` at the project nearest the change and runs the command
//    it names. See stack.mjs. With no record the gate blocks and names the exact path to
//    create; it never guesses and never passes quietly.
//
// 3. THE DOCS-ONLY PATH NO LONGER OPENS THE PROTECTED BRANCH. The original let a
//    docs-only commit land on main with no branch, which was a founder policy for one
//    repo. Here the protected branch blocks unconditionally. The suite skip survives,
//    narrowed: see isDocumentation.
//
// WHAT THIS GATE RUNS, AND WHAT IT DOES NOT. It runs the command recorded at the project
// nearest the change. It does not run the repo-wide tree in a
// mono-repo, and it does not run an acceptance or e2e layer the project keeps behind a
// separate script. That is PLAN's efficiency spine item 1, and L-06 is its stated cost:
// an acceptance regression is then only ever discovered in CI. The countermeasure is
// Phase 2's, not this gate's. Nothing here widens the default to compensate.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_BRANCH_UNRESOLVED,
  block,
  currentBranch,
  defaultBranch,
  git,
  isAeoRole,
  matchesGitSubcommand,
  resolveWorktree,
  runGate,
} from './lib.mjs';
import { projectAnchor, runInProgress } from './sentinel.mjs';
import { RECORD_FILE, RECORD_KEY, resolveTestPlan } from './stack.mjs';

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
 * How long ALL of this commit's suites together may run before the gate stops waiting
 * and blocks. One budget per invocation, never one per suite.
 *
 * This is the whole reason an explicit hook timeout matters. When Claude Code's own
 * timeout fires it kills the hook, and a killed hook exits non-zero but not 2, which
 * is a NON-blocking error: the tool call proceeds and the commit lands untested
 * (C-06). A test suite that overruns would become a silent pass. So the gate keeps its
 * own budget strictly inside the hook's, observes the overrun itself, and blocks.
 *
 * Per suite, that argument holds for one unit and fails for two. A mono-repo commit
 * touching a Node package and a Python package could spend the full budget on each,
 * clear the hook timeout between them, be cancelled, and land untested, in exactly the
 * mono-repo case a per-directory record exists to serve. So the deadline is taken
 * once, at gate entry, and each suite is given what is left of it.
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

// `.txt` is absent on purpose. It is a documentation extension in prose only:
// requirements.txt, constraints.txt, CMakeLists.txt and golden-output fixtures are all
// executable configuration, and a dependency bump is the change most likely to turn a
// suite red without touching a line of source.
const DOCS_EXTENSION = /\.(md|rst)$/i;

// A dot-directory holds configuration, whatever the extension inside it. The original
// denied `.claude/` specifically, for a reason worth keeping: agent roles and skill
// definitions are all `.md`, so the extension test alone classified the harness's own
// rules as documentation and let a change to them land with no suite run. Generalised
// to any dot-directory rather than a name list, because `.agents/` is the same hazard
// in the upstream layout and a list of names is a list that rots. The cost is that a
// `.github/CONTRIBUTING.md` commit runs the suite, which is the safe direction.
const DOT_DIRECTORY = /(^|\/)\.[^/]+\//;

// The directory axis was not enough. A plugin keeps `agents/builder.md` and
// `skills/x/SKILL.md` under no dot-directory at all, so a commit rewriting the builder's
// charter ran nothing. Front matter is what separates a definition from prose: a role, a
// skill and a static-site page all open with a `---` block that something reads and acts
// on, and a README does not. That is a property of the file rather than a list of names
// that rots. An unreadable or deleted file is not prose either, so it reads as code.
function opensWithFrontMatter(full) {
  try {
    return /^\uFEFF?---\r?$/.test(readFileSync(full, 'utf8').split('\n', 1)[0]);
  } catch {
    return true;
  }
}

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

function isDocumentation(toplevel, file) {
  if (DOT_DIRECTORY.test(file) || !DOCS_EXTENSION.test(file)) return false;
  return !opensWithFrontMatter(path.resolve(toplevel, file));
}

function noRecordFailure(plan, toplevel) {
  const lines = [
    'no test command is recorded for this change, so the gate cannot confirm the suite is green.',
    `  repository:   ${toplevel}`,
    `  searched:     ${plan.searched.join(', ') || '(nothing)'}`,
  ];
  for (const unit of plan.units) {
    if (unit.command === null) lines.push(`  at ${unit.record}: ${unit.reason}`);
  }
  for (const dir of plan.missing) {
    lines.push(`  at ${dir}: no ${RECORD_FILE} there or in any directory above it`);
  }
  lines.push(
    `Create ${path.join(toplevel, RECORD_FILE)} holding {"${RECORD_KEY}": "<the command that runs this project's fast suite>"} and commit it.`,
    `The command runs with that file's own directory as its working directory. A mono-repo puts one record in each project directory, and the nearest record above a changed file is the one that runs.`,
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
function runSuite(unit, deadline) {
  const shown = unit.command;
  const result = spawnSync(unit.command, [], {
    cwd: unit.root,
    encoding: 'utf8',
    windowsHide: true,
    // What is left of the whole commit's budget, never a fresh one. A spent deadline
    // still spawns, with a timeout that expires at once, so the overrun is reported
    // through the one path below rather than through a second copy of it.
    timeout: Math.max(deadline - Date.now(), 1),
    maxBuffer: MAX_SUITE_OUTPUT,
    // The recorded command is a command LINE, not a program and an argv, so it has to go
    // through a shell: `npm test && pytest` is one thing a project can record. Windows
    // needs a shell for npm, gradlew and every other .cmd shim in any case.
    //
    // WHAT THIS TRUSTS, STATED HONESTLY. The string comes from a tracked file in the
    // repository, so this gate executes shell that the repository controls. The
    // substantive trust level is unchanged: the table this replaced ran `npm test`, whose
    // body is `scripts.test` in the repository's own package.json, so a repository could
    // already decide what the gate executed. What moved is where that decision is
    // written — one visible line in one file, instead of behind a package manager.
    shell: true,
  });

  const output = tail(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  const seen = output === '' ? '' : `\n--- last ${LOG_TAIL_LINES} lines ---\n${output}`;

  // Read before the overrun test: a maxBuffer overflow also kills the child, so it
  // arrives as a signalled exit and was reported as a timeout, which it is not.
  if (result.error?.code === 'ENOBUFS') {
    block(`\`${shown}\` in ${unit.root} produced more than ${MAX_SUITE_OUTPUT} bytes of output, so the gate cannot confirm the suite is green.`);
  }
  if (result.error?.code === 'ETIMEDOUT' || (result.status === null && result.signal)) {
    block(
      `\`${shown}\` in ${unit.root} did not finish within the gate's ${Math.round(SUITE_BUDGET_MS / 1000)}s budget for this commit, so the gate cannot confirm the suite is green. This is the project's fast tier; if it takes this long, it is an acceptance suite and belongs in CI.${seen}`,
    );
  }
  // A command that is not on PATH. With `shell: true` that is NOT an ENOENT from
  // spawnSync: the shell starts fine and reports the miss as its own exit code — 127 from
  // POSIX `sh`, 9009 from a Windows batch runner that propagates its errorlevel, which is
  // the shape of most toolchain shims.
  //
  // MEASURED, NOT ASSUMED, AND ONLY HALF TRUE ON WINDOWS. `cmd.exe` sets `errorlevel` to
  // 9009 for a command it cannot find, but exits 1 to its parent, so a bare missing
  // program on Windows arrives here as a red suite. That is why the tail matters more
  // than the label: `cmd.exe`'s own "is not recognized as an internal or external
  // command" line is in the output either way, and both paths block. Keying on these two
  // codes is message quality and never a fail-open, and the tail goes with the message so
  // a suite that genuinely exited 127 still reads correctly.
  if (result.error || result.status === 127 || result.status === 9009) {
    const cause = result.error
      ? result.error.message
      : `exit ${result.status}: the shell could not find the command`;
    block(`\`${shown}\` could not be started in ${unit.root} (${cause}). The gate cannot confirm the suite is green.${seen}`);
  }
  if (result.status !== 0) {
    block(
      `the project's test suite is red. Get to green before committing.\n  ran: ${shown}\n  in:  ${unit.root}\n  exit: ${result.status}\n--- last ${LOG_TAIL_LINES} lines ---\n${output}`,
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
  if (branch !== null) {
    const protectedBranch = defaultBranch(toplevel);
    if (protectedBranch === null) {
      // A gate that cannot name the branch it protects cannot tell that this commit is
      // not on it. Guessing `main` here is what let a code commit land on `main` in a
      // repo with no origin; the honest answer is to stop and ask for one fact.
      block(
        `this repository does not say what its default branch is, so the gate cannot tell whether this commit lands on it. ${DEFAULT_BRANCH_UNRESOLVED}`,
      );
    }
    if (branch === protectedBranch) {
      block(`no direct commits on ${protectedBranch}. Work on a branch and merge via PR after founder approval.`);
    }
  }
  // A null branch is an unborn HEAD: `git init`, no commit yet, so there are no
  // branches for defaultBranch to read and nothing for this check to compare. Asking
  // for a default branch here would make the first commit in a new repository
  // impossible, which is over-blocking rather than fail-closed. The suite still runs.

  // L-02 again, and the reason it belongs here rather than in review-jail. Hooks in a
  // hooks.json group run concurrently, so review-jail sealing a reviewer's commit does
  // not stop this gate starting a full suite run beside it. The seal holds; the side
  // effect is the class of event that killed four live runs. The branch check above is
  // free and still applies; everything below this line executes something.
  if (isAeoRole(payload, 'reviewer')) {
    note('commit-gate: the reviewer role does not commit, and review-jail owns that block. No suite is run.');
    return;
  }

  // One deadline for the whole invocation, taken before any suite starts. See
  // SUITE_BUDGET_MS.
  const deadline = Date.now() + SUITE_BUDGET_MS;

  // Fails safe in every direction: an empty set, any non-documentation file, any path
  // under a dot-directory, any file that opens with front matter, or a git failure that
  // empties the set all fall through to the record and the suite.
  const files = changedFiles(toplevel, command);
  if (files.length > 0 && files.every((file) => isDocumentation(toplevel, file))) {
    note(`commit-gate: documentation only (${files.length} file(s)); no code changed, so the suite is not run.`);
    return;
  }

  // L-02, and the reason this gate is the one that needs it. Every other gate blocks an
  // action; this one performs one, because running the suite executes code. Four
  // simultaneous external kills of a live four-hour pipeline were traced to a concurrent
  // session's commit gate firing tests. So a run-in-progress sentinel is a hard stop
  // here, before a test command is even resolved.
  //
  // Placed after the documentation-only return on purpose. A docs-only commit runs
  // nothing and cannot disturb a live job. The runbook's blanket "no commits" is a human
  // standing in for "no test execution"; the gate enforces the mechanism, and holding a
  // note-taking commit for four hours is what teaches people to delete the sentinel.
  const liveRun = runInProgress(projectAnchor(toplevel));
  for (const line of liveRun.notes) note(`commit-gate: ${line}`);
  if (liveRun.reason !== null) block(liveRun.reason);

  const plan = resolveTestPlan({ toplevel, files });
  if (plan.missing.length > 0 || plan.units.some((u) => u.command === null)) {
    block(noRecordFailure(plan, toplevel));
  }

  for (const unit of plan.units) runSuite(unit, deadline);
}

// Importing this file must not run the gate, so the tests can read the timeout it
// requires without spawning it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runGate({ name: 'commit-gate', run: commitGate });
}
