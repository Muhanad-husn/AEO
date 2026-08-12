# P5.5: what four concurrent actors actually cost

2026-08-12. Branch `p5.5-measure-concurrency`, cut from `main` at `e4cfac0`.
[D11](../../docs/DECISIONS.md) names two quantities Phase 5 must measure rather than
assume — core oversubscription when four commit gates run a suite at once, and the
merge-order conflict rate across a concurrent group. This is both numbers, with their
noise floors, their conditions and their positive controls. **No fix ships from this
slice.** Nothing under `plugin/` was touched and `package.json` is unchanged.

The harness is `tests/measure/oversubscription.mjs` and
`tests/measure/merge-conflicts.mjs`. Every trial is in `run.jsonl` beside this file,
written through `plugin/scripts/runlog.mjs` in its fixed six-field envelope.

## The headline

**Four concurrent commit gates do not oversubscribe this machine's cores. They run 3x
slower anyway.** The CPU sat around 65% idle while each of the four actors took three
times as long as it takes alone.

That reframes D11's first question. The quantity it told Phase 5 to measure — core
oversubscription — is not the one that binds.

## Conditions

Stated first, because none of these numbers is a property of the code.

| | |
| --- | --- |
| Machine | AMD Ryzen 7 5700U, **16 logical cores** (8 physical), 15.3 GiB as node reports it, Windows 11 10.0.26200 |
| Runtime | node v24.16.0, git 2.49.0.windows.1 |
| Suite | `npm test` — the commit gate's fast tier ([D17](../../docs/DECISIONS.md)). 13 files, 362 tests, 359 pass, 3 skipped |
| What else was running | **a second Claude Code session, throughout, uncontrollable.** 7–8 node processes and 29–47% machine busy before each trial |
| Also running | measurement 2's git plumbing overlapped rounds 2 through 5 |
| Isolation | four plain directory copies of this worktree, `source/`, `.git` and `node_modules` excluded, `git init` in each. **Not** git worktrees |

**No quiet window ever appeared**, so every number below is a loaded-machine number and
the load each trial ran under is stored in that trial's record. `npm test` cost 46s here
against the 29s [fix #8](../2026-08-12-fix-8-fast-tier/summary.md) measured on a quiet
machine — the same tier costing 1.6x more because of what else is on the box.

The four actors are directory copies rather than git worktrees because worktree machinery
is not what is being measured and Phase 1 already ships it. Each copy gets its own
checkout, its own temp fixtures and its own file locks, which is what four worktrees would
give it. `source/` is excluded because no test reads it, `.git` because it would point
back at the real repository.

## Measurement 1 — core oversubscription

### Noise floor, before any comparison

Three serial runs in one copy, after a discarded 55.70s warm-up:

| run | wall clock |
| --- | --- |
| 1 | 51.36s |
| 2 | 46.21s |
| 3 | 46.36s |

Median **46.36s**, spread (max − min) / median = **11.1%**.

The effect looked for is a ratio somewhere between 1.0 (the machine absorbed four actors)
and 4.0 (they were fully serialised). An 11.1% floor does not swamp that, so the
comparison is worth reading.

A second source of error is larger than the noise floor and matters more. The serial
baselines **drifted 23% downward** over the twelve minutes of rounds, 50.05s to 38.53s, as
the competing session's own work ebbed. That is why each group is compared against the
serial run from its own round, taken seconds earlier, rather than against a global
baseline. Taking all the baselines first would have turned that drift into a result.

### Result

One round is a serial run and then a group of four, back to back, in that order.

| round | serial | group of 4 | **ratio** | per-actor inside the group |
| --- | --- | --- | --- | --- |
| 1 | 50.05s | 135.21s | 2.70x | 135.2, 134.1, 134.0, 134.6s |
| 2 | 49.16s | 131.57s | 2.68x | 130.5, 130.0, 131.4, 129.3s |
| 3 | 42.67s | 132.67s | 3.11x | 131.2, 130.8, 132.0, 132.3s |
| 4 | 43.79s | 132.31s | 3.02x | 132.2, 130.1, 129.1, 131.9s |
| 5 | 38.53s | 124.53s | 3.23x | 122.6, 124.4, 123.6, 123.7s |

**Median 3.02x, range 2.68–3.23x**, against a fully-serialised bound of 4.0.

Two things fall out of the per-actor column. There is no straggler — the four finish
within about 2s of each other every round, so none is starved while the others proceed.
And the group wall clock is far steadier than the serial baseline (124.5–135.2s, an 8%
band, against a baseline that moved 23%), which is what a saturated resource looks like:
once it is the constraint, the background session stops mattering much.

**What it costs and buys.** Four gates one after another take 4 x 46.4s = 186s. Together
they take 132s. Concurrency buys about **1.3x on throughput**, not 4x, and each actor
waits **3x longer** for its own gate to come back.

### The part that does not fit

Machine CPU busy, sampled across the span of every trial:

| | busy |
| --- | --- |
| idle, before any trial | 29–32% |
| during one serial run | 32–37% |
| during a group of four | 32–40% |

Four gates each running 3x slower moved the machine's CPU by about five points, leaving
roughly 60% of sixteen cores unused throughout. The derived figure — one fast tier adding
**0.1 cores** over background — is not credible on its face, and the ratio contradicts it.
What both readings agree on is that **the CPU was never near saturation.**

### Positive control

A method that has never seen the effect cannot report its absence. So sixteen CPU-bound
spinners were started and the same serial trial run through the same timing path and the
same CPU sampler.

| | result |
| --- | --- |
| serial run under 16 spinners | **598.06s** |
| serial run unloaded (median) | 46.36s |
| ratio | **12.90x** |
| machine busy during the control | **100.0%** |

The control settles the ambiguity above rather than merely passing. The CPU sampler reads
**100.0%** when the cores are genuinely pinned, so its 32–40% during the real group is a
real reading and not an instrument failure. And the timing path reports 12.90x when a
slowdown exists, so 3.02x is a measurement and not a plumbing artifact.

Its limit, stated: the control loads the machine and runs one serial trial. It does not
exercise the group code path under load. It establishes that the timer and the CPU sampler
both detect contention, which is what the null CPU reading needed.

### What this means

Four concurrent fast tiers are **not** limited by cores here. They are limited by
something that saturates while 60% of the CPU is idle. The likeliest candidate is already
on the record: fix #8 measured **277ms to start one node process** on this machine and
named on-access virus scanning over the checkout and the temp directory as the probable
cause. One `npm test` is npm, then `node --test`, then a child process per test file, so a
group of four is on the order of sixty process creations competing for whatever serialises
them. **This slice did not test that hypothesis**, and it should not be repeated as though
it had.

## Measurement 2 — merge-order conflict rate

### Method, and why a naive replay is not available

This history is squash-merged and the branches are deleted, so the original concurrent
tips are gone. `main`'s first-parent line is a chain, so the merge base of any two commits
on it is just the older one and asking git to merge them is trivially clean. That is not
D11's question.

The question asked instead, per adjacent pair (A, then B, with P = A's parent):

> Had B been developed from P — concurrently with A rather than after it — would landing A
> first have made B conflict?

answered with one read-only three-way merge:

```
git merge-tree --write-tree --merge-base=A  P  B
```

Base A, one side P (A's diff reversed), the other side B (B's diff). It conflicts exactly
when A's changed regions overlap B's, which is the same overlap test as merging A against
a from-P version of B, run by the same merge machinery. Nothing is written: no branch is
created, merged or deleted, and no object enters this repository.

**Sampling rule: none, this is a complete census.** Every adjacent pair on `main`'s
first-parent line, n = 60 from 62 commits — the root has no parent to branch from, the tip
has no successor. No `--limit N` pretending to be a sample (L-10).

**Two populations, one method.** Most adjacent pairs were not developed concurrently, so
for those the question is synthetic and is labelled that way. The subset whose two pull
requests were genuinely open at the same time, read from `gh pr list`, is the real observed
record and is reported separately with its own much smaller n.

### Positive control

| pair | direct formulation | linearized formulation | required |
| --- | --- | --- | --- |
| two commits editing the same line of one file | CONFLICT | CONFLICT | conflict |
| two commits editing different files | clean | clean | clean |

**PASSED**, on both verdicts and not just the interesting one: a detector that answers
"conflict" to everything is exactly as useless as one that never does.

The control also earns the method rather than asserting it. It builds a genuine
two-branches-from-one-base repository and runs *both* formulations on it — the direct one,
which needs branches that no longer exist on `main`, and the linearized one, which is what
gets used on `main` — and fails unless they agree. The equivalence the method rests on is
tested, not claimed.

### Results

| population | conflicting / pairs | rate |
| --- | --- | --- |
| every adjacent pair on `main` (synthetic) | **16 / 60** | **26.7%** |
| pairs whose PRs were genuinely open together (real) | **1 / 6** | **16.7%** |

The one real conflict is **#18 then #19** — P5.1 and P5.4, which landed within eleven
minutes of each other. The other five real pairs are clean: #11/#12, #22/#23, #27/#26,
#26/#29, #29/#28.

n = 6 is tiny and is stated as tiny. Six pairs cannot separate 17% from 27%. What they
establish is that the synthetic census is not wildly off and that the real rate is not
zero.

### Where the conflicts land

Totals hide this, so here is the diff (L-10). Conflicting pairs, by file:

| pairs | file |
| --- | --- |
| 5 | `logs/2026-08-11-phase-2-verification/summary.md` |
| 3 | `docs/BUILD-METHOD.md` |
| 2 | `CLAUDE.md` |
| 2 | `package.json` |
| 2 | `plugin/skills/sprint-start/SKILL.md` |
| 1 each | `docs/PLAN.md`, `plugin/DECISIONS.md`, `plugin/hooks/hooks.json`, `plugin/hooks/session-status.mjs`, `plugin/skills/safe-cleanup/scripts/classify-branches.mjs`, `plugin/skills/safe-pr/scripts/collect-evidence.mjs`, `plugin/skills/sprint-start/references/actor-cap.md`, `source/_manifests/07-plugin-format.md`, `logs/2026-08-04-p1.1-hook-runtime/summary.md`, `tests/hooks/hooks-json.test.mjs`, `tests/hooks/session-status.test.mjs`, `tests/skills/collect-evidence.test.mjs` |

Of the sixteen conflicting pairs, **twelve collide only in prose** — a run-log summary, a
plan document, `CLAUDE.md`, a skill's markdown. **Two collide in `package.json`**, both on
its test-script lines. **Two collide in executable code.**

And one file accounts for five of the sixteen on its own:
`logs/2026-08-11-phase-2-verification/summary.md`, appended to by five consecutive
sessions. That is not a concurrency hazard at all. It is one record being extended five
times in a row, which the census counts as five conflicting pairs because the synthetic
question — "had these been concurrent" — is meaningless for them. **The 26.7% is inflated,
and it is inflated in the direction that makes concurrency look worse than it is.** The
real concurrent subset shows no such pattern.

### What it implies for a group of four

Six pairs. At the synthetic rate, assuming independence:

> P(at least one conflict) = 1 − (1 − 0.267)^6 = **84.4%**

At the observed rate, 65.7%. Both are **ceilings, not estimates.** The six pairs are not
independent: conflicts cluster on the same few hot files, so one pair colliding makes the
others more likely to collide too, which *raises* the chance a whole group comes back
clean. An independence calculation errs high here. Stating that direction matters — a
concurrency number that errs toward flattering the tool is the failure this slice was
tiered up to avoid.

## The recommendation

**Nothing needs to change, and the measurement is what says so.** Four concurrent gates
cost each actor 3x its solo latency but still return the group 1.3x faster than running
them one after another, so serialising the gates would make the founder wait longer, not
less. A queue, a scheduler or a semaphore would each spend real complexity to buy a
regression, and none of them touches the actual constraint, since the cores a scheduler
would ration were 60% idle throughout. The merge side agrees: one conflict in six real
concurrent pairs, and in the synthetic census twelve of sixteen collisions are in prose
rather than code — a cost the founder already absorbs by hand in less time than tooling to
avoid it would take to build. The one lever worth anything is not in this repository at
all: it is the process-creation cost fix #8 measured, and excluding the checkouts and the
temp directory from on-access virus scanning would cut every suite on the machine rather
than just this one.

## What was found and not fixed

- **`runlog open` cannot create a run directory inside a linked worktree.** It anchors
  through `sentinel.mjs`'s `linkedWorktreeMain`, by [D12](../../docs/DECISIONS.md)'s
  design, so run from `D:/AEO-p5.5` it created `D:/AEO/logs/2026-08-12-p5.5-concurrency` —
  in the main checkout, which this slice was told not to touch. The directory was moved
  into this worktree and `D:/AEO` was left clean, and both harnesses now take `--dir`. The
  seam is real: every P5.3 actor works in a worktree, so any lane that opens a run log from
  one writes it into the wrong checkout. Not fixed here, because no plugin behaviour
  changes in this slice.
- **The CPU accounting for a single run is not trustworthy at this resolution.** "One fast
  tier adds 0.1 cores" cannot sit next to a 3x group ratio. Subtracting a 3-second idle
  baseline from a 46-second run sample attributes all of the difference to our run while
  the competing session's load moves underneath it. The sampler itself is sound — the
  positive control reads 100.0% under sixteen spinners — but the subtraction is not, and no
  claim here rests on it.
- **The bottleneck was excluded, not identified.** Cores are ruled out. Process creation
  and filesystem I/O are the standing hypothesis from fix #8, untested by this slice.
  Measuring it needs a different instrument.
- **Measurement 2 ran while measurement 1 was taking rounds 2 through 5.** Its git plumbing
  is part of the load those rounds were measured under, and it is in their records. The
  within-round comparison is what makes that survivable rather than fatal.
- **`run.jsonl` carries four passes of measurement 2**, and the last is the one cited here.
  The first used `git log --reverse` and assumed `line[i+1]` was a child of `line[i]` —
  false, because `main` is not linear (13 merge commits, 78 total, 62 on the first-parent
  line), so about a quarter of its pairs were not adjacent at all and it reported 18/76.
  The second fixed that with `--first-parent` plus an assertion on each pair's parent. The
  third added the per-file tally. The fourth corrected the independence bound's wording
  from "floor" to "ceiling", after the direction was checked rather than assumed.
- **CI does not cover the harness.** Neither file is a `*.test.mjs` and neither npm script
  names them, deliberately: `tests/hooks/test-tiers.test.mjs` fails the fast tier the
  moment an unnamed `.test.mjs` exists, and a twelve-minute measurement has no business in
  a commit gate. Both positive controls therefore run inline on every invocation instead of
  in a suite. If either harness rots, nothing will say so until someone runs it.

## The envelope, and what went in `detail`

Every trial is a `runlog record` call with the fixed six keys — ts, job, unit, status,
duration, detail (EN-14). The envelope has no room for a ratio, a CPU sample or a process
count, and the rule is that it never grows a key, so those ride in `detail` as `k=v` pairs.
`duration` carries the wall clock in milliseconds, which is what it is for. Units used:
`background-idle`, `warmup`, `noise-serial`, `noise-floor`, `one-run-cores`,
`round-serial`, `round-actor`, `round-group`, `ratio-summary`, `positive-control`,
`merge-positive-control`, `merge-census-all`, `merge-conflict-files`,
`merge-census-observed`, `merge-group-of-four`.

`run.jsonl` carries the structured record; `console.log` is empty, because both harnesses
print to the terminal rather than through shell redirection.
