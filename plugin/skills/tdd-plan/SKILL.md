---
name: tdd-plan
description: Split a new feature, product, or fix into thin, independently valuable vertical slices before any code is written, and write one execution plan per slice to disk. Trigger at the start of new work, or on a request to slice something up, find the smallest first step, or plan test-first. The output plan is the contract red-green-refactor executes next.
---

# TDD Plan — slice and plan

Slicing is the hard, valuable judgment call this skill exists to slow down
for: understand the request, detect whether a walking skeleton is needed
first, cut vertical — never horizontal — slices, validate each against
INVEST, then write a plan file per slice with a concrete Given/When/Then
acceptance criterion and a seeded unit-test list. No code is written in
this phase.

**Ports from**
`source/upstream-red-green-refactor/.agents/skills/tdd-plan/SKILL.md`,
upstream at `593e7ab`. Its `references/slicing-guide.md` (splitting
patterns, a worked example) ports as a reference asset, unchanged.

**Changes on port:** none structural. Full port lands in Phase 2.
