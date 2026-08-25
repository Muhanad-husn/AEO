// Issue #125 — `gh pr merge --delete-branch` silently leaves the remote branch behind
// when a worktree holds the local one.
//
// The mechanism, confirmed against cli/cli's own source: `runMerge` calls
// `deleteLocalBranch()` and returns on its error, then `deleteRemoteBranch()`. A
// worktree holds its branch checked out, so `git branch -D` fails, the command returns
// non-zero, and the remote delete is never reached. The merge itself has already gone
// through. So the visible error names the LOCAL branch while the REMOTE branch is what
// silently survives — which is why it goes unnoticed: the operator reads "failed to
// delete local branch", handles that, and has no reason to check `origin`.
//
// It is not theoretical and it is not fixed upstream: no released gh has the worktree
// handling as of v2.98.0 (2026-08-20). `sprint-start` step 4 gives every actor a
// worktree, and step 8 removed it AFTER the merge, so a perfectly followed lane hit the
// held branch every time.
//
// Two structural checks, because SKILL.md is prose:
//   - the ordering, asserted over the commands rather than the sentences, since "remove
//     the worktree before the merge" and "merge, then remove the worktree" differ only
//     in a word that a proximity check cannot read;
//   - the mechanism is written down, so the next editor does not "tidy" the order back.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const SPRINT_START = path.join(repoRoot, 'plugin', 'skills', 'sprint-start', 'SKILL.md');
const SAFE_CLEANUP = path.join(repoRoot, 'plugin', 'skills', 'safe-cleanup', 'SKILL.md');

function read(file) {
  return readFileSync(file, 'utf8');
}

describe('the worktree comes off before the merge (issue #125)', () => {
  test('sprint-start shows the worktree removal and the merge, in that order', () => {
    const text = read(SPRINT_START);
    const removeAt = text.search(/git worktree remove/);
    const mergeAt = text.search(/gh pr merge/);
    assert.notEqual(removeAt, -1, 'sprint-start must show the `git worktree remove` call');
    assert.notEqual(mergeAt, -1, 'sprint-start must show the `gh pr merge` call');
    assert.ok(
      removeAt < mergeAt,
      'sprint-start still removes the worktree after the merge — the merge then hits a held ' +
        'branch, `--delete-branch` aborts at the local step, and the remote branch survives',
    );
  });

  test('sprint-start says why the order matters, not just what the order is', () => {
    // An unexplained ordering is one an editor rewrites for readability. The reason has
    // to travel with it: the flag involved, and which end goes uncleaned.
    const text = read(SPRINT_START);
    assert.match(text, /--delete-branch/, 'name the flag whose behaviour forces the order');
    assert.match(
      text,
      /remote[\s\S]{0,200}?(surviv\w*|behind|uncleaned|not deleted)|(?:surviv\w*|behind|uncleaned)[\s\S]{0,200}?remote/i,
      'say that the remote branch is what survives — the local failure is the visible half',
    );
  });

  test('safe-cleanup keeps its local-only posture', () => {
    // Issue #125 asks for reporting, explicitly not deletion: widening this skill to
    // delete on the remote would be a change of posture and a separate decision.
    const text = read(SAFE_CLEANUP);
    assert.match(
      text,
      /never (?:touch(?:es)?|delete[sd]?)[\s\S]{0,40}remote|remote[\s\S]{0,40}never (?:touch(?:es)?|delete[sd]?)/i,
      'safe-cleanup must still state that it never deletes on the remote',
    );
  });

  test('safe-cleanup reports the branches already stranded on the remote', () => {
    // The reorder fixes new sprints. It does nothing for the ones already sitting on
    // `origin` from previous sessions, and nothing in the plugin would ever notice them.
    const text = read(SAFE_CLEANUP);
    assert.match(
      text,
      /report[\s\S]{0,300}?remote branch/i,
      'safe-cleanup must say it reports remote branches whose PR merged',
    );
    assert.match(
      text,
      /git push origin --delete|git push <remote> --delete/,
      'safe-cleanup must hand the founder the command that retires one, since it will not',
    );
  });
});
