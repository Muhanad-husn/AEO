---
name: status
description: Render the repository's live state instead of recalling it - the sensorium's score, bar, dollars, runs, commitment and harness cost, then open issues triaged, open pull requests with their check state, the Decision Log and any planned-against-built slice chains. Use when asked where things stand, what is next, or for ground truth at the start of a session.
---

# `status`: read the record, never the memory

Everything here is re-read from git, GitHub and the repository's own files on
every run. Nothing is cached and nothing is hand-maintained, because a status
answer once repeated a five-day-old memory and a never-ticked checkbox about
work that had already shipped (D5, L-08).

```
node "${CLAUDE_PLUGIN_ROOT}/skills/status/scripts/render-status.mjs"
```

Show the founder the output verbatim. Nothing is summarised before display.

## The sensorium

`plugin/hooks/sensorium.mjs` loads every module under `plugin/hooks/sensorium/`
in filename order and prints its lines first. Seven fields, over five sections:

- `score:` the consumer's own status table, under a Status heading with `State`
  and `Score` columns, in its `PLAN.md` or `docs/PLAN.md`. Anything else prints
  `score: none declared`. The table is the oracle (phase 2 decision 3).
- `bar:` the `Kill line` item in that repository's `RULES.md`, quoted. It is the
  one bar both consumers have written down (phase 2 decision 4); without one the
  line says `none declared`.
- `dollars:` spent, ceiling and balance from `LEDGER.md`.
- `runs:` the live and stale sentinels under `.aeo/runs/`, with unreadable
  sentinels and directory errors named rather than dropped.
- `last run:` the newest `logs/<dir>/run.jsonl`'s last record, one line. A
  session reads the structured record, never a run's prose (#183).
- `commitment:` the newest row of `COMMITMENTS.md` and, beside it, `executed:`
  whether the previous recommendation was carried out. The ledger is written by
  `plugin/scripts/commitment.mjs`, called by the model; nothing fires at session
  end, because a hook cannot read a recommendation out of prose (phase 2
  decision 5).
- `harness:` node processes per tool and lines read at session start. The
  tests-over-source ratio walks the source tree and stays in the score script
  (phase 2 decision 6).

A section whose render throws prints `<name>: unknown (<reason>)` and every
other line still prints.

## The rest of the view

- **Issues.** Every open issue, triaged into open, in flight (an open PR
  references it, or it has an assignee) and blocked (GitHub's own dependency
  field). Blocked wins over in flight, because it still cannot merge.
- **Pull requests.** Every open PR with the check state GitHub already computed
  (`statusCheckRollup`). A local suite run duplicates CI at the founder's
  expense.
- **The Decision Log.** One line per decision, from whichever of
  `docs/DECISIONS.md`, `DECISIONS.md`, `docs/decisions.md` or `decisions.md` the
  project has. With none, it falls back to the plugin's own log and says the
  project keeps none; only with neither does it report not found, naming every
  path it looked at (#132).
- **Slice chains.** For each `plans/<feature>/`, the slices planned against the
  slices with an evidence directory, and whether the README records the chain as
  closed. Evidence is staged when a PR opens, not when it merges, so it is a
  proxy for built and the render says so. Silent in a repository with no
  `plans/`.

`plugin/hooks/session-status.mjs` answers the same questions at session start
through the same code, lighter, against a stated latency budget. One renderer,
two callers.
