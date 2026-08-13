# P6.4: the trigger eval, and the before number

2026-08-13. Branch `feat/p6.4-trigger-eval`, rebased onto `main` at `85ee475` — after
P6.1's scaffolder (#85), P6.3's `status` (#86) and #87 landed.
[D23](../../docs/DECISIONS.md) moved the trigger eval out of P2.M and into Phase 6 so the
number lands against the descriptions the tuning pass is judged by, and Checkpoint 2 closed
saying it had no trigger-accuracy number. This is that number.

**This slice measures. It does not tune.** Nothing under `plugin/` was touched. Every
description scored below is the one that shipped, defects included; P6.5 fixes them and is
judged against this file.

The harness is [`evals/trigger-eval.mjs`](../../evals/trigger-eval.mjs) with its case set in
[`evals/trigger-cases.json`](../../evals/trigger-cases.json). `evals/grade-plugin.mjs` is
untouched and stays a separate measurement: it grades the tree's shape, this grades whether
the text in that tree fires.

Three independent five-repeat runs are recorded beside this file — `run-1` through `run-3`,
each as a JSON envelope and a report — with `pooled.txt` reading all fifteen repeats
together. `pre-rebase/` holds an earlier set against the fourteen-skill tree; it is kept as a
consistency check and is discussed at the end.

## Conditions

Stated first, because none of these numbers is a property of the text alone.

| | |
| --- | --- |
| Judge | `claude -p`, Claude Code CLI 2.1.229, model alias **`sonnet`** |
| Sampling | CLI defaults. **No temperature and no seed control is exposed**, which is why the noise floor below is not optional |
| Judge isolation | `--safe-mode --no-session-persistence --strict-mcp-config --tools "" --system-prompt`, run from a neutral temp directory |
| Roster order | fixed alphabetical, not shuffled per repeat |
| Repeats | 5 per run, 3 runs, **15 total** |
| Cases | 40: 19 near misses, 18 positives, 3 controls |
| Machine | Windows 11 10.0.26200, node v24.16.0, four judge calls in flight |

**Isolation is load-bearing.** The first probe of `claude -p` on this machine answered in
the voice of an installed plugin instead of answering the question: without `--safe-mode`
the judge inherits the operator's global `CLAUDE.md`, project memory, installed plugins and
skills. A judge contaminated by local configuration measures the configuration. Anyone
reproducing this must keep those flags.

## The roster is eight, not six

Issue #82, [D23](../../docs/DECISIONS.md) and `docs/PLAN.md` all say six
description-triggered skills. **The shipped tree has eight, against seven operator lanes.**
D23 already carried one correction of this kind — five became six when Phase 3 added
`monitor-design` — and it has drifted twice more since: Phase 5 added `worker-dispatch`,
Phase 4 added `verify` to the lane side, and P6.1 has just added `new-project`.

| | |
| --- | --- |
| Description-triggered, scored here (8) | `monitor-design`, `new-project`, `red-green-refactor`, `safe-cleanup`, `safe-pr`, `tdd-ci`, `tdd-plan`, `worker-dispatch` |
| Operator lanes, `disable-model-invocation: true`, excluded (7) | `fix`, `review`, `sprint-plan`, `sprint-start`, `status`, `triage`, `verify` |

The harness reads this split out of the tree on every run rather than carrying a list, so it
cannot drift again — and it refuses to run at all if a skill in the roster has no cases, which
is how `new-project` was caught after the rebase rather than silently scoring nothing. The
count in the planning docs is stale documentation, not a defect in the plugin.

A related staleness, reported and deliberately not fixed here: the section comment above
`checkSkills` in `evals/grade-plugin.mjs` still says "the six-lane
`disable-model-invocation` split". The grader's behaviour is correct — it reads
`OPERATOR_LANES` — and that file is out of this slice's scope.

## How the case set was built

A case set derived from the descriptions it scores measures the case set. These 40 cases
were written from what a founder would plausibly type, deliberately avoiding each
description's own vocabulary: `safe-cleanup`'s "prune stale local work" is never typed at
it, and `red-green-refactor` is never asked to "red, green, refactor".

Three kinds:

- **positive** (18) — the skill's own job, stated two or three ways, so a description keyed
  to one phrasing shows up as a gap rather than passing.
- **near-miss** (19) — the ones that matter. Two skills competing for one prompt is the
  failure P6.5 exists to fix, and a set of obvious positives scores high and means nothing.
  Every near miss records, in a `competes` field, where a wrong answer would plausibly go:
  a named neighbour, or `NONE` when the risk is the right skill going quiet. That field is
  checked by the harness, so "every skill is exercised under competition" is verified rather
  than asserted.
- **control-none** (3) — flagrantly out-of-scope prompts. L-10 records that judges are
  systematically generous; if the roster fires on "what is the capital of Portugal", no
  score above it is trustworthy. **All three were declined in all fifteen repeats**, so the
  control holds.

`NONE` is the correct answer for twelve cases. Eight of those belong to an operator lane —
`review`, `sprint-plan`, `sprint-start`, `fix` — which the runtime never offers on
description, so a triggered skill taking one is a real defect rather than a technicality.

The judge sees the roster and one user message. It never sees the expected answer, the case
kind, or the authoring rationale; L-10's "a judge shown a pre-fill rubber-stamps it" is
enforced by a test, because the day someone passes the case object into the prompt builder
instead of the prompt string is the day this measurement quietly becomes worthless.

## The noise floor

**Read this before any score below. A difference smaller than these numbers is not a
difference.**

Overall accuracy over fifteen repeats: 90.0% fourteen times and 92.5% once.

| | |
| --- | --- |
| **Overall accuracy floor** | **2.5 percentage points** (min 90.0%, max 92.5%, stdev 0.6 pp) |
| **Case-level floor** | **2 of 40 cases re-rolled, 5.0%** |
| Per-skill recall floor | **0 pp for all eight skills** |
| Per-skill false-fire floor | **plus or minus one firing per repeat** for `tdd-plan` and `worker-dispatch`; **0** for the other six |

The three runs reproduce each other far inside that floor:

| | run 1 | run 2 | run 3 |
| --- | --- | --- | --- |
| accuracy per repeat | 90.0 x5 | 92.5, 90.0 x4 | 90.0 x5 |
| mean accuracy | 90.00% | 90.50% | 90.00% |
| spread within the run | 0.0 pp | 2.5 pp | 0.0 pp |
| cases that re-rolled | 1 of 40 (2.5%) | 2 of 40 (5.0%) | 1 of 40 (2.5%) |
| `tdd-plan` false fires per repeat | 1.0 | 0.8 | 1.0 |
| `worker-dispatch` false fires per repeat | 0.4 | 0.8 | 0.4 |

**The three run means span 0.5 pp against a 2.5 pp floor.** Re-running the harness against
an unchanged tree reproduces.

The two cases that re-rolled are named, because L-10 says to diff the entries that flipped
and never the totals:

| case | expected | verdicts over fifteen repeats |
| --- | --- | --- |
| `rgr-n2` | `red-green-refactor` | `worker-dispatch` x8, NONE x7 — **never correct; only the destination varies** |
| `wd-n2` | NONE | `tdd-plan` x14, NONE x1 |

That table is the reason the aggregate is not enough on its own. `rgr-n2` looks unstable and
is not: it is a stable failure with an unstable destination, and reading only the flip rate
would have filed it as noise.

## Per-skill before-numbers

Mean over fifteen repeats. `n` is the number of cases the skill was owed. **False fires**
counts cases per repeat that selected this skill and should not have, whatever they should
have selected instead.

| skill | n | recall | recall spread | false fires per repeat | precision |
| --- | --- | --- | --- | --- | --- |
| `monitor-design` | 3 | **66.7%** | 0 pp | 0 | 100% |
| `new-project` | 4 | **100%** | 0 pp | 0 | 100% |
| `red-green-refactor` | 4 | **75.0%** | 0 pp | 0 | 100% |
| `safe-cleanup` | 3 | **100%** | 0 pp | 0 | 100% |
| `safe-pr` | 3 | **100%** | 0 pp | 0 | 100% |
| `tdd-ci` | 4 | **75.0%** | 0 pp | 0 | 100% |
| `tdd-plan` | 4 | **100%** | 0 pp | **0.93** | **81.3%** |
| `worker-dispatch` | 3 | **100%** | 0 pp | **0.53** | **86.7%** |

Overall accuracy is **90.2%** mean over fifteen repeats. Accuracy on the twelve cases that
should have selected nothing is **92.2%**.

The split is clean and it is informative. Three descriptions are **too narrow** and lose
prompts they are owed — `monitor-design`, `tdd-ci` and `red-green-refactor`, none of which
ever fired anywhere it should not. Two are **too broad** and take prompts they are not owed
— `tdd-plan` and `worker-dispatch`, both of which caught everything of their own. Three are
clean in both directions: `new-project`, `safe-cleanup` and `safe-pr`. One number could not
have said any of that.

**`new-project` is clean out of the gate.** Four cases owed, all caught in all fifteen
repeats, and it never took a prompt it should not have — including "Turn on branch
protection for this repo", which its description arguably reaches and which it correctly
declined every time. Its last sentence, pointing sprint-scale planning inside an existing
repository at `tdd-plan`, holds: `np-n1` went to `tdd-plan` fifteen times out of fifteen.
The predicted collision with `tdd-plan` did not happen.

## What fired where it should not — the P6.5 work order

Ranked against the floor. **All four entries are above it**; nothing in this set is a
coin-flip artefact.

### 1. `tdd-plan` fires on a rewrite-with-agents request, 14 of 15 repeats

> "Rewrite the auth module from scratch. It is a big job, so throw a bunch of agents at it."
> (`wd-n2`, expected NONE)

Far above the floor. The prompt asks for a fan-out over feature work, which
`worker-dispatch` explicitly excludes and correctly declined every time. Nothing on the
roster should take it, and `tdd-plan`'s "split a new feature, product, or fix into thin
vertical slices" absorbs it instead. This is the single largest wrong-firing in the set and
the whole of `tdd-plan`'s 81.3% precision.

### 2. `tdd-ci` never fires on a required-check request, 15 of 15 repeats

> "Make the test job a required check on main." (`ci-n1`, expected `tdd-ci`, NONE took it)

Deterministic, and worth reading twice: `tdd-ci`'s description contains the literal phrase
**"make tests a required check"** and the judge still declined, every time. The rest of the
description describes writing a workflow file, and a settings-shaped ask does not look like
writing a file. A phrase in the trigger list does not survive a body that contradicts it.

### 3. `monitor-design` never fires on a progress-view request for a fan-out job, 15 of 15 repeats

> "The four-hundred-file rename is running now. Give me a progress readout for that job."
> (`md-n3`, expected `monitor-design`, NONE took it)

Deterministic. The description's anti-trigger — do not use for "is it still working" or "how
far along is it" — is over-broad and swallows a legitimate design request that happens to
use the word progress. The anti-trigger itself works: `md-n1` and `md-n2`, the two questions
it names, were declined all fifteen times. It is calibrated too wide by exactly one case.

### 4. `red-green-refactor` never wins a three-file change, and `worker-dispatch` takes half of them

> "Add deleted_at handling to the three repository classes that need it."
> (`rgr-n2`, expected `red-green-refactor`)

Fifteen failures out of fifteen: eight to `worker-dispatch`, seven to NONE. The failure is
deterministic even though the destination is not — `red-green-refactor` never selected it in
any repeat. Two descriptions to look at rather than one: `red-green-refactor` reads as
needing an existing slice plan, and `worker-dispatch` reads mechanical-and-multi-file
broadly enough to catch three files.

Nothing else in the set failed at all. Thirty-six of forty cases were correct in every one
of the fifteen repeats.

## Consistency with the pre-rebase set

`pre-rebase/` holds two five-repeat runs plus a pilot against the fourteen-skill tree, taken
before P6.1's scaffolder landed. It is kept because it is a free check on whether adding a
ninth description to the roster disturbed the other eight.

It did not, in either direction. All four defects above appear in the pre-rebase set with the
same direction and comparable rates: `tdd-plan` on `wd-n2` 9 of 10, `worker-dispatch` on
`rgr-n2` 5 of 10, `tdd-ci` on `ci-n1` 10 of 10, `monitor-design` on `md-n3` 10 of 10. The
per-skill recalls are identical. Overall accuracy is not comparable across the two sets and
should not be quoted as a movement — the case count and the roster both changed — which is
why the before-number for P6.5 is the fifteen-repeat, forty-case set above and nothing else.

One difference is worth naming rather than burying. `sc-n2` ("Delete the merged branches on
GitHub as well as locally") failed twice in ten pre-rebase repeats and never in fifteen
post-rebase ones, taking `safe-cleanup`'s recall from 93.3% to a flat 100%. That is a case
moving from just inside the floor to outside it with no change to `safe-cleanup`'s text, and
it is the clearest single illustration of why P6.5 must re-run rather than eyeball: a longer
roster re-rolled a borderline case.

## What P6.5 must not do

Four entries above are real and three of them are fully deterministic, so the tuning pass has
something to aim at. Two cautions:

- **Re-run this harness, do not eyeball the text.** L-10 records a one-word cosmetic relabel
  re-rolling 93 of 176 results. A one-word change to any description re-rolls this whole set,
  including the thirty-six cases that are currently right.
- **The bar is the floor, not zero.** An after-number of 92% against this 90.2% sits inside
  a 2.5 pp floor and means nothing. Moving a named case from 0 of 15 to 15 of 15 is a result;
  moving the aggregate by two points is not.

## Reproducing

    node evals/trigger-eval.mjs --repeats 5 --model sonnet --out out.json

Requires an authenticated `claude` CLI on PATH. `--dry-run` prints the roster split and one
built judge prompt without making a single model call. A five-repeat run costs roughly seven
minutes at a concurrency of four.

`tests/evals/trigger-eval.test.mjs` covers the harness's own mechanics — roster loading,
verdict parsing, scoring, the noise-floor aggregation and the case-file validation — against
fixtures with no live model calls, which is why it sits in the fast tier. Every scoring group
has a positive control: a perfect verdict set proven to score clean, and a set with one
planted error proven to land in exactly the right row and nowhere else.
