// Issue #65 — the P7.4 dry run caught `sprint-start` dispatching the verifier before
// staging its review packet. `review-jail` refused the verifier's first Read and the
// lane recovered on its own by restaging and re-running, but nothing had pinned the
// ordering, so nothing would have caught a repeat.
//
// `plugin/skills/verify/SKILL.md` already states packet-before-dispatch (its step 2
// assembles the packet; step 3 dispatches). The bug was `sprint-start` — the
// orchestrating skill — not restating that order at either place it can trigger a
// verifier dispatch, so a session running the procedure had nothing local to stop it
// jumping straight to dispatch.
//
// This is prose, not an executable, so the assertion is structural rather than a
// runtime check: for every paragraph in SKILL.md that talks about dispatching the
// verifier, a staging instruction ("stage" + "packet") must appear earlier in that same
// paragraph. That fails on the pre-fix file two ways at once — no dispatch mention
// carries staging language, and in fact no paragraph mentions the verifier at all — and
// it fails just as hard on a future edit that adds a new dispatch path without carrying
// the ordering along, which is the scenario the issue asks this test to guard.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const SKILL_PATH = path.resolve(
  import.meta.dirname,
  '../../plugin/skills/sprint-start/SKILL.md',
);

/** A staging instruction: the word "stage" (in some form) followed, within the same
 *  paragraph, by "packet". Matches "stage the review packet", "stages its own packet",
 *  etc. without pinning exact wording beyond that. */
const STAGE_BEFORE_PACKET = /\bstag(?:e|es|ed|ing)\b[\s\S]{0,120}?\bpacket\b/i;

/** A mention of the verifier being dispatched, in either word order, so "dispatch the
 *  verifier" and "verifier is dispatched" both count. */
const VERIFIER_DISPATCH = /(?:\bdispatch\w*\b[\s\S]{0,80}?\bverifier\b)|(?:\bverifier\b[\s\S]{0,80}?\bdispatch\w*\b)/i;

/** Paragraphs are SKILL.md's natural unit here: each numbered step, and each bullet
 *  under the concurrent section, is separated from its neighbours by a blank line. */
function paragraphsOf(source) {
  return source.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

describe('sprint-start stages the review packet before it dispatches the verifier (issue #65)', () => {
  const source = readFileSync(SKILL_PATH, 'utf8');
  const paragraphs = paragraphsOf(source);
  const dispatchParagraphs = paragraphs.filter((p) => VERIFIER_DISPATCH.test(p));

  test('the skill documents at least two places that can dispatch the verifier', () => {
    // The single-actor procedure (step 7, via safe-pr) and the concurrent section's
    // per-actor dispatch (step 6, which re-runs step 7 once per actor). Both are real
    // dispatch points and both need the ordering stated, per the issue's "every path"
    // acceptance line.
    assert.ok(
      dispatchParagraphs.length >= 2,
      `expected at least 2 paragraphs mentioning a verifier dispatch, found ${dispatchParagraphs.length}. ` +
        'If this is 0, the ordering instruction this test guards is missing entirely.',
    );
  });

  test('every paragraph that dispatches the verifier stages the packet first', () => {
    assert.ok(dispatchParagraphs.length > 0, 'no verifier-dispatch paragraph found to check');
    for (const paragraph of dispatchParagraphs) {
      const stageMatch = STAGE_BEFORE_PACKET.exec(paragraph);
      const dispatchMatch = VERIFIER_DISPATCH.exec(paragraph);
      assert.ok(
        stageMatch,
        `no "stage ... packet" instruction found in a paragraph that dispatches the verifier:\n${paragraph}`,
      );
      assert.ok(
        stageMatch.index < dispatchMatch.index,
        `the staging instruction must appear before the dispatch mention, not after:\n${paragraph}`,
      );
    }
  });

  test('the single-actor procedure step (safe-pr) carries the ordering', () => {
    const step7 = paragraphs.find((p) => /^7\.\s*\*\*Prepare the PR\*\*/.test(p));
    assert.ok(step7, 'step 7 ("Prepare the PR") not found — has the procedure been renumbered?');
    assert.match(step7, VERIFIER_DISPATCH);
    assert.match(step7, STAGE_BEFORE_PACKET);
  });

  test('the concurrent per-actor dispatch step carries the ordering too', () => {
    const concurrentStep6 = paragraphs.find((p) =>
      /^6\.\s*\*\*Cut each worktree and dispatch each actor\.\*\*/.test(p),
    );
    assert.ok(
      concurrentStep6,
      'the concurrent "Cut each worktree and dispatch each actor" step not found — has it moved or been renamed?',
    );
    assert.match(concurrentStep6, VERIFIER_DISPATCH);
    assert.match(concurrentStep6, STAGE_BEFORE_PACKET);
  });
});
