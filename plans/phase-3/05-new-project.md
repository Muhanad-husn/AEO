# 05: `new-project` asks the oracle question

Issue: [#199](https://github.com/Muhanad-husn/AEO/issues/199)

## Goal

`plugin/skills/new-project/SKILL.md` asks, before it writes a line, which product oracle
the project has: a key and rubric, an acceptance suite over samples, the founder as
reader with a written checklist, or none yet. Its scaffold writes `RULES.md` with a
`**Kill line.**` item, `PLAN.md` with a status table under a `Status` heading in the
phase 2 shape (`Phase`, `State`, `Score`, `Closed`), `LEDGER.md` with a `Ceiling $<n>`
first line when the answer says money moves, and `COMMITMENTS.md` empty, then lands one
green commit on `main`. A scaffold that answered "none yet" still has a status table, so
the sensorium prints `score: 0 of <n> phases done` and never `score: none declared`.

## Acceptance criterion

Given a temporary directory and `scaffold-plan.json` applied with the oracle answer
`founder as reader` and money `no`, when the scaffold runs, then `RULES.md` holds a line
starting `**Kill line.**`, `PLAN.md` holds a table under a `Status` heading whose header
has `Phase`, `State` and `Score`, `LEDGER.md` does not exist, `COMMITMENTS.md` exists
with the phase 0 decision 4 header, `logs/` exists before any product file, and there is
one commit on `main`; and when `node plugin/hooks/session-status.mjs` runs in that
directory, then its output begins with `score: 0 of` and holds `bar:` followed by the
kill line's sentence and `commitment: none declared`; and given the answer money `yes`
with a ceiling of 50, then `LEDGER.md`'s first line holds `Ceiling $50` and the sensorium
prints `dollars: 0 of 50`; and `new-project/SKILL.md` has no ordered list of three or
more items, no `refuse`, and is under 120 lines.

## Mechanism

- The scaffold is data plus a runner already tested by `new-project-scaffold.test.mjs`
  (integration) and `new-project-plan-smoke.test.mjs` (fast). `scaffold-plan.json` gains
  the four files as steps with `when:` conditions on the oracle and money answers; the
  runner reads two answers. Tests first, committed red; Sonnet builds the JSON and runner
  change; Opus writes the SKILL.md, which is code-grade prose.
- The SKILL.md drops "lanes and gates", the toolchain preflight order and the handbook
  step list. It says what the scaffold leaves behind and why each file is there: the
  status table is what the sensorium reads (phase 2 decision 3), the kill line is the bar
  (decision 4), the ledger is where dollars come from (phase 0 decision 2).
- `new-project-commands.test.mjs` (the `gh api` branch protection block) stays as it is
  if the block stays; if the SKILL.md drops the block, the test goes with it.

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

A separate bar declaration beyond the kill line (phase 2 decision 4 holds until a
consumer asks). Wiring the oracle answer into `scripts/score.mjs`. The third consumer's
name (phase 6).
