---
name: status
description: Render the project's current state — open issues triaged into open, in flight and blocked, open PR status with check state, and the Decision Log — as a generated view, never a hand-maintained one. Use when asked for project status, "where are we", or at the start of a session that needs ground truth instead of a memory file's word for it.
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

The script does three things, every run, from the record itself, and
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
  or `decisions.md` exists in this repo — detected, not assumed. If none
  of them exist, the render says so by name and still shows Issues and
  PRs; a missing source is reported, never silently dropped.

`plugin/hooks/session-status.mjs` renders the same issues-and-PRs answer
at SessionStart, through the same shared code
(`plugin/hooks/status-render.mjs`) — this skill and that hook are two
callers of one renderer, not two differently-shaped answers to the same
question. The hook's own render stays lighter (no check state, no
Decision Log) because SessionStart has a stated latency budget this
skill does not.

## What this skill does not do

Nothing is written, cached, or hand-maintained — re-run it and it
re-reads git and GitHub. It does not report the project's current phase:
there is no generated source for that without hand-maintaining a second
record, which is exactly what [D5](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)
exists to prevent. It does not run tests, gate health checks, or the
production-data-root check — those belong to `session-status.mjs`, not
to this skill's stated contract.
