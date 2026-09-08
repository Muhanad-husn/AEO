# AEO: the second build

Written 2026-09-08. This is the plan of record. It replaces `docs/PLAN.md`, which is the
first build's plan and stays as its record. The first build's lessons are in
`docs/EVIDENCE.md` and `docs/DECISIONS.md` and are not repeated here except where they
became a rule or a gate that survives.

## 1. What is being built

A Claude Code plugin that runs a solo founder's software shop on a frontier model without
telling the model how to work. The founder keeps three things: the merge, the money and
the production data. The model keeps everything else: which tool, which tier, which path,
whether a change needs a reviewer, how to demonstrate it. The plugin's job is to make the
goal impossible to lose sight of and the irreversible impossible to do by accident.

RLM is the example, not the cure. Its three-file harness moved a project from sixteen days
with no graded report to rubric 90 in four days. It did that inside one project with one
scorable oracle, one founder and one machine. What generalises is the shape: gates on
outcomes, the goal in view, the path free. What does not generalise is the file set, and
this plan does not copy it.

**The final deliverable** is `plugin/` at `v1.0.0`, installed into two consuming projects
of different shape, with the number for each printed beside the release: days to a correct
deliverable, dollars, and founder interventions per merged pull request, against the same
project's own record under the first build.

## 2. The method

Three layers. One is code and refuses. One is code and shows. One is prose and advises.
Nothing prescribes.

| Layer | Kind | What it does | Fires |
|---|---|---|---|
| Invariants | code, PreToolUse, fails closed, no override | Merge and branch deletion stay with the founder. Production data is unreachable. A declared test command does not run while a long job's sentinel is live. A role does not rewrite the config that governs it. | Only on the matching tool and command. Nothing fires on Read, Grep, Glob, Task or MCP calls that are not a merge. |
| Sensorium | code, SessionStart and `/status`, writes nothing | Prints what the model cannot passively see: the product number and its bar, dollars spent of the cap, open issues and pull requests, live runs and their last progress line, the last recommendation and whether it was executed, and the harness's own cost this session. | Every session start, and on demand. |
| Knowledge | prose, description-triggered, advisory | How this shop does a thing and why, with the incident behind each rule. Tests red first for behaviour; the existing suite as oracle for the rest. A pull request says what, what it cost, which number it expects to move. Branch cleanup classifies before it deletes. A long job is watched from its run log, not its shell. | When the model judges it relevant. No skill refuses, no skill is operator-only except `sprint-plan`, no skill names a step order. |

Two mechanisms sit across the layers.

**The commitment ledger.** Every session ends with one recommendation. The sensorium reads
it back at the next session start with one word beside it: executed, partial, not. That is
the paper's reflection-action gap measured on ourselves at zero cost, and the first drift
signal the first build never had. The model tracks its own thread; the harness only shows
it the thread.

**The persistence cap.** Two attempts per shape, then the shape changes or the model says
the method is wrong. A harness red gets minutes. A method question is a first-class
message, never an apology.

**The product oracle** is the one project-specific thing. `new-project` asks for it before
it writes a line: a key and rubric, an acceptance suite over samples, or the founder as
reader with a written checklist. A project may answer "none yet". The sensorium then prints
`score: none declared` on every session start until it has one. Nothing refuses; the
absence is loud.

## 3. What is kept from the first build, and how it changes

| First build | Second build | Why |
|---|---|---|
| `block-merge`, role-scoped, matches text | kept; applies to every subagent; matches command structure so `grep "git merge"` passes | Merge is the founder's. The text match refused documentation of the rule itself. |
| `sandbox-guard` rules 1, 2, 5, 6 | kept, no override | Three named incidents, one of them 49,674 live entries read by tests. Capability does not make production data reversible. |
| `sandbox-guard` rule 3, parse failure blocks | dropped to a warning | Refused harmless command shapes when armed. The data rules still hold on any path the parser can read. |
| `path-guard`, `redirect-guard` | kept | Cheap, outcome-shaped, one demonstrated bypass closed. |
| `review-jail` | deleted | Reviewer worked through a keyhole and its only measurement refused clean work 67 to 100 percent. Blinding is done by what the verifier packet omits, not by denying tools. |
| `session-status` | becomes the sensorium | Right instinct, stopped at git state. |
| `status` | same renderer, more fields | One renderer, two callers, unchanged. |
| `runlog`, `run-monitor`, `run-sentinel` | kept as scripts and one reference | The monitor is the convention that answers "is it still working" from a terminal. Worth keeping for any model. |
| `monitor-designer` agent, `monitor-design` skill | one reference file, no agent | The pid table and the hook landmines are knowledge. The agent was a lane. |
| `sprint-plan`, `independence.mjs` | kept, operator-only, the only such skill | Slicing before filing is the founder's checkpoint. Independence over declared creates cost a real collision to learn. |
| `sprint-start`, `worker-dispatch` | one reference: how to dispatch, cap of four writers, no worktree for workers | The orchestrator dispatches; it does not need a lane to. |
| `fix` | unlocked, model-invocable, folded with `red-green-refactor` into one advisory `build` skill | The fast lane existed and was locked to the founder's keyboard. |
| `red-green-refactor` doctrine, 7,000 words | `test-strategy.md` sections that carry a measurement stay; the rest goes | "Follow these literally" is what produced literal following. |
| `safe-pr`, evidence collector, template | `pr` reference: what, cost, number; secret scan stays; evidence when it demonstrates | Untrimmable packet on a one-line fix. Secret scan is cheap and outcome-shaped. |
| `safe-cleanup`, classifier script | kept, advisory, script unchanged | Every guard cites its incident. Deletion is irreversible. |
| `tdd-ci`, workflow templates | kept as reference | Templates are knowledge. |
| `new-project` | rewritten: asks the oracle question, writes `RULES.md`, `PLAN.md` with a status table, `LEDGER.md` if money moves, one green commit | The scaffold is where the goal enters the project. |
| `triage`, `review`, `verify` lanes | deleted; the verifier's blinding protocol and the risk rubric survive as one reference | The model decides when to dispatch a second reader and says why in the PR. |
| Five agent charters | deleted | Plain dispatch. Tier chosen per slice by the orchestrator, stated in one line. |
| `hooks.json` matcher-less `review-jail` entry | gone | One node process on every Grep, for a function that returned at its first line. |
| Trigger eval, `grade-plugin` | run, reported, gate nothing | An eval number is read, never protected. |

## 4. Consumers and the score

The plugin is scored on projects that use it, never on itself. Three consumers, of
different shape on purpose.

| # | Project | Shape | Oracle | Baseline on record |
|---|---|---|---|---|
| 1 | `D:\RLM` | Python pipeline, model calls, money | key, rubric, spread | phases 0 to 5: 4 days, $3.50, 48 PRs under one hook and two skills. `RLM-Challenge`: 16 days, $20.58, 122 PRs, no report, under the first build |
| 2 | `D:\CIP-code` | service with production data at `D:\CIP-data`, 7,000 tests | acceptance suite, founder as reader | filed #127, #130, #133, #134 against the first build: an hour lost to a flaky gate, a day to harness noise, two lockouts |
| 3 | a fresh project from `new-project` | whatever the founder names; a UI is the useful case | founder as reader with a checklist | none; this is the generalisation test |

**The score**, per consumer phase: days from first issue to the phase's gate, dollars,
founder interventions per merged pull request (a message that corrects, re-asks or
unblocks), and the commitment ledger's executed rate. Read by a script from git, GitHub
and the consumer's own ledger; nothing hand-counted. The harness's own cost is printed
beside it: node processes per Bash call, lines read at session start, tests over source.

## 5. Phases

One artefact per phase, checked against a consumer. The next phase does not start until
the gate passes. A gap found later is fixed in the phase that owns it.

| Phase | Artefact | Test against the score | Consumer | Days |
|---|---|---|---|---|
| 0 Score | `scripts/score.mjs`: reads a consumer repo and prints days, dollars, PRs, interventions, executed rate, harness cost | Reproduces RLM's phases 0 to 5 row and `RLM-Challenge`'s sixteen days from their records. Two runs byte-identical | 1 | 1 |
| 1 Invariants | `hooks/` at the keep-list of section 3; `hooks.json` with matchers that fire nothing on read tools | `block-merge` structural on the first build's false-positive list. Node processes per call: Grep 0, Bash 1 unarmed, 2 armed. Existing hook tests pass minus the deleted | none | 1 |
| 2 Sensorium | `session-status` and `/status` printing the section 2 fields, plus the commitment ledger read and write | Against RLM: prints its status row, ledger balance, last recommendation with its executed word. Against a repo with no oracle: prints `score: none declared` | 1 | 1 to 2 |
| 3 Knowledge | `skills/` rewritten advisory; agents deleted; `new-project` asks the oracle question; references carry every surviving incident | `grade-plugin` finds no `refuses`, no `disable-model-invocation` outside `sprint-plan`, no step-ordered lane. Session-start read budget under 150 lines. Every reference cites an incident or a measurement | none | 2 |
| 4 Run 1 | RLM phases 6 and 7 built with the plugin installed, replacing the global copies | Score row for phases 6 and 7 beside the row for 0 to 5. Not slower, not more interventions | 1 | RLM's own |
| 5 Run 2 | CIP's next milestone built under the plugin, `AEO_LIVE_DATA_ROOT` declared | No lockout, no false refusal, sentinel and data rules hold live. Score row beside CIP's record under the first build | 2 | CIP's own |
| 6 Run 3 | A fresh project from `new-project` to its first gated artefact | Scaffold to first green commit in one session; oracle declared or `none declared` printed; score row exists | 3 | 1 to 2 |
| 7 Removal | Each surviving rule taken out in turn, the cheapest consumer rerun, the rule deleted if the score holds | The plugin ships with only rules that failed the removal test. `v1.0.0` tagged with the three score rows in the release notes | all | 2 |

**The bar.** Phase 4 is the bar: RLM under the plugin must not be slower or cost more
founder interventions per PR than RLM under one hook and two skills. If the plugin adds
nothing over three files, the three files are the product and the plugin is the
installer for them.

**Kill line.** If phase 4 misses the bar, or phase 5 produces a lockout or a refusal of
legitimate work, the layer that caused it is removed, not fixed, before another phase
runs. Two misses on the same layer and the layer is gone from the plan.

## 5a. Status

One row per phase, written by the phase's closing pull request.

| Phase | State | Score | Harness cost | Closed |
|---|---|---|---|---|
| 0 Score | done | consumer: Muhanad-husn/RLM<br>phases: 0 to 5, 2026-09-05 to 2026-09-08<br>days: 4<br>dollars: 3.50<br>prs: 48 merged<br>interventions: 1.40 per merged PR (67 messages, 41 merge decisions excluded, 38 sessions)<br>executed: none declared<br>harness: bash 1 node, grep 0, read 0, task 0; session start 839 lines; tests 0.77 of source (9534 / 12348)<br>consumer: Muhanad-husn/RLM-Challenge (from record)<br>phases: all, 2026-08-21 to 2026-09-05<br>days: 16<br>dollars: 20.58<br>prs: 117 merged of 122<br>interventions: no transcripts<br>executed: none declared<br>harness: no checkout | harness: bash 1 node, grep 0, read 0, task 0; session start 835 lines; tests 1.76 of source (17005 / 9677) | 2026-09-08 |
| 1 Invariants | not started | | | |
| 2 Sensorium | not started | | | |
| 3 Knowledge | not started | | | |
| 4 Run 1 | not started | | | |
| 5 Run 2 | not started | | | |
| 6 Run 3 | not started | | | |
| 7 Removal | not started | | | |

**How a phase becomes issues.** The founder types `/sprint-plan` for the phase. Three to
six issues, each a vertical piece that leaves an artefact a test checks, the closing issue
last. Each issue is one session and one pull request. Unblocked issues run concurrently,
at most four.

## 6. Models and what is set free

The orchestrator is Fable 5.1 and chooses. No charter pins a tier. The plugin's only
statement on tiering is one line in the dispatch reference: if a second reader is
dispatched, it sits at or above the builder's tier, because two instances of one model is
a rerun.

What the model decides, and records in one line where it matters:

- **Path.** Which tool, which order, whether a test comes first for a non-behavioural
  change. The existing suite is the oracle when behaviour does not move.
- **Tier and fan-out.** Opus, Sonnet or Haiku per slice; reads fan out without limit;
  writers are capped at four because that is what one founder can read, not what a model
  can do.
- **Review.** Whether a change needs a second reader, blinded or not, and why. The default
  is the founder reading the PR.
- **Demonstration.** What evidence a PR carries. A transcript when it shows something; a
  sentence when it does not.
- **Design.** A spec or a plan is prose the model may change. It logs one dated line and
  moves on. The founder vetoes after, never approves before. Approval is for merge and
  money.
- **Purpose over letter.** When an instruction's letter and its purpose disagree, the
  model says so and follows the purpose.

What the model does not decide: the merge, the spend past a cap, reaching production
data, and rewriting the hooks that hold those three.

## 7. Cost

Dollars in this repository are near zero; the consumers spend their own and cap it in
their own plans. The cost this plan tracks is the harness's:

| Quantity | First build | Target |
|---|---|---|
| Node processes per Bash call | 4, plus a global duplicate | 1 unarmed, 2 armed |
| Node processes per Grep, Read, Task | 1 to 2 | 0 |
| Lines read at session start | about 500 across `CLAUDE.md`, charters and skill descriptions | under 150 |
| Skill and reference prose | 2,724 lines plus 164 of charters | under 800 |
| Mandatory tool calls on a one-line fix | 12 to 15 plus an Opus dispatch | the edit, the test, the commit, the PR |

Every phase's closing PR prints the row.

## 8. Reporting to the founder

One message per phase, and one per day while a phase is open: the score row, the harness
cost row, and one recommendation with the number behind it. If the message cannot name
the score, nothing else in it counts.

## 9. What is deliberately not built

- No lane that orders steps. A skill says what this shop wants and why; it never says
  "then".
- No agent charters. Dispatch is a call with a prompt and a tier.
- No reviewer on every PR, no verifier by rubric. A second reader is the model's call.
- No evidence template, no committed evidence directories.
- No eval that gates a merge. Trigger accuracy and shape grading are printed in the PR.
- No spec approval step. Prose is free; git is the audit.
- No local re-derivation of anything GitHub enforces server-side. D30 stands.
- No configuration option nobody sets. A declaration that is missing is printed as
  missing; it never blocks.

## 10. Repository layout

```
PLAN.md          this file
RULES.md         one page: the gates and the two rules that stop the loop
CLAUDE.md        what a session in this folder must know
plugin/          the product: hooks/, scripts/, skills/, references/
scripts/         score.mjs and the consumer readers
tests/           one file per hook and per script; prose gets none
docs/            the first build's plan, decisions and evidence; record, not process
logs/            run records, one directory per verification
source/          the vendored origins, verbatim, untouched
```

## 11. Decisions the founder has made

Made 2026-09-08: RLM is the example, not the template; the good conventions stay as
knowledge, the lanes go; the orchestrator is trusted with path, tier, review and design;
three consumers of different shape; the merge, the money and the data stay gated in code.

Made 2026-09-08, on this plan's proposals:

1. The third consumer is a small UI project, because it is the shape no oracle covers and
   the founder-as-reader case has never been run. The project is named when phase 6 is
   sliced.
2. `block-merge` gates every subagent, as the global copy already does in RLM, because
   plain dispatch has no role names to scope to.
3. A founder intervention is any founder message inside an issue's session other than the
   merge decision, counted from the transcript by the score script.

Made 2026-09-08, in phase 0:

1. The window is the first commit's calendar date to the date the last phase's State cell
   turned `done`, read in the closing commit's UTC offset; days are inclusive, so RLM's
   2026-09-05 to 2026-09-08 is 4.
2. Dollars come from `LEDGER.md`'s Phase and Dollars columns summed over the phase range,
   never from the status table.
3. A founder message is a `user` record with string content not starting with `<` and not
   marked meta; a merge decision is such a message of at most twelve words carrying
   approve, approved, merge or lgtm, and is excluded from the intervention count.
4. The commitment ledger is `COMMITMENTS.md`, a table with an Executed column holding
   executed, partial or not; a blank cell stays out of the denominator, and a consumer
   without the file prints `executed: none declared`.
5. RLM-Challenge is scored from `scripts/records/rlm-challenge.json`, a record copied from
   the first build's design mistake register, because its repository no longer exists;
   the row's first line says `(from record)`.

No decision is open.
