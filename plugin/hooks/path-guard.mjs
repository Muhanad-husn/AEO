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
// under it. It also isn't reachable through this gate at all: a role subagent's
// Edit/Write target is a project file, resolved through the project's git worktree,
// and the plugin cache sits outside every project worktree. Nothing here needs to
// name it.
//
// THE ROOT-NAMED-.claude CHECK (V-11). isPathInside(root/.claude, target) stops
// matching the moment `.claude/` is made its own git repository: `rev-parse
// --show-toplevel` then resolves to `<root>/.claude` for anything under it, so a
// target's OWN toplevel becomes the harness directory, and the substring `.claude/`
// never appears in a path relative to THAT root. That is issue #271 all over again,
// this time with no signal that the fence stopped working. So the resolved toplevel's
// own name is checked directly, independent of the containment test: whole path
// segment, not "contains .claude" (a checkout at `~/.claude/plugins/aeo/` must still
// resolve normally: its toplevel is named `aeo`, not `.claude`, and `.claude` is only
// an ancestor of it, which this check does not look at).
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

/**
 * True when `dirPath`'s own basename is `.claude`, a whole path segment, not a
 * substring anywhere in the path (V-12). Case-insensitive on Windows, where the
 * filesystem is; a real distinction on a case-sensitive host.
 */
function isHarnessNamed(dirPath) {
  const base = path.basename(dirPath);
  return process.platform === 'win32' ? base.toLowerCase() === HARNESS_DIRNAME : base === HARNESS_DIRNAME;
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

await runGate({
  name: 'path-guard',
  run: (payload) => {
    const tool = typeof payload?.tool_name === 'string' ? payload.tool_name : '';
    if (tool !== 'Edit' && tool !== 'Write') return;
    if (!isAnyAeoRole(payload)) return; // main session and non-AEO agents pass (C-02)

    const rawPath = payload?.tool_input?.file_path;
    // No target named: there is nothing to fence against, so this passes rather than
    // blocks. Mirrors the PS original (`if (-not $filePath) { exit 0 }`) and this
    // gate's own allow-by-default posture. It is not review-jail's deny-by-default.
    if (typeof rawPath !== 'string' || rawPath.trim() === '') return;
    const named = rawPath.trim();

    const full = resolveFullPath(named, payload);
    const ancestor = nearestExistingAncestor(path.dirname(full));
    if (!ancestor) {
      block(`cannot resolve a directory for the target path (${named}).`);
    }

    const toplevel = gitToplevel(ancestor);
    if (!toplevel) {
      block(`target is not inside a git worktree (${named}).`);
    }

    const root = path.resolve(toplevel);
    const rel = path.relative(root, full).split(path.sep).join('/');
    const harnessDir = path.join(root, HARNESS_DIRNAME);

    // The root-named check fires independent of where under that root the target
    // sits, because if the toplevel itself is `.claude/`, the whole worktree IS the
    // harness config (V-11). Otherwise, ordinary containment: isPathInside is the
    // whole-segment test (V-12), so a sibling like `.claude-evil/` or a trailing
    // separator on the harness path do not fool it either way.
    const inHarness = isHarnessNamed(root) || isPathInside(harnessDir, full);

    if (inHarness) {
      block(
        `role subagents may not touch ${HARNESS_DIRNAME}/ - harness config governs the roles, so a role does not ` +
          `edit it. Ask the orchestrator (tried: ${rel}).`,
      );
    }
  },
});
