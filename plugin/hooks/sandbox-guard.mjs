// AEO sandbox guard: production data is not reachable from a session, and a live long
// job is not run over.
//
// PreToolUse on Bash and on the tools that read or write a file directly. It decides from
// stdin rather than from an `if:` filter, because `if:` fails open on an unparseable
// command and is never the security boundary (C-04).
//
// WHY THIS EXISTS. Three real incidents, months apart, all invisible in CI because CI
// has no data directory (L-03):
//
//   - A module-global logs root meant any test driving main() wrote real timestamped run
//     directories into the operator's live logs. 79 leaked directories over five days,
//     one of which a status hook then reported as "newest run".
//   - A lookup that resolved through a DEFAULT directory when its argument was omitted
//     meant six test call-sites silently read the operator's live 49,674-entry index.
//   - A conftest fixture that snapshotted and restored a shared state directory. That
//     was the mitigation which already existed; it addresses collision, not reach.
//
// Plus the fourth (L-02): four simultaneous external kills of a live four-hour pipeline
// were traced to a concurrent session running the project's suite over it. Rule 1 below
// is what still guards that: it refuses a Bash invocation of the declared suite while a
// sentinel is up, whoever types it. The commit gate this rule used to be backstopped by
// is gone (D30) — it ran the suite as a side effect of every commit, which was the other
// half of L-02's own hazard, so deleting it removes that half of the risk rather than
// reopening it.
//
// REFUSE, NEVER WARN. Advice is what cost 19,000 documents. There is no override flag
// and the absence of one is the point (L-05): an override is what you reach for at 2am,
// and a guard with a bypass is a guard that reports safety it does not provide.
//
// THE TWO VARIABLES, AND WHY TWO.
//
//   AEO_LIVE_DATA_ROOT  the project's declaration of WHERE PRODUCTION DATA IS.
//   AEO_DATA_ROOT       the seam: where THIS process tree reads and writes data.
//
// One variable cannot do this. The guard has to compare an effective location against a
// declared one, and a single variable gives it nothing to compare against. In ordinary
// operator use outside Claude Code the two are equal; in a session they must differ, and
// this gate is what makes "must" mean something.
//
// The seam is an environment variable rather than an injected argument because in-process
// monkeypatching never reaches a subprocess CLI child and integration tests shell out.
// That is L-03's second requirement, stated in its own words, and an environment variable
// is the only seam that survives a process boundary unaided.
//
// WHY THE ENVIRONMENT RULE FIRES ON EVERY COMMAND AND NOT ONLY ON TEST COMMANDS. A gate
// that had to recognise "this command runs the project's code" would be a classifier
// whose failure mode is silent under-blocking, which is the L-08 shape this project is
// most alert to. There is nothing to classify here. A session whose declared seam points
// into production data is misconfigured as a whole, and blocking at its first Bash call
// with a message naming the fix is a one-time setup block, not a per-command tax. Once
// the project sets both variables in .claude/settings.json the rule never fires again.
//
// The sentinel rule does need to recognise a suite, and it takes that from the project's
// own recorded test command (stack.mjs) rather than from a table of its own. A project
// with no record declares no suite here, so a live run is protected only for a project
// that has named its own test command; recognition is deliberately generous within that.
// A command shape the recognition misses (D22's known miss: `node --test`, when the
// record says `npm test`) is a gap this rule alone carries (D30): nothing else backstops
// it now that the commit gate is gone.
//
// WHO IT APPLIES TO: everyone, the orchestrator included. There is no identity test in
// this file. block-merge exempts the orchestrator because a founder-approved merge is a
// real workflow. A founder-approved run against production data during a live job is not
// one, and the four kills in L-02 came from concurrent sessions rather than from a role.

import { realpathSync, writeSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { block, commandSegments, isPathInside, normalizeHookPath, operationDirs, runGate, toolFilePath } from './lib.mjs';
import { projectAnchor, runInProgress } from './sentinel.mjs';
import { resolveTestPlan } from './stack.mjs';

/** The project's declaration of where production data is. Absolute, or the guard blocks. */
export const LIVE_DATA_ROOT_ENV = 'AEO_LIVE_DATA_ROOT';

/** The seam. Where this process tree resolves its data. Inherited by every child. */
export const DATA_ROOT_ENV = 'AEO_DATA_ROOT';

const NO_OVERRIDE =
  'There is no override flag. That is deliberate (L-05): an override is what you reach for at 2am.';

/**
 * The tools that name their target in the payload instead of inside a shell command, and
 * which hooks.json's matcher for this gate must therefore list alongside Bash.
 *
 * A smoke test of the installed plugin found the hole this set closes. The matcher was
 * `^Bash$`, so `cat <file inside production data>` was refused while a Write that CREATED
 * a file inside the production data root was not gated at all, and a Read of a file inside
 * it went through freely. Production data does not care which tool reached it.
 *
 * READS ARE IN SCOPE, by the same evidence the rest of this gate is built on: L-03's
 * second incident is six test call-sites silently READING a live 49,674-entry index.
 *
 * Glob and Grep are not here. They name a pattern plus an optional root rather than a
 * file, which is a wider surface than this fix, and a matcher wider than the set the gate
 * actually judges reads as covered while it is not.
 */
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read', 'NotebookRead']);

function note(message) {
  try {
    writeSync(2, `${message}\n`);
  } catch {
    // Losing the note must not change the decision. runGate owns the exit.
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * An absolute path with every symlink and alias on it resolved.
 *
 * isPathInside compares strings and does not call realpath, so two names for one
 * directory never compare equal. For this gate that is not a correctness nit: a link
 * into live data defeats an unresolved check, and what it defeats is the guarantee that
 * data cannot be reached. Both sides go through here before they are compared.
 *
 * The loop realpaths the deepest ancestor that exists and re-appends the rest, so a path
 * that has not been created yet still resolves to the right place.
 */
function realise(p) {
  let current = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      return path.join(realpathSync.native(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** True when either path contains the other, once both are resolved through their links. */
function overlaps(a, b) {
  const ra = realise(a);
  const rb = realise(b);
  return isPathInside(ra, rb) || isPathInside(rb, ra);
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

// A token is a run of non-space characters with quoted spans allowed inside it, so
// `--data-dir="D:/corpus one"` is one token rather than two. Shell parsing beyond this
// is deliberately not attempted: the tokens feed a containment test whose false
// positives cost a message and whose false negatives are covered by the environment
// rule, which needs no parsing at all.
const TOKEN = /(?:"[^"]*"|'[^']*'|[^\s"']+)+/g;

/** The command split into tokens, with quotes removed. */
export function shellTokens(command) {
  if (typeof command !== 'string' || command === '') return [];
  return (command.match(TOKEN) ?? []).map((t) => t.replace(/["']/g, ''));
}

const URL_LIKE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/**
 * The tokens that could name a filesystem location.
 *
 * `NAME=value` and `--flag=value` both contribute their right-hand side, which is where
 * a data directory is usually passed. A token with no separator in it is a word rather
 * than a path and is skipped; a bare `corpus` is not a claim about a location.
 */
export function pathCandidates(tokens) {
  const out = new Set();
  for (const raw of tokens) {
    const eq = raw.indexOf('=');
    const t = (eq > 0 ? raw.slice(eq + 1) : raw).trim();
    if (t === '' || URL_LIKE.test(t)) continue;
    if (!/[\\/]/.test(t)) continue;
    out.add(t);
  }
  return [...out];
}

/**
 * Interpreters generic enough that their own name carries no identity: what they run is
 * named by the argument after them, not by the interpreter itself (#136). This is a fixed,
 * small set rather than a heuristic on purpose: an interpreter's identity lives in its
 * script argument, and no positional or lexical signal — not position, not extension, not
 * a trailing slash — can substitute for naming them. `go test pkg/...` and `pytest
 * tests/` both put a path-shaped token straight after a plain program, and only one of
 * those programs is generic; a rule that tried to tell them apart by shape alone gets one
 * of the two wrong.
 *
 * `cmd`, `powershell` and `pwsh` are deliberately absent (#136). Their own flags are
 * path-shaped by the same `/[\\/]/` test a script argument is — `/c` and `-File` both
 * contain a slash or a dash the same way a path does — so `cmd /c scripts\check.cmd`
 * mis-reduces to `['cmd', 'c']`, the flag's own basename, not the script's. No declared
 * test command in this corpus starts with a Windows shell, and a set entry that
 * mis-reduces is worse than one that is simply absent.
 */
const GENERIC_INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'node', 'python', 'python3', 'ruby', 'perl']);

/**
 * `tokens[i]`, reduced to its basename when it is path-shaped and a generic interpreter
 * appears earlier in the same command, skipping over any flags in between (#136). Shared
 * by both sides of the match: the declared command's own tokens, when deciding what
 * identifies the suite, and the invoked command's tokens, when recognising that identity
 * again. `bash scripts/check.sh` reduces to `['bash', 'check.sh']` on either side, and
 * `node --experimental-vm-modules node_modules/.bin/jest` reduces to `['node', 'jest']`,
 * the flag between interpreter and script skipped on both sides the same way.
 */
function reduceInterpreterScript(tokens, i) {
  const t = tokens[i];
  if (!/[\\/]/.test(t)) return t;
  let j = i - 1;
  while (j >= 0 && tokens[j].startsWith('-')) j -= 1;
  return j >= 0 && GENERIC_INTERPRETERS.has(tokens[j]) ? path.basename(t) : t;
}

/**
 * The declared command reduced to the tokens worth matching on.
 *
 * A flag never identifies the suite and is dropped outright: `pytest -k x` is the same
 * invocation as bare `pytest`. So does a glob argument: `rm -rf build/*.log` names no
 * particular file.
 *
 * A path-shaped token is kept, reduced to its basename, ONLY when it is a generic
 * interpreter's own script argument — reachable from the interpreter by walking back
 * over any flags in between (see reduceInterpreterScript). `bash scripts/check.sh`
 * becomes `['bash', 'check.sh']`, whatever relative prefix that script carries:
 * `bash ./scripts/check.sh` reduces the same way, because dropping it as a relative
 * argument the way `go test ./...` is dropped would reopen #134 for every script path
 * written the ordinary way, with a leading `./` (#136). Any other path-shaped token —
 * relative or not, adjacent to a flag or to nothing — is dropped the same way: it is a
 * target the suite runs over, not part of what identifies it, which is what lets a bare
 * `pytest` still match `pytest tests/unit/test_api.py`.
 *
 * Two earlier versions of this rule got it wrong in opposite directions. Keeping every
 * path-shaped token once anything plain survived made a declared command with a
 * directory argument fail to match its own plain invocation — `pytest tests/` no longer
 * matched a bare `pytest` (#136). Dropping every path-shaped token whenever a plain one
 * survived, before that, made `bash scripts/check.sh` collapse to just `bash`, so any
 * `bash <anything>` matched it, including a supervisor's own `status` and `stop`
 * commands, unreachable for the life of a run (#134). A third version required strict,
 * un-walked adjacency on this side while the invoked side walked back over flags — that
 * asymmetry is gone; both sides now read a flag-skipping predecessor the same way.
 *
 * When nothing survives — no plain token and no interpreter+script pair — the first kept
 * token (flags and globs still excluded) keeps its basename, so `vendor/bin/phpunit`
 * still matches a bare `phpunit`, and `vendor/bin/phpunit tests/` still reduces to
 * `['phpunit']` rather than folding `tests/` into the suite's identity by accident (#136).
 */
function significantTokens(command) {
  const wanted = [];
  for (let i = 0; i < command.length; i += 1) {
    const t = command[i];
    if (t.startsWith('-') || t.includes('*')) continue;
    if (/[\\/]/.test(t)) {
      const reduced = reduceInterpreterScript(command, i);
      if (reduced !== t) wanted.push(reduced);
      continue;
    }
    wanted.push(t);
  }
  if (wanted.length > 0) return wanted;
  const kept = command.filter((t) => !t.startsWith('-') && !t.includes('*'));
  return kept.length > 0 ? [path.basename(kept[0])] : [];
}

function isOrderedSubsequence(tokens, wanted) {
  let i = 0;
  for (const t of tokens) {
    if (t === wanted[i]) i += 1;
    if (i === wanted.length) return true;
  }
  return false;
}

/**
 * The declared test command this Bash command invokes, or null.
 *
 * Two forms match, both whole-token (V-12). The full declared sequence in order, which
 * catches `npm test`, `uv run pytest` and `bash scripts/check.sh`. Or its final program
 * token IN PROGRAM POSITION, which catches a bare `pytest -k x` in a project whose
 * declared command wraps it, `cd sub && pytest` with it, and a script run directly as
 * `./scripts/check.sh`, whose basename is the program.
 *
 * The first form reads the invoked command's own tokens through reduceInterpreterScript
 * before comparing, the same reduction significantTokens applies to the declared side, so
 * an interpreter's script survives flags typed between them on either side (#136). The
 * second form reduces a segment's program to a plain basename unconditionally: a program
 * IS the thing invoked, not an argument to something else, so there is no interpreter to
 * require there. Both are deliberately narrower than reducing every path-shaped invoked
 * token regardless of what precedes it: doing that made `git add tools/pytest` and `cat
 * .venv/bin/pytest` match a bare declared `pytest`, because `tools/pytest` reduces to the
 * same basename as the declared suite even though it is `git add`'s and `cat`'s argument,
 * not an interpreter's.
 *
 * The second form used to accept that token anywhere in the command. Because flags and
 * globs are dropped, the final declared token is the literal `test` for Node, Go, Rust
 * and Maven, so during a live run `grep -r test .`, `mkdir test` and `git add test` were
 * each refused with "`npm test` will not run", naming a command nobody typed. A guard
 * people cannot work around is a guard people delete, which is the failure this whole
 * gate is trying not to cause.
 *
 * A KNOWN MISS, in the other direction: `node --test` is not recognised, and it is how
 * this project's own suite runs. The recorded command is `npm test`, and what that
 * expands to is the package manager's business, not this function's to guess. During a
 * live run a hand-typed `node --test` is not held by anything (D30): nothing runs a
 * suite as a side effect of a commit any more, so there is no second check downstream of
 * this one to catch what it misses. The same miss now also covers a project that declares
 * its suite with a target, `node --test tests/`: the bare `node --test` a developer
 * actually types omits `tests/`, so it no longer carries the token the declared command's
 * identity needs — accepted, because reading identity off flag-skipped adjacency both
 * ways is what lets that declared command recognise its own full invocation and the
 * `node --experimental-vm-modules node_modules/.bin/jest`-shaped ones like it (#136).
 *
 * A SECOND KNOWN MISS, of the same shape (#134): a different interpreter running the same
 * script, as in `sh scripts/check.sh` against a declared `bash scripts/check.sh`. The
 * script's basename is an ARGUMENT to `sh` there, not the program in program position, so
 * neither form catches it — catching it would mean treating `sh` and `bash` as
 * equivalent, which is a different question from which programs are generic enough to
 * need a script argument at all. GENERIC_INTERPRETERS answers only the second question;
 * it is not an interchangeability table between shells, and does not grow into one.
 *
 * A THIRD KNOWN MISS (#136): a wrapper that runs a script through a sub-command rather
 * than an interpreter — `uv run scripts/check.py`, and the same for `deno`, `bun` or
 * poetry's own `run` — still collapses to `['uv', 'run']`, because `run` is not in
 * GENERIC_INTERPRETERS and the script argument after it is dropped like any other target.
 * Any `uv run <anything>` then matches the declared suite, the same over-match #134 fixed
 * for a bare interpreter. `poetry run python scripts/check.py` does not have this
 * problem: its script follows `python`, a real interpreter, and reduces correctly. Adding
 * `run` (or `uv`, `deno`, `bun`) to the set is not the fix — `npm run build` and `cargo
 * run` are "run" too, and neither takes a script argument that identifies a suite.
 */
export function invokesDeclaredSuite(command, declared) {
  const rawTokens = shellTokens(command);
  const tokens = rawTokens.map((t, i) => reduceInterpreterScript(rawTokens, i));
  const programs = commandSegments(command).segments.map((s) =>
    s.program === null ? null : /[\\/]/.test(s.program) ? path.basename(s.program) : s.program,
  );
  for (const candidate of declared) {
    const wanted = significantTokens(candidate);
    if (wanted.length === 0) continue;
    if (isOrderedSubsequence(tokens, wanted) || programs.includes(wanted[wanted.length - 1])) {
      return candidate.join(' ');
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The two roots
// ---------------------------------------------------------------------------

function readRoot(value, platform) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '') return { set: false, raw: '', root: null };
  const normalised = normalizeHookPath(raw, { platform });
  // Absoluteness is judged for the platform named, not the one this process runs on.
  // Reading it from the host made the `platform` argument true for normalisation and a
  // lie for the test that follows it: `D:/production` is not absolute to path.posix, so
  // every declared root went null and the guard resolved nothing.
  const p = platform === 'win32' ? path.win32 : path.posix;
  return { set: true, raw, root: p.isAbsolute(normalised) ? normalised : null };
}

/**
 * Where production data is, and where the data of EACH command on this line will resolve.
 *
 * An inline `AEO_DATA_ROOT=...` wins over the inherited value, because that is what the
 * child will see. This is the sanctioned way to redirect one command inside a session: it
 * is visible in the command string and the guard validates it like any other value.
 *
 * ONE SEAM PER COMMAND, NOT ONE PER LINE. A prefix assignment binds to the single command
 * it prefixes and the shell carries it no further, so every command on the line gets its
 * own answer and the guard judges them all. Reading one seam for the whole line let
 * `AEO_DATA_ROOT=<sandbox> npm run build && npm test` run the suite against production —
 * `npm test` never saw that assignment — and it leaked backwards just as freely, so
 * `npm test && AEO_DATA_ROOT=<sandbox> echo ok` did the same. Both exited 0.
 *
 * ONLY IN LEADING POSITION, and within one command the last one wins. Taking the value
 * from any token that started with the name was not the shell's rule either, and it
 * defeated the gate with the gate's own advice: told to set the variable, a model runs
 * `echo 'AEO_DATA_ROOT=<safe>' >> .claude/settings.json && npm test`, the guard read the
 * safe value out of the echoed string and allowed, and the child still ran with the
 * production-pointing seam, because writing a settings file changes no running process. A
 * grep pattern, a commit message and a heredoc body named the variable just as cheaply.
 * Assignments before this one are allowed, so
 * `NODE_ENV=test AEO_DATA_ROOT=<sandbox> npm test` is read the way the shell reads it.
 *
 * A segment that runs no program sets nothing a child can inherit — a bare assignment
 * makes a shell variable, not an exported one — so it contributes no seam and is not
 * judged. A command with no segments at all still gets the session's own seam, because
 * the environment rule fires whether or not there is a command to read.
 *
 * @returns {{live: object, seams: Array<{data: object, dataSource: string}>}}
 */
export function resolveRoots({ command = '', env = process.env, platform = process.platform } = {}) {
  const live = readRoot(env?.[LIVE_DATA_ROOT_ENV], platform);
  const inherited = env?.[DATA_ROOT_ENV];

  const seams = [];
  const seen = new Set();
  const record = (value, source) => {
    const key = `${source} ${value ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    seams.push({ data: readRoot(value, platform), dataSource: source });
  };

  for (const segment of commandSegments(command).segments) {
    if (segment.program === null) continue;
    const assigned = segment.assignments.filter((a) => a.startsWith(`${DATA_ROOT_ENV}=`)).pop();
    if (assigned === undefined) record(inherited, 'session environment');
    else record(assigned.slice(DATA_ROOT_ENV.length + 1), 'the command');
  }
  if (seams.length === 0) record(inherited, 'session environment');

  return { live, seams };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** The three ways one command's seam can be wrong. Blocks; returns only when it is fine. */
function checkSeam(live, data, dataSource) {
  if (!data.set) {
    block(
      `this session declares production data at ${live.root} (${LIVE_DATA_ROOT_ENV}) and sets no ` +
        `${DATA_ROOT_ENV}, so anything it runs resolves its data through its own defaults. A lookup ` +
        `falling through to a default directory is how six test call-sites read a live 49,674-entry ` +
        `index (L-03), and a gate cannot see inside a child process to check. Set ${DATA_ROOT_ENV} to a ` +
        `directory outside ${live.root} for this session, or prefix this one command with ` +
        `${DATA_ROOT_ENV}=<sandbox>. ${NO_OVERRIDE}`,
    );
  }

  if (data.root === null) {
    block(
      `${DATA_ROOT_ENV} is set to ${JSON.stringify(data.raw)} in ${dataSource}, which is not an absolute ` +
        `path. A relative seam resolves against whatever working directory the child happens to have, so ` +
        `the guard cannot tell whether it lands in production data at ${live.root}. Set it to an absolute ` +
        `path. ${NO_OVERRIDE}`,
    );
  }

  if (overlaps(live.root, data.root)) {
    block(
      `${DATA_ROOT_ENV} is ${data.root} (from ${dataSource}) and production data is at ${live.root}. ` +
        `One contains the other, so this run is pointed at production data. Three incidents came from ` +
        `exactly this (L-03), and none of them were visible in CI, because CI has no data directory. ` +
        `Point ${DATA_ROOT_ENV} at a directory that neither contains nor sits inside ${live.root}. ${NO_OVERRIDE}`,
    );
  }
}

/** @param {object} payload */
export function sandboxGuard(payload) {
  const command = typeof payload?.tool_input?.command === 'string' ? payload.tool_input.command : '';
  const tool = typeof payload?.tool_name === 'string' ? payload.tool_name : '';
  const fileTool = FILE_TOOLS.has(tool);

  const walk = operationDirs(payload);
  const dirs = walk.dirs.filter((d) => path.isAbsolute(d));

  // 1. A live long job (L-02). Read first and read cheaply: no git process, one readdir,
  //    and nothing else happens until a sentinel is actually present.
  //
  //    Every directory any command on this line runs in, not just the first: `cd
  //    elsewhere && npm test` still burns this machine while a job is live here, so a
  //    sentinel in either project is a sentinel worth honouring.
  //
  //    BASH ONLY. This rule blocks a command that INVOKES the project's declared test
  //    command, and a file tool invokes nothing, so it can never match. Skipping it
  //    outright rather than letting it not-match also keeps the sentinel walk off the
  //    path of every Read and Edit in the session.
  if (!fileTool) {
    const anchors = [...new Set(dirs.map(projectAnchor).filter((a) => a !== null))];
    for (const anchor of anchors) {
      const { reason, notes } = runInProgress(anchor);
      for (const line of notes) note(`sandbox-guard: ${line}`);
      if (reason === null) continue;
      // The record states one command line per project; this rule matches on tokens, so
      // the line is tokenised here rather than stored pre-split.
      const declared = resolveTestPlan({ toplevel: anchor, files: [] })
        .units.map((u) => u.command)
        .filter((c) => typeof c === 'string')
        .map((c) => shellTokens(c));
      const invoked = invokesDeclaredSuite(command, declared);
      if (invoked !== null) block(`\`${invoked}\` will not run: ${reason}\n${NO_OVERRIDE}`);
    }
  }

  // 2. The seam (L-03). Everything below needs a declared production data root; without
  //    one the project has told the guard nothing to protect, and there is nothing here
  //    to be ambiguous about.
  const { live, seams } = resolveRoots({ command, env: process.env });
  if (!live.set) return;

  if (live.root === null) {
    block(
      `${LIVE_DATA_ROOT_ENV} is set to ${JSON.stringify(live.raw)}, which is not an absolute path, so the ` +
        `sandbox guard cannot tell production data from a sandbox and refuses every call. Set it to the ` +
        `absolute path of the production data directory, or unset it. ${NO_OVERRIDE}`,
    );
  }

  // 3. A command the guard could not read all the way through. Everything below decides
  //    from the directories a command runs in and the paths it names, so a construct that
  //    hides either one hides the decision itself. This project's production data cannot
  //    be un-deleted, so an unreadable command is refused rather than guessed at. It is
  //    confined to sessions that declared production data, above, because a guard that
  //    refused every backtick in a project with nothing to protect is a guard people
  //    delete (L-05).
  if (walk.parseError !== null) {
    block(
      `this command was not run because ${walk.parseError}, and this session declares production data at ` +
        `${live.root}. A command the guard cannot read is a command it cannot clear. Rewrite it, or split ` +
        `it into commands that can be read one at a time. ${NO_OVERRIDE}`,
    );
  }
  if (walk.unresolved) {
    block(
      `this command changes directory to somewhere the guard cannot name — an expansion, a glob, a bare ` +
        `\`cd\`, or \`cd -\` — and this session declares production data at ${live.root}. The guard cannot ` +
        `tell whether what follows runs inside it, so it refuses. Give the directory literally. ${NO_OVERRIDE}`,
    );
  }

  // 4. Every command on the line gets its own seam, because a prefix assignment binds to
  //    the one command it prefixes.
  //
  //    BASH ONLY, AND DELIBERATELY. This rule exists because a gate cannot see inside a
  //    child process: it refuses when a child would resolve its data through its own
  //    defaults, since the guard has no way to check afterwards. A file tool spawns no
  //    child and passes nothing on. Its target is the single path in the payload, which
  //    rule 5 reads and judges directly, so the rule's own stated rationale does not
  //    reach it. Applying it anyway would also make the block unfixable from inside the
  //    session: what this rule tells you to do is set AEO_DATA_ROOT in
  //    .claude/settings.json, and writing that file is an Edit.
  if (!fileTool) {
    for (const { data, dataSource } of seams) {
      checkSeam(live, data, dataSource);
    }
  }

  // 5. A call that names production data outright, whatever the environment says.
  //
  // ONE DIRECTION ONLY: a named path INSIDE the production root blocks; one that
  // CONTAINS it does not. `rm -rf D:/` names an ancestor of production data and is
  // allowed here. The seam rule twenty lines above tests both directions and this rule
  // deliberately does not, because the other direction is `ls /` and `cd ..`, and a
  // guard that refuses those is a guard that gets deleted. The limit is real: the
  // 19,000-document incident was a sweeper run from the wrong root. What covers it is
  // the seam, which the sweeper reads to decide where to sweep.
  const operationDir = dirs[0] ?? null;
  const liveReal = realise(live.root);
  // A file tool names exactly one location and names it plainly. A Bash command names as
  // many as its tokens do, and which of them is a path has to be guessed at.
  const candidates = fileTool
    ? [toolFilePath(payload)].filter((p) => p !== null)
    : pathCandidates(shellTokens(command));
  for (const candidate of candidates) {
    const named = normalizeHookPath(candidate);
    // A relative token with no directory to resolve against names no location, so there
    // is nothing to test. The environment rule above already governs where the child
    // resolves its own relative paths.
    const resolved = path.isAbsolute(named) ? named : operationDir && path.resolve(operationDir, named);
    if (!resolved) continue;
    if (!isPathInside(liveReal, realise(resolved))) continue;
    block(
      fileTool
        ? `this ${tool} targets ${JSON.stringify(candidate)}, which resolves to ${realise(resolved)}, inside the ` +
            `production data root ${live.root}. Production data is not reachable from a session, reads included: ` +
            `six test call-sites silently reading a live 49,674-entry index is one of the three incidents this ` +
            `gate exists for (L-03). ${NO_OVERRIDE}`
        : `this command names ${JSON.stringify(candidate)}, which resolves to ${realise(resolved)}, inside the ` +
            `production data root ${live.root}. A run pointed at production data is refused. ${NO_OVERRIDE}`,
    );
  }

  // 6. The directory the command runs IN. pathCandidates skips a token with no separator
  //    in it, which is right on its own and a hole in combination with a `cd`: nothing in
  //    `cd corpus && rm -rf index` carries a separator, so the rule above sees no
  //    candidates at all while the command deletes production data. The same is true of a
  //    session whose cwd already sits inside it and types no `cd`, and the Bash tool
  //    persists its working directory between calls, so one `cd corpus` reaches both. The
  //    directory is the claim, and the guard already resolved it.
  //
  //    BASH ONLY, for the reason the rule is stated in: it covers the paths a command
  //    names relatively and the guard therefore cannot see. A file tool names one target
  //    and rule 5 has already judged it, resolved against this same directory when it was
  //    relative. Running this rule as well would refuse a Write to an absolute path
  //    OUTSIDE production data purely because the session happened to be sitting inside
  //    it, and no production data is behind that refusal.
  if (fileTool) return;
  for (const dir of dirs) {
    if (isPathInside(liveReal, realise(dir))) {
      block(
        `this command operates in ${realise(dir)}, inside the production data root ${live.root}. Every ` +
          `relative path it names resolves there, so a run from inside production data is refused. Run it ` +
          `from outside ${live.root}. ${NO_OVERRIDE}`,
      );
    }
  }
}

// Importing this file must not run the gate, so the sentinel writer and the tests can
// use its exports without spawning it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runGate({ name: 'sandbox-guard', run: sandboxGuard });
}
