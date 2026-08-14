// AEO path-guard: role subagents never edit the harness's own config. PreToolUse
// hook on Edit and Write.
//
// The config that governs the roles is not theirs to edit. Same asymmetry
// block-merge enforces for git, applied to a repo's own `.claude/` directory (roster,
// hooks, skills, settings). The main session and every non-AEO agent pass through
// (C-02): identity is decided from the payload alone, the same as block-merge, and
// for the same reason no `-Role` argument survives the port: there is only one
// wiring now (C-01).
//
// WHICH DIRECTORY IS FENCED, AND WHY THE PLUGIN ROOT ISN'T (D12). The fence is a
// project's own `.claude/`, resolved from the target file's git worktree, never
// `${CLAUDE_PLUGIN_ROOT}`. The plugin root is where the installed plugin's own files
// live, and it is ephemeral: it changes on every plugin update, so a gate that wrote
// state there or fenced writes into it would be fencing a path that moves out from
// under it.
//
// The plugin root IS reachable through this gate, and that is deliberate. A
// marketplace install is its own git checkout, so an installed gate at
// `<home>/.claude/plugins/<market>/aeo/hooks/` resolves its own toplevel, named `aeo`,
// and a role editing it is allowed unless something above that checkout is a
// repository too. Fencing it would also fence `plugin/hooks/` in this repository,
// which is the legitimate work of every slice that touches a gate: a fix larger than
// its bug.
//
// THE HARNESS-ROOT CHECK (V-11, #113): what counts as "inside the harness" and the
// escalation walk that decides it -- the root-named-.claude case, ordinary containment,
// and the linked-worktree discriminator that must skip only one level's block rather
// than return out of the whole walk -- now live in lib.mjs's isPathIntoHarness (#116).
// That function's own header carries the long form of the mechanism; this file no
// longer has its own copy to keep in sync; redirect-guard.mjs is the second caller the
// sharing exists for.
//
// KNOWN LIMIT: the scope is a worktree ROOT's `.claude/`, so a nested
// `<repo>/apps/web/.claude/` in a monorepo is not fenced, even though directory-scoped
// skills make such a directory genuinely govern roles. The PowerShell original had the
// same root-only scope, so this is inherited, not introduced by the port.
//
// KNOWN LIMIT, NOW NARROWED (#116): this gate's matcher is Edit and Write, so a role
// with only Bash or PowerShell used to pass every write straight through --
// `printf '{}' > .claude/settings.json` never reached this gate at all. redirect-guard.mjs,
// wired on `^(Bash|PowerShell)$`, closes that for a bare redirect and for the
// write-through-a-tool routes it names (tee, cp, mv, install, dd of=, sed -i, and their
// PowerShell cmdlet equivalents); its own header states what is still left uncovered.
//
// KNOWN LIMIT: a worktree cut FROM a linked worktree, parked under that worktree's own
// `.claude/worktrees/`, is still blocked -- `--git-common-dir` always resolves to the
// ORIGINAL main checkout regardless of which worktree `git worktree add` was run from
// (git worktrees never nest into their own family; there is one common dir per
// repository), so isPathIntoHarness's worktree discriminator, comparing against the
// intermediate worktree, never matches. Fails closed, same class as #113 one level
// deeper. Not chased: AEO's own concurrency model never produces it -- sprint worktrees
// are cut from the main checkout only, and operation workers get no worktree at all.
//
// RESOLUTION ORDER, DIFFERENT FROM lib.mjs's resolveWorktree ON PURPOSE. Every other
// Phase 1 gate resolves the directory a *command* operates in (resolveOperationDir):
// an explicit `cd <dir> &&`, then the tool call's own cwd. That answers "what worktree
// is this shell command running in." This gate is not a shell command, it is a file
// write, and the file itself names its own worktree, which can be a sibling of the
// one the subagent was launched in. Resolving from the reported cwd here would fence
// the wrong repository whenever a subagent's target and its cwd disagree, which is
// exactly the failure resolveOperationDir's own doc comment records for Bash calls.
// So this gate walks from the target path instead: normalize it, find the nearest
// existing ancestor directory (the file, and its parent, may not exist yet), and take
// THAT directory's git toplevel.

import path from 'node:path';

import {
  HARNESS_DIRNAME,
  block,
  isAnyAeoRole,
  isPathIntoHarness,
  normalizeHookPath,
  runGate,
  toolFilePath,
} from './lib.mjs';

// The tools that write a file, and must match hooks.json's matcher for this gate. A
// matcher wider than this set is worse than a narrow one: it fires the gate for a tool
// the gate then ignores, which reads as covered and is not.
const FENCED_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/**
 * The target path, resolved to absolute. A relative `file_path` resolves against
 * `payload.cwd` when that is itself absolute, which is a strictly better answer than
 * the PowerShell original's blind `GetFullPath` (resolved against the hook PROCESS's
 * own cwd, which in a plugin can be the ephemeral plugin cache, D12). Falling further
 * back to `path.resolve`'s own default (the hook process's cwd) keeps this gate's
 * posture the same as the original in the one case neither answer is trustworthy:
 * never block on an unresolvable relative path, because this gate's default is allow
 * and only a proven `.claude/` write flips it (contrast review-jail, whose default is
 * deny).
 */
function resolveFullPath(filePath, payload) {
  const normalized = normalizeHookPath(filePath);
  if (path.isAbsolute(normalized)) return path.resolve(normalized);
  const cwd = typeof payload?.cwd === 'string' ? normalizeHookPath(payload.cwd.trim()) : '';
  if (cwd && path.isAbsolute(cwd)) return path.resolve(cwd, normalized);
  return path.resolve(normalized);
}

const FENCE_REASON =
  `role subagents may not touch ${HARNESS_DIRNAME}/ - harness config governs the roles, so a role does not ` +
  'edit it. Ask the orchestrator';

await runGate({
  name: 'path-guard',
  run: (payload) => {
    const tool = typeof payload?.tool_name === 'string' ? payload.tool_name : '';
    if (!FENCED_TOOLS.has(tool)) return;
    if (!isAnyAeoRole(payload)) return; // main session and non-AEO agents pass (C-02)

    // Which field carries the target is lib.mjs's to know, because the sandbox guard
    // reads the same field set and V-13 is two gates deriving one thing twice.
    const named = toolFilePath(payload);
    // No target named: there is nothing to fence against, so this passes rather than
    // blocks. Mirrors the PS original (`if (-not $filePath) { exit 0 }`) and this
    // gate's own allow-by-default posture. It is not review-jail's deny-by-default.
    if (named === null) return;

    const full = resolveFullPath(named, payload);
    const hit = isPathIntoHarness(full);
    if (hit === null) return;

    // hit.root is null exactly when no git worktree contains `full` at all -- the
    // machine-where-$HOME-is-not-a-repository case isPathIntoHarness's own header
    // describes -- and that message shape is path-guard's own, not shared: it names the
    // absolute path and says so, rather than a path relative to a root that doesn't
    // exist here.
    if (hit.root === null) block(`${FENCE_REASON} (tried: ${hit.rel}, outside any git worktree).`);
    block(`${FENCE_REASON} (tried: ${hit.rel}).`);
  },
});
