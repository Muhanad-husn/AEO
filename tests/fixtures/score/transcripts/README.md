# Synthetic transcripts

Four hand-written session files in the shape Claude Code writes under
`~/.claude/projects/<slug>/`. No real transcript text is here, and no test reads
a real one. One JSON object per line.

A founder message is a `user` record whose `message.content` is a plain string
that does not open with `<` and that is not marked `isMeta`. Everything else in
these files is noise the count has to drop:

- tool results, whose content is an array
- task notifications, system reminders, slash commands and hook output, all of
  which arrive wrapped in a tag
- `assistant` and `summary` records

A merge decision is a founder message of at most twelve words containing
`approve`, `approved`, `merge` or `lgtm`. `in-window-a.jsonl` holds one long
message containing the word `merge`; it is over twelve words, so it counts as a
message and not as a decision.

Across the four files: 7 typed founder messages, 2 merge decisions, 5 task
notifications, 3 system reminders, 1 slash command, 2 hook outputs.

| File | First founder message (UTC) | In a 2026-09-06 to 2026-09-07 window read at +02:00 |
| --- | --- | --- |
| `in-window-a.jsonl` | 2026-09-06T00:02:47.905Z | yes, 2026-09-06 |
| `in-window-b.jsonl` | 2026-09-07T21:30:00.000Z | yes, 2026-09-07 |
| `before-window.jsonl` | 2026-09-05T10:00:00.000Z | no, 2026-09-05 |
| `after-window.jsonl` | 2026-09-07T22:30:00.000Z | no, 2026-09-08 |

The two sessions inside the window hold 5 messages and 1 merge decision between
them.

## `../commitments-sample.md`

The commitment ledger a consumer keeps as `COMMITMENTS.md`. It is a markdown
table with an `Executed` column holding one of `executed`, `partial` or `not`.
A blank cell is unmarked and stays out of the denominator, so the sample's five
rows read `executed: 2 of 4 marked`.
