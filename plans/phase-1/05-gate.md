# 05: Phase 1 gate: the counts and the status row

Issue: [#171](https://github.com/Muhanad-husn/AEO/issues/171)

## Goal

`PLAN.md` section 5a reads `1 Invariants | done` with the harness cell carrying two lines
quoted verbatim: the plugin's own count from slice 01's test, `plugin: bash 1 node, grep
0, read 0, task 0`, and this repository's `harness:` line printed by `node
scripts/score.mjs D:/AEO` on the closing commit; the score cell reads `consumer: none
(phase 1 has no consumer)`; the CI run on the closing commit is green with no
review-jail test in either tier and is cited by its run URL, never re-run locally.

## Acceptance criterion

Given slices 02, 03 and 04 merged to `main`,
when the CI battery runs on the closing commit,
then it is green, `npm test` and `npm run test:integration` in `package.json` name no
review-jail test, `tests/hooks/gate.test.mjs` passes with `bash 1, grep 0, read 0, task
0`, every entry of `tests/hooks/fixtures/block-merge-cases.mjs` passes or blocks as
listed, and `PLAN.md` section 5a's row `1 Invariants` reads `done` with the two harness
lines and the date.

## Mechanism

- Prose written by hand from the script's output and the CI log, quoted verbatim in the
  pull request body.
- `node scripts/score.mjs D:/AEO` prints this repository's `harness:` line on the closing
  commit; the plugin's own `plugin:` line comes from slice 01's test, not from the score
  script.
- No model call. Sonnet builds.

## What the closing pull request writes

- `PLAN.md` section 5a, row `1 Invariants`: state `done`, the score cell
  `consumer: none (phase 1 has no consumer)`, the harness cell with the two quoted lines,
  the date it lands.
- `PLAN.md` section 11, a new dated block "Made <date>, in phase 1", one line each:
  1. one gate script, `gate.mjs`, runs every kept rule in one process per matched call, so
     the plugin's count is one node process on a shell call, one on a write call, and
     none on Read, Grep, Glob, Task or a forge call that is not a merge;
  2. Read and NotebookRead are not matched, because section 2 says nothing fires on Read
     and the L-03 read incident arrived through code, which is a Bash call;
  3. the forge matcher is `^mcp__.*github.*__merge`, so a forge call that is not a merge
     starts no process;
  4. block-merge judges `commandSegments` and falls back to the text match only when the
     parser cannot read the command;
  5. sandbox-guard rule 3 and rule 4, a command the parser cannot read and a `cd` it
     cannot name, judge every path they can read and then allow with a warning, and the
     warning is carried in the hook's JSON stdout;
  6. block-merge, path-guard and redirect-guard enforce on any non-empty `agent_type`,
     with the C-02 cost stated once.
- The pull request's recommendation, not a file change: copy `plugin/hooks/block-merge.mjs`
  and `plugin/hooks/lib.mjs` over `~/.claude/hooks/` on the founder's machine so the
  global copy stops refusing a `grep` for the two words, and delete the known-limit
  sentence from `CLAUDE.md` when that is done.

## Files

```aeo-independence
slice: 05-gate
edits: PLAN.md
depends-on: 02-block-merge-structural
depends-on: 03-unreadable-command-warns
depends-on: 04-fence-every-subagent
```

## Out of scope

Phase 2. Any change under `plugin/hooks/` beyond what CI on the closing commit exposes; a
defect found there is fixed in its owning slice's files with a note in this pull request.
The founder's global hooks and `CLAUDE.md`'s known-limit sentence, which wait on the
founder's copy. The plugin version, which stays `0.2.0` until `v1.0.0`.
