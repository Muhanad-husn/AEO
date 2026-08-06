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
//   - git push --delete / -d, and the `git push origin :<branch>` deletion refspec
//     (remote branch deletion, every spelling)
//   - git push --all / --mirror, which push every local ref and so push the protected
//     branch without naming it
//   - a push whose refspec resolves to the repo's default branch (D14): explicit
//     `<branch>`, `HEAD:<branch>`, `+<branch>`, `"<branch>"`, and a bare `git push`
//     while the worktree's current branch already is the default branch
//
// Every one of those is judged for EVERY git push in the command, not the first one.
//
// Blocked unconditionally, orchestrator included, because these are the forge's own
// merge and direct-write surface rather than a subagent-identity question:
//   - any `mcp__*github*__*` tool whose action is `merge` as a whole underscore-word
//   - create_or_update_file / push_files / delete_file targeting the default branch,
//     including by omitting `branch` (the REST contract defaults it to that branch)
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
  DEFAULT_BRANCH_UNRESOLVED,
  block,
  currentBranch,
  defaultBranch,
  isAnyAeoRole,
  matchesGitSubcommand,
  resolveWorktree,
  runGate,
} from './lib.mjs';

// defaultBranch returns null when the repository does not say which branch it protects
// (D14, as corrected in lib.mjs). Every use of it here is a "does this call target the
// protected branch" question, and null makes that question unanswerable, so it blocks.
// blockMerge's own closing line is wrong for this case: the fix is one git command, not
// a PR, so these two block directly with the remedy instead.
function blockUnresolvedDefault(what) {
  block(`this repository does not say what its default branch is, so ${what} cannot be shown to miss it. ${DEFAULT_BRANCH_UNRESOLVED}`);
}

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
    // An omitted `branch` is not "nothing to compare". The GitHub contents API defaults
    // it to the repository's default branch, so an omitted branch IS a write to the
    // protected branch, spelled without naming it. The reference MCP server marks the
    // field required, which would make this unreachable there, but D14's rule is that
    // the forge is detected rather than assumed, so this gate does not get to depend on
    // one server's schema. And D16's rule, which the lines just below already apply, is
    // that unresolved is never a pass. Allowing the case where the target is KNOWN to
    // be the default branch, while blocking the case where it is unknown, is the wrong
    // way round. No `branch` on the wire, no write.
    if (!branch) {
      blockMerge('a forge write with no `branch` goes to the repository default branch. Name the branch explicitly.');
    }
    const protectedBranch = defaultBranch(resolveWorktree(payload).toplevel);
    const target = branch.replace(/^refs\/heads\//, '');
    if (protectedBranch === null) blockUnresolvedDefault(`a forge write to \`${target}\``);
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
// This regex is unchanged except for two things, both of which were bypasses:
//
//   - it is GLOBAL, and every match is judged. `exec` returned one match, and the
//     capture `([^;&|]*)` stops at the first separator, so everything after it was
//     invisible and `git push origin feat/x && git push origin main` passed. The merge
//     arm never had that hole because matchesGitSubcommand scans the whole string.
//   - the tail is split with quotes removed rather than on whitespace alone, so
//     `git push origin "main"` yields the ref `main`. The old reasoning was that git
//     ref names cannot contain whitespace, which is true and does not reach quotes.
//
// Mirrors matchesGitSubcommand's own git-level option prefix (`lib.mjs`) because
// refspec destination parsing has no whole-token equivalent there. P1.1 named this
// P1.2's problem to solve, not the library's.

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

// Flags that push refs the command never names, the protected branch among them. Being
// flags, they left the non-flag list holding only the remote and the refspec list
// empty, so the gate fell through to the bare-push branch, which allows the call from a
// feature branch. `--mirror` also deletes the remote refs that have no local
// counterpart. Neither needs a resolved default branch to be wrong.
const PUSH_EVERY_REF_FLAGS = new Set(['--all', '--mirror']);

/**
 * @returns {{deletesRemoteBranch: boolean, everyRefFlag: string|null, destinations: string[]}}
 * `destinations` is empty when the invocation carries no explicit refspec: a bare
 * `git push` or `git push <remote>`, which pushes whatever the current branch already is.
 */
function analyzePush(tokens) {
  const nonFlags = tokens.filter((t) => !t.startsWith('-'));
  const refspecs = nonFlags.length >= 2 ? nonFlags.slice(1) : [];

  let deletesRemoteBranch = tokens.some((t) => DELETE_FLAGS.has(t));
  const everyRefFlag = tokens.find((t) => PUSH_EVERY_REF_FLAGS.has(t)) ?? null;
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
  return { deletesRemoteBranch, everyRefFlag, destinations };
}

// ---------------------------------------------------------------------------
// The Bash arm: AEO subagents only (C-02)
// ---------------------------------------------------------------------------

const GH_PR_MERGE_RE = /\bgh\s+pr\s+merge\b/;
const GH_API_MERGE_RE = /\bgh\s+api\s+\S*\/merge(?=[/?\s]|$)/;

function checkBashCommand(payload, command) {
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

  const pushes = gitInvocationTails(command, 'push').map(analyzePush);
  if (pushes.length === 0) return;

  // The two decisions that need only the command text, for every push, before any git
  // subprocess runs. Neither depends on which branch is protected.
  for (const push of pushes) {
    if (push.deletesRemoteBranch) blockMerge('subagents never delete remote branches.');
    if (push.everyRefFlag) {
      blockMerge(`\`git push ${push.everyRefFlag}\` pushes every local ref, the protected branch included.`);
    }
  }

  const dir = resolveWorktree(payload).toplevel;
  const protectedBranch = defaultBranch(dir);
  if (protectedBranch === null) blockUnresolvedDefault('this push');
  const bare = pushes.some((p) => p.destinations.length === 0);
  const onProtected = bare && currentBranch(dir) === protectedBranch;

  for (const push of pushes) {
    const targetsProtected =
      push.destinations.length > 0 ? push.destinations.includes(protectedBranch) : onProtected;
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
