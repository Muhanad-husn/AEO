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
// Blocked, for an AEO subagent's shell calls only — Bash or PowerShell (see F5 below):
//   - git merge, including through `git -C <dir> merge` (V-02)
//   - gh pr merge, gh api .../merge
//   - git branch -d / -D / --delete (local branch deletion)
//   - git push --delete / -d, and the `git push origin :<branch>` deletion refspec
//     (remote branch deletion, every spelling)
//
// Every one of those is judged for EVERY git push in the command, not the first one.
//
// Blocked unconditionally, orchestrator included, because this is the forge's own
// merge surface rather than a subagent-identity question:
//   - any `mcp__*github*__*` tool whose action is `merge` as a whole underscore-word
//
// F5: which subagents this gate enforces against. Production blocked ANY subagent:
// `agent_type` non-empty. C-02 forbids that read: a main session launched with
// `--agent` also carries `agent_type`, so presence-only matching blocks the
// orchestrator's own founder-approved merge path whenever it runs in that mode. This
// gate enforces on `isAnyAeoRole` (lib.mjs) instead, which matches every `aeo:<role>`
// identity this plugin ships, whatever the current role count is, and nothing else. A
// `general-purpose` subagent, or a foreign plugin's `other:builder`, passes this
// check. That narrowing, and why it was accepted, is recorded in the slice log.

import { block, isAnyAeoRole, isShellTool, matchesGitSubcommand, runGate } from './lib.mjs';

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
// The Bash arm: AEO subagents only (C-02)
// ---------------------------------------------------------------------------

const GH_PR_MERGE_RE = /\bgh\s+pr\s+merge\b/;
const GH_API_MERGE_RE = /\bgh\s+api\s+\S*\/merge(?=[/?\s]|$)/;

function checkBashCommand(command) {
  if (matchesGitSubcommand(command, 'merge')) blockMerge('subagents never run git merge.');
  if (GH_PR_MERGE_RE.test(command)) blockMerge('subagents never merge PRs.');
  if (GH_API_MERGE_RE.test(command)) blockMerge('subagents never merge via the API.');

  // The delete flag is tested against this invocation's own tail. Tested against the
  // whole command, as it was, `git branch --show-current && ls -d */` blocked on the
  // `-d` of the `ls`.
  for (const tokens of gitInvocationTails(command, 'branch')) {
    if (tokens.some((t) => DELETE_FLAGS.has(t))) {
      blockMerge('subagents never delete branches; cleanup runs on founder approval.');
    }
  }

  for (const tokens of gitInvocationTails(command, 'push')) {
    if (pushDeletesRemoteBranch(tokens)) blockMerge('subagents never delete remote branches.');
  }
}

// ---------------------------------------------------------------------------

await runGate({
  name: 'block-merge',
  run: (payload) => {
    const tool = typeof payload?.tool_name === 'string' ? payload.tool_name : '';

    const action = forgeAction(tool);
    if (action !== null) {
      checkForgeTool(action);
      return; // every other forge tool passes
    }

    if (!isShellTool(payload)) return; // Bash or PowerShell; C-07
    if (!isAnyAeoRole(payload)) return; // orchestrator's own approved path (C-02, F5)

    const command = typeof payload?.tool_input?.command === 'string' ? payload.tool_input.command : '';
    checkBashCommand(command);
  },
});
