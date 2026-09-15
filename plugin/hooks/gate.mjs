// AEO gate: the one script hooks.json wires on PreToolUse (#167). It decides nothing
// itself; it reads the payload once and calls the rule modules, which is one node process
// per matched call instead of four on a shell call and one on every Grep, Read and Task.
// `block` throws, so the first rule that refuses wins, as the first refusing hook did.

import { pathToFileURL } from 'node:url';

import { SHELL_TOOLS, runGate } from './lib.mjs';
import { blockMergeGate } from './block-merge.mjs';
import { redirectGuard } from './redirect-guard.mjs';
import { pathGuard } from './path-guard.mjs';
import { sandboxGuard } from './sandbox-guard.mjs';

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const FORGE_TOOL_RE = /^mcp__.*github.*__/i;

/** @param {object} payload */
export function gate(payload) {
  const tool = typeof payload?.tool_name === 'string' ? payload.tool_name : '';

  if (SHELL_TOOLS.has(tool)) {
    blockMergeGate(payload);
    redirectGuard(payload);
    sandboxGuard(payload);
    return;
  }

  if (WRITE_TOOLS.has(tool)) {
    pathGuard(payload);
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
