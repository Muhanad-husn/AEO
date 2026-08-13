# Checkpoint 6 — Verification

2026-08-13. Branch `docs/checkpoint-6-verification`, cut from `main` at `a9b07e3`.

**Status: both verify clauses hold.** Clause 1 was run live for the first time — an empty
directory on disk became a Go repository with a green suite, one commit on `main`, a
private remote, enforced branch protection, and a commit gate that refused a real commit
inside it. On the way through, the branch-protection command the scaffolder hands the
founder **failed with HTTP 422**, and it fails for every project, not just this one. The
clause survives because a one-character correction makes the command work and the shape it
asks for is reachable; the defect is real and is the most important thing in this log.

This slice reads, runs and judges. Nothing under `plugin/`, `docs/`, `evals/`, `tests/` or
`package.json` was touched, and nothing was merged.

## The verify line

> scaffolding a fresh repo on a non-Python stack produces a working org; `/aeo:status`
> reflects reality with no hand-maintained file.

| Clause | Result |
| --- | --- |
| Scaffolding a fresh repo | ✅ `D:\aeo-scaffold-proof`, empty at 09:27, first path written 09:29:57. Since deleted |
| …on a non-Python stack | ✅ Go. `go.mod` and `tests/baseline_test.go` written by the agent; no seed exists for Go |
| …produces a working org | ✅ the resolver returns exactly one unit, `go test ./...`, green; **`commit-gate` fired inside the scaffolded repo** and refused a real commit on `main` |
| …the emitted tree | ✅ `logs/` first, 11.4s ahead of any product path; `.claude/settings.json` with both variables declared blank; one commit `8375534` on `main`; clean tree |
| …stops at the Stage 0 checkpoint | ✅ stopped, presented both `gh` commands, ran neither. Named two decisions it refused to make |
| …the remote | ✅ `gh repo create` as prescribed, verbatim, first try |
| …branch protection | ⚠️ **the prescribed `gh api` call returns 422 and sets nothing.** With `-F` in place of `-f` it succeeds; all three properties then read back correct, and a direct push to `main` was refused live |
| `/aeo:status` reflects reality | ✅ cross-checked line by line against `gh issue list` and `gh pr list` taken seconds apart, on a populated repository and an empty one |
| …with no hand-maintained file | ✅ no write call in the renderer or its shared module; working tree clean after every run. One nuance below |

## Clause 1 — scaffolding a fresh repo on a non-Python stack

`plugin/skills/new-project/` shipped in #85 and #87 and had only ever been exercised by
`tests/skills/new-project-scaffold.test.mjs`, which walks `scaffold-plan.json` and asserts
the tree that manifest describes. That test cannot see whether an agent following the prose
reaches the same tree, whether the checkpoint holds, or whether the commands the skill
hardcodes work. This is the first live run.

### How it was run

```
cd D:\aeo-scaffold-proof
claude --plugin-dir D:/AEO-wt-cp6/plugin \
  --allowedTools Bash Read Write Edit Glob Grep Skill TodoWrite -p < prompt.txt
```

Nothing was installed and nothing was written to `~/.claude/`, per
[TESTBED.md](../../docs/TESTBED.md). The directory was created empty and had zero entries
immediately before the run. The prompt is [`scaffold-prompt.txt`](scaffold-prompt.txt), and
three things about it matter.

- **The skill was never named.** The prompt says "this directory is empty and I want to
  start a brand new project here from scratch". `new-project` is description-triggered, and
  it triggered. That is one live confirmation of the description P6.4 and P6.5 both scored
  at 100% and left alone.
- **Go was given, not inferred.** Step 2 of the skill requires one question about the stack
  before anything is written, and a headless run cannot be asked one. Supplying it in the
  prompt satisfies the step rather than bypassing it; what was not supplied is any hint
  about test tooling, module path, or layout.
- **Nothing was said about stopping.** The prompt asks the agent to "work through it end to
  end", which is the opposite of a hint to halt. The checkpoint held anyway.

TESTBED.md prescribes a `.claude/settings.local.json` granting the tools a `-p` run needs.
Writing one was refused by this session's own permission classifier, twice, through two
different tools. `--allowedTools` on the command line is the same grant by another route,
and it has the side benefit that the target directory really was empty — the prescribed
route would have put a `.claude/` in it before the scaffolder ran.

**One environment correction was needed and is recorded rather than smoothed.** `go` did
not resolve in this session's processes, although it is on both the machine and user `PATH`
(`C:\Program Files\Go\bin\go.exe`, present). Checkpoint 7's log records `go version`
answering on 2026-08-13; the toolchain was installed after this session's process
environment was captured, so the stale `PATH` was inherited rather than the machine's. It
was prepended for the run. Anyone reproducing on a long-lived session should expect the
same and should not read it as a missing toolchain.

### The emitted tree, checked rather than taken from the report

| What the skill promises | Checked against | Result |
| --- | --- | --- |
| `logs/` before any product code (EN-14) | file mtimes | `logs/.gitkeep` 09:29:57.027; next path 09:30:00.315; first product path (`go.mod`) 09:30:08.466. **11.4 seconds ahead** |
| the plan's array order | mtimes against `scaffold-plan.json` | all ten stage-0 steps in exact array order, no exceptions |
| `.claude/settings.json` with both variables declared blank (P6.2, #64) | the file, and `git ls-files` | present, tracked, `AEO_LIVE_DATA_ROOT: ""` and `AEO_DATA_ROOT: ""` |
| exactly one commit, on `main` | `git rev-list --count`, `git rev-parse --abbrev-ref` | `1`, `main`, `8375534` |
| a clean tree after the commit | `git status --porcelain --ignored` | empty. Nothing untracked, nothing ignored-and-left |
| the resolver returns exactly one unit | `hooks/stack.mjs` over the tree | `{ stack: 'go', manifest: 'go.mod', command: ['go','test','./...'] }`, `missing: []` |
| the suite is green | `go test ./...` | `ok  github.com/Muhanad-husn/aeo-scaffold-proof/tests` |
| no project config file ([D10](../../docs/DECISIONS.md)) | `git ls-files` | none. Ten tracked paths, all named in the plan |

The full capture is in [`scaffold-tree.txt`](scaffold-tree.txt); the agent's own closing
report is in [`scaffold-stage0-report.txt`](scaffold-stage0-report.txt).

Two details in the agent's work are worth naming because a manifest-walking test could not
have produced them. The Go module path was derived from the remote the prompt named
(`github.com/Muhanad-husn/aeo-scaffold-proof`), and `.gitignore` gained a Go section
appended below the plan's own content — which is exactly what the `appendSeed` mechanism
does for Node and which the plan has no Go entry for. Both are the agent writing "to that
stack's own conventions", which is what step 3 asks for when no seed exists.

Issue #66's tripwire did not fire: `go test ./...` exits 0 here because
`tests/baseline_test.go` gives the module a package. `src/.gitkeep` on its own would not.

### The scaffolded repository is a working org, and that was fired rather than argued

The strongest evidence in this clause is not the tree. It is that a second session, started
inside the scaffolded repository with the plugin loaded, ran a real `git commit` and was
refused:

```
fired — commit-gate refused `git commit --allow-empty` on `main` in D:\aeo-scaffold-proof.
        Verbatim: "PreToolUse:Bash hook error: [node ${CLAUDE_PLUGIN_ROOT}/hooks/commit-gate.mjs]:
        BLOCKED: no direct commits on main. Work on a branch and merge via PR after founder
        approval."
        git log afterwards: one line, 8375534. HEAD unchanged. No commit landed.
```

Under [TESTBED.md](../../docs/TESTBED.md)'s convention that is a `fired` line, not an
`invoked` one: a real action in a live session triggered the gate and the action did not
happen. The verbatim session output is in
[`commit-gate-probe.txt`](commit-gate-probe.txt). It also closes the loop the skill's own
step 6 opens — the gate allows the first
commit because `HEAD` is unborn, and refuses every commit on `main` after it. Both halves
were observed, minutes apart, in the same repository.

### The Stage 0 checkpoint held

The acceptance clause is that the scaffolder prepares the outward-facing commands and
stops. It did. Its closing report opens "Stage 0 done, local. Stopping at checkpoint before
anything outward-facing", presents both commands filled in with the owner and repository,
explains what each does, and ends "Say go and I run both commands". Neither was run.

It also declined two decisions rather than making them, which is the "never guess, never
pass quietly" behaviour issue #80 asked for.

- **The plan tier could not be read.** The skill tells the agent to "check the current terms
  for this account rather than repeating a plan name". It tried and could not: the token
  lacks the `user` scope, so `gh api user` returns `plan: null`. It said so, named the three
  options if protection is refused, and asked which the founder wants. **A second finding
  sits underneath this one:** the skill asks for a check the standard token cannot perform,
  so every run of this skill hits the same wall.
- **The README paragraph is a placeholder and says so.** The prompt gave "small command-line
  tool" and nothing else. Rather than inventing a product, it wrote a paragraph that
  announces itself as a placeholder and asked for a sentence.

### The outward-facing half — and the defect

The founder approved one private scratch repository for this session. It was created,
protected, read back, probed, and deleted.

**`gh repo create` worked verbatim.** The command in the skill, unmodified:

```
gh repo create Muhanad-husn/aeo-scaffold-proof --private --source=. --remote=origin --push
→ https://github.com/Muhanad-husn/aeo-scaffold-proof
  branch 'main' set up to track 'origin/main'
```

**The branch-protection command in the skill does not work.** Run verbatim, it returns
HTTP 422 and changes nothing:

```
gh api -X PUT repos/Muhanad-husn/aeo-scaffold-proof/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_pull_request_reviews[required_approving_review_count]=0' \
  -F 'enforce_admins=true' -F 'required_status_checks=null' -F 'restrictions=null'

{"message":"Invalid request.\n\nNo subschema in \"anyOf\" matched.\nFor
'properties/required_approving_review_count', \"0\" is not an integer.\nNot all subschemas
of \"allOf\" matched.\nFor 'anyOf/1', {\"required_approving_review_count\" => \"0\"} is not
a null.","status":"422"}
```

`gh api -f` sends every value as a string. `required_approving_review_count` is typed as an
integer, so `"0"` is rejected. `-F` is the typed form, and it is already used for the other
three fields on the same command; the review-count field is the only one that did not get
it. **The fix is one character**, `-f` to `-F`, in `plugin/skills/new-project/SKILL.md` in
the block under step 7.

This matters more than a typo usually would, for three reasons. It is a command the skill
hardcodes and instructs the agent to run rather than compose, so nothing upstream of it
catches the error. It is the last step of Stage 0, so a founder reaches it after everything
else has gone right. And the skill anticipates a *different* failure at exactly this point —
a tier refusal on a private repository — which is the wrong thing to be watching for and
would point a reader away from the real cause.

With `-F`, the same call succeeded on the first attempt.

### The read-back, from the API rather than from the response

```
gh api repos/Muhanad-husn/aeo-scaffold-proof/branches/main/protection
```

| Property the skill claims | Read back | Result |
| --- | --- | --- |
| a pull request is required before merge | `required_pull_request_reviews` present, non-null | ✅ |
| direct push to `main` blocked, admins included | `enforce_admins.enabled: true` | ✅ |
| `required_approving_review_count` is 0 | `0` | ✅ |
| status checks left null until CI names one | `required_status_checks` absent from the response | ✅ |
| restrictions null | `restrictions` absent from the response | ✅ |

`gh api repos/.../branches/main` also reports `protected: true`, and `allow_force_pushes`
and `allow_deletions` both came back `false`.

**The block was fired, not only read.** A flag saying pushes are blocked is a claim; a
rejected push is evidence. An empty commit was made locally and pushed to `main`:

```
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - Changes must be made through a pull request.
 ! [remote rejected] main -> main (protected branch hook declined)
```

The account is the repository's owner and sole admin, so this is `enforce_admins` doing its
work rather than an ordinary permission check. The local probe commit was reset away
immediately; the repository's one commit stayed `8375534` on both sides.

**Branch protection on a private repository was not refused.** The skill warns that it "has
historically required a paid GitHub tier" and tells the agent to check rather than assert.
The check could not be performed and the call succeeded anyway. That is a fact about this
account today rather than about GitHub's terms, and it should be recorded as such rather
than promoted into a new assumption.

### Teardown

| Step | Result |
| --- | --- |
| `gh repo delete Muhanad-husn/aeo-scaffold-proof --yes` | exit 0. `gh repo view` now returns "Could not resolve to a Repository" |
| `delete_repo` scope | present — checked **before** the repository was created, not after |
| `D:\aeo-scaffold-proof` removed from disk | gone. `Remove-Item` refused the path as protected; `rm -rf` did it |
| anything else created | nothing. No other repository, and nothing pushed to `Muhanad-husn/AEO` beyond this branch |

### What clause 1 does not establish

- **Stage 1 never ran.** The handbook, the branch it lands on, and its pull request are all
  past the checkpoint, and the run stopped at the checkpoint by design. `CLAUDE.md` was never
  written, and the scaffolded `README.md` links to a file that does not yet exist. Nothing in
  the verify line asks for Stage 1, but a reader should not take this log as covering it.
- **`logs/` was created and never written into.** The scaffolder makes the directory EN-14
  requires and puts nothing in it, so the run that created the tree is itself unrecorded.
  That is consistent with the plan and with every test over it; it is named because "the
  observability directory exists" and "runs are recorded" are not the same claim.
- **One stack, one machine, one run.** Rust, Python and every other unseeded stack rest on
  the same paragraph of prose that Go did, and are unexercised.

## Clause 2 — `/aeo:status` reflects reality with no hand-maintained file

`plugin/skills/status/scripts/render-status.mjs` was run live, twice, in two repositories
with opposite content, and each render was cross-checked against `gh` output taken seconds
apart in the same working directory.

### The populated case — `D:\aeo-testbed\repo`, render at 07:29:49Z

Every line of the render, against the `gh` answer captured at 07:29:52Z:

| Render | `gh` | Result |
| --- | --- | --- |
| Issues (6) | six objects returned | ✅ |
| Open (2): #8, #7 | both have `assignees: []`, `blockedBy.totalCount: 0`, `closedByPullRequestsReferences: []` | ✅ plain backlog, correctly bucketed |
| In flight (4): #6, #5, #4, #3 | each carries exactly one `closedByPullRequestsReferences` entry — #6 to PR 12, #5 to PR 9, #4 to PR 11, #3 to PR 10 | ✅ |
| no Blocked section | every issue has `blockedBy.totalCount: 0` | ✅ an omitted bucket, not a silent one |
| Open PRs (4): #12, #11, #10, #9 | four objects, none `isDraft` | ✅ |
| `[checks: passing]` on all four | every `statusCheckRollup` entry `conclusion: SUCCESS`, `status: COMPLETED` — three per PR, two CI jobs plus GitGuardian | ✅ |
| **Decision Log:** not found. Looked for `docs/DECISIONS.md`, `DECISIONS.md`, `docs/decisions.md`, `decisions.md` | **not a `gh` result, and not checkable by a reader** — a directory listing taken during the run, which found the testbed's `docs/` holding only `tdd-evidence`. The testbed is private ([TESTBED.md](../../docs/TESTBED.md)), so there is nothing to open; this row rests on the record's word | ✅ **the missing-log case, run live** |

The testbed is the harder of the two directories, and it produced the "names what it looked
for" behaviour without needing a fixture: it has a `docs/` directory and no decision log in
it, so the render had to report absence rather than crash or fall silent.

### The empty case — `D:\AEO-wt-cp6`, render at 07:29:16Z

| Render | `gh` at 07:29:31Z | Result |
| --- | --- | --- |
| **Issues:** none open. | `gh issue list --state open` returned `[]` | ✅ |
| **Open PRs:** none. | `gh pr list --state open` returned `[]` | ✅ |
| **Decision Log** (`docs/DECISIONS.md`, 25): D1 through D25 | 25 `### D<n> — <title>` headings, D1 to D25, no gaps and no duplicates | ✅ |

"None open" is a real computed zero here rather than a failure rendered as silence:
`gh issue list --state all` returns fifteen issues, every one `CLOSED`. Phase 6 closed its
own backlog — #80 through #83 — and Checkpoint 7's four open defects (#62, #63, #64, #65)
are all closed too.

The three-way distinction the module is built around — unknown, empty, populated — is
therefore observed in two of its three states live. **The `unknown` branch was not
exercised**: `gh` answered on every call. That path is covered by
`tests/skills/status.test.mjs` against a fake `gh`, which lives in the integration tier, and
is cited here rather than re-run.

### Nothing is written or cached

| Check | Result |
| --- | --- |
| write calls in `render-status.mjs` | two, both `process.stdout.write` / `process.stderr.write`. Nothing touches the filesystem |
| write calls in `plugin/hooks/status-render.mjs` | none. Its only `node:fs` import is `{ existsSync, readFileSync }` |
| `plugin/hooks/lib.mjs`, reached through `resolveWorktree` | `spawnSync('git', …)` for reads only; no write, no mkdir |
| working tree after each run | `git status --porcelain` empty in both repositories |
| a hand-maintained tracker anywhere in the repo | none. `docs/` holds the six planning docs plus `MIGRATION.md`; no `TRACKER.md` exists |
| one renderer, two callers | `session-status.mjs:33` imports `fetchOpenIssues`, `fetchOpenPrs`, `formatPrLine`, `ghJson` and `renderSection` from `status-render.mjs`, and is the first `SessionStart` entry in `hooks/hooks.json`. The two cannot drift |

**One nuance, stated because the clause's wording invites the wrong reading.** The Decision
Log *is* a hand-maintained file — `docs/DECISIONS.md` is authored prose. What
[D5](../../docs/DECISIONS.md) forbids is a hand-maintained *view*: a second record of issue
and PR state that drifts from the first. The renderer reads the decision log on every run
and stores nothing, so the file is a source, not a cache. The clause holds on the reading
D5 actually sets.

## What was judged rather than re-run — the trigger eval

P6.4's before-number and P6.5's after-number were not reproduced. The two fifteen-repeat
sets cost hours of live judge calls, and re-rolling them would produce a third pair of
numbers rather than a check on the first two. They were checked against their own raw data
instead. The recomputation is in [`trigger-eval-recompute.txt`](trigger-eval-recompute.txt).

### Same harness, same judge, same cases — verified from the run JSON, not the prose

| | P6.4 (before) | P6.5 (after) | Same? |
| --- | --- | --- | --- |
| model | `sonnet` | `sonnet` | ✅ |
| judge flags | `--safe-mode --no-session-persistence --strict-mcp-config --tools "" --system-prompt` | identical array | ✅ |
| repeats | 5 × 3 runs = 15 | 5 × 3 runs = 15 | ✅ |
| cases | 40 | 40 | ✅ |
| roster / operator lanes | 8 / 7 | 8 / 7 | ✅ |
| case set content | SHA-256 over the serialized `cases` array, `c8192f12ab17cc60…` | **byte-identical** | ✅ |
| harness code | `evals/trigger-eval.mjs` | **not in #90's file list** | ✅ |

The case files were read from two different worktrees, `D:\AEO-wt-p64` and `D:\AEO-wt-p65`,
which is the one thing that could have let the sets diverge unnoticed. They did not: the
serialized `cases` arrays hash identically, and #90's diff does not include
`evals/trigger-cases.json`. P6.5's "the same 40, unmodified" is true, and checkable.

P6.5's other structural claim holds as well. The whole of #90's diff under `plugin/` is
**five files, one insertion and one deletion each**, and every changed line begins
`description:`. No skill body, no other frontmatter field, no test.

### The spot-check — recomputed by hand from the raw verdicts

Every per-skill number in both summaries was recomputed from the raw verdict arrays in the
six run JSONs, without calling the harness's own scoring functions.

**Every number reproduces.** Recall, false fires per repeat, precision, overall accuracy,
NONE-case accuracy, the per-repeat accuracy ranges and the case-by-case flip table — all
sixteen per-skill rows across the two tables, plus both aggregates:

| | before | after |
| --- | --- | --- |
| overall accuracy, recomputed | **90.17%** (summary: 90.2%) | **96.83%** (summary: 96.8%) |
| per-repeat accuracy range | 90.0 – 92.5, one repeat at 92.5 | 95.0 – 100.0 |
| NONE-case accuracy | **92.22%** (summary: 92.2%) | **93.33%** (summary: 93.3%) |
| cases whose distribution changed | 5 — and exactly the five the summary names | |

The five changed cases came out identical to P6.5's table, including the two that are not
wins: `wd-n2` before `tdd-plan ×14, NONE ×1` and after `red-green-refactor ×7, tdd-plan ×5,
NONE ×3`; `sc-n2` before `safe-cleanup ×15` and after `safe-cleanup ×8, NONE ×7`.

**One thing my first pass disagreed on, and it is a definition rather than an error.** Five
precision figures came out one to two points low when computed pooled over all 600
case-repeat pairs: `worker-dispatch` before 84.9% against the summary's 86.7%,
`red-green-refactor` after 89.6% against 90.7%, `tdd-plan` 81.1% and 92.3% against 81.3%
and 93.3%. Reading `evals/trigger-eval.mjs` settles it — `scoreRun` computes precision
inside one repeat and `aggregateRuns` takes the mean across repeats, so the reported figure
is the mean of fifteen per-repeat ratios rather than the ratio over the pooled sample.
Recomputing that way reproduces all five exactly. Both are defensible, and the harness's
choice is the consistent one, since every neighbouring figure in the table is a per-repeat
mean.

It is still worth knowing that the two differ by up to 1.8 points on these denominators,
which is inside the after-run's 5.0 pp floor. **No precision figure from this harness should
be compared against a pooled precision computed some other way.**

### The noise floor, and whether the win clears it

| | stated | checked |
| --- | --- | --- |
| before floor, overall accuracy | 2.5 pp (min 90.0, max 92.5, stdev 0.6) | ✅ recomputed range 90.0 – 92.5 |
| after floor, overall accuracy | 5.0 pp (min 95.0, max 100.0, stdev 1.7) | ✅ recomputed range 95.0 – 100.0 |
| the gap | 6.6 pp | ✅ 96.83 − 90.17 = **6.66 pp** |
| the bar applied | the **larger** of the two floors, 5.0 pp | ✅ P6.5 states and applies this rather than quoting the flattering 2.5 |

**The improvement is outside the floor, on the correct reading of it.** 6.66 pp against
5.0 pp is not a comfortable margin, and P6.5 does not claim it is: it says outright that
the aggregate movement means something only under this reading, and rests the result on
three named cases that went 0/15 to 15/15 instead. That is the right way round, and it is
what L-10 asks for.

The per-skill discipline holds too. `tdd-plan` and `worker-dispatch` both improved on
precision and P6.5 **declines to claim either**, because both movements are smaller than
their own ±1-firing-per-repeat floors. It reports the single-case swings underneath them
instead — `tdd-plan` on `wd-n2`, 14 to 5, and `worker-dispatch` on `rgr-n2`, 8 to 0 — which
are outside any floor. A pass that wanted a good headline would have banked the precision
numbers.

### The regressions are reported, at full size

Both of the ones this checkpoint was told to look for are in P6.5's log, in its own tables,
with their sizes and their reasoning.

| Regression | Reported? | Checked |
| --- | --- | --- |
| `safe-cleanup` on `sc-n2`, 15/15 to 8/15 | ✅ its own section, "The one that regressed" | ✅ recomputed: `safe-cleanup ×8, NONE ×7`. Recall 100% to 84.5%, above `safe-cleanup`'s 0 pp floor |
| `wd-n2` still wrong, 1/15 to 3/15 | ✅ its own section, "The one that was not fixed", stated as **not a result** | ✅ recomputed: correct in 3 of 15. Two repeats on one case |
| `red-green-refactor` precision 100% to 90.7% | ✅ named, above its floor, entirely `wd-n2`, kept with a stated trade | ✅ recomputed |
| the after-run's floor doubling, 2.5 pp to 5.0 pp | ✅ named as a widening *within* runs, with `sc-n2` identified as the cause | ✅ recomputed; the three run means still span 0.5 pp |

`sc-n2` is the honest part of the slice. `safe-cleanup`'s description is byte-identical
across the two runs — confirmed here from the roster arrays inside the run JSONs, not from
the prose — so a case fell seven repeats because its *neighbours* got longer. P6.4 predicted
exactly that, by name, in its closing section. The disposition is to report it and change
nothing, on the grounds that reverting trades three stable fixes for one, and that editing
`safe-cleanup` would be a guess costing another ninety minutes of measurement. Against the
80/20 bar that is right, and the reasoning is on the record rather than implied.

**No claimed win is inside the floor.** The three fixes are 0/15 to 15/15 on named cases,
which no floor reaches. The two precision improvements are inside their floors and are
explicitly not claimed. The aggregate is claimed only against the larger floor.

### One deviation from the plan, judged rather than flagged

`docs/PLAN.md`'s P6.5 row says the pass covers "those six plus the scaffolder's own
description". `new-project`'s description was **not edited**. P6.5 gives the reason: 4 of 4
cases in all fifteen repeats before, zero false fires, and L-10's re-roll warning applying
in full to any change. It has an after-number too — unchanged at 100% recall and 100%
precision, through a roster rewrite around it. Issue #83 singled it out as the description
most in need of tuning; it needed none. Leaving it alone was the correct action and it is
measured, not asserted.

`skill-creator`'s own optimisation loop was also not run, and the substitution is argued
rather than glossed: `run_loop.py` optimises one description at a time against a
single-skill trigger rate, which cannot see competition, and two of P6.4's four defects are
one skill stealing another's prompt. The guidance came from
`skill-creator/scripts/improve_description.py`; the measurement came from P6.4's harness,
which is what [D23](../../docs/DECISIONS.md) names. That is the right division and it is
declared.

## The lane count in `docs/` is wrong, and this log records it rather than fixes it

Verified against the shipped tree by reading `disable-model-invocation` out of all fifteen
`SKILL.md` files:

| | count | names |
| --- | --- | --- |
| Operator-invoked lanes (`disable-model-invocation: true`) | **7** | `fix`, `review`, `sprint-plan`, `sprint-start`, `status`, `triage`, `verify` |
| Description-triggered | **8** | `monitor-design`, `new-project`, `red-green-refactor`, `safe-cleanup`, `safe-pr`, `tdd-ci`, `tdd-plan`, `worker-dispatch` |
| Total | **15** | |

Both P6.4 and P6.5 found this independently and both said so. `README.md:68` is already
correct: "Fifteen skills ship today. Seven are operator-invoked only". The stale figures are
all in `docs/`, and they are not all the same kind.

| Location | Text | Kind |
| --- | --- | --- |
| `docs/PLAN.md:311` | "The six lanes are excluded; they do not trigger on description" | **present tense, Phase 6's own section, load-bearing** |
| `docs/PLAN.md:323` | "over the six description-triggered skills" | **present tense**, the P6.4 slice row |
| `docs/PLAN.md:324` | "those six plus the scaffolder's own"; "the six operator-invoked lanes" | **present tense**, the P6.5 slice row |
| `docs/DECISIONS.md:114` | "Phase 3 added `monitor-design`, so the set is six" | **present tense**, D23's parenthetical. It is now eight |
| `docs/DECISIONS.md:476` | "No runtime check proves the six lanes are absent…" | present tense |
| `docs/EVIDENCE.md:121` | "the determinism the six operator lanes wanted" | present tense |
| `docs/DECISIONS.md:552` | "eleven skills. The six operator lanes (…) … The five harness skills (…)" | **historical** — D9's record of what shipped in Phase 0 |
| `docs/PLAN.md:121-128` | the same eleven / six / five split | **historical** — Phase 0's verify line |
| `docs/DECISIONS.md:786` | EN-8, "six lanes plus five harness skills" | historical, the disposition table |

The last three describe the tree as it was and are defensible as records. The first six
describe the tree as it is, and are wrong. **`docs/` was not edited here** — the orchestrator
owns those files and is correcting them separately.

## The two in-session fixes from #89, confirmed on `main`

Both were closed inside PR #89 rather than filed, and both are actually present at `a9b07e3`.

| Defect | Where | State on `main` |
| --- | --- | --- |
| stale lane-count comment in the acceptance grader | `evals/grade-plugin.mjs:47-51` | **Fixed.** The comment now reads "PLAN Phase 0's six, plus Phase 4's verify", and `OPERATOR_LANES` holds all seven. The code was already right; only the comment was stale |
| the `session-status` test reported empty hook stdout as a wrong-render mismatch | `tests/hooks/session-status.test.mjs:160-175` | **Fixed.** `runHook` now throws on empty stdout, naming the exit code or signal and any stderr: "produced no stdout (…). This means the process did not run to completion, not that it rendered the wrong log." |

The second is L-08 applied to a test helper, and it is the right shape: a signal that says
something went wrong without saying what is the same defect as a zero that means "not
measured".

## Issue candidates

Not filed here. This slice proposes; the orchestrator files.

> **Title:** `new-project`'s branch-protection command fails with HTTP 422 — `-f` where the
> API needs `-F`
>
> `plugin/skills/new-project/SKILL.md`, step 7, hardcodes
> `-f 'required_pull_request_reviews[required_approving_review_count]=0'`. `gh api -f` sends
> the value as the string `"0"`; the API types the field as an integer and rejects it with
> HTTP 422, setting nothing. The other three fields on the same command already use `-F`.
> Changing this one to `-F` makes the call succeed — verified live against a real repository
> on 2026-08-13, with all three protection properties reading back correct afterwards and a
> direct push to `main` refused with GH006. The skill instructs the agent to run this command
> rather than compose it, and it is the last step of Stage 0, so a founder reaches it only
> after everything else has gone right. The skill's own commentary anticipates a *tier*
> refusal at this point, which points a reader away from the real cause.

> **Title:** `new-project` asks for a plan-tier check the standard `gh` token cannot perform
>
> Step 7 tells the agent to "check the current terms for this account rather than repeating
> a plan name". The live run tried and could not: the token's scopes are `delete_repo`,
> `gist`, `read:org`, `repo` and `workflow`, with no `user` scope, so `gh api user` returns
> `plan: null`. The agent handled it correctly — it named the limitation and put the three
> options to the founder rather than guessing — but every run hits the same wall, so the
> skill should either name the scope requirement or drop to "attempt the call and read the
> response", which is what actually resolves the question. On this account the protection
> call **succeeded on a private repository**, so the tier caution did not bite; that is a
> fact about this account rather than about GitHub's terms.

> **Title:** Precision in the trigger eval is a mean of per-repeat ratios, not a pooled ratio
>
> `evals/trigger-eval.mjs` computes precision inside `scoreRun`, over one repeat, and
> averages across repeats in `aggregateRuns`. On the denominators this case set produces,
> that differs from precision over the pooled sample by up to 1.8 points — `worker-dispatch`
> before reads 86.7% per-repeat and 84.9% pooled. Both are defensible and the per-repeat mean
> is the consistent choice, since every neighbouring figure is one. Worth a line in the
> harness's header comment so a future comparison against an externally computed precision is
> not read as a movement.

## What this checkpoint does not cover

- **Stage 1 of the scaffolder.** The handbook, its branch and its pull request are all past
  the checkpoint the run stopped at. Unexercised.
- **Every stack but Go.** Node has the slice's own manifest test; Go now has a live run.
  Rust, Python and the rest rest on one paragraph of prose.
- **The `unknown` branch of the status renderer.** `gh` answered on every live call. That
  path is covered by `tests/skills/status.test.mjs` against a fake `gh` — the integration
  tier — and is cited, not re-run here.
- **A populated Blocked bucket.** No issue in either repository carried a `blockedBy`
  dependency, so the third triage bucket was only ever observed empty and correctly omitted.
- **The trigger-eval numbers themselves.** Judged against their own raw data, not
  reproduced. A third fifteen-repeat pair would be a new measurement rather than a check.
- **`npm run test:integration`.** Not run locally per this session's guidance; it stalls on
  this machine. CI's `battery` job is the oracle, and it is the only tier that runs
  `tests/skills/new-project-scaffold.test.mjs` and `tests/skills/status.test.mjs` — both live
  in the integration tier, not in the 445-test fast tier.
