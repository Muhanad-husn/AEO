// Live acceptance test for the score row: a fresh clone of Muhanad-husn/RLM, read
// twice, over the network. Skips loudly when no clone is available, so the fast tier
// never touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSlug } from '../../scripts/score/sources.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'scripts', 'score.mjs');
const clone = process.env.AEO_RLM_CLONE;
const hasClone = clone && existsSync(clone) && statSync(clone).isDirectory();

test(
  'two live runs of the score script are byte-identical',
  { skip: hasClone ? false : 'AEO_RLM_CLONE not set: live run needs a clone of Muhanad-husn/RLM' },
  async (t) => {
    const run = () => execFileSync(process.execPath, [script, clone, '--phases', '0-5'], {
      encoding: 'utf8',
      timeout: 120000,
    });

    const first = run();
    const second = run();

    assert.equal(first, second);
    assert.match(first, /^days: 4$/m);
    assert.match(first, /^dollars: 3\.50$/m);
    assert.match(first, /^prs: 48 merged$/m);
    assert.match(first, /tests \d+\.\d\d of source \(\d+ \/ \d+\)/);

    const projectsRoot = join(homedir(), '.claude', 'projects');
    const slug = projectSlug(clone);
    const hasTranscripts = existsSync(projectsRoot)
      && readdirSync(projectsRoot, { withFileTypes: true })
        .some((entry) => entry.isDirectory() && entry.name.startsWith(slug));

    await t.test(
      'interventions line reads no transcripts',
      // The founder's own machine may hold transcripts for this clone; skip rather
      // than fail when that is so.
      { skip: hasTranscripts ? 'transcripts exist for this clone on this machine' : false },
      () => {
        assert.match(first, /^interventions: no transcripts$/m);
      },
    );
  },
);
