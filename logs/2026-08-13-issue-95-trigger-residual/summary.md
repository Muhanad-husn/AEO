# Issue #95: the second trigger-accuracy residual, fixed in the case set

2026-08-13. Branch `95-trigger-eval-residual`, cut from `main` at `fd2d7c2`.

[Issue #95](https://github.com/Muhanad-husn/AEO/issues/95) records the two results P6.5
measured in the wrong direction and deliberately left open. The founder chose option 2:
fix residual 2 by fixing the case, not by editing a description. Residual 1 is accepted
and closed as a documented cost of a net-positive trade.

**Nothing under `plugin/` changed. Not one `description:` line was touched.** The whole
diff is one case in `evals/trigger-cases.json`, plus a revision record at the top of that
file. [D23](../../docs/DECISIONS.md) and P6.5's own conclusion both forbid an unmeasured
description edit, and this slice buys the cheaper of the two options on offer.

## The numbers

Both runs are five repeats against the same judge in the same configuration, taken about
an hour apart on the same machine.

| | before | after |
| --- | --- | --- |
| overall accuracy, mean of 5 repeats | **97.5%** | **99.5%** |
| per repeat | 97.5, 97.5, 100.0, 95.0, 97.5 | 100.0, 100.0, 100.0, 100.0, 97.5 |
| **overall accuracy floor** | **5.0 pp** (stdev 1.6 pp) | **2.5 pp** (stdev 1.0 pp) |
| cases whose verdict re-rolled | 2 of 40 | 1 of 40 |
| wrong firings | `tdd-plan` and `red-green-refactor`, both on `wd-n2` | **none** |

**The 2.0 pp gap between the two overall numbers is inside the 5.0 pp before-floor, and
is not a claimable movement.** It is stated here because the issue asked for it, not
because it means anything. The largest movement a one-case fix could produce is 4 of 200
judgements, or 2.0 pp, which is smaller than this harness's floor by construction. An
aggregate number was never going to settle this slice.

The result that does mean something is at case level, which is where
[L-10](../../docs/EVIDENCE.md) says to read it.

| case | expected | before, 5 repeats | after, 5 repeats | direction |
| --- | --- | --- | --- | --- |
| `wd-n2` | NONE to `red-green-refactor` | correct 1/5: `tdd-plan` x3, `red-green-refactor` x1, NONE x1 | **correct 5/5** | **fixed, by re-framing** |
| `sc-n2` | `safe-cleanup` | correct 4/5 | correct 4/5 | **unchanged, still failing** |

The other thirty-eight cases were correct in all five repeats on both sides. After the
change the set has **no wrong firings at all**: every skill that fired was right to, and
the single remaining error in the whole run is `safe-cleanup` going quiet once on
`sc-n2`, which is residual 1 behaving exactly as P6.5 described it.

Per-skill movements are in [before-after.txt](before-after.txt) beside this file. Every
one of them is `wd-n2` and nothing else, and every one of them is definitional rather
than behavioural: `tdd-plan`'s false fires fall from 0.60 to 0.00 per repeat and
`red-green-refactor`'s from 0.20 to 0.00 because the case they were scored wrong on no
longer expects NONE. No description changed, so no skill behaved differently. Reporting
those as precision improvements would be the exact dishonesty D23 exists to prevent.

## The issue's structural claim is wrong, and the real cause is worse

Issue #95 and P6.5 both say `wd-n2`'s cause is that its real handler, sprint-scale
planning, carries `disable-model-invocation: true` and is invisible to the judge, and
that it is *"the only case of the forty with that property"*.

**It is not the only one. There are five, and four of them score clean.**

| case | prompt belongs to | after P6.5, 15 repeats |
| --- | --- | --- |
| `pr-n2` | the `review` lane | correct 15/15 |
| `ci-n2` | the `fix` lane | correct 15/15 |
| `tp-n1` | the `sprint-plan` lane | correct 15/15 |
| `wd-n1` | the `sprint-start` lane | correct 15/15 |
| `wd-n2` | `sprint-plan` and `sprint-start` | correct 3/15 |

An out-of-frame handler is therefore not what breaks a case. The four that work all have
something `wd-n2` lacked: the tempted skill's own description carries an exclusion whose
words match the prompt. `tdd-ci` says do not use it on a test that is already flaky, and
`ci-n2` asks about a flaky test. `worker-dispatch` says do not use it for work needing
its own branch and pull request, and `wd-n1` asks for a branch and a pull request each.
The judge can decline from the roster it can see.

`wd-n2` had no such exclusion available, and the opposite was true. P6.5 deliberately
widened `red-green-refactor` to cover *"any request to implement, add, or change
behaviour in code that already exists ... however many files the change happens to
touch"*. Rewriting the auth module from scratch is changing behaviour in code that
already exists. The judge is instructed in as many words to *"judge only on whether a
description covers the message"*, and a description covered it. **On the inputs the judge
was given, `red-green-refactor` was the right answer, and the case scored it as a
failure.**

That makes the case worse than unanswerable. It contradicts another case in the same set.
`rgr-n2` requires `red-green-refactor` to take a multi-file behaviour change; `wd-n2`
required it to decline one. The only difference between them is scale, and scale is
precisely what P6.5 made `red-green-refactor` deliberately silent about, on the
`skill-creator` rule against enumerating specifics. **No wording of any description could
satisfy both cases at once.** A sixth wording attempt was never going to work, and the
effort P6.5 spent on this case was spent against a target that did not exist.

## What changed, and why re-frame rather than drop

The case was re-framed, keeping its id, its slot and the job it was written to do.

| | before | after |
| --- | --- | --- |
| prompt | Rewrite the auth module from scratch. It is a big job, so throw a bunch of agents at it. | Rework the payment retry logic so failed charges back off instead of hammering the provider. There is a fair bit to it, so throw a bunch of agents at the job. |
| expect | `NONE` | `red-green-refactor` |
| competes | `worker-dispatch` | `worker-dispatch`, `tdd-plan` |

The discriminator the case existed to test is intact. Its original rationale ends
*"tests whether the request for parallelism overrides the exclusion"*, and that sentence
survives verbatim. The fan-out is still requested in the same words, and the reason
`worker-dispatch` must refuse is still its own stated exclusion: units that change
behaviour are implementation work and belong to `red-green-refactor`. The only thing that
changed is that the answer is now on the roster the judge can see.

Dropping the case to leave thirty-nine was the alternative, and it was rejected. A
thirty-nine case set would be more honest than forty with one unanswerable question, but
re-framing is more honest still: it keeps the pressure on the `worker-dispatch` boundary
from the hardest direction, which is where a founder asks for parallelism on work that
must not be parallelised that way. Dropping would have removed a test and called it a
fix. It also keeps the set at forty, so the count in the P6.4 and P6.5 records still
describes the file.

`wd-n2` keeps its id because the id prefix names the skill whose boundary is under test,
not the expected answer. `rgr-n1` expects `tdd-plan` for the same reason. The case still
tests `worker-dispatch`, so it is still `wd-n2`.

The prompt avoids the descriptions' own vocabulary, as the case file's note requires.
"Rework" appears in no description on the roster.

Two knock-on effects are worth stating rather than leaving to be discovered:

- The `red-green-refactor` recall denominator moved from four cases to five, and
  NONE-expecting cases fell from twelve to eleven. The `none` accuracy figure before and
  after is therefore over different denominators and the two are not comparable.
- The case set has changed, so **no number taken before today is over this set**. The
  case file now carries a `revised` record saying so, pointing here.

## Residual 1 is unchanged, and was not chased

`sc-n2` was correct 4 of 5 repeats before and 4 of 5 after, missing once in each run to
NONE. The `safe-cleanup` description was not touched by this slice or by P6.5, and the
case has now re-rolled in three separate measurements. P6.5's reading of it stands
without amendment: the cause is roster length and attention dilution rather than a word
in the text of `safe-cleanup`, there is no edit to revert, and any fix would be a guess
costing another full measurement with fresh re-roll risk to seven descriptions that are
clean.

It remains the only failing case in the set, and it is now the only case in the set that
re-rolls at all.

## Reproducing

    node evals/trigger-eval.mjs --repeats 5 --model sonnet --concurrency 4 --out out.json

Once against `fd2d7c2` for the before-number and once against this branch for the after.
Requires an authenticated `claude` CLI on PATH.

| | |
| --- | --- |
| Judge | `claude -p`, model alias `sonnet` |
| Sampling | CLI defaults. No temperature and no seed control is exposed |
| Judge isolation | safe mode, no session persistence, strict MCP config, no tools, explicit system prompt, from a neutral temp directory |
| Roster order | fixed alphabetical |
| Repeats | 5 per run, one run each side |
| Concurrency | 4 judge calls in flight |
| Machine | Windows 11 10.0.26200, node v24.16.0, under concurrent actor load |

Five repeats rather than the fifteen P6.5 took. The thing being measured is one case
moving from stably wrong to stably right, and five repeats resolve that at 1/5 against
5/5 with no ambiguity. Fifteen would have cost hours more to sharpen an aggregate that is
inside its floor either way.

`npm test` is 451 pass, 0 fail, before and after. No test asserts the case count or any
prompt text. `tests/evals/trigger-eval.test.mjs` validates the shipped case file against
the shipped roster on every run, and the re-framed case passes it.

## What the next slice should know

1. **A near miss expecting NONE is only sound if every roster description honestly fails
   to cover its prompt.** Four of the five lane-owned cases satisfy that because the
   tempted skill's description carries a matching exclusion. Check that before writing
   another one, and prefer a case whose right answer is on the roster.
2. **Two cases can contradict each other, and the harness will not say so.** `rgr-n2` and
   `wd-n2` demanded opposite behaviour from one description for three phases, and it read
   as a stubborn description defect. Nothing in `validateCases` can catch this; the only
   defence is reading the case set as a whole when a case refuses to move.
3. **`sc-n2` is still the one to watch.** It has now re-rolled in three measurements with
   the `safe-cleanup` text constant. The P6.5 suggestion of a second, less borderline
   positive case for `safe-cleanup` is still the sensible next move, and it is a case-set
   change rather than a description change, which makes it cheap.
