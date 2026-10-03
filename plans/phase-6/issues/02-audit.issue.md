# docs(phase-6): every rule has a verdict from the two live runs [slice 02]

**Spec:** PLAN.md#5-phases, row "6 Removal"; PLAN.md#5a-status, row 6; PLAN.md section 11, line "Made 2026-10-03" · **Plan:** plans/phase-6/02-audit.md · **Issue:** #258
**Depends on:** #256 · **Labels:** phase-6

## Deliverable

plans/phase-6/audit.md holds one row per rule and per skill and reference: its count in Axial DEC-75 and in decision-model-poc, each refusal classified stopped-harm or false with the command quoted short, and a verdict keep, delete, or kept-by-founder-decision.

## Mechanism

The 01 script for counts. Reading the transcript lines around each refusal for classification. Prose, no mechanical test.

## Acceptance criterion

Given 01 merged, when score.mjs runs on D:/axial and D:/decision-model-poc over their windows, then audit.md quotes both `rules:` blocks verbatim, every listed refusal has a classification and a one-line reason, every rule id from the plugin's hooks and every skill and reference appears with a verdict, and the founder approves the verdict column in the pull request before 03 or 04 starts.

## Files

```aeo-independence
slice: 02-audit
depends-on: 01-counter
creates: plans/phase-6/audit.md
```

## Out of scope

Deleting anything. Re-scoring interventions.
