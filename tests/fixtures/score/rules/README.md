# Synthetic transcripts for the rules block

Three hand-written session files in the shape Claude Code writes under
`~/.claude/projects/<slug>/`. No real transcript text is here. One JSON object per
line. `tests/scripts/score-rules.test.mjs` copies them into a temporary home:

| File | Placed at | Stands for |
| --- | --- | --- |
| `session.jsonl` | `<slug>/session-1.jsonl` | a top-level session |
| `session-resumed.jsonl` | `<slug>/session-2.jsonl` | a resumed session that repeats one refusal record of `session-1` with the same `uuid` |
| `subagent.jsonl` | `<slug>/session-1/subagents/agent-a1.jsonl` | a subagent session |

The window is 2026-09-28 to 2026-10-01, read at +02:00, closing at
2026-10-01T18:00:00Z.

A refusal is a `tool_result` whose text reads `hook error: [<command>]: BLOCKED: <reason>`
and whose command is the plugin's `gate.mjs`. A warning is a `hook_system_message`
attachment that opens with `sandbox-guard: `.

What each file holds, and what it should count:

- `session.jsonl`: a `/aeo:sprint-plan` typed command (skill load), the pre-#214 seam
  refusal (`sandbox-guard/seam-unset`), an `aeo:build` Skill call, a Read of
  `references/ci.md` under the plugin cache, an unnamed-`cd` warning, and one refusal
  from `gate.mjs` whose text no table entry knows (unmatched). Not counted: a
  `run-names-root` refusal on 2026-09-27, before the window; an `aeo:pr` Skill call on
  2026-10-02, after it; a refusal from the founder's own `~/.claude/hooks/block-merge.mjs`;
  a Grep result that quotes `BLOCKED:`; a non-plugin Skill and a non-plugin reference.
- `session-resumed.jsonl`: the same seam refusal record again, which counts once.
- `subagent.jsonl`: refusals for `block-merge/git-merge`, `block-merge/pr-merge` (its
  text arrives as an array), `block-merge/text-fallback`, the seam rule again,
  `sandbox-guard/write-unrestorable` twice (current wording and the wording from before
  #237), `path-guard/harness-config` and `redirect-guard/target`; a Read of
  `plugin/references/slicing.md` and an `aeo:pr` Skill call.

Totals inside the window: 9 refusals, 1 warning, 1 unmatched, 3 skill loads (build,
sprint-plan, pr), 2 reference loads (ci, slicing), 3 sessions of which 1 is a subagent.
