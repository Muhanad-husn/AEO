# Decisions

Settled decisions governing the migration, with rationale and expected impact —
required by fixed principle 3. Newest first. A decision here is binding until
explicitly revisited.

---

## 2026-07-31 — Seven migration decisions

All seven recommendations in the assessment were approved by the founder, with
one addition to D1.

### D1 — Port the hooks to Python, in a dedicated directory

**Problem.** All five gate scripts are Windows PowerShell, invoked through a
hardcoded `powershell -NoProfile -ExecutionPolicy Bypass -File` line. On macOS or
Linux the merge-blocking and test-gating silently do nothing — the plugin would
appear installed while enforcing nothing.

**Decision.** Port to Python. One implementation, not two to keep in sync, and
Python is already present wherever Claude Code runs. **Founder addition:** the
hook scripts get their own dedicated directory rather than being scattered —
`hooks/` at the plugin root, holding all gate scripts and nothing else.

**Impact.** Unblocks D4 and D7; without it, verification gates are meaningless
off Windows. The PowerShell originals stay untouched under `source/` as the
reference implementation.

### D2 — Vendor the upstream `red-green-refactor` repo

**Problem.** The skill instructed the builder agent to clone
`brainqub3/red-green-refactor` from GitHub at runtime. Neither this repo nor the
plugin was self-contained.

**Decision.** Vendored at `source/upstream-red-green-refactor/`, commit
`593e7ab` (2026-06-08). MIT licensed, © john-adeojo.

**Impact.** Larger than expected — see "What vendoring upstream revealed" below.
The runtime clone step can be removed.

### D3 — Write our own packaging script

**Problem.** `skill-creator`'s `package_skill.py` emits a bare `.skill` zip and
has no `.claude-plugin/plugin.json` awareness. There was no tooling path to a
distributable plugin.

**Decision.** Write a small packaging script in this repo rather than extending
`skill-creator`.

**Impact.** Forking someone else's tool to add a concept it does not have costs
more than writing ours. It is a manifest plus a zip.

### D4 — The verifier is risk-triggered, not per-slice

**Problem.** An independent verifier on every slice roughly doubles agent cost
and applies full ceremony to typo fixes — the process defect principle 1 rejects.

**Decision.** One risk rubric, shared by enhancement 12 and enhancement 13:

| Change touches | Verification |
| --- | --- |
| A contract or spec | Full verification |
| Behaviour covered by an acceptance test | Verification |
| Docs, comments, formatting | Tests only |

**Impact.** One rubric with two consumers, so the verifier and the merge gate
cannot disagree. Must be built before enhancements 12 and 6 have a trigger.

### D5 — GitHub issues are the single source of truth

**Problem.** Issues are already the system of record, but a hand-maintained
`TRACKER.md` also exists. Two records that will disagree, and the hand-maintained
one rots first.

**Decision.** Issues remain the record. The tracker becomes a generated view, not
a parallel document.

**Impact.** Mostly already built — the SessionStart hook injects branch, issue,
and PR state today.

### D6 — Spec questions are batched, not blocking

**Problem.** Principle 3 requires founder approval for spec changes while
enhancement 6 makes concurrency default. Parallel agents each hitting a spec
question all stall on the founder.

**Decision.** Agents park the question, continue with everything not blocked by
it, and surface all spec questions together in one briefing.

**Impact.** The founder answers a batch once instead of being interrupted per
agent. Preserves principle 3's approval requirement without serializing the fleet.

### D7 — Principle 5's hierarchy is a default, not a requirement

**Problem.** Subprojects → contracts → phases → stages suits a product like
Axial. Imposed on every project by a general-purpose plugin it is heavy; a small
CLI does not need it.

**Decision.** Default for multi-component products; skipped for single-component
work. The plugin suggests the structure rather than enforcing it.

**Impact.** Keeps principle 5 intact where it earns its keep without violating
principle 1 everywhere else.

---

## What vendoring upstream revealed

D2 was expected to be routine. It changed the shape of the migration.

**The upstream repo is the origin of five of Axial's ten skills** —
`red-green-refactor`, `safe-pr`, `safe-cleanup`, `tdd-ci`, `tdd-plan` — plus a
sixth, `tdd-harness`, that Axial dropped.

**All executable code is byte-identical between Axial and upstream:**

| File | Status |
| --- | --- |
| `safe-pr/scripts/collect-evidence.mjs` | Identical |
| `safe-cleanup/scripts/classify-branches.mjs` | Identical |
| `red-green-refactor/references/test-strategy.md` | Identical |
| `tdd-plan/references/slicing-guide.md` | Identical |
| `red-green-refactor/SKILL.md` | Diverged |
| `safe-pr/SKILL.md` | Diverged |

**Consequence.** Axial's local adaptation lives entirely in SKILL.md prose. The
scripts need no de-Axialing at all. For these five skills, upstream is already
the generalized form and is the better migration base — the work is reconciling
prose, not rewriting tooling. This materially shrinks the "de-Axialize what
exists" step in the assessment's sequencing.

**Licensing.** MIT, © john-adeojo. Redistribution in the plugin is permitted and
requires preserving the copyright notice and license text. This is now a
distribution obligation, not an optional courtesy.

**Layout note.** Upstream ships `.agents/skills/` and `.claude/skills/` as a
verified byte-for-byte mirror — one source, two runtime locations. Worth
considering for the plugin if non-Claude runtimes are ever a target.
