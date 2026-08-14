// Issue #112 — the reviewer reads every pull request, not only high-risk or
// founder-requested ones.
//
// Before this slice, `safe-pr` dispatched the reviewer only on a row of the risk
// rubric that asked for it, so a normal slice never got read by anything but the
// founder. The fix makes the dispatch an unconditional step of `safe-pr`'s own
// procedure, decoupled from the rubric, which keeps its existing job of deciding
// only whether the separate `verify` lane also runs. This test pins that shape
// structurally, the same way `tests/skills/sprint-start-ordering.test.mjs` pins an
// ordering constraint: paragraphs, not prose quality.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const SAFE_PR = path.join(repoRoot, 'plugin', 'skills', 'safe-pr', 'SKILL.md');
const REVIEWER_AGENT = path.join(repoRoot, 'plugin', 'agents', 'reviewer.md');
const REVIEW_SKILL = path.join(repoRoot, 'plugin', 'skills', 'review', 'SKILL.md');
const FIX_SKILL = path.join(repoRoot, 'plugin', 'skills', 'fix', 'SKILL.md');
const SPRINT_START = path.join(repoRoot, 'plugin', 'skills', 'sprint-start', 'SKILL.md');

function read(file) {
  return readFileSync(file, 'utf8');
}

function paragraphsOf(source) {
  return source.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

/** A conditional phrase that would make the reviewer's dispatch depend on a risk
 *  signal rather than run every time. Any of these surviving next to a reviewer
 *  dispatch is the exact defect issue #112 reports. */
const CONDITIONAL_REVIEW_LANGUAGE = /founder-requested|high-blast-radius|blast radius|when it's warranted|on a row that asks for (review|verification)/i;

describe('the reviewer dispatch is unconditional (issue #112)', () => {
  test('safe-pr dispatches the reviewer as its own step, not a branch of the risk rubric', () => {
    const text = read(SAFE_PR);
    const paragraphs = paragraphsOf(text);
    const reviewerParagraph = paragraphs.find((p) => /dispatch(es|ed)?\s+the\s+reviewer/i.test(p));
    assert.ok(reviewerParagraph, 'no paragraph in safe-pr/SKILL.md dispatches the reviewer');
    assert.match(reviewerParagraph, /every\s+(pull request|PR)/i, 'the reviewer-dispatch paragraph does not say "every PR"');
    assert.doesNotMatch(
      reviewerParagraph,
      CONDITIONAL_REVIEW_LANGUAGE,
      'the reviewer-dispatch paragraph still ties dispatch to a risk signal',
    );
  });

  test('the risk rubric is still named, but only for the separate verify lane', () => {
    const text = read(SAFE_PR);
    const paragraphs = paragraphsOf(text);
    const rubricParagraph = paragraphs.find((p) => p.includes('risk-rubric.md'));
    assert.ok(rubricParagraph, 'safe-pr/SKILL.md no longer names the risk rubric');
    assert.match(rubricParagraph, /`verify`/, 'the rubric paragraph no longer ties the rubric to the verify lane');
    assert.match(
      rubricParagraph,
      /never whether review itself happens|only whether/i,
      'the rubric paragraph does not say its job is now limited to the verify lane',
    );
  });

  test('the routine packet is stated explicitly, and it is not a smaller one', () => {
    const normalized = read(SAFE_PR).replace(/\s+/g, ' ');
    assert.match(
      normalized,
      /same for a routine slice as for a high-risk one/i,
      'safe-pr/SKILL.md does not say what a routine review packet carries relative to a high-risk one',
    );
  });

  test('reviewer.md no longer restricts itself to high-blast-radius or founder-requested changes', () => {
    const text = read(REVIEWER_AGENT);
    assert.doesNotMatch(
      text,
      /for high-blast-radius or founder-requested changes/i,
      'reviewer.md still describes itself as scoped to high-risk or founder-requested changes',
    );
    assert.match(text, /every pull request/i, 'reviewer.md does not say it is dispatched on every pull request');
  });

  test('the review skill names safe-pr as its unconditional, primary caller', () => {
    const text = read(REVIEW_SKILL);
    assert.match(text, /safe-pr/);
    assert.match(text, /every pull request|unconditionally/i);
  });

  test('the fix lane no longer claims to skip the reviewer stage', () => {
    const text = read(FIX_SKILL);
    assert.doesNotMatch(
      text,
      /no reviewer stage|skipping[^.]*reviewer stage/i,
      'fix/SKILL.md still claims to skip review, which is no longer true once safe-pr dispatches it unconditionally',
    );
  });

  test('sprint-start no longer gates its review step on a risk signal', () => {
    const text = read(SPRINT_START);
    const paragraphs = paragraphsOf(text);
    const reviewStep = paragraphs.find((p) => /^6\.\s*\*\*/.test(p));
    assert.ok(reviewStep, 'sprint-start/SKILL.md step 6 not found — has the procedure been renumbered?');
    assert.doesNotMatch(
      reviewStep,
      CONDITIONAL_REVIEW_LANGUAGE,
      'sprint-start step 6 still gates review on a risk or founder signal',
    );
  });
});
