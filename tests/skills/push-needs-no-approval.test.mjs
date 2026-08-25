// Issue #126 — pushing a feature branch and opening a pull request need no founder
// approval. Only the merge does.
//
// `safe-pr` step 6 stopped the lane for an explicit confirmation before the push, and
// its safety rules called a push and `gh pr create` "outward-facing"; `tdd-ci` step 6
// carried a matching "Confirm before pushing". D30 had already settled the same
// question in the opposite direction in code: `block-merge.mjs` deliberately stopped
// refusing a push, because branch protection refuses the dangerous cases server-side.
// So the enforcement layer treated merge as the risk and push as ordinary work, while
// the written lanes were stricter than the gates for no stated reason.
//
// These are prose, not executables, so the assertions are structural. Neither a
// sentence nor a paragraph is the right unit: step 6 of `safe-pr` put the gate in one
// sentence ("get explicit confirmation") and the act in the next ("Then push"), while
// the safety rule put both in one. So the check is proximity — a human-gate word
// shortly before a push, with nothing between them to say the gate is about the merge.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const SAFE_PR = path.join(repoRoot, 'plugin', 'skills', 'safe-pr', 'SKILL.md');
const TDD_CI = path.join(repoRoot, 'plugin', 'skills', 'tdd-ci', 'SKILL.md');

function read(file) {
  return readFileSync(file, 'utf8');
}

/** Sentences, roughly: split on sentence-final punctuation and on line breaks, so a
 *  bullet or a numbered step counts as its own unit even without a full stop. Fenced
 *  code blocks are dropped first — a `git push` line inside a fence is the command
 *  being documented, not prose about approving it. */
function sentencesOf(source) {
  const withoutFences = source.replace(/```[\s\S]*?```/g, ' ');
  return withoutFences
    .split(/(?<=[.!?:])\s+|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Language that makes something wait for a human. "approval"/"approve" is included
 *  deliberately: "needs founder approval" is the exact shape being removed from the
 *  push, and kept on the merge. */
const HUMAN_GATE = /\b(confirm\w*|approv\w*|sign-?off|go-ahead|permission)\b/gi;

/** The two acts issue #126 says need no approval: pushing a feature branch, and
 *  opening the pull request. */
const PUSH_OR_PR_OPEN = /\bpush\w*\b|gh pr create/gi;

/** A gate that is about the merge may wait for a human — that is the whole design,
 *  and issue #126 asks for it to be left exactly as it is. Repository settings are
 *  the same: `tdd-ci` step 7 proposes a required status check and waits, correctly.
 *  Looked for just before the gate word too, since that is where the subject sits
 *  ("Changing repo settings needs explicit founder approval"). */
const LEGITIMATE_SUBJECT = /\bmerg\w*\b|\brepo(?:sitory)? settings\b|\bbranch protection\b/i;

/** How far back the gate word's own subject can sit. */
const SUBJECT_LOOKBEHIND = 120;

/** A negation between the gate word and the act — "needs no approval", "never waits
 *  for" — is the new rule being stated, not the old one surviving. */
const NEGATED = /\bno\b|\bnot\b|\bnever\b|\bwithout\b/i;

/** How far a gate word can sit from the act it gates and still be gating it. Step 6's
 *  "get explicit confirmation — this is outward-facing. Then push:" spans about 40
 *  characters; 200 covers a sentence boundary without reaching across a whole step. */
const GATE_REACH = 200;

/** Every span where a human-gate word is followed, within reach, by a push or a
 *  `gh pr create`, and nothing in between says the gate is about something else. */
function gatedPushes(source) {
  const text = sentencesOf(source).join(' ');
  const gates = [...text.matchAll(HUMAN_GATE)];
  const acts = [...text.matchAll(PUSH_OR_PR_OPEN)];
  const spans = [];
  for (const gate of gates) {
    const gateEnd = gate.index + gate[0].length;
    for (const act of acts) {
      if (act.index < gateEnd || act.index - gateEnd > GATE_REACH) continue;
      if (NEGATED.test(text.slice(gateEnd, act.index))) continue;
      const subjectWindow = text.slice(Math.max(0, gate.index - SUBJECT_LOOKBEHIND), act.index);
      if (LEGITIMATE_SUBJECT.test(subjectWindow)) continue;
      spans.push(text.slice(gate.index, act.index + act[0].length));
      break;
    }
  }
  return spans;
}

describe('a feature-branch push and a PR need no founder approval (issue #126)', () => {
  test('safe-pr does not gate the push or gh pr create behind a confirmation', () => {
    const offenders = gatedPushes(read(SAFE_PR));
    assert.deepEqual(
      offenders,
      [],
      'safe-pr still stops for a human before pushing or opening the PR:\n  ' +
        offenders.join('\n  '),
    );
  });

  test('tdd-ci does not gate the push behind a confirmation', () => {
    const offenders = gatedPushes(read(TDD_CI));
    assert.deepEqual(
      offenders,
      [],
      'tdd-ci still stops for a human before pushing:\n  ' + offenders.join('\n  '),
    );
  });

  test('safe-pr states the rule positively, rather than only dropping the old one', () => {
    // A deletion alone would leave the lane silent on the question, and the next
    // editor with a safety instinct would put the stop back. The skill has to say
    // which act needs a human and which does not.
    const statesIt = sentencesOf(read(SAFE_PR)).some(
      (s) =>
        /\bneeds? no\b[\s\S]{0,40}\bapproval\b|\bno\b[\s\S]{0,20}\bapproval\b|\bwithout\b[\s\S]{0,30}\bapproval\b/i.test(s)
        && /\bpush\w*\b|gh pr create|pull request/i.test(s),
    );
    assert.ok(
      statesIt,
      'safe-pr should say in so many words that a feature-branch push and a PR need no approval',
    );
  });

  test('every merge-side rule survives untouched', () => {
    // The point of the change is that the merge is the only gate — so the merge gate
    // had better still be there. This is the regression guard on overshoot.
    const text = read(SAFE_PR);
    assert.match(
      text,
      /never merges/i,
      'safe-pr must still state that it never merges',
    );
    assert.match(
      text,
      /merg\w*[\s\S]{0,120}founder approval/i,
      'safe-pr must still state that the merge waits for founder approval',
    );
  });

  test('the push safety rules that are about the act, not the approver, survive', () => {
    const text = read(SAFE_PR);
    assert.match(text, /never force-push/i, 'safe-pr must still refuse a force-push');
    assert.match(
      text,
      /never push to the default\s+branch/i,
      'safe-pr must still refuse a push to the default branch',
    );
  });
});
