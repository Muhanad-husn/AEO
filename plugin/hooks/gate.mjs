// AEO gate: the one script hooks.json wires on PreToolUse (#167). It decides nothing
// itself; it reads the payload once and calls the rule modules, which is one node process
// per matched call. `block` throws, so the first rule that refuses wins.
//
// Two modules remain: block-merge, which keeps merging and branch deletion with the
// founder, and sandbox-guard, which refuses a write under the declared production data
// root that git cannot restore. A rule that throws is refused by runGate as a call it
// could not evaluate.

import { pathToFileURL } from 'node:url';

import { SHELL_TOOLS, runGate } from './lib.mjs';
import { blockMergeGate } from './block-merge.mjs';
import { sandboxGuard } from './sandbox-guard.mjs';

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const FORGE_TOOL_RE = /^mcp__.*github.*__/i;

/** @param {object} payload */
export function gate(payload) {
  const tool = typeof payload?.tool_name === 'string' ? payload.tool_name : '';

  if (SHELL_TOOLS.has(tool)) {
    blockMergeGate(payload);
    sandboxGuard(payload);
    return;
  }

  if (WRITE_TOOLS.has(tool)) {
    sandboxGuard(payload);
    return;
  }

  // hooks.json narrows the forge matcher to a merge-named action so a forge call that is
  // not a merge starts no process; block-merge still judges the action, so the matcher is
  // a pre-filter and never the boundary (C-04). Read, NotebookRead, Grep, Glob, Task and
  // BashOutput reach no rule here and no matcher there.
  if (FORGE_TOOL_RE.test(tool)) blockMergeGate(payload);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runGate({ name: 'gate', run: gate });
}
