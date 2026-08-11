# Phase 2 verification — Checkpoint 2

2026-08-11. Branch `feat/phase-2/roles-and-lanes`.

**Status: complete.** Everything Phase 2 was to author exists and is committed, and both
halves of PLAN's verify line have run against a real repository — the local gates, and
the GitHub path from an issue to an open pull request with CI green.

The fixture is no longer a throwaway. It is now the project's permanent testbed, on disk
at `D:\aeo-testbed` and on GitHub at `Muhanad-husn/aeo-testbed`, private. Its terms are in
[docs/TESTBED.md](../../docs/TESTBED.md).

## What landed

| Slice | Model | Output |
| --- | --- | --- |
| P2.0 | Haiku | 11 reference, asset and script files vendored from upstream `593e7ab` |
| P2.1 | Sonnet | `builder`, `reviewer`, `triage` charters |
| P2.2 | Sonnet | `sprint-plan`, `sprint-start`, `fix`, `review`, `triage` lanes |
| P2.3 | Sonnet | `red-green-refactor`, `safe-pr`, `safe-cleanup`, `tdd-ci`, `tdd-plan` |
| P2.4 | Orchestrator | `classify-branches.mjs` fail-closed guards, with tests |
| P2.M | Sonnet | `evals/grade-plugin.mjs`, with tests |

Ten skills ported, not eleven. `status` remains a stub by its own contract and lands in
Phase 6.

P2.4 was written by the orchestrator rather than dispatched, on founder instruction. It
is the one exception to the authoring rule in this phase and it is recorded here so it
stays precedent rather than drift: the founder's standing instruction was that subagents
write and the orchestrator checks, with the orchestrator taking the pen only for
fail-closed logic, which is what P2.4 is.

## Numbers

| Measure | Value |
| --- | --- |
| Acceptance grader | 92 expectations, 92 pass |
| Planted-defect control | 6 planted, 6 caught |
| Fast tier | 139 pass, 0 fail |
| Integration tier | 497 tests, 496 pass, 1 skipped |
| Tests added this phase | 60 |

The one skip is a platform-conditional directory-link case in `review-jail.test.mjs`, not
a guarded group silently declining to run.

**The grader's noise floor is zero by construction** — it is deterministic and
text-based. Nothing was measured for variance, and saying "zero noise floor" here means
"there is no sampling", not "we sampled and found none".

**91/91 is not a quality score.** It says the plugin satisfies static claims it makes
about itself. It does not install or run anything (D21), does not dispatch an agent, does
not judge prose, and does not measure whether a skill triggers. It has **no continuity**
with the vendored skill's 1.0-versus-0.27–0.45 benchmark: different harness, different
artifact shape. Any comparison between those numbers would be invented.

## The live run

A Node fixture repository was created outside this tree, in the OS temp scratchpad, with
a real `package.json` test command. The plugin was loaded with `claude --plugin-dir`
rather than installed. **That is better than D21's procedure and should replace it:**
nothing is written to `~/.claude/`, no marketplace is registered, no cache is populated,
and the uninstall step disappears because there was no install. D21 assumed installation
was the only route; it is not.

Every check below ran headless against the real plugin, in that repository.

| Check | Result |
| --- | --- |
| Plugin loads, hooks active | ✅ 3 agents, hooks reported loaded |
| Model-visible skills | ✅ exactly the five description-triggered ones |
| The six lanes hidden from model invocation | ✅ absent from the model's skill list, per D9 |
| `/aeo:fix` drives a real change test-first | ✅ test and code together, 4 behavioural tests, edge cases |
| Node stack detection resolves `npm test` | ✅ |
| Commit on a feature branch with a green suite | ✅ allowed |
| **Commit with a red suite** | ✅ **blocked**, with the failing assertion echoed |
| Commit on the default branch | ✅ blocked |
| `review-jail` on a reviewer's repo `Read` | ✅ blocked; only the packet root reachable |
| `block-merge` on a role's `git merge` | ✅ blocked |

The red-suite case is the one that matters most. A commit gate that resolves a test
command but never runs it passes every green case identically, so only a deliberately red
suite distinguishes a working gate from a silent one. It blocked and quoted the real
assertion failure.

The reviewer returned `NEEDS_CONTEXT` rather than guessing, which is what its charter
says to do when the packet does not carry what it needs. Its resolved packet root was the
`<os temp>/aeo-review-packets` convention, matching the gate.

**Two paths D22 recorded as never exercised are now exercised:** `review-jail` and a
role's merge attempt. The GitHub forge merge path remains unexercised, for the same
reason as below.

`D:\AEO` was byte-identical before and after, and no plugin was installed.

## The GitHub half

A private repository was created on the founder's own command, `main` pushed to it, and
one issue opened describing a real defect: `runningTotal` fails on a non-array argument
with a `TypeError` naming `filter` rather than the caller's mistake. Then
`/aeo:sprint-start` ran headless.

| Check | Result |
| --- | --- |
| Issue selection from the forge | ✅ took issue #1, the only unblocked one |
| Worktree cut, builder dispatched | ✅ `wt-issue-1`, branch `fix/1-running-total-input-guard` |
| Failing test first, watched red | ✅ red output quoted in the PR body, failing for the stated reason |
| Green, test and code in one commit | ✅ 5 tests pass |
| `tdd-ci` supplied the missing CI | ✅ workflow authored because the repo had none |
| Evidence collected and secret-scanned | ✅ committed under `docs/tdd-evidence/` |
| PR body generated from the template | ✅ evidence-linked, placeholders filled |
| **Stopped before pushing, and asked** | ✅ the lane refused to go outward-facing on its own |
| Push and `gh pr create` on approval | ✅ [PR #2](https://github.com/Muhanad-husn/aeo-testbed/pull/2), base `main` |
| CI green on the PR | ✅ Node 20 and 22, both pass |
| `gh pr merge` from an AEO role | ✅ blocked |
| `gh pr merge` from the orchestrator | ✅ allowed — the founder-approved path stays open |

The last two were exercised by invoking `block-merge.mjs` directly against the testbed's
real working tree, not through a live dispatched subagent: the auto-mode permission
classifier refuses a real merge attempt, as it should. Real hook, real repository, real
default-branch resolution — but not a real session, and this row claims no more than that.
The in-session wiring is proven separately by the `git merge` block in the local run.

The forge-tool merge arm remains unexercised for the reason the code already records: no
tool on the live GitHub MCP server has an action beginning with `merge`.

**The lane refused to push on its own and put the decision to the founder** with the
title, the branch, the commit list, and two flagged concerns. That is the invariant the
whole design rests on, and it held under a headless run with `Bash` fully permitted.

### The merge, and what cleanup did with it

PR #2 was squash-merged on founder approval. `main` fast-forwarded, its suite is green,
and the slice worktree was removed — the whole of `sprint-start` step 8 except the branch
retirement, which `safe-cleanup` declined to do.

**`safe-cleanup` does not recognise a squash merge.** A squash creates one new commit, so
the branch's own commits are never ancestors of the default branch. The classifier reads
that as `ahead-of-merged-pr` and keeps the branch:

```
fix/1-running-total-input-guard  ahead-of-merged-pr  2  0d  5  PR #2 merged but 5 commit(s) NOT in main — kept
Summary: 0 merged · 0 abandoned · 1 ahead-of-merged-pr (kept)
```

Refusing to delete on ambiguous evidence is L-05 working. But the evidence is not
ambiguous and the script already holds it: PR #2 is `MERGED`, and the branch head equals
the PR's `headRefOid` — both `14f1681`. Nothing was pushed after the merge, so every
commit on that branch is inside the squash. The script fetches the PR record, then decides
on ancestry alone and discards what the record told it.

This is not an edge case. Squash is GitHub's most common merge setting, and on a repository
that uses it this tool never deletes anything — it degrades silently into a report. It also
means the first live exercise of `safe-cleanup` was the thing that found it. No unit test
would have: the fixtures merge by fast-forward.

**Fixed, on founder approval.** The rule is an exact identity check, not a heuristic: a
merged PR whose recorded head SHA equals the branch head releases the branch. No threshold,
no tunable, nothing to defend. Both cases the old rule existed to defeat still hold — a
post-merge commit moves the head, and a reused branch name is a different commit, so the
SHAs differ and the branch is kept either way. Every merged PR on the branch is checked
rather than the first.

The delete-time re-verification had to change with it. It re-ran the cherry check, which a
squash-merged branch fails by construction, so classification would have said `merged` and
the delete step would have skipped it — the tool would still have deleted nothing. It now
re-asks whichever question the branch was classified on.

Same run, after the fix:

```
fix/1-running-total-input-guard  merged  2  0d  5  PR #2 merged this exact head (14f1681) — squashed into main
Summary: 1 merged · 0 abandoned · 0 ahead-of-merged-pr (kept) · 0 open-PR (kept) · 1 local-only/unknown (kept)
```

`feat/e2e` stayed kept, so the keep-set is not hollow and L-05's guard is unaffected.

Two planted defects were used as controls, both caught: matching on a SHA prefix (1 test
fails) and dropping the SHA comparison entirely, which is the "delete any branch with a
merged PR" catastrophe (5 tests fail). Nine new tests, all against PR records handed to the
rule directly — `gh` cannot be shimmed on Windows, so the CLI cannot be driven into this
state from a test. One further test pins the premise with real git: it squash-merges a
branch and asserts `git cherry` still reports every commit absent. If that ever stops
holding, the test says why the rule exists.

The apply run that would retire the branch is refused by the permission classifier, so the
branch is still present locally and on the remote. The tool never touches remotes by design
in any case.

### The finding this half produced

**A lane resolved the default branch correctly and then branched from `HEAD` anyway.**
`sprint-start` step 4 says to cut the worktree from the repository's default branch.
`main` was two commits behind `feat/e2e`, and the worktree was cut from `feat/e2e`, so the
PR carries two unrelated commits.

It was not silent about it. The wrap-up brief flagged it, and the PR body carries a *Base
branch note* giving the reasoning: issue #1's premise — that non-numeric entries are
already skipped — is only true on `feat/e2e`, so branching from `main` would have meant
re-implementing that behaviour and colliding later. The reasoning is sound and the
disclosure is exactly what the charter asks for.

Two things follow. The D16 default-branch resolution worked; what failed was the use of
the result, which no test of the resolver would catch. And step 4 is written as an
absolute with no escape hatch, so a correct judgment call could only be made by
overriding the step and saying so afterwards. **Phase 3 should give step 4 an explicit
exception clause** — cut from the default branch unless the issue's premise does not hold
there, in which case name the base and why in the PR body. That is what the lane did
unprompted; the skill should say it.

This is also why the testbed keeps a `main` that is behind. A repository whose default
branch is current cannot distinguish a lane that branches from the default from one that
branches from `HEAD`.

## What is missing from this checkpoint, stated rather than carried

**Headless verification needs a permission allowlist.** In `-p` mode Bash cannot be
approved interactively, so the fixture carries a `.claude/settings.local.json` granting
it. Worth knowing for anyone automating this: permissions and hooks are independent
layers, so granting Bash does not weaken the gate under test — the commit gate still
blocked a red suite with Bash fully allowed.

**There is no trigger-accuracy number, deliberately** ([D23](../../docs/DECISIONS.md)).
The trigger eval moved to Phase 6, where descriptions are tuned, because a number taken
here would read text scheduled to change and Phase 6's `skill-creator` pass over the same
five skills would re-roll it. Approved by the founder. The gap is real and this is where
it is recorded.

**Dogfooding has not started.** PLAN says it begins the moment Phase 1 closes; D21
forbids installing the plugin into this repository while its skills are stubs that read
as work orders. Both cannot hold. The stubs are now filled, so the constraint expires
with this phase — but Phase 2 was built ungoverned by its own gates, exactly as Phases 0
and 1 were.

## Findings no single slice could see

**The permission classifier refuses to create a repository or merge a PR, through `gh`
and through the GitHub MCP tools alike.** Neither is a plugin defect and neither should be
worked around. It has two consequences worth carrying: verification cannot bootstrap its
own remote, which is the argument for a permanent testbed rather than a per-run
throwaway; and the merge arm of `block-merge` is verifiable at the hook level but not by a
live merge attempt. Any future run that needs a fresh remote needs a founder command, and
should be planned for rather than discovered mid-run.


**A live gate hole, found by a currency check rather than by a test.** C-07's background
tool list names `PowerShell` alongside `Bash`. Every gate decided on the literal string
`Bash`. `sandbox-guard` was genuinely open — it is the only gate that does not exempt the
main session, so it refused `cat <file in the production data root>` while allowing
`Get-Content` on the same file. That is D22's file-tool hole one tool short of closed.
`block-merge` and `commit-gate` were latent. Fixed, with the tool set in `lib.mjs` and
`hooks.json` asserted against it.

`path-guard` was deliberately **not** widened, and a test pins that decision: a shell
writes through a redirect it cannot see whatever its matcher says. That remains D22's
carried finding.

**Two tests that passed for the wrong reason, both caught before they were trusted.** A
shimmed `gh` never resolved on Windows — Node cannot spawn a `.cmd` without a shell and
does not append PATHEXT — so every call reached the operator's real GitHub CLI and the
failure-path assertions passed because the real tool also failed. And `skip: null` skips
in Node's runner, so three tests reported as coverage were not running. The second is
L-08's own skip-guard trap, reproduced inside the tests written to enforce L-08.

**The tier-accounting guard was scoped to one directory.** It scanned `tests/hooks/`
only, so the first test file written outside it was accounted for by nothing — the exact
failure that guard exists to catch. It reads the whole tree now.

**Two subagent reports were wrong and would have made things worse if acted on.** One
flagged a dangling `find-docs` reference that had already been stripped; one reported
L-06's countermeasure as unhomed when it was in `sprint-start` step 5. Both were checked
against the files rather than taken on report.

**A `tools:` allowlist excludes MCP tools.** The current docs use `tools: Read, Grep,
Glob, Bash` as their worked example of a subagent that cannot use MCP tools. The triage
charter had been written to prefer the GitHub MCP issue tools over `gh`, which instructed
it to use something it did not have. Naming a server in `tools:` would hardcode an
identifier that varies per install — D14's failure with new names — so the charter uses
`gh`, which is gated identically.

## Corrections to the record

**D8's supporting fact is stale.** It states that `python3` on this machine is a
Microsoft Store alias stub. Python 3.13.14 runs here. D8's decision stands on its other
reasoning — one runtime, and L-09's five Windows encoding incidents — but the stated fact
is no longer true and should not be repeated.

## Standing constraints

**Did this phase remove more than it adds?** No, and it could not: it replaces stubs with
content. The honest check is against the sources ported. All five harness skills are
shorter than upstream in words. Of the five lanes, three are level or smaller; two grew,
each carrying an obligation the source did not have — EN-2's mechanism field, and packet
staging for a reviewer that did not used to be jailed. The three charters shrank from
62/43/22 lines to 26/20/17.

**Did anything hit a tripwire?** One candidate, resolved rather than justified. The L-05
keep-set guard needed a notion of "suspiciously small", which is a hand-tuned constant by
default. It ships as a categorical zero instead — a run that kept nothing on evidence —
with protected-by-name branches excluded from the count, since base and current exist in
every repository and counting them would make the check pass everywhere. No threshold, no
tunable, nothing to defend.
