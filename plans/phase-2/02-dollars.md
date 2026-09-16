# 02: Dollars spent of the cap

Issue: [#182](https://github.com/Muhanad-husn/AEO/issues/182)

## Goal

`plugin/hooks/sensorium/20-dollars.mjs` prints one line from the consumer's `LEDGER.md`:
`dollars: <spent> of <ceiling>, balance <balance> (LEDGER.md)`, where the ceiling is the
first `$<n>` after the word `Ceiling` in the prose above the table, the balance is the
last table row's `balance` cell, and spent is the difference. A repository with no
`LEDGER.md` prints `dollars: none declared`. A `LEDGER.md` the reader cannot parse prints
`dollars: LEDGER.md present, unreadable (<reason>)`.

## Acceptance criterion

Given a temporary repository holding a `LEDGER.md` whose first line is
`Ceiling $50. Written by the code that makes gateway calls; a line added by hand says so.`
and whose table ends with a row whose balance cell is `31.8800`,
when `renderSensorium(root)` runs,
then its output holds the line `dollars: 18.12 of 50, balance 31.88 (LEDGER.md)`;
and given a repository with no `LEDGER.md`, then it holds `dollars: none declared`;
and given a `LEDGER.md` with a `Ceiling $50` line and no table, then it holds
`dollars: LEDGER.md present, unreadable (no table with a balance column)`.

## Mechanism

- No existing skill or plugin fits. No MCP. No model call. Node only.
- A new reader `plugin/hooks/ledger.mjs` exports `parseLedger(markdown)` returning
  `{ ceiling, balance, rows }` or a reason; it uses `splitRow` from
  `plugin/hooks/status-table.mjs` (slice 01). `scripts/score/sources.mjs` keeps its own
  ledger read for the phase-range sum; a later slice may fold it in, not this one.
- Two decimals, because the score script prints dollars to two decimals and the founder
  reads both.
- Behavioural tests first, committed red; Sonnet builds.

## Files

```aeo-independence
slice: 02-dollars
creates: plugin/hooks/sensorium/20-dollars.mjs
creates: plugin/hooks/ledger.mjs
creates: tests/hooks/sensorium-dollars.test.mjs
creates: tests/fixtures/sensorium/rlm-ledger.md
depends-on: 01-composer-score
```

## Out of scope

Per-phase dollars and the phase cap from the consumer's `PLAN.md` phase table; the
score script's own ledger sum; a ledger in any file but `LEDGER.md`.
