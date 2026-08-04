// AEO sandbox guard: production data is not reachable from a session, and a live long
// job is not run over.
//
// PreToolUse on Bash. It decides from stdin rather than from an `if:` filter, because
// `if:` fails open on an unparseable command and is never the security boundary (C-04).
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
// Plus the fourth (L-02): because the commit gate runs the test suite, `git commit`
// executes code, and four simultaneous external kills of a live four-hour pipeline were
// traced to a concurrent session's commit gate firing the suite.
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
// The sentinel rule does need to recognise a suite, and it takes that from stack.mjs's
// detection rather than from a table of its own. Its recognition is deliberately generous
// and its misses are backstopped by the commit gate, which refuses to cross a live
// sentinel with no recognition involved at all.
//
// WHO IT APPLIES TO: everyone, the orchestrator included. There is no identity test in
// this file. block-merge exempts the orchestrator because a founder-approved merge is a
// real workflow. A founder-approved run against production data during a live job is not
// one, and the four kills in L-02 came from concurrent sessions rather than from a role.

import { realpathSync, writeSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { block, isPathInside, normalizeHookPath, resolveOperationDir, runGate } from './lib.mjs';
import { projectAnchor, runInProgress } from './sentinel.mjs';
import { resolveTestPlan } from './stack.mjs';

/** The project's declaration of where production data is. Absolute, or the guard blocks. */
export const LIVE_DATA_ROOT_ENV = 'AEO_LIVE_DATA_ROOT';

/** The seam. Where this process tree resolves its data. Inherited by every child. */
export const DATA_ROOT_ENV = 'AEO_DATA_ROOT';

const NO_OVERRIDE =
  'There is no override flag. That is deliberate (L-05): an override is what you reach for at 2am.';

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
 * The declared command reduced to the tokens worth matching on.
 *
 * Flags, glob arguments and relative path arguments are dropped: `go test ./...` is the
 * same invocation as `go test ./pkg`, and a gate keyed on `./...` would miss the second.
 * When nothing survives, a path-shaped program keeps its basename, so
 * `vendor/bin/phpunit` still matches a bare `phpunit`.
 */
function significantTokens(command) {
  const kept = command.filter((t) => !t.startsWith('-') && !/^\.{1,2}[\\/]/.test(t) && !t.includes('*'));
  const plain = kept.filter((t) => !/[\\/]/.test(t));
  return plain.length > 0 ? plain : kept.map((t) => path.basename(t));
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
 * catches `npm test` and `uv run pytest`. Or its final program token alone, which
 * catches a bare `pytest -k x` in a project whose declared command wraps it.
 *
 * The second form is deliberately generous. Where a project's declared command ends in a
 * script name rather than a program name, `npm test` being the case, this also matches a
 * command that merely contains the word `test`. During a live long job that costs a
 * clear message on a rare command; the alternative is a miss on the case the rule exists
 * for. Over-blocking is the direction to be wrong in here.
 */
export function invokesDeclaredSuite(tokens, declared) {
  for (const command of declared) {
    const wanted = significantTokens(command);
    if (wanted.length === 0) continue;
    if (isOrderedSubsequence(tokens, wanted) || tokens.includes(wanted[wanted.length - 1])) {
      return command.join(' ');
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
  return { set: true, raw, root: path.isAbsolute(normalised) ? normalised : null };
}

/**
 * Where production data is, and where this command's data will resolve.
 *
 * An inline `AEO_DATA_ROOT=...` in the command wins over the inherited value, because
 * that is what the child will see. The last assignment wins, which is the shell's own
 * rule. This is the sanctioned way to redirect one command inside a session: it is
 * visible in the command string and the guard validates it like any other value.
 */
export function resolveRoots({ command = '', env = process.env, platform = process.platform } = {}) {
  const live = readRoot(env?.[LIVE_DATA_ROOT_ENV], platform);

  let inline = null;
  for (const token of shellTokens(command)) {
    if (token.startsWith(`${DATA_ROOT_ENV}=`)) inline = token.slice(DATA_ROOT_ENV.length + 1);
  }
  const data = readRoot(inline ?? env?.[DATA_ROOT_ENV], platform);
  return { live, data, dataSource: inline === null ? 'session environment' : 'the command' };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Every directory this call could operate in, absolute, nearest first.
 *
 * resolveOperationDir prefers a leading `cd <dir> &&` because a PreToolUse hook sees the
 * command before it runs (V-02). That target is frequently relative, and isPathInside
 * would resolve a relative path against the HOOK's working directory, which is not
 * anywhere the command will be. So it is resolved against the session's own cwd, and
 * both are returned: `cd elsewhere && npm test` still burns this machine while a job is
 * live here, so a sentinel in either project is a sentinel worth honouring.
 */
function operationDirs(payload) {
  const base = typeof payload?.cwd === 'string' ? normalizeHookPath(payload.cwd.trim()) : '';
  const { dir } = resolveOperationDir(payload);
  const out = [];
  for (const candidate of [dir, base]) {
    if (typeof candidate !== 'string' || candidate === '') continue;
    if (path.isAbsolute(candidate)) out.push(candidate);
    else if (path.isAbsolute(base)) out.push(path.resolve(base, candidate));
  }
  return [...new Set(out)];
}

/** @param {object} payload */
export function sandboxGuard(payload) {
  const command = typeof payload?.tool_input?.command === 'string' ? payload.tool_input.command : '';
  const tokens = shellTokens(command);

  // 1. A live long job (L-02). Read first and read cheaply: no git process, one readdir,
  //    and nothing else happens until a sentinel is actually present.
  const dirs = operationDirs(payload);
  const anchors = [...new Set(dirs.map(projectAnchor).filter((a) => a !== null))];
  for (const anchor of anchors) {
    const { reason, notes } = runInProgress(anchor);
    for (const line of notes) note(`sandbox-guard: ${line}`);
    if (reason === null) continue;
    const declared = resolveTestPlan({ toplevel: anchor, files: [] })
      .units.map((u) => u.command)
      .filter((c) => Array.isArray(c));
    const invoked = invokesDeclaredSuite(tokens, declared);
    if (invoked !== null) block(`\`${invoked}\` will not run: ${reason}\n${NO_OVERRIDE}`);
  }

  // 2. The seam (L-03). Everything below needs a declared production data root; without
  //    one the project has told the guard nothing to protect, and there is nothing here
  //    to be ambiguous about.
  const { live, data, dataSource } = resolveRoots({ command, env: process.env });
  if (!live.set) return;

  if (live.root === null) {
    block(
      `${LIVE_DATA_ROOT_ENV} is set to ${JSON.stringify(live.raw)}, which is not an absolute path, so the ` +
        `sandbox guard cannot tell production data from a sandbox and refuses every command. Set it to the ` +
        `absolute path of the production data directory, or unset it. ${NO_OVERRIDE}`,
    );
  }

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

  // 3. A command that names production data outright, whatever the environment says.
  const operationDir = dirs[0] ?? null;
  const liveReal = realise(live.root);
  for (const candidate of pathCandidates(tokens)) {
    const named = normalizeHookPath(candidate);
    // A relative token with no directory to resolve against names no location, so there
    // is nothing to test. The environment rule above already governs where the child
    // resolves its own relative paths.
    const resolved = path.isAbsolute(named) ? named : operationDir && path.resolve(operationDir, named);
    if (!resolved) continue;
    if (isPathInside(liveReal, realise(resolved))) {
      block(
        `this command names ${JSON.stringify(candidate)}, which resolves to ${realise(resolved)}, inside the ` +
          `production data root ${live.root}. A run pointed at production data is refused. ${NO_OVERRIDE}`,
      );
    }
  }
}

// Importing this file must not run the gate, so the sentinel writer and the tests can
// use its exports without spawning it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runGate({ name: 'sandbox-guard', run: sandboxGuard });
}
