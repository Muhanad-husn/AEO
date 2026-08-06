# Fix: the confirmed merge-gate bypasses

2026-08-04. Branch `fix/phase-1/block-merge`. Files: `plugin/hooks/block-merge.mjs`,
`tests/hooks/block-merge.test.mjs`.

Found in the Checkpoint 1 review round. Every command below passed the gate as an
`aeo:builder`, confirmed by direct probe before any change was made:

```
git push origin feat/x && git push origin main          -> exit 0
git push origin feat/x; git push origin main            -> exit 0
git push origin feat/x && git push origin --delete main -> exit 0
git push origin -d feat/dead                            -> exit 0
git push --all origin                                   -> exit 0
git push --mirror origin                                -> exit 0
git push origin "main"                                  -> exit 0
```

Seven probe commands, four root causes. Two more findings from the same round were
sent as judgement calls rather than as defects; both are decided below.

## The main one: only the first push was analysed

The push analysis read one slice of the command. `PUSH_ARGS_RE.exec` returns the first
match, and its capture `([^;&|]*)` stops at the first `;`, `&` or `|`. Everything after
that was invisible. The `git merge` arm never had the hole, because
`matchesGitSubcommand` scans the whole string, so the file was inconsistent with
itself and the merge arm was the model to follow.

**Resolution.** The same regex, made global, with the tail carried out of each match
and every match judged. `gitInvocationTails(command, sub)` is 5 lines and has exactly
two callers in this file: the push analysis and the `git branch` deletion check, which
needed the identical scoping for a different reason (below). Nothing moved to
`lib.mjs`; see "What did not change" at the end.

## The other three, each small and local

| Symptom | Cause | Fix |
| --- | --- | --- |
| `-d` passed | the push check tested for the literal `--delete`, while the branch check in the same file already handled `-d`/`-D`/`--delete` | one `DELETE_FLAGS` set, used by both |
| `--all`/`--mirror` passed | both are flags, so the non-flag list held only the remote, the refspec list was empty, and the gate fell through to the bare-push branch, which allows the call from a feature branch | `PUSH_EVERY_REF_FLAGS`, checked before the default branch is even resolved, since neither needs one to be wrong |
| `"main"` passed | the tail was split on whitespace with no quote handling | the split now drops the quotes that group a word |

The quote comment in the original reasoned that git ref names cannot contain
whitespace, so a plain split needed no quote handling. True about whitespace. It does
not reach quotes.

## The two judgement calls

### A forge write that omits `branch`: now blocked

Previously allowed, pinned by a test reading "a missing branch field is not enforced:
nothing to compare". That reading was wrong. The GitHub contents API defaults an
omitted `branch` to the repository's default branch, so an omitted branch is not an
absent target. It is the protected target, spelled without naming it.

The reference MCP server marks the field required, which may make the case unreachable
on that install. It does not settle the question. D14's rule is that the forge is
detected, not assumed, so the gate does not get to depend on one server's schema; and
D16's rule is that unresolved is never a pass, which the same function already applies
when the default branch cannot be determined. Allowing the case where the target is
*known* to be the default branch, while blocking the case where the target is unknown,
is the wrong way round. The test that pinned the old behaviour was changed, with the
reason written into it.

Cost of being wrong here is one clear message telling the caller to name the branch.
Cost of the old disposition is a silent direct write to the protected branch.

### `git branch` plus a stray `-d`: no longer over-blocks

`git branch --show-current && ls -d */` and `git branch -a && sort -d file.txt` both
blocked with "subagents never delete branches". The flag test ran against the whole
command string, gated only on the command containing a `git branch` somewhere, so a
`-d` belonging to a different program fired it. The flag test is now scoped to the
`git branch` invocation's own tail, which is the same scoping the push side needed.

An over-block is not a hole, so this was the lowest-priority item in the round. It was
fixed anyway because it costs three lines once the tail scan exists, and because a
gate that blocks obviously-fine commands teaches a builder that the gate is noise.

## What did not change

Deliberately left alone, to keep the fix the size of the bug:

- `lib.mjs`. A sibling slice owns it this round. `gitInvocationTails` is arguably the
  general form of `matchesGitSubcommand` and could live beside it, but it has one
  consumer file today and moving it would be a second gate's decision, not this one's.
- The refspec parser's shape: `+` prefix, `HEAD:<branch>`, `refs/heads/` stripping and
  the `:` deletion form are untouched and still pass their original tests.
- The identity policy (F5), the forge merge-action pattern, and the block wording.

Known and not addressed, because each is a widening rather than one of the reported
defects, and a widening is a founder call: a refspec built by shell expansion
(`git push origin $BRANCH`), `git push origin HEAD` from the default branch, and a
push wrapped in a subshell (`(git push origin main)`), whose closing paren currently
lands inside the destination token. Each is reachable and each is a distinct policy
question about what the gate should do with a value it cannot read.

## Verification

All seven bypass commands were confirmed failing before the change and blocking after,
by direct probe against the real gate script, alongside the controls that must keep
blocking (`git push origin main`, `git push origin HEAD:main`, `git merge feat/x`,
`git -C <dir> merge feat/x`, `git push origin :main`, `git branch -d feat/dead`, a bare
`git push` from the default branch) and the controls that must keep passing
(`git merge-base a b`, `git push origin feat/main-thing`, `git branch --list`, a bare
`git push` from a feature branch, and the orchestrator with no `agent_type`).

### Mutation testing

Each fix was reverted in turn and `tests/hooks/block-merge.test.mjs` re-run. Baseline
73 pass, 0 fail.

| Reverted fix | Tests red |
| --- | --- |
| M1 only the first git invocation is scanned | 10 |
| M2 `-d`/`-D` are not delete flags | 5 |
| M3 `--all`/`--mirror` unrecognised | 3 |
| M4 quotes are ordinary characters again | 2 |
| M5 a forge write with no `branch` is allowed | 2 |
| M6 the branch delete-flag test is unscoped | 2 |

M1 was 5 before the battery was strengthened. The five added cases vary position
(second and third in the chain), separator, and which of the gate's four push
decisions the hidden invocation trips, because the defect hid every one of them
equally. M4, M5 and M6 each reach exactly one decision, and every test capable of
detecting them is red; the counts are 2 because two is how many such tests exist, not
because coverage stops there.

One process note for whoever runs this next. A mutation harness that is killed
mid-run leaves the gate mutated, and the next run will read that as its baseline. It
happened here and the baseline-green check caught it. The harness now also refuses to
start unless every anchor is present.

### Test counts

`npm run test:all`, both tiers, nothing red.

| | Before | After |
| --- | --- | --- |
| Fast tier (`npm test`) | 103 | 103 |
| Integration tier | 359 | 382 |
| **Total** | **462** | **485** |

All 23 added tests are in `tests/hooks/block-merge.test.mjs`, which goes from 50 to 73.
One existing test changed rather than being added: the one that pinned a forge write
with no `branch` as allowed.
