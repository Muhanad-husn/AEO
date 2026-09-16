// A fast-tier smoke check over the shared status renderer (issue #96).
//
//   node --test tests/skills/status-render-smoke.test.mjs
//
// The renderer's real test is tests/skills/status.test.mjs, which spawns the skill's
// script against a fake `gh` in a throwaway git repository. That cost is why it lives in
// the integration tier, and D26 says it stays there. The consequence D26 also records is
// that a commit which breaks the renderer still passes the fast tier alone (D26, amended
// by D30). This file narrows that window with an in-process import and four pure calls:
// no process is spawned, no git is run, no network is touched.
//
// plugin/hooks/status-render.mjs is one renderer with two callers -- the `status` skill's
// script and session-status.mjs's SessionStart hook. What is asserted here is the renderer
// itself: that the module loads, that the entry points both callers import are still
// exported, and that each produces output against a literal fixture. Neither caller's
// process wiring is in scope; that is what the integration tier already covers, for each
// caller, at the cost that put it there.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parseDecisionLog,
  renderIssueTriage,
  renderOpenPrsWithChecks,
  renderSection,
  formatPrLine,
  summarizeChecks,
} from '../../plugin/hooks/status-render.mjs';
// The sensorium (#181): renderStatusView now prepends this block ahead of everything
// tested above. Imported straight from sensorium.mjs, not through renderStatusView,
// because renderStatusView's own path also calls gh -- exactly the process-spawning,
// network-touching cost this file's header says it exists to avoid. The full
// integration, gh included, is tests/hooks/sensorium.test.mjs's job (fast tier too,
// via a faked gh, but a separate file since it does spawn processes).
import { renderSensorium } from '../../plugin/hooks/sensorium.mjs';

// The gh answer shape both callers pass in, small enough to read at a glance. `ok: true`
// with data is the populated path; the unknown and empty paths are the integration
// tier's, since getting them wrong is a subtler failure than the module not working.
const ISSUES = {
  ok: true,
  data: [
    { number: 10, title: 'plain backlog issue', labels: [{ name: 'bug' }], assignees: [] },
    { number: 13, title: 'blocked issue', labels: [], assignees: [], blockedBy: { totalCount: 1, nodes: [{ number: 9 }] } },
  ],
};

const PRS = {
  ok: true,
  data: [{ number: 20, title: 'passing pr', isDraft: false, statusCheckRollup: [{ conclusion: 'SUCCESS', status: 'COMPLETED' }] }],
};

describe('the shared renderer loads with the exports both callers use', () => {
  test('every entry point the two callers import is a function', () => {
    // An import that resolves to undefined is how a moved or renamed export breaks a
    // caller, and it breaks it at call time rather than at load time.
    for (const [name, fn] of Object.entries({
      parseDecisionLog,
      renderIssueTriage,
      renderOpenPrsWithChecks,
      renderSection,
      formatPrLine,
      summarizeChecks,
    })) {
      assert.equal(typeof fn, 'function', `status-render.mjs no longer exports ${name}`);
    }
  });
});

describe('each renderer produces output against a fixture', () => {
  test('issues render into their triage buckets', () => {
    const out = renderIssueTriage(ISSUES).join('\n');
    assert.match(out, /\*\*Issues \(2\):\*\*/);
    assert.match(out, /- #10 plain backlog issue/);
    assert.match(out, /- #13 blocked issue/);
  });

  test('open PRs render with check state', () => {
    const out = renderOpenPrsWithChecks(PRS).join('\n');
    assert.match(out, /\*\*Open PRs \(1\):\*\*/);
    assert.match(out, /- #20 passing pr {2}\[checks: passing\]/);
  });

  test('decision headings parse into identifier and title', () => {
    const decisions = parseDecisionLog('### D5 — GitHub issues are the single source of truth\n\nbody\n');
    assert.deepEqual(decisions, [{ id: 'D5', number: 5, title: 'GitHub issues are the single source of truth' }]);
  });
});

describe('the sensorium (#181) leads renderStatusView\'s output', () => {
  test('its block, on its own, begins with score:', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'aeo-status-render-smoke-'));
    try {
      const out = (await renderSensorium(dir)).join('\n');
      assert.ok(out.startsWith('score:'), `expected the sensorium block to start with "score:", got: ${out}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
