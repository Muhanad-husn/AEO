# feat(phase-3): `new-project` asks the oracle question [slice 05]

**Spec:** PLAN.md#5-phases, row "3 Knowledge"; PLAN.md#2-the-method, the product oracle; PLAN.md#3-what-is-kept, row `new-project` · **Plan:** plans/phase-3/05-new-project.md
**Depends on:** #195 · **Issue:** #199
**Labels:** phase-3

## Deliverable

`plugin/skills/new-project/SKILL.md` asks, before it writes a line, which product oracle the project has: a key and rubric, an acceptance suite over samples, the founder as reader with a written checklist, or none yet. Its scaffold writes `RULES.md` with a `**Kill line.**` item, `PLAN.md` with a status table under a `Status` heading in the phase 2 shape, `LEDGER.md` with a `Ceiling $<n>` first line when money moves, `COMMITMENTS.md` empty, and lands one green commit on `main`. A scaffold that answered "none yet" still has a status table, so the sensorium prints `score: 0 of <n> phases done`, never `score: none declared`.

## Mechanism

The scaffold is data plus a runner already tested by `new-project-scaffold.test.mjs` (integration) and `new-project-plan-smoke.test.mjs` (fast). `scaffold-plan.json` gains the four files as steps with `when:` conditions on the oracle and money answers, read from a fixture at `tests/fixtures/new-project/oracle-answers.json`. Tests first, committed red; Sonnet builds the JSON and runner change; Opus writes the SKILL.md, under 120 lines, dropping "lanes and gates", the preflight order and the handbook step list, and saying why each file is there (phase 2 decisions 3 and 4, phase 0 decision 2). `new-project-commands.test.mjs` stays if the `gh api` block stays and goes with it otherwise.

## Acceptance criterion

Given a temporary directory and `scaffold-plan.json` applied with the oracle answer `founder as reader` and money `no`, when the scaffold runs, then `RULES.md` holds a line starting `**Kill line.**`, `PLAN.md` holds a table under a `Status` heading whose header has `Phase`, `State` and `Score`, `LEDGER.md` does not exist, `COMMITMENTS.md` exists with the phase 0 decision 4 header, `logs/` exists before any product file, and there is one commit on `main`; and when `node plugin/hooks/session-status.mjs` runs in that directory, then its output begins with `score: 0 of` and holds `bar:` followed by the kill line's sentence and `commitment: none declared`; and given money `yes` with a ceiling of 50, then `LEDGER.md`'s first line holds `Ceiling $50` and the sensorium prints `dollars: 0 of 50`; and `new-project/SKILL.md` has no ordered list of three or more items, no `refuse`, and is under 120 lines.

## Files

```aeo-independence
slice: 05-new-project
edits: plugin/skills/new-project/SKILL.md
edits: plugin/skills/new-project/assets/scaffold-plan.json
edits: tests/skills/new-project-plan-smoke.test.mjs
edits: tests/skills/new-project-scaffold.test.mjs
edits: tests/skills/new-project-commands.test.mjs
creates: tests/fixtures/new-project/oracle-answers.json
depends-on: 01-grader
```

## Out of scope

A separate bar declaration beyond the kill line (phase 2 decision 4 holds until a consumer asks); wiring the oracle answer into `scripts/score.mjs`; the third consumer's name (phase 6).
