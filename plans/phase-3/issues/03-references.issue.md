# feat(phase-3): the references: dispatch, second reader, run monitor, CI [slice 03]

**Spec:** PLAN.md#5-phases, row "3 Knowledge"; PLAN.md#3-what-is-kept, rows `monitor-design`, `sprint-start`, `tdd-ci`, `triage`/`review`/`verify` · **Plan:** plans/phase-3/03-references.md
**Depends on:** #195 · **Issue:** #197
**Labels:** phase-3

## Deliverable

Four files under `plugin/references/`, each carrying the knowledge of a deleted lane and the incident behind it: `dispatch.md` (how to dispatch, writers capped at four, no worktree for operation workers, a second reader sits at or above the builder's tier), `second-reader.md` (the verifier's blinding protocol and the risk rubric as what a second reader is for), `run-monitor.md` (the sentinel convention, the pid table, the hook landmines), `ci.md` (the workflow templates, moved unchanged to `references/workflows/`, and when a job becomes a required check). `sprint-start`, `worker-dispatch`, `triage`, `review`, `verify`, `monitor-design` and `tdd-ci` are deleted, with `plan-actors.mjs`.

## Mechanism

Prose, code-grade: Opus for `dispatch.md` and `second-reader.md`, which state rules; Sonnet for `run-monitor.md` and `ci.md`, copied and cut from `hook-landmines.md`, `monitor-design/SKILL.md`'s pid table and `github-actions-guide.md`. Each under 120 lines; with slice 02's two, the references stay under 500 lines. `run-monitor.md` points at `runlog.mjs`, `run-monitor.mjs` and `run-sentinel.mjs`, unchanged. `risk-rubric.md` folds into `second-reader.md` as the rubric's rows. No script, no model call at runtime.

## Acceptance criterion

Given slice 01 merged, when `node evals/grade-plugin.mjs plugin` runs after this slice, then no expectation names a file under `references/`; and the seven skill directories above do not exist; and each of the four references cites an `EVIDENCE.md` id or a number within its first five lines (`dispatch.md`: D11 and C-07; `second-reader.md`: L-01 and the 67 to 100 percent refusal rate; `run-monitor.md`: L-02 and V-11; `ci.md`: D17 and D24); and `plugin/references/workflows/` holds the files that were under `tdd-ci/assets/workflows/`; and no reference holds an ordered list of three or more items; and `npm test` is green.

## Files

```aeo-independence
slice: 03-references
creates: plugin/references/dispatch.md
creates: plugin/references/second-reader.md
creates: plugin/references/run-monitor.md
creates: plugin/references/ci.md
creates: plugin/references/workflows/README.md
edits: plugin/skills/sprint-start/SKILL.md
edits: plugin/skills/sprint-start/references/actor-cap.md
edits: plugin/skills/sprint-start/scripts/plan-actors.mjs
edits: plugin/skills/worker-dispatch/SKILL.md
edits: plugin/skills/triage/SKILL.md
edits: plugin/skills/review/SKILL.md
edits: plugin/skills/verify/SKILL.md
edits: plugin/skills/verify/references/risk-rubric.md
edits: plugin/skills/monitor-design/SKILL.md
edits: plugin/skills/monitor-design/references/hook-landmines.md
edits: plugin/skills/tdd-ci/SKILL.md
edits: plugin/skills/tdd-ci/references/github-actions-guide.md
edits: plugin/skills/tdd-ci/assets/workflows
depends-on: 01-grader
```

Paths listed as `edits` and removed by the slice are deletions.

## Out of scope

`safe-cleanup`, `safe-pr`, `status` (slice 04); `new-project` (slice 05); the `build` skill (slice 02); trigger cases (slice 06).
