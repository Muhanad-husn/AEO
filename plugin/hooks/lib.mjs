// AEO hook runtime: the shared library every gate sits on.
//
// Why this exists (V-13): the v2 PowerShell harness dropped its shared library and
// its tests. Four standalone scripts each re-implemented stdin parsing and worktree
// resolution, and the same worktree fix then had to be found three times and still
// never landed in one of the three. One tested library is the fix. Every gate imports
// this; no gate re-derives any of it.
//
// Three contracts every gate obeys.
//
// 1. THE BLOCK PATH. A gate never calls process.exit. It calls block(reason), which
//    throws, or it returns. runGate owns the only exit(2) in the plugin. Exit 2 is the
//    hard block and stays the hard block (C-06); every other non-zero exit is a
//    NON-blocking error, meaning the tool call proceeds and the gate has failed open.
//    So runGate never exits with anything but 0 or 2, and an internal error becomes an
//    explicit block rather than an accidental open door. That holds for the crash paths
//    a try/catch cannot see as well, which is what the two handlers in runGate are for.
//    Two cases sit outside it and are pinned by tests rather than claimed as covered:
//    a gate file that crashes at module scope before runGate is entered, and a gate
//    that breaks the contract above and calls process.exit itself.
//
// 2. IDENTITY IS WHOLE-TOKEN OR WHOLE-SEGMENT, NEVER SUBSTRING (V-12). An argv identity
//    test goes through matchesGitSubcommand; a path containment test goes through
//    isPathInside. `git merge-base` is not `git merge`, and D:/project is not inside
//    D:/proj. Both bugs have been paid for.
//
// 3. agent_type IS NOT A SUBAGENT FLAG (C-02). It is also set when a main session runs
//    with --agent, and a plugin subagent reports a namespaced name (aeo:builder). Test
//    isAeoRole/isAnyAeoRole, never presence. Presence blocks the orchestrator's own
//    approved merge path; the bare name never fires.
//
// Node built-ins only, no dependencies, no install step.
//
// Encoding note (L-09): all output goes through fs.writeSync on the raw fd as UTF-8
// bytes. None of the five PowerShell encoding incidents can recur here. There is no
// console codepage, no *>> redirection and no ${var}: parsing hazard.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeSync } from 'node:fs';
import path from 'node:path';

/** The plugin's namespace. Plugin subagents report `<namespace>:<role>` (C-02). */
export const PLUGIN_NAMESPACE = 'aeo';

/**
 * The one-line banner a shell fallback prints when `node` itself does not resolve.
 *
 * A Node script cannot report that Node is missing. The only mitigation that survives
 * a missing runtime is a non-Node fallback in the hooks.json command string:
 *
 *   node "${CLAUDE_PLUGIN_ROOT}/hooks/session-status.mjs" || echo "<this string>"
 *
 * It is deliberately one line with no quotes, `$`, or backticks so it survives sh,
 * cmd.exe and pwsh quoting unchanged. Exported so hooks.json and its test share one
 * source of truth for a string that must be byte-identical in both.
 */
export const RUNTIME_MISSING_BANNER =
  '[AEO] GATES NOT ENFORCING: node did not resolve, so every AEO hook fails open. Install Node 18+ on PATH and restart Claude Code.';

const MIN_NODE_MAJOR = 18; // Node 18 is the plugin's stated prerequisite (D8): ESM and node:test.

// ---------------------------------------------------------------------------
// The block path
// ---------------------------------------------------------------------------

class BlockDecision extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'BlockDecision';
    this.reason = reason;
  }
}

// Latched as well as thrown. A gate that wraps its own body in try/catch would
// otherwise swallow the throw and fall through to allow. That is the exact accident
// this library exists to make impossible. runGate checks the latch before allowing.
let blockLatched = null;

/**
 * Block the tool call. Throws; never returns. Safe to call without `return`.
 * @param {string} reason Stated to the model on stderr, prefixed with `BLOCKED: `.
 * @returns {never}
 */
export function block(reason) {
  blockLatched = String(reason ?? 'blocked');
  throw new BlockDecision(blockLatched);
}

function finish(code, message) {
  if (message) {
    try {
      writeSync(2, message.endsWith('\n') ? message : `${message}\n`);
    } catch {
      // A failed stderr write must not turn a block into an open gate.
    }
  }
  process.exit(code);
}

const CANNOT_DECIDE =
  'A gate that cannot decide does not pass the call. Fix the gate, or ask the orchestrator.';

/**
 * A printable description of a thrown value, for a value that need not be an Error.
 *
 * Reading `err.message` directly is the obvious form and it is a fail-open defect. On
 * `throw null` or a bare `Promise.reject()` it raises a TypeError INSIDE the catch
 * handler, where nothing catches it. Node then exits 1, exit 1 is a non-blocking error
 * (C-06), and the tool call proceeds. The gate fails open in the one function that owns
 * every exit. `throw 'a string'` is the same mistake in a quieter register: it exits 2,
 * but reports the reason as `undefined` and loses what went wrong.
 *
 * So every read here is defended, a hostile `message` getter included. This runs on the
 * block path, and code on the block path is not allowed to throw.
 */
function describeError(err) {
  try {
    if (err instanceof Error) {
      const message = err.message;
      if (typeof message === 'string' && message !== '') return message;
    }
    if (typeof err === 'string' && err !== '') return err;
    if (err === null) return 'null was thrown';
    if (err === undefined) return 'nothing was thrown with the rejection';
    const text = String(err);
    return text === '' ? 'unprintable thrown value' : text;
  } catch {
    return 'unprintable thrown value';
  }
}

async function readStdin() {
  // A hook always receives its payload on stdin. A TTY means it was run by hand;
  // reading would hang. Hang protection otherwise belongs to hooks.json `timeout`,
  // not to a constant invented here.
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Entry point for a blocking gate. Reads and parses the payload, runs the gate, and
 * owns every exit.
 *
 * Malformed or empty payload => allow, with a line on stderr. The model cannot cause
 * this: Claude Code serializes the payload, and every model-controlled string sits
 * inside valid JSON. A parse failure is a platform fault, not a bypass, so blocking
 * would brick the session for no security gain. The PowerShell originals allowed too,
 * but silently, so a payload-shape change would have disabled every gate with no signal
 * (L-08, "an unset threshold makes a gate silently skip"). The stderr line is the loud
 * skip.
 *
 * Internal error after a readable payload => block. The gate had a decision to make
 * and could not make it; a gate that cannot decide does not pass the call.
 *
 * @param {{name: string, run: (payload: object) => unknown}} spec
 */
export async function runGate({ name, run }) {
  // Any exit code other than 0 or 2 is a non-blocking error (C-06), so any crash Node
  // would report as exit 1 is a gate failing open. try/catch around `run` covers the
  // synchronous and awaited paths. These two handlers cover the rest: a floating
  // promise rejection, and a throw from a timer or a callback the gate left running.
  // Both become the same explicit block.
  const crash = (err) => finish(2, `BLOCKED: the ${name} gate crashed (${describeError(err)}). ${CANNOT_DECIDE}`);
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);

  let payload;
  try {
    const raw = await readStdin();
    if (!raw.trim()) {
      return finish(0, `${name}: empty hook payload; nothing to judge, allowing.`);
    }
    payload = JSON.parse(raw);
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('payload is not a JSON object');
    }
  } catch (err) {
    return finish(0, `${name}: unreadable hook payload (${describeError(err)}); allowing.`);
  }

  try {
    await run(payload);
  } catch (err) {
    if (err instanceof BlockDecision) return finish(2, `BLOCKED: ${err.reason}`);
    return finish(
      2,
      `BLOCKED: the ${name} gate could not evaluate this call (${describeError(err)}). ${CANNOT_DECIDE}`,
    );
  }

  if (blockLatched !== null) return finish(2, `BLOCKED: ${blockLatched}`);
  return finish(0, null);
}

/**
 * Entry point for a hook that reports and never blocks (SessionStart, P1.7). Whatever
 * happens, the exit code is 0. `run` returns the text to place on stdout; a returned
 * empty value writes nothing. Making non-blocking structural rather than a promise is
 * the point: P1.7's stated must-not is "block anything".
 *
 * @param {{name: string, run: (payload: object|null) => unknown}} spec
 */
export async function runReporter({ name, run }) {
  // The same asynchronous crash paths runGate defends against, resolved the other way.
  // Without these, a floating rejection in a reporter exits 1 and the doc comment above
  // is not true. Exit 1 does not block anything, so this costs a hook-error notice
  // rather than a session, but the contract says 0 and the contract should hold.
  const crash = (err) => {
    try {
      writeSync(2, `${name}: report crashed (${describeError(err)}); continuing.\n`);
    } catch {
      // Nowhere left to say it. Exit 0 regardless; a reporter never costs a session.
    }
    process.exit(0);
  };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);

  let out = '';
  try {
    let payload = null;
    try {
      const raw = await readStdin();
      if (raw.trim()) payload = JSON.parse(raw);
    } catch {
      payload = null; // A reporter reports what it can; an unreadable payload is not fatal.
    }
    const text = await run(payload);
    if (typeof text === 'string') out = text;
  } catch (err) {
    // Never costs a session. The name is included so a silently empty report is
    // attributable when someone goes looking.
    try {
      writeSync(2, `${name}: report failed (${describeError(err)}); continuing.\n`);
    } catch {
      // stderr is gone too, so there is nowhere left to say it. A reporter is never
      // allowed to cost a session, so this is where the attempt stops.
    }
  }
  if (out) {
    try {
      writeSync(1, out.endsWith('\n') ? out : `${out}\n`);
    } catch (err) {
      // Loud skip, never a quiet pass (L-08). The report this drops is D8's only
      // signal that the gates are not enforcing, so losing it has to be said somewhere
      // rather than swallowed.
      try {
        writeSync(2, `${name}: report could not be written to stdout (${describeError(err)}).\n`);
      } catch {
        // Both streams are unwritable. Nothing left to report with, and still not fatal.
      }
    }
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Identity (C-02)
// ---------------------------------------------------------------------------

/** The raw `agent_type`, trimmed, or null. For messages, never for a policy test. */
export function agentIdentity(payload) {
  const value = payload?.agent_type;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** True only for exactly this plugin's `<namespace>:<role>`. Anchored, role escaped. */
export function isAeoRole(payload, role) {
  const id = agentIdentity(payload);
  if (id === null) return false;
  return new RegExp(`^${escapeRegExp(PLUGIN_NAMESPACE)}:${escapeRegExp(role)}$`).test(id);
}

/** True for any subagent this plugin ships. A bare `builder` from --agent is not one. */
export function isAnyAeoRole(payload) {
  const id = agentIdentity(payload);
  if (id === null) return false;
  return new RegExp(`^${escapeRegExp(PLUGIN_NAMESPACE)}:[a-z][a-z0-9._-]*$`).test(id);
}

// ---------------------------------------------------------------------------
// Identity matching (V-12)
// ---------------------------------------------------------------------------

/**
 * True when `command` invokes `git <sub>` as a whole token, allowing git's own
 * pre-subcommand options. The trailing lookahead is load-bearing: without it `merge`
 * matches `git merge-base`, which is read-only, and `commit` matches `git commit-tree`.
 * The option prefix is equally load-bearing: without it `git -C <dir> merge` is missed
 * (V-02). Ported from the live block-merge/commit-gate matcher, not the skill's.
 */
export function matchesGitSubcommand(command, sub) {
  if (typeof command !== 'string' || command === '') return false;
  const pattern = String.raw`\bgit\s+((-C|-c)\s+\S+\s+|-\S+\s+)*` + escapeRegExp(sub) + String.raw`(?![-\w])`;
  return new RegExp(pattern).test(command);
}

/**
 * True when `child` is `parent` or lies under it, compared by whole path segment.
 * The trailing-separator rule is the point: D:/project is not inside D:/proj.
 * Case-insensitive on Windows, where the filesystem is.
 */
export function isPathInside(parent, child) {
  const a = canonicalise(parent);
  const b = canonicalise(child);
  if (a === null || b === null) return false;
  if (a === b) return true;
  return b.startsWith(a.endsWith('/') ? a : `${a}/`);
}

function canonicalise(p) {
  if (typeof p !== 'string' || p.trim() === '') return null;
  try {
    let s = path.resolve(p).replace(/\\/g, '/');
    s = s.replace(/(.)\/+$/, '$1'); // drop trailing separators, but keep a bare root
    if (process.platform === 'win32') s = s.toLowerCase();
    return s;
  } catch {
    return null;
  }
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Shell segmentation
// ---------------------------------------------------------------------------
//
// WHY THIS EXISTS. Two gate rules used to reason about a Bash command as one string while
// the shell runs it as a SEQUENCE of commands, and both leaked in the same way. The
// operation-directory rule matched `cd X &&` and nothing else, so `cd prod ; rm -rf
// corpus`, a newline, `pushd`, `cd -- prod` and `( cd prod && … )` each deleted production
// data and exited 0. The sandbox guard's seam rule took the last leading `NAME=value`
// anywhere on the line and applied it to every command on that line, so
// `AEO_DATA_ROOT=<sandbox> npm run build && npm test` ran the suite against production —
// a prefix assignment binds to the single command it prefixes and the shell carries it no
// further. Two rounds of patching added a pattern per reported shape and left the
// neighbouring shapes open. One segmenter, shared by both rules, is what stops a sixth
// separator from becoming a sixth patch.
//
// WHAT IT IS NOT. Not a shell. It reads quoting, operators, redirections and heredocs,
// which is exactly what "where does one command end" needs, and nothing more. What it
// cannot read confidently — an unterminated quote, a backtick, an unterminated heredoc —
// it reports as an error rather than guessing at, and a gate that fails closed blocks on
// that. An unparseable command is not a safe command.

/** A `NAME=value` assignment, which in leading position sets one child's environment. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The commands that move the shell. `popd` is not one: it needs a stack we cannot see. */
const DIR_CHANGERS = new Set(['cd', 'pushd']);

// The operators after which a `cd` in the preceding command is still in effect. `||` runs
// its right side only when the cd FAILED; `|` and `&` put each side in its own subshell.
// In all three the next command runs where the previous one started. The empty string is
// end-of-command, which survives because the Bash tool persists its working directory
// between calls, and `)` survives only until the subshell scope is popped below.
const CD_SURVIVES = new Set(['&&', ';', '\n', ')', '']);

/** Words that are grammar rather than a program. `{ cd x; }` must still read as a cd. */
const NOT_A_PROGRAM = new Set(['{', '}', '!', 'time', 'do', 'then', 'else']);

/** The characters a backslash may escape. A backslash before anything else is a byte. */
const ESCAPABLE = new Set(['"', "'", '`', '$', ' ', '\t', '&', '|', ';', '(', ')', '<', '>']);

/**
 * Skip a heredoc body, which is data and must never reach leading position: without this
 * a `<<EOF` body line spelling `AEO_DATA_ROOT=<sandbox>` reads as a prefix assignment.
 * Returns the offset after the terminator line, or null when there is no terminator.
 */
function skipHeredoc(text, from, { delimiter, strip }) {
  let i = from;
  for (;;) {
    let eol = text.indexOf('\n', i);
    const last = eol === -1;
    if (last) eol = text.length;
    let line = text.slice(i, eol).replace(/\r$/, '');
    if (strip) line = line.replace(/^\t+/, '');
    if (line === delimiter) return last ? text.length : eol + 1;
    if (last) return null;
    i = eol + 1;
  }
}

/**
 * The words and command-separating operators the shell would see, or null when the text
 * cannot be read confidently. A word carries `target: true` when it is a redirection
 * destination rather than an argument, so `> out.txt` cannot be mistaken for a program.
 */
function scanShell(command) {
  const items = [];
  let word = null;
  let nextIsTarget = false;
  const heredocs = [];

  const add = (s) => { word = (word ?? '') + s; };
  const flush = () => {
    if (word === null) return;
    items.push({ word, target: nextIsTarget });
    nextIsTarget = false;
    word = null;
  };
  const op = (value) => { flush(); items.push({ op: value }); };

  let i = 0;
  const n = command.length;
  while (i < n) {
    const c = command[i];

    // A backslash escapes only what the shell would otherwise read as syntax. Everything
    // else keeps it, because on this platform a backslash is a path separator far more
    // often than an escape: consuming it turns `cd D:\other\wt` into `D:otherwt` and a
    // UNC target into nonsense, and both are ordinary here (L-09).
    if (c === '\\') {
      if (i + 1 >= n) { add('\\'); i += 1; continue; }
      if (command[i + 1] === '\n') { i += 2; continue; } // line continuation
      if (ESCAPABLE.has(command[i + 1])) { add(command[i + 1]); i += 2; continue; }
      add(c);
      i += 1;
      continue;
    }

    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1) return null;
      add(command.slice(i + 1, end));
      i = end + 1;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      let buf = '';
      for (;;) {
        if (j >= n) return null;
        if (command[j] === '\\' && command[j + 1] === '"') { buf += '"'; j += 2; continue; }
        if (command[j] === '"') break;
        buf += command[j];
        j += 1;
      }
      add(buf);
      i = j + 1;
      continue;
    }

    // A backtick substitution is a command we would have to read recursively. We do not,
    // so we say so rather than guess.
    if (c === '`') return null;

    if (c === '\n') {
      op('\n');
      i += 1;
      let skipped = false;
      while (heredocs.length > 0) {
        const next = skipHeredoc(command, i, heredocs.shift());
        if (next === null) return null;
        i = next;
        skipped = true;
      }
      // The terminator line's own newline was consumed above; put the boundary back.
      if (skipped) items.push({ op: '\n' });
      continue;
    }

    if (c === ' ' || c === '\t' || c === '\r') { flush(); i += 1; continue; }

    if (c === '<' || c === '>' || (c === '&' && command[i + 1] === '>')) {
      const rest = command.slice(i);
      if (rest.startsWith('<<') && !rest.startsWith('<<<')) {
        const m = /^<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_.-]*)\2/.exec(rest);
        if (!m) return null;
        flush();
        heredocs.push({ delimiter: m[3], strip: m[1] === '-' });
        i += m[0].length;
        continue;
      }
      const m = /^(?:&>>|&>|<<<|>>|>\||<>|[<>]&\s*[0-9-]+|[<>]&|>|<)/.exec(rest);
      if (m) {
        if (word !== null && /^\d+$/.test(word)) word = null; // the fd in `2>&1`, not a word
        flush();
        nextIsTarget = !/^[<>]&\s*[0-9-]+$/.test(m[0]);
        i += m[0].length;
        continue;
      }
    }

    if (c === '&' && command[i + 1] === '&') { op('&&'); i += 2; continue; }
    if (c === '|' && command[i + 1] === '|') { op('||'); i += 2; continue; }
    if (c === '|') { op('|'); i += command[i + 1] === '&' ? 2 : 1; continue; }
    if (c === '&') { op('&'); i += 1; continue; }
    if (c === ';') { let j = i; while (command[j] === ';') j += 1; op(';'); i = j; continue; }
    if (c === '(' || c === ')') { op(c); i += 1; continue; }

    add(c);
    i += 1;
  }
  flush();
  return items;
}

/**
 * The command split into the segments the shell will execute as separate commands.
 *
 * Each segment carries every word it contains, the `NAME=value` assignments in its leading
 * position, the program it runs, that program's arguments, and the operator that follows
 * it. `error` is non-null when the command could not be read; `segments` is then empty and
 * the caller decides, which for a fail-closed gate means blocking.
 *
 * @returns {{segments: Array<{tokens: string[], assignments: string[], program: string|null, args: string[], followedBy: string}>, error: string|null}}
 */
export function commandSegments(command) {
  if (typeof command !== 'string' || command.trim() === '') return { segments: [], error: null };
  const items = scanShell(command);
  if (items === null) {
    return {
      segments: [],
      error:
        'it could not be read as a sequence of shell commands (an unterminated quote, a backtick substitution, ' +
        'or an unterminated heredoc)',
    };
  }

  const segments = [];
  let current = { tokens: [], assignments: [], program: null, args: [], followedBy: '' };
  for (const item of items) {
    if (item.op !== undefined) {
      current.followedBy = item.op;
      segments.push(current);
      current = { tokens: [], assignments: [], program: null, args: [], followedBy: '' };
      continue;
    }
    current.tokens.push(item.word);
    if (item.target) continue; // a redirection destination runs nothing and assigns nothing
    if (NOT_A_PROGRAM.has(item.word)) continue;
    if (current.program !== null) current.args.push(item.word);
    else if (ASSIGNMENT.test(item.word)) current.assignments.push(item.word);
    else if (!item.word.startsWith('-')) current.program = item.word;
  }
  segments.push(current);
  return { segments, error: null };
}

/**
 * The directory a segment moves the shell to: a string, `null` when it is a `cd` whose
 * target cannot be known, or `undefined` when it is not a `cd` at all.
 *
 * `null` covers a bare `cd`, `cd -`, and a target carrying an expansion or a glob. Each is
 * a directory this gate cannot name, and naming it is the whole job.
 */
function segmentCdTarget(segment) {
  if (segment.program === null || !DIR_CHANGERS.has(segment.program)) return undefined;
  const args = [...segment.args];
  while (args.length > 0 && args[0].startsWith('-')) {
    if (args.shift() === '--') break;
  }
  const target = args[0];
  if (target === undefined || target === '') return null;
  return /[$*?]/.test(target) ? null : target;
}

// ---------------------------------------------------------------------------
// Worktree resolution
// ---------------------------------------------------------------------------

/**
 * `/d/proj` -> `D:/proj`. Windows only: on POSIX, `/d/proj` is a real path.
 *
 * A session-provided cwd can arrive in MSYS form, which `git -C` cannot consume
 * (L-09). The drive letter must be followed by `/` or end-of-string, so `/tmp` and
 * `/usr` are not drives and pass through untouched. Already-Windows paths pass through.
 */
export function normalizeHookPath(p, { platform = process.platform } = {}) {
  if (typeof p !== 'string' || p === '') return p;
  if (platform !== 'win32') return p;
  const m = /^\/([A-Za-z])(\/.*)?$/.exec(p);
  if (!m) return p;
  return `${m[1].toUpperCase()}:${m[2] || '/'}`;
}

/**
 * The directory a tool call actually operates in, and where that came from.
 *
 * The order is not arbitrary; each step was paid for by an incident.
 *
 * 1. A `cd` or `pushd` that the shell would still have in effect when the command runs.
 *    Taken from commandSegments, so every separator the shell honours is honoured here:
 *    `&&`, `;`, a newline and a subshell, and NOT `||`, `|` or `&`, after which the next
 *    command runs where the previous one started. Matching only `cd X &&` is what let
 *    `cd prod ; rm -rf corpus` through. A PreToolUse hook inspects the call BEFORE the
 *    command body runs, so the in-command `cd` is not yet in effect. For a subagent the
 *    reported cwd is unreliable on top of that, often pinned to the launch checkout on
 *    the default branch. A feature-worktree commit was blocked as "on main" because of
 *    it, and the same bug then recurred in the push path (V-02).
 * 2. `payload.cwd`, the tool call's own declared directory.
 * 3. `CLAUDE_PROJECT_DIR`, which is session-fixed and so is wrong for every worktree
 *    session. Third for that reason, not second.
 * 4. `process.cwd()`. The PowerShell fell back to the hook script's grandparent; in a
 *    plugin that is the ephemeral plugin cache (C-09, D12), which would resolve gates
 *    against the wrong repo entirely. Deliberately not ported.
 *
 * A `cd` TARGET IS RESOLVED AGAINST `payload.cwd`, so `dir` from that step is absolute
 * or null, never relative. Consumers hand `dir` to `git -C`, which resolves a relative
 * path against the HOOK process's working directory, and the hook is not running where
 * the command will. `cd ../wt-2 && git commit` therefore inspected whichever repository
 * sat beside the hook: the commit gate read a different project's run-in-progress
 * sentinel, so L-02's protection evaluated a tree nobody was committing to. P1.5 found
 * this and fixed it inside sandbox-guard only, leaving the other three consumers with
 * it, which is V-13 recurring inside the library built to stop it.
 *
 * A relative target with no absolute `payload.cwd` is a RESOLUTION FAILURE, not a
 * fall-through: `{dir: null, source: 'cd'}`. Steps 3 and 4 are session-fixed, so
 * substituting one would hand a gate a real repository that is not the one the command
 * names, and it would enforce confidently against the wrong tree. A null makes every
 * consumer stop and say so. `source` stays `cd` so the failure is attributable to the
 * command rather than reading as "nothing was found anywhere".
 *
 * @returns {{dir: string|null, source: 'cd'|'payload.cwd'|'CLAUDE_PROJECT_DIR'|'process.cwd'|'none'}}
 */
export function resolveOperationDir(payload, options) {
  const { dir, source } = walkOperation(payload, options);
  return { dir, source };
}

/**
 * Every directory this call could operate in, plus whether the walk was able to name them
 * all.
 *
 * The sandbox guard needs the whole set rather than one answer: `cd elsewhere && npm test`
 * still burns this machine while a job is live here. `unresolved` is true when a `cd`
 * target could not be named or the command could not be parsed, and a fail-closed gate
 * blocks on it rather than enforcing against the directories it did manage to see.
 *
 * @returns {{dirs: string[], unresolved: boolean, parseError: string|null}}
 */
export function operationDirs(payload, options) {
  const w = walkOperation(payload, options);
  const dirs = [...w.dirs, w.dir].filter((d) => typeof d === 'string' && d !== '');
  return { dirs: [...new Set(dirs)], unresolved: w.unresolved, parseError: w.parseError };
}

function resolveCdTarget(target, current, p, platform) {
  // MSYS form before absoluteness: `/d/proj` is not a drive to path.win32 until it is
  // `D:/proj`, so testing first would discard a usable base.
  const t = normalizeHookPath(target, { platform });
  if (p.isAbsolute(t)) return t;
  if (current === null || !p.isAbsolute(current)) return null;
  const resolved = p.resolve(current, t);
  // Separators unify only on win32, where both are separators. On POSIX a backslash is an
  // ordinary character in a directory name.
  return platform === 'win32' ? resolved.replace(/\\/g, '/') : resolved;
}

function walkOperation(payload, { env = process.env, cwd = process.cwd, platform = process.platform } = {}) {
  // The target platform's path rules, not the host's, so a target is judged the way
  // `git -C` would judge it and the tests are not host-dependent.
  const p = platform === 'win32' ? path.win32 : path.posix;
  const base = normalizeHookPath(typeof payload?.cwd === 'string' ? payload.cwd.trim() : '', { platform });
  const rawCommand = payload?.tool_input?.command;
  const { segments, error } = commandSegments(typeof rawCommand === 'string' ? rawCommand : '');

  const dirs = [];
  let current = base === '' ? null : base;
  let operationDir;
  let fromCd = false;
  let cdApplied = false;
  let unresolved = error !== null;
  const scopes = [];

  for (const segment of segments) {
    if (segment.tokens.length > 0) dirs.push(current);
    const target = segmentCdTarget(segment);
    if (target !== undefined) {
      if (CD_SURVIVES.has(segment.followedBy)) {
        const moved = target === null ? null : resolveCdTarget(target, current, p, platform);
        if (moved === null) unresolved = true;
        current = moved;
        cdApplied = true;
        dirs.push(current);
      }
    } else if (segment.tokens.length > 0 && operationDir === undefined) {
      operationDir = current;
      fromCd = cdApplied;
    }
    // A subshell's `cd` dies with the subshell, so `(` banks the outer directory and `)`
    // restores it. Without this, `( cd prod && rm -rf x ) && ls` would report `ls` as
    // running in prod.
    if (segment.followedBy === '(') scopes.push(current);
    else if (segment.followedBy === ')' && scopes.length > 0) current = scopes.pop();
  }
  if (operationDir === undefined && segments.length > 0) {
    operationDir = current;
    fromCd = cdApplied;
  }

  const keep = [...new Set(dirs.filter((d) => typeof d === 'string' && d !== ''))];
  // A `cd` that took effect is the answer, null included: the remaining steps are
  // session-fixed directories, so substituting one would hand a gate a real repository
  // that is not the one the command names, and it would enforce confidently against the
  // wrong tree. `source` stays `cd` so the failure is attributable to the command rather
  // than reading as "nothing was found anywhere".
  if (fromCd) return { dir: operationDir ?? null, source: 'cd', dirs: keep, unresolved, parseError: error };

  const fromPayload = typeof payload?.cwd === 'string' ? payload.cwd.trim() : '';
  if (fromPayload) {
    return { dir: normalizeHookPath(fromPayload, { platform }), source: 'payload.cwd', dirs: keep, unresolved, parseError: error };
  }

  const fromEnv = typeof env?.CLAUDE_PROJECT_DIR === 'string' ? env.CLAUDE_PROJECT_DIR.trim() : '';
  if (fromEnv) {
    return { dir: normalizeHookPath(fromEnv, { platform }), source: 'CLAUDE_PROJECT_DIR', dirs: keep, unresolved, parseError: error };
  }

  const fromProcess = typeof cwd === 'function' ? cwd() : '';
  if (fromProcess) {
    return { dir: normalizeHookPath(fromProcess, { platform }), source: 'process.cwd', dirs: keep, unresolved, parseError: error };
  }

  return { dir: null, source: 'none', dirs: keep, unresolved, parseError: error };
}

/**
 * resolveOperationDir, then normalised to the git toplevel of that directory, so a
 * branch check and a test run both target the tree actually being operated on.
 * `toplevel` is null when the directory is not inside a git worktree.
 *
 * @returns {{dir: string|null, source: string, toplevel: string|null}}
 */
export function resolveWorktree(payload, options) {
  const resolved = resolveOperationDir(payload, options);
  return { ...resolved, toplevel: resolved.dir ? gitToplevel(resolved.dir) : null };
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

/** Run git in `dir`. Returns trimmed stdout, or null on any failure. Never throws. */
export function git(dir, ...args) {
  if (!dir) return null;
  let result;
  try {
    result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true });
  } catch {
    return null;
  }
  if (result.error || result.status !== 0) return null;
  const out = (result.stdout ?? '').trim();
  return out === '' ? null : out;
}

/** The git toplevel of `dir`, or null. */
export function gitToplevel(dir) {
  return git(dir, 'rev-parse', '--show-toplevel');
}

/**
 * The checked-out branch name of `dir`, or null.
 *
 * On a detached HEAD this returns the literal string `HEAD`, which is what
 * `rev-parse --abbrev-ref` reports and is passed through unchanged. No consumer needs
 * a different answer yet, so nothing normalises it. A gate comparing this against the
 * default branch is therefore correct on a detached HEAD (it is not on the default
 * branch), while a gate that wants to refuse detached HEAD outright has to test for
 * the literal itself. If a second consumer ever wants it normalised, the
 * normalisation belongs here rather than in the gate.
 */
export function currentBranch(dir) {
  return git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
}

// Cached per process, which is per hook invocation, not per session (D14). Keyed by
// directory so a hook that inspects two worktrees gets two answers. `null` is a real
// answer here, not a miss, and is cached like any other.
const defaultBranchCache = new Map();

// The names a repository with no remote is allowed to be read as protecting. D14 names
// all three as the cases it exists for. A list of names does rot, so it is only ever
// consulted after the repository's own two authoritative statements have said nothing,
// and only when exactly one of them exists.
const CONVENTIONAL_DEFAULTS = ['main', 'master', 'trunk'];

/** What a gate tells the user when defaultBranch returns null. */
export const DEFAULT_BRANCH_UNRESOLVED =
  'Point origin at it with `git remote set-head origin -a`, or, in a repository with no remote, state it with `git config init.defaultBranch <name>` inside this repository.';

/**
 * The repository's default branch (D14), or null when the repository does not say.
 *
 * `main` is matched by no gate as a literal: a repo on `master` or `trunk` must gate
 * identically or the merge guard silently no-ops for the first external user.
 *
 * D14 specifies origin's HEAD, then the local default, then the literal `main`. Two of
 * those three steps were wrong in a way that inverted the decision D14 exists to make,
 * so both changed here.
 *
 * `git config --get init.defaultBranch`, unqualified, reads system and global scope.
 * That setting is a creation-time preference about the repos this machine makes NEXT,
 * not a statement about this one. On a machine whose system config says `master`, a
 * real repo on `main` with no origin resolved to `master`, and a gate comparing `main`
 * against `master` never fired: a direct commit of code on `main` was allowed. It also
 * made the `main` last resort unreachable on any machine that sets the key at all. The
 * read is now `--local`, so it answers only when this repository itself was configured.
 *
 * The `main` last resort is gone. Returning a guess makes a gate that cannot tell what
 * it is protecting behave exactly like one that can, and the guess is wrong precisely
 * in the repos D14 was written for. What replaces it is evidence the repository really
 * does carry: its own branches. One branch is the default branch. Otherwise, exactly
 * one conventional name among them is it. Two conventional names, or none with several
 * branches, is genuinely ambiguous, and the honest answer is null.
 *
 * A null is not a pass. Every caller blocks on it and says so, which is D10's
 * escape-hatch rule applied here (L-08: an unset threshold makes a gate silently skip).
 *
 * @returns {string|null}
 */
export function defaultBranch(dir) {
  const key = dir ?? '';
  if (defaultBranchCache.has(key)) return defaultBranchCache.get(key);
  const branch = resolveDefaultBranch(dir);
  defaultBranchCache.set(key, branch);
  return branch;
}

function resolveDefaultBranch(dir) {
  const fromOrigin = git(dir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  if (fromOrigin) {
    const slash = fromOrigin.indexOf('/'); // `origin/main` -> `main`; `origin/feat/x` -> `feat/x`
    return slash === -1 ? fromOrigin : fromOrigin.slice(slash + 1);
  }

  const fromLocalConfig = git(dir, 'config', '--local', '--get', 'init.defaultBranch');
  if (fromLocalConfig) return fromLocalConfig;

  const listed = git(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/');
  const names = listed ? listed.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
  if (names.length === 1) return names[0];
  const conventional = names.filter((name) => CONVENTIONAL_DEFAULTS.includes(name));
  if (conventional.length === 1) return conventional[0];

  return null;
}

// ---------------------------------------------------------------------------
// Runtime preflight (D8)
// ---------------------------------------------------------------------------

/**
 * Gate health, for P1.7's SessionStart banner and /aeo:status.
 *
 * What it covers: a Node too old to run the gates, a missing `git`, a missing or
 * unparseable hooks.json, and a hooks.json entry pointing at a script that is not
 * there. Each of those makes a gate fail open silently, and each is reachable from
 * inside Node.
 *
 * What it CANNOT cover: `node` not resolving at all. This function is Node. If the
 * runtime is missing, nothing here runs, and the hook exits non-zero-but-not-2, which
 * Claude Code treats as a non-blocking error: the tool call proceeds (C-06). The only
 * mitigation is the non-Node shell fallback described on RUNTIME_MISSING_BANNER.
 *
 * @returns {{ok: boolean, checks: Array<{name: string, ok: boolean, detail: string}>, banner: string|null}}
 */
export function preflight({ pluginRoot = process.env.CLAUDE_PLUGIN_ROOT } = {}) {
  const checks = [];

  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  checks.push({
    name: 'node runtime',
    ok: Number.isFinite(major) && major >= MIN_NODE_MAJOR,
    detail: `node ${process.versions.node} (need ${MIN_NODE_MAJOR}+)`,
  });

  let gitOk = false;
  let gitDetail = 'git not found on PATH';
  try {
    const r = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true });
    gitOk = !r.error && r.status === 0;
    if (gitOk) gitDetail = (r.stdout ?? '').trim();
  } catch {
    gitOk = false;
  }
  checks.push({ name: 'git', ok: gitOk, detail: gitDetail });

  if (!pluginRoot) {
    checks.push({ name: 'hook wiring', ok: false, detail: 'CLAUDE_PLUGIN_ROOT is unset; cannot locate hooks.json' });
  } else {
    const manifest = path.join(pluginRoot, 'hooks', 'hooks.json');
    if (!existsSync(manifest)) {
      checks.push({ name: 'hook wiring', ok: false, detail: `no hooks.json at ${manifest}; no gates are registered` });
    } else {
      let scripts = null;
      let parseError = null;
      try {
        // The shape is Claude Code's to validate; we only need every string in it, so
        // that both the shell form (`command`) and the exec form (`command` + `args`)
        // are covered without this having to know which is which.
        const strings = [];
        collectStrings(JSON.parse(readFileSync(manifest, 'utf8')), strings);
        scripts = strings.flatMap((s) =>
          [...s.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}([^\s"']*\.mjs)/g)].map((m) => m[1]),
        );
      } catch (err) {
        parseError = err.message;
      }

      if (parseError !== null) {
        checks.push({ name: 'hook wiring', ok: false, detail: `hooks.json does not parse (${parseError})` });
      } else if (scripts.length === 0) {
        checks.push({ name: 'hook wiring', ok: false, detail: 'hooks.json registers no gate scripts' });
      } else {
        const missing = scripts.filter((rel) => !existsSync(path.join(pluginRoot, rel.replace(/^[/\\]/, ''))));
        checks.push({
          name: 'hook wiring',
          ok: missing.length === 0,
          detail:
            missing.length === 0
              ? `${scripts.length} gate script(s) present`
              : `missing gate script(s): ${missing.join(', ')}`,
        });
      }
    }
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks, banner: ok ? null : formatBanner(checks.filter((c) => !c.ok)) };
}

function collectStrings(node, out) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) for (const v of node) collectStrings(v, out);
  else if (node && typeof node === 'object') for (const v of Object.values(node)) collectStrings(v, out);
}

function formatBanner(failures) {
  const rule = '='.repeat(78);
  const lines = [
    rule,
    '  AEO GATES ARE NOT ENFORCING',
    '',
    ...failures.map((f) => `  - ${f.name}: ${f.detail}`),
    '',
    '  A hook that cannot start exits non-zero but not 2, which Claude Code treats as a',
    '  non-blocking error: the tool call proceeds. These gates are failing OPEN. Merge,',
    '  commit and path enforcement are not running until this is fixed.',
    rule,
  ];
  return lines.join('\n');
}
