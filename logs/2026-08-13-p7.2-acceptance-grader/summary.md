# P7.2: the grader scores 120/120 and missed the defect that broke a skill

2026-08-13. Branch `feat/phase-7/p7.2-grader-rerun`, cut from `main` at `69e40c2`.
Issue #43. Nothing under `plugin/` or `evals/` was changed by this slice. This file is
the whole product.

## The headline

`evals/grade-plugin.mjs` reports **120 of 120 expectations passing** against the shipped
plugin tree, with a **measured noise floor of zero**, and **14 of 16 planted defects
caught**.

The two it missed are the same defect: **YAML frontmatter that does not parse**. That is
not a hypothetical. It is issue #48, live in this tree, in
`plugin/skills/monitor-design/SKILL.md`, and the grader scores that file green. Worse
than green: its evidence string reads

```
PASS :: skills/monitor-design/SKILL.md declares a "name" and a non-empty "description"
     :: name="monitor-design", description=569 chars
```

for a file that loads at runtime with **zero** frontmatter fields. The grader does not
merely fail to notice. It states the opposite of what is true, in the evidence line a
reader would use to check it.

A skill has been unloadable since Phase 3 and the acceptance grader has never said so.

## Conditions

| | |
| --- | --- |
| Machine | Windows 11 10.0.26200, node v24.16.0 |
| Grader | `evals/grade-plugin.mjs` at `69e40c2`, unmodified |
| Tree graded | `plugin/` at `69e40c2` |
| Cross-check tool | `claude plugin validate <root> --strict` |
| Baseline | `evals/grade-plugin.mjs` and `plugin/` both at `4d7cae8`, the P2.M commit |

## Noise floor: zero, measured

Ten consecutive runs against an unchanged tree produced **one distinct output hash**.
Not zero by assertion, zero by measurement.

```
$ for i in 1 2 3 4 5 6 7 8 9 10; do node evals/grade-plugin.mjs plugin nf$i.json; done
$ md5sum nf*.json | awk '{print $1}' | sort -u | wc -l
1
```

The grader has no model call, no network, no clock and no randomness. The P2.M log
called the floor "zero by construction" and said plainly that nothing had been sampled.
It has now been sampled. **A one-check move in this number is a real move**, which is
what makes the per-check diff below worth reading.

## Positive control: 14 of 16 caught

Every plant mutates exactly one fact in a fresh copy of the pristine tree. A plant counts
as caught only when a check that passed on the pristine tree fails on the mutated one.

| Plant | Fact broken | Result |
| --- | --- | --- |
| P1 | `plugin.json` loses `version` (C-09) | caught, 119/120 |
| P2 | `skills/triage/` deleted | caught, 114/115 |
| P3 | a `commands/` directory appears (C-03) | caught, 119/120 |
| P4 | `skills/fix` description emptied | caught, 119/120 |
| P5 | `fix` lane loses `disable-model-invocation` (D9) | caught, 119/120 |
| P6 | `agents/builder.md` gains `permissionMode:` (C-01) | caught, 119/120 |
| P7 | builder declares `MultiEdit`, dropped at runtime (C-07) | caught, 119/120 |
| P8 | builder pinned to a raw model id (EN-9) | caught, 118/120 |
| P9 | reviewer given `Bash` (L-01) | caught, 119/120 |
| P10 | a gate script named in `hooks.json` deleted | caught, 119/120 |
| P11 | `uv run` written into a shipped skill (V-09) | caught, 119/120 |
| P12 | a shipped skill cites `D99`, which nothing defines | caught, 119/120 |
| P13 | `DECISIONS.md` grows an entry nothing cites | caught, 119/120 |
| P14 | a skill references a `${CLAUDE_PLUGIN_ROOT}` path that does not exist | caught, 119/120 |
| **P15** | **a description gains an unquoted `": "` (the #48 class)** | **MISSED, 120/120** |
| **P16** | **a description continues on a tab-indented second line** | **MISSED, 120/120** |

P8 is worth a note: it broke two checks, not one, because the model tier comparison
between builder and reviewer also depends on the alias. That is the check set behaving
correctly, not a leak.

P15 and P16 are real defects, not imagined ones. The same mutated tree that the grader
scores 120/120 is rejected by the official validator:

```
$ node evals/grade-plugin.mjs p15
p15: 120/120 passed

$ claude plugin validate ./p15 --strict
frontmatter: YAML frontmatter failed to parse: YAML Parse error: Unexpected token.
At runtime this skill loads with empty metadata (all frontmatter fields silently dropped).
Validation failed
```

## The score, and what flipped

**120 of 120.** No check fails. The comparison against P2.M is a check-by-check one, and
it decomposes into two independent causes.

| Run | Result |
| --- | --- |
| P2.M grader, P2.M tree (the reproduced baseline) | 91/91 |
| current grader, P2.M tree | 90/93 |
| current grader, current tree | 120/120 |

**No check flipped from pass to fail, or from fail to pass, anywhere in the comparison.**
The 91 to 120 move is entirely composition.

**Grader change, 91 to 93 checks.** Two rewrites and no new families. The rule "no
Markdown file cites a bare decision id" became "every decision id cited resolves to an
entry in `DECISIONS.md`", renaming 14 checks, and one new reverse check was added: every
entry in the shipped `DECISIONS.md` must be cited by something. The two inventory-count
checks were renamed as their expected counts moved. That is issue #30, landed in
`42d8db8`.

The three failures in the middle row are the current grader complaining that the Phase 2
tree lacks Phase 3, 4 and 5 content: 11 skills instead of 14, 3 agents instead of 5, and
no `verifier.md` to jail. They are the expected reading of an old tree by a new grader,
not regressions.

**Tree growth, 93 to 120 checks.** 27 checks appeared because 3 skills and 2 agents did.
Each new unit brings its own frontmatter check, its lane check or role checks, its Axial
scan, its decision-id scan and its `${CLAUDE_PLUGIN_ROOT}` path scan. All 27 pass.

The P2.M log has an internal inconsistency worth recording while it is cheap: its Numbers
table says "92 expectations, 92 pass" and its prose two paragraphs later says "91/91". The
reproduced run at `4d7cae8` is **91/91**, so the prose is right and the table is wrong.

## Did the grader catch #48?

No. Here is exactly why, and exactly what would have.

`plugin/skills/monitor-design/SKILL.md` carries a description ending

```
Do not use to check on a run in progress: "is it still working", ...
```

In YAML, a plain unquoted scalar cannot contain a colon followed by a space. That `": "`
after `progress` reopens the parser in mapping context and the block fails. Across all 14
skills and 5 agents, that is the **only** description containing a colon-space, and it is
the only file `claude plugin validate --strict` rejects.

The grader reads frontmatter with a hand-rolled line regex applied inside the `---`
fence. That regex matches the broken line happily and hands back a 569-character
description. The comment above it justifies the choice on the grounds that every file
uses single-line scalars only, which is a statement about what the files should contain,
not a check that they do.

**The check that would have caught it:** parse the frontmatter the way the runtime parses
it, and fail when it does not parse. One expectation per skill and agent file, worded as
"the frontmatter block parses as YAML". Two ways to get there, and both are one small
change:

- **Shell out to `claude plugin validate <root> --strict` and assert exit 0.** Zero new
  dependencies, uses the tool that already knows the truth, and it also covers manifest
  and schema rules the grader does not model. Cost: the grader stops being pure and
  read-only in-process, and it needs the CLI on PATH, so the existing unit tests need a
  skip path when it is absent.
- **Add a real YAML parse of the fence, and fail on a throw.** Keeps the grader pure and
  in-process. Cost: a dependency, which under the founder's principles needs approval.

The first is the 80/20 answer. The second is the one that keeps the grader's stated
character.

Either way the grader would then fail on the current tree, which is correct, and is the
whole point. A grader that has never failed on a real defect is not evidence.

## Limits: what this number cannot see

- **It never runs anything.** No plugin is installed or loaded, no agent is dispatched,
  no hook fires, no skill is invoked. D21, by design.
- **It does not parse YAML.** See above. It reads frontmatter as text that looks like
  YAML.
- **It does not judge prose.** A charter can be empty of meaning and pass every check.
  `status` is still a stub and scores the same as a finished lane.
- **It does not check whether a skill triggers.** No description is scored.
- **It checks the tools an agent declares, not the tools it uses.** C-07 is enforced on
  frontmatter only.
- **It checks that gate scripts named in `hooks.json` exist, not that they gate.** The
  hook tests do that, separately.
- **It has no continuity with the vendored skill's benchmark.** Different harness,
  different artifact. Any comparison would be invented.

## The trigger-eval gap, still open

D23 in `docs/DECISIONS.md` moved the trigger eval out of P2.M into Phase 6, and Phase 6
is deferred until the plugin has been used. So **Checkpoint 7 closes with no
trigger-accuracy number**, exactly as Checkpoint 2 did. This is the second checkpoint in
a row to carry that gap, and it is recorded here so the gap does not quietly disappear by
never being mentioned.

The gap is not neutral this time. The trigger eval measures whether a description fires
when it should, over the description-triggered skills. `monitor-design` is one of them,
and its description is dropped at load. Until #48 lands, that skill's trigger accuracy is
not low, it is undefined.

## Reproducing this

```
node evals/grade-plugin.mjs plugin out.json      # 120/120
claude plugin validate ./plugin --strict         # fails on monitor-design, exit 1
git archive 4d7cae8 plugin evals | tar -x -C <tmp>
node <tmp>/evals/grade-plugin.mjs <tmp>/plugin   # 91/91, the P2.M baseline
```

The plant harness ran against a copy of `plugin/` in the OS scratchpad, not against the
worktree, so no defect could survive a crash into a commit. The copy was proved
equivalent first: it produced an identical expectation vector to the worktree tree,
120/120, same texts and same verdicts. `git status` was clean before and after.
