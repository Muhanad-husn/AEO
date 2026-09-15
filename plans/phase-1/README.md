# Phase 1: Invariants

Milestone `Phase 1`. Spec: `PLAN.md` section 5, row "1 Invariants", and section 2,
the Invariants layer. Consumer: none; the phase is checked on this repository's own
hook tests and on the count.

The outcome: `plugin/hooks/` holds the keep-list of `PLAN.md` section 3 and nothing
else. `hooks.json` wires one script, `gate.mjs`, on three matchers: the shells, the
write tools, and a GitHub forge merge. Nothing fires on Read, Grep, Glob, Task or a
forge call that is not a merge. block-merge judges the command's structure, so a
subagent can grep for the two words `git merge` and commit a message that contains them.
The sandbox guard warns instead of refusing on a command it cannot read, after judging
every path it can read. Every fence applies to every subagent. The plugin's count is
one node process on a shell call, one on a write call, none elsewhere.

## What the survey found

- Today `hooks.json` fires four node processes on every Bash call (sandbox-guard,
  redirect-guard, block-merge, review-jail), one on every Grep, Read and Task
  (review-jail has no matcher), and sandbox-guard on Read and NotebookRead. The
  founder's global block-merge copy adds a fifth on Bash on this machine.
- `scripts/score/harness.mjs` exports `measure`, which counts node hooks per tool by
  testing each matcher against the tool name. That is the phase's count, already written
  in phase 0.
- block-merge matches text: `matchesGitSubcommand` and whole-command regexes. `CLAUDE.md`
  records the limit: a subagent cannot grep for or commit a message containing `git
  merge` side by side. The first build's other false positives are on record in
  `block-merge.mjs` (`ls -d` after `git branch`), its test (`sort -d`), and V-02
  (`git merge-base`).
- `lib.mjs` already exports `commandSegments`, the shell parser redirect-guard and
  sandbox-guard use, with a non-null `error` when the command cannot be read.
- sandbox-guard's rules, by order in `sandboxGuard`: 1 sentinel, 2 seam, 3 parse
  failure refuses, 4 an unnamed `cd` refuses, 5 a named path inside the live root
  refuses, 6 an operation directory inside the live root refuses. `PLAN.md` keeps 1, 2,
  5, 6 and drops 3 to a warning; rule 4 is not named there.
- path-guard, redirect-guard and block-merge all gate on `isAnyAeoRole`, which matches
  only `aeo:<role>`; a `general-purpose` subagent passes every fence today. The
  charters that carried the `aeo:` names are deleted in phase 3.
- `sandbox-guard.mjs` already exports its check and runs `runGate` only behind a main
  guard; block-merge, path-guard and redirect-guard run `runGate` at the top level and
  must take the same shape before one script can call them.
- Tests pinned to the current wiring: `tests/hooks/hooks-json.test.mjs`, the
  registration describe at the end of `tests/hooks/sandbox-guard.test.mjs`, and
  `tests/skills/gate-map.test.mjs`, which compares the count of distinct scripts in
  `hooks.json` to README's "The gates" section.

## The shape decisions this phase fixes

- **One script per matched call.** `gate.mjs` dispatches on `tool_name` to the kept
  rule modules in one process. The count is one on Bash and PowerShell, one on Edit,
  Write, MultiEdit and NotebookEdit, zero elsewhere. `PLAN.md` section 5 allows two on
  Bash when armed; this shape is one in both states.
- **Read is not matched.** `PLAN.md` section 2 says nothing fires on Read. The L-03 read
  incident was code reading a live index, which arrives as a Bash call and is still
  judged.
- **The forge matcher names the merge.** `^mcp__.*github.*__merge` starts a process
  only for a merge-named action; the gate still checks the name.
- **Structure first, text as the fallback.** block-merge walks `commandSegments`; when
  the parser reports an error the current text match decides, so the gate never fails
  open on a quoting trick.
- **A command the guard cannot read is judged on what it can read, then allowed with a
  warning.** Rules 3 and 4 both take this shape; folding rule 4 in goes past
  `PLAN.md`'s literal line, which names rule 3 only, and the founder decides it at
  review. The warning rides in the hook's JSON stdout.
- **Every subagent.** The three fences enforce on any non-empty `agent_type`, per
  `PLAN.md` section 11 decision 2, with the C-02 cost stated once: a main session
  launched with `--agent` reads as a subagent.
- **The global copy is the founder's.** `~/.claude/hooks/block-merge.mjs` is outside
  the repository; the gate's pull request recommends copying the new file over it.

## Slices

| NN | Slice | Plan | Issue | Depends on |
|---|---|---|---|---|
| 01 | One node process per shell call, and none on a read tool | [01-one-process.md](01-one-process.md) | #167 | none |
| 02 | block-merge judges the command's structure, for every subagent | [02-block-merge-structural.md](02-block-merge-structural.md) | #168 | 01 |
| 03 | A command the sandbox guard cannot read is judged on what it can read, then allowed with a warning | [03-unreadable-command-warns.md](03-unreadable-command-warns.md) | #169 | 01 |
| 04 | The config fence holds for every subagent | [04-fence-every-subagent.md](04-fence-every-subagent.md) | #170 | 01 |
| 05 | Phase 1 gate: the counts and the status row | [05-gate.md](05-gate.md) | #171 | 02, 03, 04 |

Order of work: 01, then 02, 03 and 04 together, then 05.
