# 02: block-merge judges the command's structure, for every subagent

Issue: [#168](https://github.com/Muhanad-husn/AEO/issues/168)

## Goal

A subagent's `grep -rn "git merge" plugin/` and `git commit -m "docs: git merge stays
with the founder"` pass; its `git merge feat`, `gh pr merge 12 --squash`,
`git branch -d feat` and `git push origin :feat` are refused; and the same commands from
the main session pass.

## Acceptance criterion

Given `tests/hooks/fixtures/block-merge-cases.mjs` with its `passes` and `blocks` lists,
each entry naming the first build record it came from,
when `node --test tests/hooks/block-merge.test.mjs` runs,
then every `passes` command exits 0 for a payload with `agent_type` `general-purpose` on
both `Bash` and `PowerShell`; every `blocks` command exits 2 for that payload and exits 0
for a payload with no `agent_type`; `git merge feat "unterminated` exits 2 with a reason
that names the text fallback; and every forge-arm test of the first build passes
unchanged.

## Mechanism

- No skill or plugin fits. No MCP. No model call.
- Library: lib.mjs's `commandSegments`, already exported and already the parser
  redirect-guard and sandbox-guard use.
- The shell arm judges each segment by its program and arguments: program `git`, its
  `-C <dir>` and `-c <k=v>` options skipped, subcommand `merge` (not `merge-base`, not
  `merge-tree`); program `gh` with arguments `pr merge`; program `gh` with `api` and a
  path argument ending in `/merge`; program `git` subcommand `branch` with `-d`, `-D` or
  `--delete`; program `git` subcommand `push` with a delete flag or a refspec whose left
  side is empty (`:feat`, `+:feat`).
- A word inside a quoted argument of any other program is never read: grep, echo,
  printf, `git commit -m`, `git log --grep`, `node -e`, `Select-String`.
- An interpreter's inline command string (`bash -c`, `sh -c`, `pwsh -Command`,
  `powershell -c`) is parsed as its own command list and judged the same way, so
  `bash -c "git merge feat"` is refused.
- When `commandSegments` reports a parse error the current text match decides, so a
  command the parser cannot read is judged as it is today and the gate does not fail
  open on a quoting trick.
- Identity: the shell arm enforces on any non-empty `agent_type`, the rule the global
  copy already applies; the main session, with no `agent_type`, keeps its
  founder-approved path; the C-02 cost is stated in the file header.
- The forge arm is unchanged.
- Behavioural tests first, committed red; Opus builds (fail-closed logic).

## Shape

- `block-merge.mjs` keeps its forge arm and its `tailTokens`/`pushDeletesRemoteBranch`
  helpers where they still serve, replaces `gitInvocationTails` and the whole-command
  regexes with a walk over `commandSegments(command).segments`, recursing into an
  interpreter's `-c` string, and keeps the old regex path in one function named for what
  it is, the fallback, called only when `error` is non-null.
- The identity test becomes `agentIdentity(payload) !== null`.
- The header comment states what is judged, what is never read, the fallback, and the
  C-02 cost, in under twenty percent of the file.
- `tests/hooks/fixtures/block-merge-cases.mjs` exports `passes` and `blocks`, each entry
  `{ command, source }` where `source` names where the first build recorded it.
- The passes list, at least: `grep -rn "git merge" plugin/` (CLAUDE.md known limit);
  `git commit -m "docs: say git merge stays with the founder"` (CLAUDE.md known limit);
  `printf '%s\n' "- git merge is the founder's call" >> RULES.md` (PLAN.md section 3,
  refused documentation of the rule itself); `git branch --show-current && ls -d */`
  (block-merge.mjs comment, an earlier false positive); `git branch -a | sort -d`
  (block-merge.test.mjs); `git merge-base HEAD main` (V-02, docs/EVIDENCE.md);
  `gh pr view 12 --json mergeable`; `gh api repos/o/r/pulls/1 --jq .mergeable`;
  `echo "gh pr merge is the founder's"`; `node -e "console.log('git merge')"`;
  `git log --merges --oneline`; `git log --grep="merge"`;
  `Select-String -Pattern "git merge" -Path RULES.md` (PowerShell).
- The blocks list, at least: `git merge feat`; `git -C D:/x merge feat`;
  `cd D:/x && git merge feat`; `gh pr merge 12 --squash --delete-branch`;
  `gh api repos/o/r/pulls/1/merge -X PUT`; `git branch -d feat`; `git branch -D feat`;
  `git push origin --delete feat`; `git push origin -d feat`; `git push origin :feat`;
  `git status; git push origin :feat`; `bash -c "git merge feat"`;
  `sh -c 'git merge feat'`; `pwsh -Command "git merge feat"`; and the parse-failure
  fallback case `git merge feat "unterminated`.

## Files

```aeo-independence
slice: 02-block-merge-structural
edits: plugin/hooks/block-merge.mjs
edits: tests/hooks/block-merge.test.mjs
creates: tests/hooks/fixtures/block-merge-cases.mjs
depends-on: 01-one-process
```

## Out of scope

Any change to lib.mjs (a gap found in `commandSegments` is reported in the pull request,
not patched here; slice 03 owns lib.mjs in this phase); the founder's global copy at
`~/.claude/hooks`, which is copied over by hand after the phase closes; README's "Who
merges" section and every skill that names roles (phase 3); gate.mjs and hooks.json
(slice 01).
