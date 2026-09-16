# Phase 3: Knowledge

Milestone `Phase 3`. Spec: `PLAN.md` section 5, row "3 Knowledge"; section 2, the
Knowledge layer; section 3, the keep table; section 9. Consumer: none.

The outcome: `plugin/skills/` is advisory prose that says how this shop does a thing and
why, with the incident behind each rule, and never names a step order; the five agent
charters are gone; `new-project` asks the oracle question before it writes a line; and
every surviving incident lives in one reference file that cites it. `grade-plugin` reads
that shape and finds no `refuses`, no `disable-model-invocation` outside `sprint-plan` and
no step-ordered lane; the plugin's session-start read budget is under 150 lines; every
reference cites an incident or a measurement. The grader reports, it gates nothing.

## What the survey found

- Fifteen skills, 3,099 lines of skill and agent prose against a target under 800. Seven
  carry `disable-model-invocation: true` (`fix`, `review`, `sprint-plan`, `sprint-start`,
  `status`, `triage`, `verify`). Nine files hold the word `refuse`. Five agent charters,
  164 lines. No `plugin/references/` directory; references sit under each skill.
- `evals/grade-plugin.mjs` grades the first build's shape: fifteen skills, five agents, the
  operator-lane set, model aliases per charter. Its 48 tests run on fixtures, not the live
  tree. Deleting one agent turns it red by design.
- Eight fast-tier tests pin first-build lanes by reading their prose: `gate-map`,
  `reviewer-every-pr`, `sprint-start-ordering`, `worktree-before-merge`,
  `push-needs-no-approval`, `packaging-surface`, `risk-rubric`, `verify/positive-control`.
  `plan-actors.test.mjs` (integration) pins `sprint-start`'s script.
- The session-start read budget is measured by `plugin/hooks/harness-cost.mjs`: consumer
  `CLAUDE.md` lines plus every agent charter's lines plus one line per skill. The plugin's
  share today is 164 charter lines plus 15. The 834 printed in `PLAN.md` 5a is dominated by
  the founder's other plugins and is not this phase's number.
- `new-project` writes a scaffold from `assets/scaffold-plan.json` (tests:
  `new-project-commands`, `new-project-plan-smoke`, `new-project-scaffold`). It asks no
  oracle question and writes no `RULES.md`, no status table, no `LEDGER.md`.
- Phase 2 fixed the oracle's shape: a status table under a Status heading with `State` and
  `Score` columns, and the bar as `RULES.md`'s `Kill line` item, until `new-project` writes
  a separate declaration (phase 2 decision 4).
- `evals/trigger-cases.json` names the current roster; renaming `fix` to `build` and
  deleting lanes changes its expected answers.

## The shape decisions this phase fixes

- **One references directory.** `plugin/references/<topic>.md`, one topic per file. The
  first lines under the title name the incident or measurement it carries, by its
  `docs/EVIDENCE.md` id or its number. Skill-local `references/` directories go.
- **The grader is rewritten first, and it counts nothing.** Slice 01 replaces the roster,
  agent and charter checks with the phase 3 checks and makes the rest count-agnostic, so
  slices 02 to 05 can each delete or rename skills without touching it.
- **A step-ordered lane is an ordered list of three or more items in a SKILL.md body,**
  outside `sprint-plan`. That is the mechanical reading of section 9's "never says then";
  the grader also prints the count of `then` as a number, never as a check. The founder
  may narrow or widen this reading; it is one regex.
- **The tests that pinned lanes go with the lanes.** A deleted lane has no test; a rewritten
  skill is prose and gets none (D20, RULES). The grader's fixture tests are the only tests
  this phase adds.
- **`tdd-plan` is not in section 3's table and is deleted.** It is a lane that orders
  slicing. The parts of `slicing-guide.md` that carry a measurement move to a reference
  `sprint-plan` and `build` both point at.
- **`tdd-ci` becomes a reference with its workflow templates beside it**, per section 3.
- **`new-project` asks one question and writes three files.** Oracle: key and rubric, an
  acceptance suite over samples, the founder as reader with a checklist, or none yet. It
  writes `RULES.md` with a `Kill line` item so the sensorium's `bar:` has something to
  read, `PLAN.md` with a status table in the phase 2 shape, `LEDGER.md` when the answer
  says money moves, and lands one green commit.
- **The score row's harness cell prints the plugin's own read budget**, as phase 1's row
  did with `plugin:`, so the 150-line bar is measured on the artefact, not on the
  founder's machine.

## Slices

| NN | Slice | Plan | Issue | Depends on |
|---|---|---|---|---|
| 01 | The grader reads the second build's shape; agents and lane tests go | [01-grader.md](01-grader.md) | #195 | none |
| 02 | One `build` skill from `fix`, `red-green-refactor` and `tdd-plan` | [02-build.md](02-build.md) | #196 | 01 |
| 03 | The references: dispatch, second reader, run monitor, CI | [03-references.md](03-references.md) | #197 | 01 |
| 04 | `pr`, `safe-cleanup` and `status`, advisory | [04-pr-cleanup-status.md](04-pr-cleanup-status.md) | #198 | 01 |
| 05 | `new-project` asks the oracle question | [05-new-project.md](05-new-project.md) | #199 | 01 |
| 06 | Phase 3 gate: the grade, the read budget and the status row | [06-gate.md](06-gate.md) | #200 | 02, 03, 04, 05, #194 |

Order of work: 01, then 02, 03, 04 and 05 together, then 06. #194 (RLM finished, phase 4
moves to CIP) edits `PLAN.md` and is independent of 01 to 05; it merges before 06, which
also edits `PLAN.md`.
