# P6.5: the skill-creator tuning pass, judged by the eval

2026-08-13. Branch `feat/p6.5-tuning-pass`, cut from `main` at `43c3580` — after P6.4's
trigger eval (#88) landed.

[D23](../../docs/DECISIONS.md) sets the bar this slice is held to: *"Phase 6 may not tune
a description and declare it improved without the eval. A tuning pass with no measurement
is the thing principle 6 exists to prevent."* So every number below comes from
[P6.4's harness](../../evals/trigger-eval.mjs), run in P6.4's configuration, against
P6.4's unmodified case set.

**Five of the eight description-triggered skills had their `description:` frontmatter line
rewritten. Nothing else in the plugin changed** — not a skill body, not another frontmatter
field, not the case set. The whole diff under `plugin/` is five lines replaced by five
lines. The full before-and-after text of each rewrite, with the reasoning, is in
[`descriptions.md`](descriptions.md) beside this file.

## The result in one paragraph

Three of P6.4's four named defects went from **stable failure to stable pass** — `md-n3`,
`ci-n1` and `rgr-n2` each moved from 0 of 15 repeats correct to 15 of 15. Overall accuracy
moved from **90.2% to 96.8%**, which is larger than either run's noise floor. The fourth
defect, `wd-n2`, **was not fixed**: `tdd-plan`'s grip on it loosened from 14 of 15 repeats
to 5, but `red-green-refactor` picked up 7 of the freed repeats, so the case is still wrong
four times in five. And one case **regressed** — `sc-n2` fell from 15 of 15 to 8 of 15,
on a description this slice never touched.

## Conditions

Identical to P6.4's, because a comparison against a different configuration is not a
comparison.

| | |
| --- | --- |
| Judge | `claude -p`, Claude Code CLI 2.1.229, model alias **`sonnet`** |
| Sampling | CLI defaults. **No temperature and no seed control is exposed** |
| Judge isolation | `--safe-mode --no-session-persistence --strict-mcp-config --tools "" --system-prompt`, run from a neutral temp directory |
| Roster order | fixed alphabetical, not shuffled per repeat |
| Repeats | 5 per run, 3 runs, **15 total** — matching P6.4 exactly |
| Cases | the same 40, unmodified: 19 near misses, 18 positives, 3 controls |
| Concurrency | 4 judge calls in flight |
| Machine | Windows 11 10.0.26200, node v24.16.0 |

One condition differed in practice and is worth naming because it cost time rather than
accuracy: the machine was under heavier load than during P6.4, and a five-repeat run took
roughly thirty minutes instead of seven. Wall clock is not an input to any score here.

`run-1` through `run-3` are stored beside this file as JSON envelopes with every raw judge
answer, plus a report each. `pooled.txt` reads all fifteen repeats together, and
`before-after.txt` is the machine-generated case-by-case diff the tables below are drawn
from.

## The noise floor, restated

**P6.4's floor is binding on the before-number and is restated here first, as L-10
requires.** The after-number has a floor of its own, which is wider, and both are stated
rather than only the convenient one.

| | before (P6.4) | after (P6.5) |
| --- | --- | --- |
| accuracy per repeat, range | 90.0% – 92.5% | 95.0% – 100.0% |
| **overall accuracy floor** | **2.5 pp** (stdev 0.6 pp) | **5.0 pp** (stdev 1.7 pp) |
| run means | 90.00%, 90.50%, 90.00% | 97.00%, 96.50%, 97.00% |
| span of the run means | 0.5 pp | 0.5 pp |
| **case-level floor** | **2 of 40 re-rolled, 5.0%** | **2 of 40 re-rolled, 5.0%** |
| per-skill recall floor | 0 pp on all eight | 0 pp on seven; 33.3 pp on `safe-cleanup` |
| per-skill false-fire floor | ±1 firing/repeat on `tdd-plan` and `worker-dispatch`, 0 elsewhere | ±1 firing/repeat on `tdd-plan` and `red-green-refactor`, 0 elsewhere |

**The gap between the two overall numbers is 6.6 pp, against the larger of the two floors
at 5.0 pp.** That is the only reading under which the aggregate movement means anything,
and it is the one to quote. The three run means still span 0.5 pp, so run-to-run
reproducibility is as tight as it was; what widened is the spread *within* a run, and the
next section says exactly which case caused it.

## What flipped, case by case

Five of the forty cases changed their verdict distribution. **These five are the result.
The totals above are a summary of this table, not a substitute for it.**

| case | expected | before, 15 repeats | after, 15 repeats | direction |
| --- | --- | --- | --- | --- |
| `md-n3` | `monitor-design` | NONE ×15 | **`monitor-design` ×15** | **fixed** |
| `ci-n1` | `tdd-ci` | NONE ×15 | **`tdd-ci` ×15** | **fixed** |
| `rgr-n2` | `red-green-refactor` | `worker-dispatch` ×8, NONE ×7 | **`red-green-refactor` ×15** | **fixed** |
| `wd-n2` | NONE | `tdd-plan` ×14, NONE ×1 | `red-green-refactor` ×7, `tdd-plan` ×5, NONE ×3 | **not fixed, redistributed** |
| `sc-n2` | `safe-cleanup` | `safe-cleanup` ×15 | `safe-cleanup` ×8, NONE ×7 | **regressed** |

Thirty-eight of the forty cases were unanimous across all fifteen repeats, the same count
as before — but **all thirty-eight are now correct, where before two of them were
unanimously wrong**. The two cases that re-roll are `wd-n2` and `sc-n2`, and they are the
two entries below the line.

## Per-skill, before and after

Mean over fifteen repeats in each column. `n` is the number of cases the skill was owed.
**False fires** counts cases per repeat that selected this skill and should not have.

| skill | n | recall | false fires/repeat | precision | verdict |
| --- | --- | --- | --- | --- | --- |
| `monitor-design` | 3 | 66.7% → **100%** | 0 → 0 | 100% → 100% | **+33.3 pp, above floor** |
| `new-project` | 4 | 100% → 100% | 0 → 0 | 100% → 100% | unchanged, not edited |
| `red-green-refactor` | 4 | 75.0% → **100%** | 0 → **0.47** | 100% → **90.7%** | **recall +25 pp; precision fell, above floor** |
| `safe-cleanup` | 3 | 100% → **84.5%** | 0 → 0 | 100% → 100% | **−15.5 pp, above floor. Not edited** |
| `safe-pr` | 3 | 100% → 100% | 0 → 0 | 100% → 100% | unchanged, not edited |
| `tdd-ci` | 4 | 75.0% → **100%** | 0 → 0 | 100% → 100% | **+25 pp, above floor** |
| `tdd-plan` | 4 | 100% → 100% | 0.93 → 0.33 | 81.3% → 93.3% | **inside its own ±1 floor — did not move** |
| `worker-dispatch` | 3 | 100% → 100% | 0.53 → 0.00 | 86.7% → 100% | **inside its own ±1 floor — did not move** |

Overall accuracy **90.2% → 96.8%**. Accuracy on the twelve cases that should select
nothing, 92.2% → 93.3%, which is inside the floor and is not a movement.

Two rows in that table need reading carefully, because the aggregate and the case-level
reading disagree and only one of them is honest at each level.

**`tdd-plan` and `worker-dispatch` did not move at the aggregate level.** P6.4 set their
false-fire floor at plus or minus one firing per repeat. `tdd-plan` fell 0.93 → 0.33 and
`worker-dispatch` fell 0.53 → 0.00; both movements are smaller than their own floors, so
**neither precision figure may be claimed as an improvement**, and the 93.3% and 100%
above are reported without a claim attached. What *did* move is visible only in the case
table: `tdd-plan` took `wd-n2` fourteen times before and five times after, and
`worker-dispatch` took `rgr-n2` eight times before and never after. Those are single-case
swings of nine and eight repeats, on cases whose before-state was documented, and they are
the reason the floor is stated per skill *and* the flips are diffed per case. Reading only
the per-skill rows would have called both of these nothing.

## The three that were fixed

Each of these was a fully deterministic failure before and is a fully deterministic pass
now. Nothing here is a coin-flip that landed well.

**`ci-n1`, `tdd-ci`, 0/15 → 15/15.** *"Make the test job a required check on main."* The
old description already contained the literal phrase "make tests a required check" and
still lost the case every time, because every other clause in it described writing a
workflow file. The fix was not another trigger phrase — it was making the required-check
outcome part of what the skill is *for* (which it honestly is; step 7 of the skill body
proposes the `gh api` command that promotes the workflow to a required check) and then
saying outright that the file-shaped and settings-shaped asks are the same job. **A phrase
in a trigger list does not survive a body that contradicts it. Stating the outcome in the
description's own voice does.** That is the transferable lesson of this slice.

**`md-n3`, `monitor-design`, 0/15 → 15/15.** The anti-trigger was scoped by subject matter
— "do not use to check on a run in progress" — which swallowed a request to build a
readout for a job that happened to be running. Rescoping it to what is being *asked for*,
a question about a run's state versus a request for a view of a job, fixed the case
without disturbing either of the two questions the anti-trigger names by hand: `md-n1` and
`md-n2` were still declined all fifteen times.

**`rgr-n2`, `red-green-refactor`, 0/15 → 15/15.** This one needed both sides.
`red-green-refactor`'s three trigger clauses all required the founder to supply TDD
vocabulary or an existing plan file, so a plain request to change some code reached it
through none of them; and `worker-dispatch`'s exclusion was keyed on "implementation work
that needs its own branch and pull request", which does not describe adding a column to
three classes. The discriminator that does work was already in `worker-dispatch`'s body
and not in its description: *if the task needs a test written first, or produces a change
someone should review as a change, it is not a worker task.* Moving that sentence into the
description is what stopped the theft; widening `red-green-refactor` is what made it win.

## The one that was not fixed

**`wd-n2` remains a stable failure.** *"Rewrite the auth module from scratch. It is a big
job, so throw a bunch of agents at it."* Expected NONE; correct in 3 of 15 repeats, up
from 1 of 15. That movement is two repeats on one case and is not a result. **Defect 1 is
open.**

What did happen is a redistribution, and it is two findings rather than a wash. `tdd-plan`
released the case — 14 of 15 down to 5 — which is what removing "Trigger at the start of
new work" and rewriting the `/aeo:sprint-plan` pointer was meant to do, and it worked.
`red-green-refactor` then took 7 of the 15, which it never did before. **The widening that
won `rgr-n2` is the same widening that lost `wd-n2`**, and the two cases are close enough
in shape that no wording tried here separated them.

The structural reason is worth recording, because it bounds how much any description
rewrite can achieve on this case. `wd-n2`'s correct answer is NONE only because its real
handler — sprint-scale planning, `/aeo:sprint-plan` and `sprint-start` — carries
`disable-model-invocation: true` and is therefore invisible to the judge. **The judge is
being asked to decline a legitimate request because the right skill is not on the roster
it can see.** Three roster skills can each make a reasonable claim on "rewrite a module,
use several agents", so all three must actively refuse it, and every refusal costs
coverage somewhere else. That is the trade `rgr-n2` and `wd-n2` sit on either side of.
This is the only case in the forty with that property, and it is a stronger argument for
revisiting the case or the lane split than for a sixth wording attempt.

## The one that regressed

**`sc-n2`, `safe-cleanup`, 15/15 → 8/15.** *"Delete the merged branches on GitHub as well
as locally."* Recall 100% → 84.5%, which is above `safe-cleanup`'s 0 pp floor. It happened
in all three runs — 2, 3 and 2 misses out of 5 — so it is not a single bad run.

**`safe-cleanup`'s description is byte-identical to the one that scored 100%.** Nothing in
this slice edited it, and nothing in the five rewrites mentions branches, merging or
deletion. What changed around it is that the roster prompt grew: five of eight descriptions
roughly doubled in length, and `sc-n2` was already the most borderline case in the set.

P6.4 predicted this, by name, in its final section: `sc-n2` failed twice in ten pre-rebase
repeats and never in fifteen post-rebase ones, and P6.4 called it *"the clearest single
illustration of why P6.5 must re-run rather than eyeball: a longer roster re-rolled a
borderline case."* It has now re-rolled a second time, in the other direction, for the same
reason. **L-10's re-roll warning is not a theoretical risk in this repo; it is a measured,
twice-reproduced behaviour of this case.**

### What was done about it

Nothing, and the reasoning is on the record rather than left implicit.

The founder's instruction for the three clean skills was to change them only with a
specific reason and to revert them if their numbers dropped. **There is no edit to revert
here** — that instruction anticipated a drop caused by editing `safe-cleanup`, and this
drop was caused by editing its neighbours. The two options actually available were:

- **Revert the whole pass.** That returns `sc-n2` to 15/15 and gives back `md-n3`, `ci-n1`
  and `rgr-n2`, three stable failures for one. Overall accuracy goes back from 96.8% to
  90.2%. Clearly worse.
- **Edit `safe-cleanup` to defend the case, and re-measure.** Possible, but there is no
  diagnosis to act on — the cause is roster length and attention dilution, not a word in
  `safe-cleanup`'s text — so the edit would be a guess, and D23 forbids claiming an
  improvement without another full fifteen-repeat measurement. At roughly thirty minutes a
  run on this machine that is another ninety minutes spent chasing one borderline case,
  with a fresh re-roll risk to the three that are now clean.

Neither is worth it against the 80/20 bar. The regression is reported at full size,
`safe-cleanup` is left exactly as it shipped, and the case is filed rather than guessed at.

The same reasoning applies to `red-green-refactor`'s precision, which fell from 100% to
90.7% — above its floor, and entirely `wd-n2`. Reverting that description would give back
`rgr-n2` and hand `worker-dispatch` its false fire again, trading a 15-repeat win for a
7-repeat loss. It stays.

## The three that were left alone

`new-project`, `safe-cleanup` and `safe-pr` scored 100% recall and 100% precision before,
so there was no defect to aim at and the whole of L-10's re-roll warning applied. They are
unchanged. Two of the three came through at 100% again; the third is the regression above.

`new-project` in particular is worth a line: it was P6.1's brand-new scaffolder
description, the hardest one to write because it must fire for someone who has just
installed the plugin and does not know what anything is called. It scored 4 of 4 cases in
all fifteen repeats before and all fifteen after, through a roster rewrite around it.
Issue #83 singled it out as the description most in need of tuning. **It needed none, and
the correct action on it was to leave it alone.**

## The roster is eight, not six

Issue #83, [D23](../../docs/DECISIONS.md) and `docs/PLAN.md` all say six
description-triggered skills, and #83's Verify section asks for seven descriptions with a
before-and-after. **The shipped tree has eight description-triggered skills against seven
operator lanes, and all eight are scored here.**

| | |
| --- | --- |
| Description-triggered, scored (8) | `monitor-design`, `new-project`, `red-green-refactor`, `safe-cleanup`, `safe-pr`, `tdd-ci`, `tdd-plan`, `worker-dispatch` |
| Operator lanes, `disable-model-invocation: true`, not tuned (7) | `fix`, `review`, `sprint-plan`, `sprint-start`, `status`, `triage`, `verify` |

P6.4 found and recorded this first; this slice confirms it against the same tree and uses
eight. The count in the planning docs has drifted three times — Phase 3 added
`monitor-design`, Phase 4 added `verify` to the lane side, Phase 5 added `worker-dispatch`
and P6.1 added `new-project` — and D23 already carries one correction of this kind in a
parenthetical. The harness reads the split out of the tree on every run rather than
carrying a list, so the measurement cannot drift again; the stale text is in
`docs/DECISIONS.md`, `docs/PLAN.md` and one comment in `evals/grade-plugin.mjs`, none of
which this slice owns. It needs a correction at the checkpoint.

The seven operator lanes were not touched, per #83's constraint. They do not trigger on
description, so tuning them is work with no reader.

## How the rewrites were produced

Issue #83 calls for a `skill-creator` pass, and one was done — but not by running that
skill's optimisation loop, and the substitution is a decision taken on the founder's
behalf rather than an oversight.

`skill-creator` ships `scripts/run_loop.py`, which optimises **one** description at a time
against **its own** twenty-query eval, asking only "did this skill trigger, yes or no".
That harness cannot see competition. Two of P6.4's four defects are one skill stealing
another's prompt, and a third was fixed only by editing two descriptions together — none
of which a single-skill trigger rate can measure. Worse, the loop's objective is to make
the skill fire more often, which is precisely the wrong direction for `tdd-plan` and
`worker-dispatch`. And optimising against one eval while reporting against another is not
a measurement at all.

So the **guidance** was taken from `skill-creator` and the **measurement** was P6.4's
harness, which is what D23 names. The guidance is not paraphrased from the skill's front
page; it is the instruction set inside `scripts/improve_description.py`, the prompt that
script sends when it rewrites a description. Four of its rules shaped every rewrite:

- **Generalise to broad categories of user intent, never an expanding list of specific
  queries** — that overfits, and the list is injected into every prompt. No rewrite names
  a case from the eval set, and both of the widest clauses ("however many files the change
  happens to touch", on both sides of the `red-green-refactor` / `worker-dispatch`
  boundary) are deliberately scale-free for that reason.
- **Imperative, and phrased around the user's intent** rather than the skill's internals.
  All five now open "Use this skill…".
- **Under 1024 characters.** The longest is 814.
- **Distinctive against the skills it competes with.** Every boundary clause now names the
  neighbour, so the judge is told where the prompt goes instead of only that it does not
  belong here.

`skill-creator` also records that Claude systematically *under*-triggers skills and that
descriptions should be a little pushy to compensate. Three of P6.4's four defects were
under-triggering, which is why three of the five rewrites widen and only two narrow.

## Reproducing

    node evals/trigger-eval.mjs --repeats 5 --model sonnet --concurrency 4 --out out.json

Three times, pooled over the fifteen repeats. Requires an authenticated `claude` CLI on
PATH. `--dry-run` prints the roster split and one built judge prompt with no model call.

`npm test` is 445 pass, 0 fail — unchanged from the baseline on `main`. No test asserts on
description text; `tests/skills/skill-frontmatter.test.mjs` asserts only that each
description parses as legal YAML and is non-empty, which all five rewrites do. The one that
was already double-quoted, `monitor-design`, stays double-quoted because it still carries
quoted questions inside it.

## What the next slice should know

Three items, all measured rather than suspected.

1. **`wd-n2` is open, and it is not obviously a wording problem.** The case asks the judge
   to decline a legitimate request because its real handler is an operator lane the judge
   cannot see. Worth deciding whether the roster shown to the judge should include the
   lanes as unselectable context before another wording attempt.
2. **`sc-n2` re-rolls whenever the roster around it changes**, now demonstrated twice in
   opposite directions with `safe-cleanup`'s text constant. Any future description work
   should expect to re-measure it, and it is a reasonable candidate for a second positive
   case so that `safe-cleanup`'s recall does not rest so heavily on one borderline prompt.
3. **The floor is a property of the run, not of the harness.** The before-run's floor was
   2.5 pp and the after-run's is 5.0 pp against the same forty cases and the same judge.
   Quoting P6.4's 2.5 pp against a future number would understate it.
