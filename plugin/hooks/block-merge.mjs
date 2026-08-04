// AEO gate: subagents never merge (V-02, D14). PreToolUse hook.
//
// One wiring, not two (C-01): a plugin subagent's own `hooks:` frontmatter is
// silently ignored, so hooks.json is the entire gate. The PowerShell original took a
// `-Mode subagent` argument to select which of its two wirings it was running as;
// this script has no second wiring, so it decides identity from the payload alone
// every time (C-02).
//
// Blocked, for an AEO subagent's Bash calls only (see F5 below):
//   - git merge, including through `git -C <dir> merge` (V-02)
//   - gh pr merge, gh api .../merge
//   - git branch -d / -D / --delete (local branch deletion)
//   - git push --delete, and the `git push origin :<branch>` deletion refspec
//     (remote branch deletion, either spelling)
//   - a push whose refspec resolves to the repo's default branch (D14): explicit
//     `<branch>`, `HEAD:<branch>`, `+<branch>`, and a bare `git push` while the
//     worktree's current branch already is the default branch
//
// Blocked unconditionally, orchestrator included, because these are the forge's own
// merge and direct-write surface rather than a subagent-identity question:
//   - any `mcp__*github*__*` tool whose action is `merge` as a whole underscore-word
//   - create_or_update_file / push_files / delete_file targeting the default branch
//
// F5: which subagents this gate enforces against. Production blocked ANY subagent:
// `agent_type` non-empty. C-02 forbids that read: a main session launched with
// `--agent` also carries `agent_type`, so presence-only matching blocks the
// orchestrator's own founder-approved merge path whenever it runs in that mode. This
// gate enforces on `isAnyAeoRole` instead, this plugin's own three roles (builder,
// reviewer, triage), identified by their anchored `aeo:<role>` identity, and nothing
// else. A `general-purpose` subagent, or a foreign plugin's `other:builder`, passes
// this check. That narrowing, and why it was accepted, is recorded in the slice log.

import {
  block,
  currentBranch,
  defaultBranch,
  isAnyAeoRole,
  matchesGitSubcommand,
  resolveWorktree,
  runGate,
} from './lib.mjs';

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

const FORGE_FILE_WRITE_ACTIONS = new Set(['create_or_update_file', 'push_files', 'delete_file']);

function forgeAction(toolName) {
  const m = FORGE_TOOL_RE.exec(typeof toolName === 'string' ? toolName : '');
  return m ? m[1] : null;
}

function checkForgeTool(payload, action) {
  if (FORGE_MERGE_ACTION_RE.test(action)) {
    blockMerge('subagents and the forge merge tool never merge.');
  }
  if (FORGE_FILE_WRITE_ACTIONS.has(action)) {
    const branch = typeof payload?.tool_input?.branch === 'string' ? payload.tool_input.branch.trim() : '';
    if (!branch) return;
    const protectedBranch = defaultBranch(resolveWorktree(payload).toplevel);
    const target = branch.replace(/^refs\/heads\//, '');
    if (target === protectedBranch) {
      blockMerge(`no direct writes to ${protectedBranch} through the forge.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Push-refspec resolution: the highest-value new work in this slice
// ---------------------------------------------------------------------------
//
// The vendored check is `$cmd -match '\bmain\b'` against the raw command text. Read
// literally, that both catches `HEAD:main` and `+main` (a colon or `+` is a non-word
// character, so `\bmain\b` sees a boundary on either side) AND false-positives on
// `feat/main-thing` (`/` and `-` are non-word too, so the same boundary logic fires
// inside it). A regex over raw text cannot tell "main is the whole branch name" from
// "main is a substring next to punctuation"; that needs the refspec actually parsed.
//
// Mirrors matchesGitSubcommand's own git-level option prefix (`lib.mjs`) because
// refspec destination parsing has no whole-token equivalent there. P1.1 named this
// P1.2's problem to solve, not the library's.
const PUSH_ARGS_RE = /\bgit\s+(?:(?:-C|-c)\s+\S+\s+|-\S+\s+)*push\b([^;&|]*)/;

/**
 * @returns {{deletesRemoteBranch: boolean, destinations: string[]}} `destinations` is
 * empty when the command carries no explicit refspec: a bare `git push` or
 * `git push <remote>`, which pushes whatever the current branch already is.
 */
function analyzePush(command) {
  const m = PUSH_ARGS_RE.exec(command);
  const tokens = (m ? m[1] : '').trim().split(/\s+/).filter(Boolean);
  const nonFlags = tokens.filter((t) => !t.startsWith('-'));
  // git ref names cannot contain whitespace, so a plain split needs no quote handling.
  const refspecs = nonFlags.length >= 2 ? nonFlags.slice(1) : [];

  let deletesRemoteBranch = tokens.includes('--delete');
  const destinations = [];
  for (const raw of refspecs) {
    const spec = raw.startsWith('+') ? raw.slice(1) : raw; // force-update prefix
    const colon = spec.indexOf(':');
    if (colon === -1) {
      destinations.push(spec);
      continue;
    }
    const source = spec.slice(0, colon);
    const dest = spec.slice(colon + 1);
    if (source === '') {
      // `git push origin :main`, the colon-deletion form. `--delete` is not the only
      // spelling of "delete a remote branch"; this one carries no flag to catch.
      deletesRemoteBranch = true;
      continue;
    }
    if (dest) destinations.push(dest.replace(/^refs\/heads\//, ''));
  }
  return { deletesRemoteBranch, destinations };
}

// ---------------------------------------------------------------------------
// The Bash arm: AEO subagents only (C-02)
// ---------------------------------------------------------------------------

const GH_PR_MERGE_RE = /\bgh\s+pr\s+merge\b/;
const GH_API_MERGE_RE = /\bgh\s+api\s+\S*\/merge(?=[/?\s]|$)/;
const GIT_BRANCH_DELETE_FLAG_RE = /(^|\s)(-d|-D|--delete)(\s|$)/;

function checkBashCommand(payload, command) {
  if (matchesGitSubcommand(command, 'merge')) blockMerge('subagents never run git merge.');
  if (GH_PR_MERGE_RE.test(command)) blockMerge('subagents never merge PRs.');
  if (GH_API_MERGE_RE.test(command)) blockMerge('subagents never merge via the API.');
  if (matchesGitSubcommand(command, 'branch') && GIT_BRANCH_DELETE_FLAG_RE.test(command)) {
    blockMerge('subagents never delete branches; cleanup runs on founder approval.');
  }

  if (matchesGitSubcommand(command, 'push')) {
    const { deletesRemoteBranch, destinations } = analyzePush(command);
    if (deletesRemoteBranch) blockMerge('subagents never delete remote branches.');

    const dir = resolveWorktree(payload).toplevel;
    const protectedBranch = defaultBranch(dir);
    const targetsProtected =
      destinations.length > 0 ? destinations.includes(protectedBranch) : currentBranch(dir) === protectedBranch;
    if (targetsProtected) blockMerge(`subagents never push to ${protectedBranch}.`);
  }
}

// ---------------------------------------------------------------------------

await runGate({
  name: 'block-merge',
  run: (payload) => {
    const tool = typeof payload?.tool_name === 'string' ? payload.tool_name : '';

    const action = forgeAction(tool);
    if (action !== null) {
      checkForgeTool(payload, action);
      return; // every other forge tool passes
    }

    if (tool !== 'Bash') return;
    if (!isAnyAeoRole(payload)) return; // orchestrator's own approved path (C-02, F5)

    const command = typeof payload?.tool_input?.command === 'string' ? payload.tool_input.command : '';
    checkBashCommand(payload, command);
  },
});
