# Harness & sprint wiring (Phases 4–5)

## § Harness — vendor & adapt `brainqub3/red-green-refactor` (Phase 4, DEC-6)

Goal: the harness suite living in `.claude/skills/`, adapted to the single-builder
loop, the gates, and the stack profile. Read its
`references/red-green-refactor-philosophy.md` and `test-strategy.md` first.

1. **Vendor by copy** (do not depend on an external install). Clone and copy the
   `.claude/skills/*` tree in. **Record the source commit SHA in the Decision Log**
   so the vendored version is reproducible. (Reference build vendored @ `593e7ab`,
   MIT.) Keep the vendored `references/` docs verbatim; adapt the `SKILL.md` files.
   **Do not keep a `tdd-harness` coordinator skill** — `/sprint-start` (§ Sprint) is
   the coordinator, and a second coordinator describing a different pipeline is a
   landmine.
2. **Audit before trusting.** Review any script that writes or deletes — e.g.
   `safe-cleanup/scripts/classify-branches.mjs`, `safe-pr/scripts/collect-evidence.mjs`
   — and the philosophy doc. (Audit outcome on the reference build: both clean —
   classify-branches is local-only, dry-run by default, needs `--apply --yes`,
   protects main/base/current/open-PR branches, writes a recovery log before
   deletion; collect-evidence writes only inside the repo, drops trace/HAR files by
   default, and secret-scans evidence. Re-audit on any newer SHA.)
3. **Adapt `red-green-refactor` for DEC-1 (v2):** one builder, both test layers.
   The builder writes the acceptance test **first**, watches it fail for the right
   reason, then drives inner unit red→green→refactor cycles until it passes — test
   and code committed together (no red commit exists; the commit gate's fast tier
   stays green throughout). If the spec's *intent* seems wrong, the builder stops
   and reports BLOCKED with the question; if only the wording is stale, it updates
   the spec in the branch and notes it for the PR body. Branch naming:
   `feat/<feature-slug>/<NN>-<slice-slug>`, cut from fresh `main`. Scope its green
   checks to the tiers (see "Test-suite architecture" below): inner cycles run the
   unit suite; the outer-loop close runs the slice's acceptance test plus the
   current subproject's contracts — **not** the full suite, which belongs to CI,
   once per PR.
4. **Co-locate inner unit tests under `src/` (DEC-20).** `tests/` holds the
   behavioral acceptance contracts, grouped by subproject (`tests/<subproject>/`);
   inner unit tests live next to the code (`src/**/test_*.py`). Configure the
   runner to collect both (pytest: `testpaths = ["tests", "src"]`). This keeps the
   commit-gate tier addressable as `pytest src` and slice-close scoping as one
   runner argument.
5. **Contract movement is disclosed, not forbidden.** Editing a pre-existing test
   or a spec section takes a one-line justification in the PR body. An edit whose
   purpose is making failing code pass is never legitimate — that judgment falls to
   the reviewer (when dispatched) and the founder on the diff.
6. **Adapt `tdd-plan`:** write per-slice plan files under `plans/<feature>/`, each
   with a field linking its GitHub issue (see § Sprint). The acceptance criterion
   (Given/When/Then) becomes the test the builder writes first. Plans name the
   **simplest mechanism that meets the bar** and defer generality, tunables, and
   polish to the out-of-scope section by default — over-engineering starts at plan
   time; if the mechanism needs hand-tuned constants over messy real-world data,
   the plan should ask whether a model call is the simpler machine.
7. **Adapt `tdd-ci`:** run the **full suite** (this is where it lives — see
   "Test-suite architecture" below), split into a parallel hermetic-unit pass and a
   serial acceptance pass, with dependency/model caches keyed on the lockfile;
   commit the GitHub Actions workflow under `.github/workflows/`. Making the
   workflow a required status check is a branch-protection change — founder
   approval, orchestrator executes. **Never commit secrets** — CI injects them.
8. **Adapt `safe-pr` to the non-web evidence path:** integration through the real
   endpoint plus transcript evidence (test-run transcript + a real boundary
   invocation), Playwright only for web slices. Before opening the PR it must
   verify: the **sprint suite** green locally (the full tree is CI's job — see
   "Test-suite architecture"); **contract movement disclosed** (every edit to a
   pre-existing test or spec has its one-line justification in the PR body — stop
   on undisclosed movement); review findings addressed or logged **if** a review
   ran (on-demand in v2). Evidence is secret-scanned before commit. Use a bare
   `Closes #NN` in the PR body so the issue auto-closes on merge. `safe-pr`
   **prepares** the PR and stops; the merge runs in the main session once the
   founder approves.
9. **Keep `safe-cleanup` report-first and local-only**, but not founder-executed:
   it reports, the founder approves, and the orchestrator runs the deletions.

**Verify:** `/tdd-plan` on a sample feature writes slice plans; `/red-green-refactor`
drives one slice test-first to green; `/tdd-ci` yields a passing Actions run;
`/safe-pr` prepares a PR into `main` with embedded evidence and does not merge.
Smoke-test the vendored scripts (classifier dry-run; collector two-phase flow —
plant a fake credential and confirm the secret scanner catches it). **⛔ CHECKPOINT 4.**

## § Sprint — lane skills over the harness (Phase 5)

Thin skills that replace the session model and drive the builder through the
harness. Two lanes, one builder.

1. **`/sprint-plan`** (sprint-backlog): decompose a subproject into a backlog of
   GitHub issues, each linking its `plans/<feature>/` slice files from `/tdd-plan`.
   **Draft issue bodies to local files for founder review before filing** — the
   founder approves the plan (one of the three human moments) — then file through
   the GitHub plugin's `issue_write`. *Known failure mode:* the plugin token may
   lack issue-write scope (a live 403 was hit); sanction a `gh issue create`
   fallback in the skill.
2. **`/sprint-start`** (sprint-execution): run from the main session, ideally fresh
   (`/clear` — sprints replace sessions; the issue and its plan carry all context).
   Select the next issue whose `Depends on:` issues are all closed and which has no
   `blocked`/`needs-context` label. Load the issue, its plan, and the spec section
   it cites — a missing or stale spec section is **not a stop**: the builder drafts
   or corrects it in the branch, and the PR shows the founder both. Cut the branch,
   dispatch the **builder** (acceptance test first and watched failing → inner
   cycles to green → sprint suite green; on the sprint's first issue, declare the
   `Sprint suite:` command as an issue comment — later issues reference it).
   Dispatch the **reviewer only when warranted** (founder asks, or the change is
   high-blast-radius: shared modules, data-facing heuristics). Then `safe-pr`
   prepares the PR — **stop at the prepared PR**. The merge is a separate step the
   orchestrator runs once the founder approves; `safe-cleanup` follows.
   **Bookend every session with two mandatory founder-facing briefs**, each
   dual-register (a plain-language part with no jargon, then a technical part with
   real names and mechanics):
   - *Kickoff*, before the branch is cut: what capability the product gains and
     why; issue number/title, slice, files it will touch, shape of the acceptance
     test; "done when" in one line.
   - *Wrap-up*, at the pause: what the product can now do, framed as observable
     behavior; what was actually built (test now green, files changed, design
     choices, any spec/test edits and their justifications); and whether the plan
     held or diverged. No session runs dark.
   Invariants: one issue = one branch = one PR, never batch.
3. **`/fix`** (the fast lane): for a bug or small change that does not warrant a
   full slice. One judgement call, one dispatch: scope-check (fix-sized vs
   feature-scale — feature-scale **bounces to `/sprint-start`**), cut `fix/<slug>`
   from fresh `main`, dispatch the **builder**, which owns its own testing — for a
   behavioral bug, a regression test that fails before the fix and passes after,
   committed together with it; for a non-behavioral change the existing suite is
   the oracle; a spec touched by the fix is updated in the same branch. No
   test-author relay, no classification buckets, no mandatory review. The
   builder's BLOCKED-on-scope-creep report plus the feature-scale bounce keep the
   fast lane from becoming the default. Like `/sprint-start` it is founder-invoked
   and pauses at the prepared PR for approval.
4. **`/triage` and `/review`:** thin entry points that delegate to the triage and
   reviewer roles. `/review` is **on-demand** — it is not a pipeline stage; CI plus
   the founder's PR review are the standing checks. A project `review` skill
   deliberately shadows any built-in PR-review skill — the role reviewer is the
   house reviewer.
5. **GitHub labels** (via the plugin): `design-question` (a genuinely contested
   design *intent* awaiting the founder — the only thing that still stops work),
   `blocked`, `needs-context`, `done-with-concerns`, plus the subproject namespace
   `sub:<subproject-slug>`. Keep the namespace coarse — one label per
   subproject/phase, not per feature. Label discipline: the labels reflect reality
   on the issue at all times; concerns and blockers go to the issue thread, not
   private notes.

**Verify:** `/sprint-plan` on a sample PRD produces real issues with linked slice
plans; `/sprint-start` drives one issue from selection to a prepared PR with no
manual git; `/fix` lands a fix plus its regression test in one dispatch.
**⛔ CHECKPOINT 5.**

## Guardrail that spans both phases

Everything the harness and sprint skills do runs **under the Phase 3 gates**. If a
**subagent** driven by `safe-pr` or `/sprint-start` ever tries to merge — via `git`
or the plugin's merge tool — the block-merge hook stops it. That is the design: the
builder takes a feature all the way to a green PR, then pauses for approval. On the
founder's "approved", the orchestrator (main session) runs the merge and, afterwards,
`/safe-cleanup` on the merged branch — approval is the requirement, not founder-run
commands.

## Test-suite architecture — a designed deliverable, not a default (post-setup learning)

The naive flow runs the full suite many times per issue: every inner commit, slice
close, review, `safe-pr`, CI. On any project with an expensive dependency (a
document-conversion pipeline, a model load, a real external endpoint) this kills
throughput, and the gate gets resented instead of trusted. Every repo has its own
dependency profile, so the suite's run structure must be **designed per repo**,
around one principle: **the cost of a test run is proportional to the blast radius
of the change; the full suite runs at boundaries, never inside loops.**

Three run tiers, each with a trigger and a budget:

| Tier | Trigger | What runs | Budget |
|---|---|---|---|
| Commit gate | every `git commit` (hook) | hermetic co-located unit tests, parallel, slow-marked excluded | seconds |
| Slice close | closing the outer loop on a slice (may repeat) | the slice's acceptance test + the **current subproject's** contracts, plus any neighbors reachable from shared code the slice touched | ~a minute |
| PR gate | **once** per PR: CI as the required check | the full suite, every subproject | minutes, paid once, off the founder's critical path |

**The subproject principle.** Work is divided product → subproject → sprint →
issue. A slice in subproject N does not rerun subproject 0's acceptance contracts
on every cycle — those contracts still guard regressions, but at the PR gate, where
they run every time and stay required. **Nobody runs the full `tests/` tree
locally** (production lesson: it duplicated CI and the wait landed on the founder;
`safe-pr` records the sprint-suite run as evidence and links the CI run for the
rest). If the slice touches shared code, pull the affected neighbors' contracts
into the slice-close run explicitly and call the blast radius out in the PR body;
when unsure, err wider once rather than paying the full suite always. Make the
scoping mechanical from the start: group contracts by subproject
(`tests/<subproject>/` directories or markers) so "the current subproject's
contracts" is one test-runner argument, not a hand-picked list — and declare the
sprint's exact command once (`Sprint suite:` comment on the sprint's first issue)
so no role invents scope.

**Efficiency levers proven in production** — apply whichever the repo's dependency
profile calls for:
- **Isolate the expensive dependency.** Lazy-import it so collection stays cheap;
  mark the tests that exercise it for real (`slow` marker) and keep exactly one
  designated end-to-end test for it, deselected everywhere the acceptance contracts
  already cover that path.
- **Cache expensive intermediates by content hash.** If the product persists
  derived artifacts keyed on the input's hash, acceptance tests sharing fixtures
  pay the expensive step once per fixture, not once per test (reference build:
  parse-tree reuse cut the acceptance suite from ~10 min to ~2 min). Pair it with
  an autouse fixture that snapshots and byte-for-byte restores the shared state
  directories, so a test that overwrites a cached artifact cannot poison the next
  test that reuses it.
- **Parallelize the hermetic; serialize the state-sharing.** Unit tests run
  `-n auto` (pytest-xdist); acceptance contracts that drive real subprocesses over
  shared scratch dirs run serially. CI runs them as two passes.
- **Skip what provably cannot change the result** — docs-only commits skip the
  suite (see `hooks.md`; fails safe to running it).
- **Cache in CI** — dependency and model-weight caches keyed on the lockfile, so
  the required check stays fast too.

**The professionalism line:** scoping changes *when* a test runs, never *whether it
gates the merge*. No contract is weakened, deselected at the PR gate, or deleted
for speed; the full suite remains the required CI check. The suite design and the
per-commit policy are gate policy, not an implementation detail — record them in
the Decision Log with founder approval.
