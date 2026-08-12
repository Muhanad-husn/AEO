# P4.2 — The independent verifier

2026-08-12. Branch `feat/phase-4/p4.2-verifier`, worktree `D:/AEO-wt/issue-5`,
issue #5. Model tier: Opus.

**Status: DONE_WITH_CONCERNS.** Everything the issue asks for is built and the
control has run. The concern is a measurement one, and it is the interesting part of
this slice: the verifier caught every planted defect in every run, and it also
declined to pass most of the clean twins. Read the numbers section before quoting a
detection rate from here.

## What landed

| File | What it is |
| --- | --- |
| `plugin/agents/verifier.md` | The charter. Fresh agent, tools Read only, Opus, advisory findings with confidence |
| `plugin/skills/verify/SKILL.md` | The lane. Operator-invoked, disable-model-invocation true |
| `plugin/skills/verify/references/risk-rubric.md` | The single copy of the risk rubric, with both consumers named |
| `tests/verify/cases.mjs` | Six planted defects and their clean twins |
| `tests/verify/positive-control.mjs` | The control runner. Model calls, no threshold, prints ranges |
| `tests/verify/positive-control.test.mjs` | The deterministic half: scorer, case inventory, packet leakage |
| `tests/skills/risk-rubric.test.mjs` | One table, three rows, two consumers, no second copy |

Changed alongside: `plugin/skills/safe-pr/SKILL.md` gains the rubric reference at
its approval step, since it is the second consumer; `plugin/hooks/review-jail.mjs`
and its tests seal the verifier as well as the reviewer; `evals/grade-plugin.mjs`
and its tests move to thirteen skills and five agents; `package.json` gains the two
new fast-tier files; the stage paragraph in `CLAUDE.md` updates its counts.

## The three settled rules, as built

**One rubric, two consumers.** The table lives once, in
`plugin/skills/verify/references/risk-rubric.md`. The verify lane and safe-pr each
point at that path and neither restates it. `tests/skills/risk-rubric.test.mjs`
walks the whole plugin tree and fails if any other file carries a table row ending
in one of the three verdicts.

Checkpoint 4 asks that the two consumers agree on a change sitting on each of the
three rows. That is not something a test can settle by classifying sample changes.
Doing so would need a classifier, which is a hand-tuned heuristic standing in for
the judgment the rubric asks a reader to make. What the test settles is the property
that makes agreement structural instead of lucky: one table, those three rows, both
consumers pointing at it, neither holding a copy. The rubric also states the reading
rules the bare table leaves open. Highest matching row wins; touching is about what
moved, not how much; when unclear, take the higher row.

**CI owns the oracles.** Stated in the rubric, in the charter, and in the lane's
relay step. The charter tells the verifier to stop and hand back a test when it
finds itself judging something an assertion could settle. The lane routes any
finding that could have been a failing test into CI rather than into the verdict.

**Advisory, never a gate.** No hook was added for this. Nothing in hooks.json
changed. The lane says findings post to the pull request and the founder weighs
them, and the rubric repeats it so a future copy of the table cannot lose the
sentence.

## Two design calls that were genuinely open

**verify is an operator lane, not a description-triggered skill.** The issue left
this to the slice. It carries disable-model-invocation true, which makes it a
seventh lane.

The rubric is the trigger. If the skill also fired on its own description, the model
would be making two judgments where one suffices: whether to consult the rubric, and
then what the rubric says. That is how "proportional to risk" decays into "every
change is medium and full verification runs every time", which is the failure the
rubric exists to prevent. Verification also costs a full extra agent dispatch and
posts to a pull request, and every other lane that spends or writes outward is
operator-invoked. review, the closest sibling, is a lane for the same reasons.

**The verifier is sealed by the existing jail, not by its charter alone.** This is
the one place the slice went past its stated file list, and it is a deliberate call.

The header of `review-jail.mjs` records why the reviewer's independence is a hook and
not a sentence: an agent holding file tools reads the repository whatever it is told.
A verifier whose entire product is a verdict about the packet it was handed has the
same exposure, so shipping it with Read and a charter that asks it not to look would
reproduce the defect that hook exists to record. The change is one constant becoming
a list, plus the role being read off the payload so each jailed role is told which
one it is. Five tests were added, including one asserting the reviewer is not told it
is the verifier and the reverse. No new gate: this is an existing gate applied to a
second role.

## The positive control, and what it actually measures

Six planted defects, each with a clean twin of the same packet. Every defect sits
where the verifier's territory is. An operator message that names no cause. A toggle
whose label and helper text disagree. A quickstart step invoking a command nothing
installs. A zero that means "not measured". A release note contradicted by its own
example. A migration guide that promises three breaking changes and documents two.
None of them could be caught by an assertion.

The packet is a claim and an artifact and nothing else. The maintainer's note
describing what was planted is never staged; a test asserts that, and asserts that
no packet contains the words plant, defect, expected, verdict, or any of the four
status words. A judge shown a pre-fill agrees with it.

### Numbers

Two configurations were run three times each, plus two earlier configurations
discarded for reasons recorded below. Every run is 6 cases by 2 variants, so 12
dispatches, on Opus, invoked with print and safe-mode and no tools, from a working
directory outside this repository.

| | run 1 | run 2 | run 3 |
| --- | --- | --- | --- |
| **Set A** defective packet not passed | 6/6 | 6/6 | 6/6 |
| clean twin not passed | 5/6 | 4/6 | 5/6 |
| defect named in matched words | 6/6 | 6/6 | 5/6 |
| same complaint on the twin | 2/6 | 3/6 | 4/6 |
| **Set B** defective packet not passed | 6/6 | 6/6 | 6/6 |
| clean twin not passed | 4/6 | 4/6 | 6/6 |
| defect named in matched words | 6/6 | 5/6 | 6/6 |
| same complaint on the twin | 4/6 | 4/6 | 4/6 |

**Detection: 36 of 36 defective dispatches, across six runs. No spread at all.**
That is the number the slice was gated on, and it is unambiguous. The reports were
read, and in every case the finding is the planted defect, usually first and at
confidence 85 to 95.

**The floor is high. The twins were refused 67% to 100% of the time.** Reading those
reports is what makes the number interpretable, and it does not say the verifier
objects to everything. The twin objections are real, specific and different: the
quickstart twin still clones from a reserved documentation domain, which hosts no
repository; the cleanup twin names a worktree for two of its three refusals and not
the third; the migration twin does not say what happens to a config file that still
holds the removed key. **The twins are clean of the planted defect, not clean of
everything.** That is a limitation of the control's design, stated rather than tuned
away.

The sharper reading is the same complaint made about the twin where it no longer
applies: 33% to 67%. It concentrates in the two cases whose twins genuinely retain a
weaker form of the same gap, which is the same limitation seen from the other side.

### What was discarded, and why

Two earlier configurations are not in the table. They are recorded because the
numbers moved and the reason matters more than the numbers.

**Keyword anchoring as the headline rate undercounts badly.** The first scorer
counted a catch as flagged plus a regex match for this defect's complaint. It scored
reports as misses that had found the planted defect exactly at confidence 95, because
they wrote that "refused" is the event and not a reason, where the matcher wanted the
phrase "no reason given". A vocabulary list is not a semantics check, and a number
produced by one describes the list. The headline pair became the flag rate on
defective packets against the flag rate on their twins. The keyword reading survives
as a column labelled a lower bound, because it still catches the case where the
verifier flagged something else entirely.

**Three of thirty-six early dispatches produced no report at all.** The charter tells
the verifier its one call is a Read of the staged packet; the control inlines the
packet and runs with tools off, so those runs opened with a Read attempt and ended
there. The fix is one sentence in the harness footer saying there are no tools. It is
byte-identical across every packet and says nothing about completeness, because an
insufficient packet has to stay reportable or NEEDS_CONTEXT stops meaning anything.
Both later configurations produced zero unparsed reports.

**Two anchors were widened after reading reports.** One of them for the case about a
zero that means unmeasured, after a run in which the verifier found the defect and
described it in words the anchor did not carry. This is disclosed rather than quietly
folded in: anchors were calibrated against observed language before the reported
runs, so the named column is not an independent measurement of the anchors
themselves.

### What the control does not test

The hook. The control exercises the charter's judgment with the packet inlined; it
does not exercise the seal that keeps a real verifier out of the repository. That
seal has its own tests in `tests/hooks/review-jail.test.mjs`.

## Tripwires

One thing was checked and deliberately not built: a rubric classifier. A function
mapping a diff to one of the three rows would be a hand-tuned heuristic replacing the
judgment the rubric asks a reader for, and it would be the fourth row the issue warns
about wearing a different hat. The rubric grew no fourth row, no config option and no
confidence threshold. The control has no pass threshold, on purpose. It reports and a
person reads it, and a bar baked in here would be a constant tuned to whichever run
happened to be in front of whoever wrote it.

One thing did grow. The control reports four rates rather than two. Each answers a
different question and the runner's header says which. Two would have been fewer
numbers and a worse answer, because detection alone cannot tell judgment from reflex.

## Test numbers

- `npm test`, the fast tier: **275 tests, 0 failures**, up from 235. New: 33 in
  `tests/verify/positive-control.test.mjs`, 7 in `tests/skills/risk-rubric.test.mjs`.
- `npm run grade:plugin`: **114/114**, thirteen skills and five agents.
- `tests/hooks/review-jail.test.mjs` run directly: **55 tests, 0 failures**, up from
  50. The 50 reviewer cases are unchanged and were not edited.

The full integration battery was not re-run here. It is a nine-minute Windows suite
and CI's tier by policy, and concurrent builders re-running it is a wall-clock cost
with no extra signal. The one integration file this slice touches was run on its own
instead.
