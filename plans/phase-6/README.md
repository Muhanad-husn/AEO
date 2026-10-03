# Phase 6: Removal

Milestone `Phase 6`. Spec: PLAN.md section 5, row "6 Removal"; PLAN.md section 5a, the status table; PLAN.md section 11, line "Made 2026-10-03". Consumer: diligence-reader, first UI milestone.

The outcome: each rule the plugin carries is measured against what it did inside two windows (Axial's DEC-75 milestone, 2026-09-28 to 2026-10-01, and decision-model-poc, 2026-10-02 to 2026-10-03). Every rule that never stopped real harm is deleted. The trimmed plugin runs on diligence-reader's first UI milestone. Main is tagged v1.0.0 with that row's score beside RLM's reference numbers.

## What the survey found

- All enforcing rules run through plugin/hooks/gate.mjs. block-merge has seven rules; redirect-guard has three; path-guard has one; sandbox-guard has eight rules and two warnings. All seven filed false refusals were in sandbox-guard.
- The harness friction figures in PLAN.md 5a (11 guard and 19 process for Axial, 0 guard and 13 process for decision-model-poc) were counted by hand. No script lists a refusal. scripts/score reads only top-level transcripts, and most Axial refusals sit in subagent transcripts.
- Neither consumer wrote a commitment. The commitment ledger touches plugin/hooks/commitments.mjs, plugin/hooks/sensorium/40-commitment.mjs, plugin/hooks/sensorium.mjs, plugin/hooks/session-status.mjs, plugin/hooks/status-render.mjs, plugin/scripts/commitment.mjs, plugin/skills/new-project/SKILL.md, plugin/skills/new-project/assets/scaffold-plan.json, plugin/skills/status/SKILL.md, scripts/score/interventions.mjs, scripts/score/sources.mjs, scripts/test-area.mjs and their tests.
- Advisory prose: six skills (build 100 lines, new-project 126, pr 62, safe-cleanup 66, sprint-plan 108, status 68) and six references (ci 90, dispatch 100, run-monitor 89, second-reader 100, slicing 46, test-strategy 118).
- decision-model-poc is closed (M0 to M7 done). diligence-reader has its UI ahead.
- Plugin version lives in plugin/.claude-plugin/plugin.json, now 0.4.4; each plugin-changing pull request bumps it. Last tag v0.2.0.

## The shape decisions this phase fixes

- **A rule's record is counted from transcripts inside the window.** Nothing is hand-counted in the score.
- **A refusal stopped real harm when it blocked a call that would have changed something git cannot restore, merged a branch, deleted a branch, or written into a role's own config.** Anything else is a false refusal.
- **Verdict per rule: kept when it stopped real harm at least once; deleted otherwise.** Exception, pending the founder: block-merge's rules and sandbox-guard's write rule (a write git cannot restore) are marked "kept by founder decision" because RULES.md and a 2026-09-08 decision keep the merge and the data gated in code. Two runs are too few to show an irreversible harm will not come.
- **A skill or reference is kept when either consumer loaded it at least once.** sprint-plan is operator-typed and counted the same way.
- **The commitment ledger is removed without waiting for the audit.** Both consumers show it held nothing.
- **One release for the rerun.** Slice 04 lands last of the removals and bumps plugin.json to 0.5.0, the version diligence-reader installs; 03 and 05 leave the version alone so no two removals collide on it. The gate sets 1.0.0.

## Slices

Filed as #256 to #261 under milestone Phase 6.

| NN | Slice | Plan | Issue | Depends on |
|---|---|---|---|---|
| 01 | The scorer prints what each rule did in a consumer's window | [01-counter.md](01-counter.md) | #256 | none |
| 02 | Every rule has a verdict from the two live runs | [02-audit.md](02-audit.md) | #258 | 01 |
| 03 | The guard rules the audit marks delete are gone | [03-guards.md](03-guards.md) | #259 | 02 |
| 04 | The skills and references no consumer loaded are gone | [04-prose.md](04-prose.md) | #260 | 02, 03, 05 |
| 05 | The commitment ledger is removed | [05-ledger.md](05-ledger.md) | #257 | none |
| 06 | Phase 6 gate: the trimmed plugin's score on diligence-reader and v1.0.0 | [06-gate.md](06-gate.md) | #261 | 03, 04, 05 |

Order of work: 01 and 05 together, then 02, then 03, then 04 (it carries the 0.5.0 release), then 06 once diligence-reader's milestone closes under 0.5.0.
