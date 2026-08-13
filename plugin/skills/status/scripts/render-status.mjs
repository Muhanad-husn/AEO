#!/usr/bin/env node
/**
 * render-status.mjs -- the `status` skill's own entry point (issue #81, P6.3).
 *
 * Prints the project's current state: open issues (triaged into open / in flight /
 * blocked), open PRs with their check state, and the Decision Log -- every field read
 * fresh from git and gh on this run. Nothing here is written, cached, or hand-
 * maintained (D5): re-run it and it re-reads the record.
 *
 * The actual rendering lives in ../../../hooks/status-render.mjs, shared with
 * session-status.mjs's SessionStart hook so the two never drift into differently-
 * shaped answers to the same question ("one renderer, two callers").
 *
 * Usage:
 *   node ${CLAUDE_PLUGIN_ROOT}/skills/status/scripts/render-status.mjs
 *
 * The project root is resolved through lib.mjs's own worktree resolution (payload.cwd,
 * then CLAUDE_PROJECT_DIR, then this process's cwd) -- the same order every gate in the
 * plugin uses, so this agrees with them about which repository it is reporting on.
 */

import { resolveWorktree } from '../../../hooks/lib.mjs';
import { renderStatusView } from '../../../hooks/status-render.mjs';

async function main() {
  const { toplevel: root } = resolveWorktree({});
  const text = await renderStatusView(root);
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

main().catch((err) => {
  // Not a hook -- there is no "never blocks" contract to uphold -- but a stack trace is
  // a worse answer than a plain line naming what happened, so the founder isn't left
  // reading a crash instead of a status.
  process.stderr.write(`status: could not render (${err?.message ?? err}).\n`);
  process.exitCode = 1;
});
