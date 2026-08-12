# Checkpoint 4 — Verification

2026-08-12. Branch `feat/phase-4/integration`, cut from `main`, carrying the four
Phase 4 slice branches merged.

**Status: all four verify clauses pass.** Three ran live against the testbed at
`D:\aeo-testbed\repo`; the fourth is on record from P4.2 and is cited rather than
re-run, for the reason given below.

## The verify line

> a PR whose evidence does not support its claim is caught at stage 0; an attempt
> to embed production data in evidence is blocked; the planted-defect control is
> caught; a branch held by a worktree fails cleanup with the worktree named.

| Clause | Result |
| --- | --- |
| Stage-0 catch on a mismatched packet | ✅ live, `BLOCKED` |
| Production data in evidence | ✅ live, refused, exit 1 |
| Planted-defect control | ✅ on record, P4.2, 36/36 |
| Worktree-held branch names the worktree | ✅ live |

Fast tier on the integration branch: 275 tests, 65 suites, 275 pass, 0 fail.

## Clause 1 — stage 0

A branch `cp4/stage-0-mismatch` was cut from testbed `main` and given a real
change: `runningTotal` gained an `options.max` cap. Its `PR_BODY.md` claimed the
cap plainly. The evidence it offered was the existing suite, green — five tests,
none of which passes a second argument. Green, real, and about a different thing
than the claim. That is the shape stage 0 exists for.

The review lane was dispatched headless, plugin loaded not installed:

```
AEO_REVIEW_PACKET_DIR=D:/aeo-testbed/review-packets \
  claude --plugin-dir D:/AEO/plugin -p "/aeo:review"
```

It staged an eight-file packet and returned **BLOCKED at stage 0**, with no spec
or quality findings — the stage stop rule held. The finding, at confidence 97:
the test file is byte-identical to `main`, the string `max` never appears in it,
line 13 of the implementation is never entered, and the same five tests were green
before the diff and after. It named what the evidence cannot distinguish: an
inverted cap, an off-by-one boundary, and no cap at all.

`BLOCKED` rather than `NEEDS_CONTEXT` is the right call and is the harder half of
the distinction the charter draws. The packet was complete; the change was the
defect.

**A second finding was not planted and is worth recording.** The PR body's pasted
log names `aeo-testbed@1.0.0` and `node --test tests/`; the repository produces
`aeo-e2e-fixture@0.1.0` and `node --test tests/*.test.mjs`. The log was written by
hand while building the fixture and the mismatch was not deliberate. The reviewer
caught it, checked it against prior recorded evidence in the packet, re-ran the
suite itself, and reported the substance as surviving while the provenance did
not. An unplanned catch is better evidence than a planted one.

It also deferred, explicitly and without scoring it, that the branch widens the
public signature of the repository's only exported function with no issue, no
spec and no test. Deferred, not dropped — which is what stopping at stage 0 is
supposed to look like.

## Clause 2 — production data

Live, in the testbed, with `AEO_LIVE_DATA_ROOT=D:/aeo-testbed/live-data` and a
transcript inside that root:

```
============ PRODUCTION DATA IN EVIDENCE — REFUSED ============
evidence source: D:/aeo-testbed/live-data/prod-transcript.txt
resolves to: D:\aeo-testbed\live-data\prod-transcript.txt
which is inside the production data root D:\aeo-testbed\live-data (AEO_LIVE_DATA_ROOT).
```

Exit 1. Nothing copied, working tree clean, no override flag. The unit suite
covers the rest: 11 tests, 11 pass, including the junction-traversal case and the
unset-declaration loud skip.

This closes the testbed pass P4.3 recorded as still open.

**One defect found.** The destination evidence folder is created before the source
check runs, so a refused run leaves `docs/tdd-evidence/<feature>/<slice>/` behind,
empty. Git does not track empty directories so nothing reaches a commit, and the
refusal itself is correct. It is untidy, not unsafe. Fix is to defer the `mkdir`
until after the sources are cleared.

## Clause 3 — the planted-defect control

Cited, not re-run. P4.2's run is recorded at
[logs/2026-08-12-p4.2-verifier/summary.md](../2026-08-12-p4.2-verifier/summary.md):
36 defective packets, 36 refused. The deterministic half —
`tests/verify/positive-control.test.mjs` — is green in the fast tier and asserts
the three ways a control of this kind is quietly worthless: a wrong scorer, a
malformed case, a packet that leaks its own answer.

Re-running the live half costs 72 model calls and would measure the same
population a second time. It was not re-run, and this line says so rather than
implying a fresh result.

**The caveat P4.2 disclosed still stands and is the important number.** Clean
twins were also refused, at 67–100%. So "refused" on its own is close to
uninformative; the discriminating signal is *what the verifier named*. Verifier
findings are advisory and cannot block, so the cost of that lands on founder
attention, not on the merge path. It was disclosed rather than tuned away, which
is the right order — tuning a control against the run that measured it is how a
control stops measuring anything.

## Clause 4 — the worktree-held branch

A branch identical to `main` was created in the testbed and checked out in a
worktree, then `--apply --yes --delete-merged` was run:

```
FAILED cp4-worktree-held (git branch -d refused: error: cannot delete branch
'cp4-worktree-held' used by worktree at 'D:/aeo-testbed/wt-cp4' — checked out in
worktree D:/aeo-testbed/wt-cp4 — left intact)
```

Cause named, location named, branch intact, recovery log written before any
deletion was attempted. The carried Checkpoint 3 finding is closed: the six
branches that survived a live cleanup needed a `git worktree list` nothing in the
output suggested, and that diagnosis is now in the message.

**One wart.** Git's own stderr already names the worktree on this version, so the
path is printed twice. The independent resolution is deliberate — git's message is
localised and its wording is not a contract, ours is neither — but the duplication
reads badly. A cheap trim would print the resolved worktree only when git's own
message does not already carry the path.

## What the testbed carries now

`cp4/stage-0-mismatch` is kept, not deleted. It is a permanent fixture: a real
diff, a plainly stated claim, and green evidence that is about something else. A
stage-0 regression is otherwise expensive to reproduce.

The staged packet is kept at `D:\aeo-testbed\review-packets\cp4-stage-0-mismatch`
and the reviewer's return at `D:\aeo-testbed\cp4-stage0-review.txt`.

The worktree, the branch it held, the production-data root and the empty evidence
folder were all removed. `main` is unchanged.

## Carried out of this checkpoint

Three items, none blocking:

1. `collect-evidence.mjs` creates the destination folder before refusing.
2. `classify-branches.mjs` prints the worktree path twice when git already named it.
3. The fast tier costs 3m39s on Windows, against 32s in
   [#3](https://github.com/Muhanad-husn/AEO/pull/3). Three pre-existing suites are
   70% of it. Filed as [#8](https://github.com/Muhanad-husn/AEO/issues/8) with the
   measurements; Phase 4's two new test files cost 9.5s combined and are not the
   cause.
