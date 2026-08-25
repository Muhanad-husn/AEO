# Trigger accuracy, re-run and reconciled: issue #145

2026-08-25. Branch `docs/trigger-accuracy-145`, cut from `main` at `b3b0ce4`. No skill,
description, or harness file changes in this slice. It records a re-run already taken
and reconciles two numbers already on the record.

[Issue #145](https://github.com/Muhanad-husn/AEO/issues/145) opened because `CLAUDE.md`
quoted P6.5's **96.8%** as current while PR #114 reported **100.0%** from its own
re-run, neither citing the other. The v0.2.0 release notes carry no accuracy figure at
all because a reviewer would not publish either number to a stranger without knowing
which one describes the shipped plugin. This log settles that: which number is current,
and why the other one is not wrong, just retired.

## What was run

Three independent invocations of the harness, against the tree at `b3b0ce4`:

    node evals/trigger-eval.mjs --repeats 5 --model sonnet --concurrency 4

5 repeats over 40 cases per run, 15 repeats and 600 judge calls across the three,
deliberately matching P6.5's own 3-runs-of-5 protocol so the number is comparable to it.

| | |
| --- | --- |
| Judge | `claude -p`, model alias `sonnet` |
| Sampling | CLI defaults. No temperature and no seed control is exposed |
| Judge isolation | `--safe-mode --no-session-persistence --strict-mcp-config --tools "" --system-prompt` |
| Roster order | fixed alphabetical, not shuffled per repeat |
| Repeats | 5 per run, 3 runs, 15 total |
| Concurrency | 4 judge calls in flight |
| Tree | `main` @ `b3b0ce4` |
| Timing | run 1: 17:19:04Z-17:26:24Z; run 2: 17:26:24Z-17:33:55Z; run 3: 17:33:55Z-17:41:42Z, 2026-08-25 |

Full envelopes are `trigger-run1.json`, `trigger-run2.json`, `trigger-run3.json` beside
this file, three distinct MD5s, not copies of one run:

| file | MD5 |
| --- | --- |
| `trigger-run1.json` | `1f040ee660e574a104da87f3c5eacb42` |
| `trigger-run2.json` | `edfe66936b8af06a90b9e760b23cee67` |
| `trigger-run3.json` | `efa2742b29baeb2d27d0040a46b346e9` |

`console.txt` is the console output of all three runs, unedited.

## Roster scored

Read from the tree, alphabetical, 8 description-triggered skills:

`monitor-design`, `new-project`, `red-green-refactor`, `safe-cleanup`, `safe-pr`,
`tdd-ci`, `tdd-plan`, `worker-dispatch`.

Excluded, 7 operator lanes (`disable-model-invocation: true`, not scored by this
harness): `fix`, `review`, `sprint-plan`, `sprint-start`, `status`, `triage`, `verify`.

Same 8-and-7 split P6.4 and P6.5 used. Issue #145 guessed the two numbers might come
from different rosters; they do not. This is the one roster both measurements scored,
and the reconciliation below names the real cause.

## The result

Identical in all three runs:

| | run 1 | run 2 | run 3 |
| --- | --- | --- | --- |
| overall accuracy, 5 repeats each | 100.0% x5 | 100.0% x5 | 100.0% x5 |
| spread | 0.0% (min 100.0, max 100.0, stdev 0.0) | 0.0% | 0.0% |
| cases whose verdict re-rolled | 0 / 40 | 0 / 40 | 0 / 40 |
| wrong firings | none | none | none |
| missed firings | none | none | none |

Every one of the 8 roster skills: 100.0% recall (±0.0), 0.0 false fires (±0.0), in every
run. **100.0% overall accuracy across all 15 repeats, 600 judge calls, 0 of 40 cases
unstable.** This matches PR #114's reported number exactly.

## The reconciliation

Issue #145 framed this as possibly a roster mismatch: that P6.5's 96.8% and #114's
100.0% might be scoring different sets of skills. **They are not.** Both measured the
same 8 skills over the same 40-case file count. Two things were verified live, not
assumed:

**1. The case set changed between the two measurements: it is not the same 40.**

    git log --oneline --format='%h %ad %s' --date=short -- evals/trigger-cases.json

    8fdb7cf 2026-08-13 fix(evals): re-frame wd-n2, which asked the judge for an answer
                        it could not reach (#104)
    43c3580 2026-08-13 feat(evals): the trigger eval, and the before number P6.5 is
                        judged by (#88)

`8fdb7cf`, the fix for issue #95 landed as PR #104, re-framed case `wd-n2`: the prompt
changed from "Rewrite the auth module from scratch..." to "Rework the payment retry
logic...", and `expect` moved from `NONE` to `red-green-refactor`. The case file records
this itself:

    $ node -e "console.log(JSON.stringify(require('./evals/trigger-cases.json').revised,null,2))"
    [
      {
        "date": "2026-08-13",
        "issue": 95,
        "change": "wd-n2 re-framed: prompt replaced and 'expect' moved from NONE to
                    red-green-refactor. Any number taken before this date is over a
                    different set. See logs/2026-08-13-issue-95-trigger-residual/summary.md."
      }
    ]

P6.5's 96.8% counted `wd-n2` as a defect no roster description could satisfy: the case
demanded the judge decline in favour of a lane (`sprint-plan`/`sprint-start`) it cannot
see, while `red-green-refactor`'s own description, deliberately widened by that same
P6.5 pass, honestly covered the prompt. `wd-n2` and case `rgr-n2` required opposite
answers from one description; no wording could win both. That structural finding is
worked through in full in
[`logs/2026-08-13-issue-95-trigger-residual/summary.md`](../2026-08-13-issue-95-trigger-residual/summary.md),
the bridge measurement taken right after the re-frame: before-number 97.5%, after-number
99.5% on a 5-repeat spot check, with the one remaining miss (`sc-n2`) unrelated to the
re-frame. **So 96.8% is a score over a case set that no longer exists.** The harness has
scored 40 cases both before and after; the count never changed, only `wd-n2`'s content
did.

**2. The eight descriptions have not moved since #114, only the bodies around them
have.**

    for n in monitor-design new-project red-green-refactor safe-cleanup safe-pr tdd-ci \
             tdd-plan worker-dispatch; do
      echo "$n $(git diff deb341d..HEAD -- plugin/skills/$n/SKILL.md \
                  | grep -cE '^[-+]description:')"
    done

All eight report `0`. No `description:` line has an added or removed diff line between
`deb341d` (PR #114's merge commit) and `HEAD`. This is the only field the harness reads.
Say it precisely, because a looser claim would be false: **several of those `SKILL.md`
bodies did change** in that window, but the description line specifically did not.

**Conclusion: #114's 100.0% describes the shipped plugin, and this re-run confirms it
rather than merely agreeing with it.** `CLAUDE.md`'s 96.8% describes a case set retired
on 2026-08-13, before #114 ever ran. There was never a roster mismatch to reconcile. The
issue's guess was reasonable to raise and wrong on inspection, and now there is a
citation trail proving it wrong rather than an assertion.

## Chain of custody

| date | event | record |
| --- | --- | --- |
| 2026-08-13 | P6.4 baseline, 90.2% | `logs/2026-08-13-p6.4-trigger-eval/` |
| 2026-08-13 | P6.5 tuning pass, 96.8%, `wd-n2` left as defect 1 | `logs/2026-08-13-p6.5-tuning-pass/summary.md` |
| 2026-08-13 | issue #95: `wd-n2` re-framed, fixed by PR #104, case set changes | `logs/2026-08-13-issue-95-trigger-residual/summary.md` |
| ~2026-08-13/14 | PR #114 re-run against the re-framed set, 100.0% | PR #114 body |
| 2026-08-25 | this re-run, three runs of five repeats, 15 total, 100.0% | this log |

## The caveat: read this before quoting 0.0% anywhere

**A 0.0 pp spread over 15 repeats is not a promise of zero noise.** It is the absence of
observed instability across 600 calls, a much stronger statement than P6.5 could make,
but still an upper bound drawn from a sample, not a proof of determinism. P6.5's 5.0 pp
floor was measured on a case set containing two cases that re-rolled by construction:
`wd-n2` (unanswerable, now fixed by re-framing) and `sc-n2` (a genuinely borderline
prompt, still in the set). Removing the unanswerable one removed most of the observed
instability; `sc-n2` did not misfire in any of these 15 repeats, but it has re-rolled in
three separate measurements before this one and there is no reason to expect it has
stopped being borderline. Do not write anything implying the harness is now
deterministic or that the noise floor has been "fixed." It has not been re-measured at
100.0%'s edge, only observed to hold at that edge 15 times running.

**What this changes about the standing warning:** `CLAUDE.md` carries one imperative on
this now, restored after an earlier draft of this PR dropped it: re-run this log's
protocol before quoting the figure, editing a `description:` line, or changing
`evals/trigger-cases.json`. That instruction is now **stronger, not weaker** than the
one it replaces. At 96.8% there was headroom to absorb a small regression without
falling below a stated floor. At 100.0% there is none. Any movement from here is
downward, and any edit is measurable against a clean baseline with nothing to hide
behind.

**100.0% is a measurement of this eight-skill roster as a set, not of any one
description in isolation.** P6.5 found the mechanism that makes this true and it is the
reason the warning above is not a slogan:
[`logs/2026-08-13-p6.5-tuning-pass/summary.md`](../2026-08-13-p6.5-tuning-pass/summary.md)
recorded `safe-cleanup` falling from 15/15 to 8/15 on case `sc-n2` without its own
description changing a byte, because five of its neighbours roughly doubled in length
and the judge sees the whole roster in one prompt. A longer neighbour dilutes the
attention a borderline case needs. P6.5's 96.8% is retired as a *number*; this finding
is not retired as a *lesson*. It means this 100.0% baseline is not safe to read as eight
independent scores. Adding a ninth roster skill, or lengthening any one of the eight
descriptions, including one that has nothing to do with the case in question, can
re-roll a result on a skill nobody touched, and `sc-n2` is the specific case most likely
to be the one that moves.

## What a reader should do next

- To quote a trigger-accuracy number anywhere in this repo, quote **100.0%**, protocol
  above, and cite this log rather than P6.5's summary, which is a correct record of a
  retired case set, not of the shipped plugin.
- Before editing any `description:` line on the 8-skill roster, re-run this harness's
  3x5 protocol and diff against this log's numbers, per the strengthened warning above.
- Any change to `evals/trigger-cases.json` retires this number the same way #104's did:
  re-run and re-cite before quoting it again. This is the failure mode that produced the
  defect #145 was filed against, and neither this log nor `CLAUDE.md` guarded against it
  before this pass.
- `sc-n2` is still the one borderline case worth a second positive example, per P6.5's
  and issue #95's own recommendation, unchanged by this slice and not acted on here.
