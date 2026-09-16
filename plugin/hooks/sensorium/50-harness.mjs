// The sensorium's fifth section (#185): the harness's own cost this session, from the
// same files scripts/score/harness.mjs measures for a consumer's score row -- the
// founder's `~/.claude/settings.json`, the project's `.claude/settings.json` and
// `.claude/settings.local.json`, every enabled plugin's `hooks.json`, agents and
// skill descriptions, and both `CLAUDE.md` files.
//
// Calls `measureCost`, not `measure`: tests-over-source is out of scope for session
// start (plans/phase-2/05-harness-cost.md), and skipping it means this section never
// pays for the tree walk (or `git ls-files` shell-out) `testsOverSource` does.
import { homedir } from 'node:os';
import { join } from 'node:path';

import { measureCost } from '../harness-cost.mjs';

export const name = '50-harness';

function homeDir() {
  return process.env.AEO_HOME_DIR || join(homedir(), '.claude');
}

export function render({ root }) {
  const { processes, sessionStartLines } = measureCost(root, { homeDir: homeDir() });
  return [
    `harness: bash ${processes.bash} node, grep ${processes.grep}, read ${processes.read}, ` +
      `task ${processes.task}; session start ${sessionStartLines} lines`,
  ];
}
