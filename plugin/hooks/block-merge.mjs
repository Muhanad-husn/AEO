// AEO gate: subagents never merge (V-02, D14). PreToolUse hook.
//
// One wiring, not two (C-01): a plugin subagent's own `hooks:` frontmatter is
// silently ignored, so hooks.json is the entire gate. The PowerShell original took a
// `-Mode subagent` argument to select which of its two wirings it was running as;
// this script has no second wiring, so it decides identity from the payload alone
// every time (C-02).
//
// WHAT THIS GATE NO LONGER DOES, AND WHY (D30). It used to also refuse a push whose
// refspec resolved to the repository's default branch, a `git push --all`/`--mirror`,
// and a forge write (`create_or_update_file`/`push_files`/`delete_file`) targeting the
// default branch. All three re-derived a check GitHub's branch protection already makes
// server-side once a repository has it configured — the checkpoint this gate cannot see
// past a `git -C <dir>` or a `cd` it resolved to the wrong directory, GitHub sees
// directly on the ref it received. Re-deriving it locally bought nothing the server
// does not already refuse, and cost issue #121. What is left here is judged from the
// command string alone, no directory resolution involved.
//
// Blocked, for any subagent's shell calls, Bash or PowerShell, and judged from the
// command's structure rather than its text (see the shell arm below):
//   - git merge, including through `git -C <dir> merge` (V-02)
//   - gh pr merge, gh api .../merge
//   - git branch -d / -D / --delete (local branch deletion)
//   - git push --delete / -d, and the `git push origin :<branch>` deletion refspec
//     (remote branch deletion, every spelling)
//
// Every one of those is judged for EVERY segment of the command, not the first one,
// and inside an interpreter's inline `-c` string as well.
//
// Blocked unconditionally, orchestrator included, because this is the forge's own
// merge surface rather than a subagent-identity question:
//   - any `mcp__*github*__*` tool whose action is `merge` as a whole underscore-word
//
// F5, superseded by slice 02: which subagents this gate enforces against. The first
// build read `isAnyAeoRole`, so only this plugin's own `aeo:<role>` identities were
// enforced against. The plugin is off in this repository and building is done by plain
// dispatched agents, `general-purpose` among them, so that read left the gate
// enforcing against nobody who runs. Identity is now `agentIdentity(payload) !== null`,
// any non-empty `agent_type`, the rule the founder's global copy already applies. The
// C-02 trap it was narrowed for, a main session launched with `--agent`, is accepted:
// the founder's merge path runs from a session that carries no `agent_type` at all.

import { pathToFileURL } from 'node:url';

import { agentIdentity, block, commandSegments, isShellTool, matchesGitSubcommand, runGate } from './lib.mjs';

// Every block shares the PowerShell original's closing line, in one place so the
// wording cannot drift block-call by block-call.
function blockMerge(reason) {
  block(`${reason} Prepare the PR; the main session merges after founder approval.`);
}

// ---------------------------------------------------------------------------
// The forge arm: blocked for everyone, including the orchestrator (D14)
// ---------------------------------------------------------------------------

// Namespace-agnostic by design (D14): matches any GitHub MCP server regardless of how
// it is registered, not one observed name. The capture is the action name, everything
// after the LAST `__`. A tool name can legitimately contain more `__` pairs before
// that (this environment's server is itself `plugin_github_github`).
const FORGE_TOOL_RE = /^mcp__.*github.*__([a-z0-9_]+)$/i;

// The leading verb, not a substring anywhere in the name (V-12's rule, applied here
// because the shared library's matchers are for argv and paths, not tool-name words).
// The vendored script's own `-match 'merge'` is a bare substring test: it would fire
// on `unmerge_something`, and a whole-word-anywhere version would still fire on a
// hypothetical read tool like `get_merge_status`. Anchoring to the leading verb
// catches the real shape of an action tool (`merge_pull_request`, `merge_branch`)
// without catching a status check that merely mentions merging. None of the
// `mcp__plugin_github_github__*` tools installed in this environment start with
// "merge" today (checked against the live tool list, not assumed), so this arm is
// currently unexercised here; the pattern still has to be right for the server that
// does ship one.
const FORGE_MERGE_ACTION_RE = /^merge(_|$)/i;

function forgeAction(toolName) {
  const m = FORGE_TOOL_RE.exec(typeof toolName === 'string' ? toolName : '');
  return m ? m[1] : null;
}

// D30: a forge write (`create_or_update_file`/`push_files`/`delete_file`) targeting the
// default branch used to be checked here too. GitHub's contents API refuses that write
// server-side whenever the repository has branch protection, the same as it refuses a
// git push to a protected ref, so the local check re-derived a server-side rule and is
// gone. The merge action below is the one thing the forge does that a local `git merge`
// also does — nothing else on the forge is this gate's business any more.
function checkForgeTool(action) {
  if (FORGE_MERGE_ACTION_RE.test(action)) {
    blockMerge('subagents and the forge merge tool never merge.');
  }
}

// ---------------------------------------------------------------------------
// Remote branch deletion, every spelling (D30 narrowed this section)
// ---------------------------------------------------------------------------
//
// This used to also resolve a push's destination refspec against the repository's
// default branch, to catch `git push origin main` and its variants. That check is gone
// (D30): GitHub's branch protection refuses the push itself once it reaches the server,
// so the local re-derivation bought nothing the server does not already refuse and cost
// issue #121 — a wrong answer from resolving the wrong worktree directory. What is left
// here, remote branch deletion, is judged from the command's own tokens alone; no
// directory is ever resolved to decide it.

/** Every `git <sub>` invocation in `command`, as its argument tail in shell words. */
function gitInvocationTails(command, sub) {
  if (typeof command !== 'string' || command === '') return [];
  const re = new RegExp(String.raw`\bgit\s+((-C|-c)\s+\S+\s+|-\S+\s+)*${sub}(?![-\w])(?<tail>[^;&|]*)`, 'g');
  return [...command.matchAll(re)].map((m) => tailTokens(m.groups.tail));
}

/** Split an argument tail into shell words, dropping the quotes that group them. */
function tailTokens(text) {
  const tokens = [];
  let current = '';
  let started = false;
  let quote = null;
  for (const c of text) {
    if (quote !== null) {
      if (c === quote) quote = null;
      else current += c;
      started = true;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
    } else {
      current += c;
      started = true;
    }
  }
  if (started) tokens.push(current);
  return tokens;
}

// `-d` is git's documented short form of `--delete`, for `push` as well as `branch`.
// The push check tested for the literal `--delete` only; the branch check in this same
// file already handled all three spellings. One set now serves both.
const DELETE_FLAGS = new Set(['-d', '-D', '--delete']);

/** Whether a `git push` invocation's own tail deletes a remote branch, any spelling. */
function pushDeletesRemoteBranch(tokens) {
  if (tokens.some((t) => DELETE_FLAGS.has(t))) return true;
  const nonFlags = tokens.filter((t) => !t.startsWith('-'));
  const refspecs = nonFlags.length >= 2 ? nonFlags.slice(1) : [];
  // `git push origin :main`, the colon-deletion form. `--delete` is not the only
  // spelling of "delete a remote branch"; this one carries no flag to catch.
  return refspecs.some((raw) => {
    const spec = raw.startsWith('+') ? raw.slice(1) : raw; // force-update prefix
    const colon = spec.indexOf(':');
    return colon !== -1 && spec.slice(0, colon) === '';
  });
}

// ---------------------------------------------------------------------------
// The shell arm: every subagent, judged by structure (slice 02)
// ---------------------------------------------------------------------------
//
// WHAT IS JUDGED. Each segment of the command, as commandSegments (lib.mjs) parses it:
// the program it runs and that program's arguments. `git` with the subcommand `merge`
// (git's own `-C <dir>` and `-c <k=v>` skipped, and `merge-base` and `merge-tree` are
// not it); `gh` with `pr merge`; `gh` with `api` and a path ending `/merge`; `git
// branch` with `-d`, `-D` or `--delete`; `git push` with a delete flag or a refspec
// whose left side is empty. Every segment, not the first one.
//
// WHAT IS NEVER READ. A word inside an argument of any other program. `grep -rn "git
// merge" plugin/`, `git commit -m "... stays with the founder"`, `printf`, `echo`,
// `node -e`, `git log --grep=`, `Select-String -Pattern`. The gate used to scan the
// whole command string as text and refused all of these, which is the known limit
// CLAUDE.md records and the reason the rule itself could not be written down.
//
// THE INTERPRETER CASE. `bash -c`, `sh -c`, `pwsh -Command`, `powershell -c` carry a
// command list inside a single argument. That string is parsed and judged on the same
// terms, to a small depth, so the structural read is not walked past by one quote.
//
// THE WRAPPER CASE. `env`, `sudo`, `timeout`, `nohup`, `nice`, `command` and the rest
// below run another program, so the segment's program is the wrapper and the real one
// sits in its arguments. commandSegments does not unwrap them, and this gate does not
// edit lib.mjs, so the unwrapping is here: the wrapper's own options are dropped, each
// with its separate value where it takes one, `env`'s `NAME=value` assignments are
// dropped, `timeout`'s duration operand is dropped, and what is left is judged as the
// real program and its arguments. It repeats, so `sudo env git merge feat` is caught.
//
// THE FALLBACK. When commandSegments reports a parse error there is nothing to walk, so
// the old whole-string text match decides instead, under its own name. A command the
// parser cannot read is judged as it was before this slice, and a quoting trick does not
// open the gate.
//
// IDENTITY (C-02). This script has one wiring, so it reads identity from the payload
// every time it runs. Any non-empty `agent_type` is a subagent, the rule the founder's
// global copy already applies and the rule the work here needs: building is done by
// plain dispatched agents, so a narrower `aeo:<role>` read enforced against nobody who
// actually runs. The main session carries no `agent_type` and keeps its
// founder-approved path.

const INTERPRETERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ash', 'pwsh', 'powershell']);
const INLINE_COMMAND_FLAG = /^-{1,2}(c|command)$/i;
const MAX_INTERPRETER_DEPTH = 3;

/**
 * The programs that run another program, and the options of their own that take a
 * separate value. `operands` is how many bare words the wrapper consumes for itself
 * before the real program begins: `timeout` takes a duration, the rest take none.
 *
 * The option lists are the value-taking ones only. Every other `-flag` is dropped
 * without looking at it, which is the safe direction here: dropping one word too few
 * would leave a flag standing where a program name is read, and the next non-flag word
 * is still the program.
 */
const WRAPPERS = new Map([
  ['env', { valueFlags: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']), operands: 0 }],
  [
    'sudo',
    {
      valueFlags: new Set([
        '-u', '--user', '-g', '--group', '-p', '--prompt', '-C', '--close-from',
        '-U', '--other-user', '-T', '--command-timeout', '-h', '--host', '-R', '--chroot',
      ]),
      operands: 0,
    },
  ],
  ['doas', { valueFlags: new Set(['-u', '-C']), operands: 0 }],
  ['timeout', { valueFlags: new Set(['-s', '--signal', '-k', '--kill-after']), operands: 1 }],
  ['nice', { valueFlags: new Set(['-n', '--adjustment']), operands: 0 }],
  [
    'xargs',
    {
      valueFlags: new Set([
        '-I', '-i', '-n', '-L', '-P', '-s', '-d', '-E', '-a', '-e',
        '--replace', '--max-args', '--max-procs', '--max-chars', '--delimiter',
        '--arg-file', '--eof', '--max-lines',
      ]),
      operands: 0,
    },
  ],
  ['nohup', { valueFlags: new Set(), operands: 0 }],
  ['command', { valueFlags: new Set(), operands: 0 }],
  ['builtin', { valueFlags: new Set(), operands: 0 }],
  ['exec', { valueFlags: new Set(['-a']), operands: 0 }],
  ['time', { valueFlags: new Set(['-o', '--output', '-f', '--format']), operands: 0 }],
]);

// Two wrappers stacked is already unusual; more than this is not a shape to keep
// unwrapping, and the limit is what stops a crafted chain from looping.
const MAX_WRAPPER_DEPTH = 4;

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * The real program and arguments behind any wrappers, or the pair unchanged.
 *
 * Returns `null` when a wrapper is present but no program follows it, which is a
 * wrapper run with nothing to run and so nothing for this gate to judge.
 */
function unwrapProgram(program, args) {
  let current = program;
  let rest = args;
  for (let depth = 0; depth < MAX_WRAPPER_DEPTH; depth += 1) {
    const wrapper = WRAPPERS.get(current);
    if (wrapper === undefined) return { program: current, args: rest };

    let i = 0;
    let operands = wrapper.operands;
    while (i < rest.length) {
      const word = rest[i];
      if (word === '--') { i += 1; break; }
      if (word.startsWith('-') && word !== '-') {
        i += wrapper.valueFlags.has(word) ? 2 : 1;
        continue;
      }
      if (ENV_ASSIGNMENT.test(word)) { i += 1; continue; }
      if (operands > 0) { operands -= 1; i += 1; continue; }
      break;
    }
    if (i >= rest.length) return null;
    current = programName(rest[i]);
    rest = rest.slice(i + 1);
  }
  return { program: current, args: rest };
}

/** A program name reduced to what it is: no directory, no `.exe`, lower case. */
function programName(raw) {
  const tail = raw.split(/[\\/]/).pop() ?? '';
  return tail.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
}

/**
 * The git subcommand a `git` invocation runs, and the arguments after it.
 *
 * git's own options come before the subcommand. `-C` and `-c` each take a separate
 * value, which is skipped with the flag so a directory named `merge` is not read as one.
 */
function gitSubcommand(args) {
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '-C' || arg === '-c') { i += 2; continue; }
    if (arg.startsWith('-')) { i += 1; continue; }
    return { sub: arg, tail: args.slice(i + 1) };
  }
  return null;
}

/** The arguments that are not flags, in order. A subcommand word is one of these. */
function nonFlags(args) {
  return args.filter((a) => !a.startsWith('-'));
}

/** Whether a `gh api` path argument addresses the merge endpoint. */
function isMergeApiPath(raw) {
  if (typeof raw !== 'string') return false;
  const path = raw.split('?')[0].replace(/\/+$/, '');
  return path.endsWith('/merge');
}

function checkGitSegment(args) {
  const invocation = gitSubcommand(args);
  if (invocation === null) return;
  const { sub, tail } = invocation;

  // `merge-base` and `merge-tree` are read-only and are different subcommands, not this
  // one with a suffix. The whole word is compared, so they never match.
  if (sub === 'merge') blockMerge('subagents never run git merge.');

  if (sub === 'branch' && tail.some((t) => DELETE_FLAGS.has(t))) {
    blockMerge('subagents never delete branches; cleanup runs on founder approval.');
  }

  if (sub === 'push' && pushDeletesRemoteBranch(tail)) {
    blockMerge('subagents never delete remote branches.');
  }
}

function checkGhSegment(args) {
  const words = nonFlags(args);
  if (words[0] === 'pr' && words[1] === 'merge') blockMerge('subagents never merge PRs.');
  if (words[0] === 'api' && isMergeApiPath(words[1])) blockMerge('subagents never merge via the API.');
}

/** The command string an interpreter segment runs inline, or null when it runs none. */
function inlineCommand(args) {
  for (let i = 0; i < args.length; i += 1) {
    if (INLINE_COMMAND_FLAG.test(args[i])) return args[i + 1] ?? null;
  }
  return null;
}

function checkSegment(segment, depth) {
  if (typeof segment.program !== 'string' || segment.program === '') return;
  const unwrapped = unwrapProgram(programName(segment.program), segment.args);
  if (unwrapped === null) return; // a wrapper with nothing after it runs nothing
  const { program, args } = unwrapped;

  if (program === 'git') checkGitSegment(args);
  else if (program === 'gh') checkGhSegment(args);
  else if (INTERPRETERS.has(program) && depth < MAX_INTERPRETER_DEPTH) {
    const inner = inlineCommand(args);
    if (inner !== null) checkShellCommand(inner, depth + 1);
  }
}

/**
 * The text match this gate used before it read structure, kept under its own name.
 *
 * It runs only when the parser could not read the command. It is the coarse rule, and
 * it says so in its reason, so a block it produces is attributable to the fallback
 * rather than read as a structural judgement.
 */
function checkByTextFallback(command) {
  const fallback = (reason) =>
    blockMerge(`${reason} The command could not be parsed, so the text fallback decided.`);

  if (matchesGitSubcommand(command, 'merge')) fallback('subagents never run git merge.');
  if (GH_PR_MERGE_RE.test(command)) fallback('subagents never merge PRs.');
  if (GH_API_MERGE_RE.test(command)) fallback('subagents never merge via the API.');

  for (const tokens of gitInvocationTails(command, 'branch')) {
    if (tokens.some((t) => DELETE_FLAGS.has(t))) {
      fallback('subagents never delete branches; cleanup runs on founder approval.');
    }
  }

  for (const tokens of gitInvocationTails(command, 'push')) {
    if (pushDeletesRemoteBranch(tokens)) fallback('subagents never delete remote branches.');
  }
}

const GH_PR_MERGE_RE = /\bgh\s+pr\s+merge\b/;
const GH_API_MERGE_RE = /\bgh\s+api\s+\S*\/merge(?=[/?\s]|$)/;

function checkShellCommand(command, depth = 0) {
  if (typeof command !== 'string' || command === '') return;
  const { segments, error } = commandSegments(command);
  if (error !== null) {
    checkByTextFallback(command);
    return;
  }
  for (const segment of segments) checkSegment(segment, depth);
}

// ---------------------------------------------------------------------------

// Exported so gate.mjs can run this decision in the same process as the other rules
// (#167). The body is what ran as this script's own `run` before; what it judges is not
// this slice's business.
/** @param {object} payload */
export function blockMergeGate(payload) {
  const tool = typeof payload?.tool_name === 'string' ? payload.tool_name : '';

  const action = forgeAction(tool);
  if (action !== null) {
    checkForgeTool(action);
    return; // every other forge tool passes
  }

  if (!isShellTool(payload)) return; // Bash or PowerShell; C-07
  if (agentIdentity(payload) === null) return; // orchestrator's own approved path (C-02, F5)

  const command = typeof payload?.tool_input?.command === 'string' ? payload.tool_input.command : '';
  checkShellCommand(command);
}

// Importing this file must not run the gate, so gate.mjs and the tests can use its
// exports without spawning it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runGate({ name: 'block-merge', run: blockMergeGate });
}
