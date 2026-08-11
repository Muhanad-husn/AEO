---
name: triage
description: Dispatch the read-only triage role to turn a raw idea into scoped GitHub issue proposals, size a request against the existing code, or groom the backlog — proposing only, never filing. Use when asked to scope an idea, size a request, or groom the backlog.
disable-model-invocation: true
---

# Triage — entry point

Dispatch the triage role with the founder's request and whatever context
bears on it: idea text, issue numbers, spec sections. It reads code and
the backlog through the GitHub issue tools and comes back with a
scoping, decomposition, or priority proposal.

Triage writes no code and files nothing. Every proposal carries its
options, a recommendation, and its cost; the founder decides. Issue
creation itself follows `sprint-plan`'s draft-then-approve flow, or, for
one quick issue, draft the body, show the founder, file on approval.

Being read-only, triage can run alongside other read-only work (a
review, a research pass) with no worktree and no coordination needed.
