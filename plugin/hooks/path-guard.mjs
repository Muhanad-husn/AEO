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
// THE HARNESS-ROOT CHECK (V-11). isPathInside(root/.claude, target) stops matching the
// moment `.claude/` participates in a nested git repository: `rev-parse
// --show-toplevel` then resolves BELOW the project root, so the substring `.claude/`
// never appears in a path relative to THAT root. That is issue #271 all over again,
// with no signal that the fence stopped working. Two shapes produce it:
//
//   1. `.claude/` is itself the repository. The resolved toplevel IS the harness
//      directory, so its own basename answers the question (isHarnessNamed).
//   2. Something UNDER `.claude/` is the repository, which is what vendoring a skill or
//      an upstream harness as its own clone produces: `<proj>/.claude/skills/rgr` has
//      toplevel `rgr`, whose basename is not `.claude` and whose own `.claude`
//      subdirectory does not contain the target. Both tests are false, so the write is
//      allowed. The loop below re-runs both against each enclosing worktree root.
//
// The loop is gated on an exactly necessary precondition, so an ordinary project pays
// one string scan and NO extra git call: it turns only while `.claude` is a whole
// segment of the current root's own path. Neither test can change against an outer
// root otherwise, because an outer root named `.claude` is by definition an ancestor
// segment of the current one, and an outer `<root>/.claude` containing the target must
// contain the current root too (the target is inside both, two ancestors of one path
// are ordered by containment, and `<root>/.claude` is a direct child of `<root>`).
// Only a repository living under a `.claude/` directory pays a `rev-parse` per level,
// which is also what keeps a plugin checkout at `~/.claude/plugins/aeo/` resolving
// normally: nothing encloses it, so the loop stops and only its own `.claude/` is
// fenced.
//
// KNOWN LIMIT: the scope is a worktree ROOT's `.claude/`, so a nested
// `<repo>/apps/web/.claude/` in a monorepo is not fenced, even though directory-scoped
// skills make such a directory genuinely govern roles. The PowerShell original had the
// same root-only scope, so this is inherited, not introduced by the port.
//
// KNOWN LIMIT: the matcher is Edit and Write, and role subagents hold Bash, so
// `printf '{}' > .claude/settings.json` never reaches this gate at all. Closing that
// is a Bash-side redirect check, a different gate's surface.
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

import { existsSync } from 'node:fs';
import path from 'node:path';

import { block, gitToplevel, isAnyAeoRole, isPathInside, normalizeHookPath, runGate } from './lib.mjs';

const HARNESS_DIRNAME = '.claude';

// The tools that write a file, and must match hooks.json's matcher for this gate. A
// matcher wider than this set is worse than a narrow one: it fires the gate for a tool
// the gate then ignores, which reads as covered and is not.
const FENCED_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/**
 * True when `dirPath`'s own basename is `.claude`, a whole path segment, not a
 * substring anywhere in the path (V-12). Case-insensitive on Windows, where the
 * filesystem is; a real distinction on a case-sensitive host.
 */
function isHarnessNamed(dirPath) {
  const base = path.basename(dirPath);
  return process.platform === 'win32' ? base.toLowerCase() === HARNESS_DIRNAME : base === HARNESS_DIRNAME;
}

/** True when any whole segment of `p` is `.claude`. Same segment rule, applied along. */
function hasHarnessSegment(p) {
  return path.resolve(p).split(/[\\/]+/).some(isHarnessNamed);
}

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

/**
 * The nearest ancestor of `dir` that exists on disk, or null when none does (the walk
 * reaches a filesystem root that itself does not exist, which does not happen on a
 * real filesystem but is not assumed away). The target file, and its parent directory,
 * may not exist yet: Write creates new files and new directories under an existing
 * project.
 */
function nearestExistingAncestor(dir) {
  let probe = dir;
  while (probe && !existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return null;
    probe = parent;
  }
  return probe || null;
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

    // Edit, Write and MultiEdit all name their target `file_path`; NotebookEdit names
    // it `notebook_path`. Reading only the first would make this gate shrug at a
    // notebook write into `.claude/`.
    const rawPath = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path;
    // No target named: there is nothing to fence against, so this passes rather than
    // blocks. Mirrors the PS original (`if (-not $filePath) { exit 0 }`) and this
    // gate's own allow-by-default posture. It is not review-jail's deny-by-default.
    if (typeof rawPath !== 'string' || rawPath.trim() === '') return;
    const named = rawPath.trim();

    const full = resolveFullPath(named, payload);
    const ancestor = nearestExistingAncestor(path.dirname(full));
    const toplevel = ancestor ? gitToplevel(ancestor) : null;

    // NO WORKTREE, AND A DELIBERATE DIVERGENCE FROM THE POWERSHELL ORIGINAL, WHICH
    // BLOCKED HERE. Blocking contradicts the allow-by-default posture stated above, and
    // it blocks a role's first write to the scratch directory this environment tells
    // every agent to use. What the original was really buying is worth keeping: on a
    // machine where `$HOME` is not a repository, `~/.claude/settings.json` has no
    // toplevel and must still be fenced. So the fence runs with no root to be relative
    // to: a whole-segment `.claude` test (V-12) over the absolute path.
    if (!toplevel) {
      if (hasHarnessSegment(full)) block(`${FENCE_REASON} (tried: ${full}, outside any git worktree).`);
      return;
    }

    // The harness-root check fires independent of where under a root the target sits,
    // because if a root itself is `.claude/`, that whole worktree IS the harness config
    // (V-11). Otherwise, ordinary containment: isPathInside is the whole-segment test
    // (V-12), so a sibling like `.claude-evil/` or a trailing separator on the harness
    // path do not fool it either way. Both then re-run against each enclosing root.
    let root = path.resolve(toplevel);
    for (;;) {
      if (isHarnessNamed(root) || isPathInside(path.join(root, HARNESS_DIRNAME), full)) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        block(`${FENCE_REASON} (tried: ${rel}).`);
      }
      if (!hasHarnessSegment(root)) return; // no outer root can change either answer
      const parent = path.dirname(root);
      if (parent === root) return; // filesystem root
      const outer = gitToplevel(parent);
      // isPathInside also guarantees termination: `outer` contains `parent`, so it is
      // strictly shorter than `root`. A git answer that is not an ancestor of the
      // directory it was asked about (a resolved symlink) stops the walk instead.
      if (!outer || !isPathInside(outer, parent)) return;
      root = path.resolve(outer);
    }
  },
});
