---
name: status
description: Render the project's current state — open issues triaged into open, in flight and blocked, open PR status with check state, the Decision Log, and (when this repo has one) its planned-vs-built slice chains — as a generated view, never a hand-maintained one. Use when asked for project status, "where are we", "what's next", or at the start of a session that needs ground truth instead of a memory file's word for it.
disable-model-invocation: true
---

# Status — the North Star, generated

No port source — this skill is new to this project. It closes a gap the
vendored skill has: a hand-maintained tracker that drifts from the issues
and PRs it's supposed to summarize. This skill instead reads GitHub
issues, PR state, and the repo's Decision Log directly, every time it
runs, and renders them — never edited by hand, and never taken on a
stale memory file's word for it ([D5](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)).

## Procedure

Run the renderer from the repo root and show the founder its output
verbatim — nothing here is summarized or filtered before display:

```
node "${CLAUDE_PLUGIN_ROOT}/skills/status/scripts/render-status.mjs"
```

The script does four things, every run, from the record itself, and
nothing else:

- **Issues.** Every open issue, triaged into **open** (plain backlog),
  **in flight** (an open PR already references it, or it has an
  assignee), and **blocked** (GitHub's own issue-dependency field says
  something else has to land first). Blocked wins when an issue is both
  blocked and has a PR against it — it still can't merge.
- **PRs.** Every open PR and its check state — read from the same
  `gh pr list` answer GitHub already computes (`statusCheckRollup`),
  never from running the suite locally. A local run duplicates CI at the
  founder's expense.
- **The Decision Log.** One line per decision, by identifier, read from
  whichever of `docs/DECISIONS.md`, `DECISIONS.md`, `docs/decisions.md`
  or `decisions.md` exists in the **project** repo — detected, not
  assumed. A project that installs this plugin inherits its own
  `DECISIONS.md` rather than keeping a copy, so when none of the four
  project candidates exist the render falls back to the plugin's own
  log instead (resolved from `CLAUDE_PLUGIN_ROOT`) and says plainly
  that the project keeps none of its own. Only when neither the
  project nor the plugin has one does it report "not found," naming
  every path it looked at (issue #132).
- **Slice chains.** For every `plans/<feature>/` directory `tdd-plan`
  wrote, the slices planned against the slices with an evidence
  directory under `docs/tdd-evidence/<feature>/` (`red-green-refactor`
  / `safe-pr`'s own output — issue #132), and whether the plan's
  README records the chain as closed. Both paths are written by this
  plugin's own lanes, so counting them is generated, not
  hand-maintained (D5 still holds). This section is
  silent — not a header, not a zero — in a repo with no `plans/`
  directory at all, and its own render always names its limit: an
  evidence directory is staged when a slice's PR opens, not when it
  merges, so it is a proxy for "built," never proof.

`plugin/hooks/session-status.mjs` renders the same issues-and-PRs answer
at SessionStart, through the same shared code
(`plugin/hooks/status-render.mjs`) — this skill and that hook are two
callers of one renderer, not two differently-shaped answers to the same
question. The hook's own render stays lighter (no check state, no
Decision Log) because SessionStart has a stated latency budget this
skill does not.

## What this skill does not do

Nothing is written, cached, or hand-maintained — re-run it and it
re-reads git and GitHub. It still does not report a single "project
phase" field: [D5](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md) rules out
hand-maintaining a second record, and nothing forces `plans/` or
`docs/tdd-evidence/` to exist or to be current in every repo. Slice
chains is as far as that gets pushed honestly — it counts what
`tdd-plan` and `red-green-refactor`/`safe-pr` actually wrote, re-derived
every run, and it says nothing at all in a repo neither has touched
(issue #132). A feature with no `plans/` entry is invisible to it
either way, same as a spec written by hand. It does not run tests, gate
health checks, or the production-data-root check — those belong to
`session-status.mjs`, not to this skill's stated contract.
