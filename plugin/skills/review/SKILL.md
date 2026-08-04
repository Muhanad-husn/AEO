---
name: review
description: Dispatch the read-only reviewer role for a two-stage check on the current branch's diff against the default branch — spec compliance first, since a green test can still betray its spec, then code quality and over-engineering. Use on demand, or for a change that touches shared modules or carries outsized blast radius.
disable-model-invocation: true
---

# Review — entry point

A thin dispatcher, not the review logic itself: hands the current diff,
the issue, and the spec section to the reviewer role and relays its
two-stage report — spec compliance, then quality — back to the founder and
the issue thread. The reviewer only ever reads; fixes route back to the
builder. A passing review earns `safe-pr`, never a merge.

**Ports from** `source/axial/dot-claude/skills/review/SKILL.md`.

**Changes on port:** the named shared modules (`llm.py`, `cli.py`, config
loading) generalize to "the paths a project's own stack detection flags as
high blast radius" — no hardcoded filenames. Reviewer isolation, a
dispatch convention here, becomes hook-enforced once P1.6 lands (L-01);
this skill's prose will say so then. Full port lands in Phase 2.
