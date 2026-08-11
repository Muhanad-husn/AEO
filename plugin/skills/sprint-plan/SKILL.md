---
name: sprint-plan
description: Decompose a phase of the product spec into a sprint backlog of GitHub issues, each linked to its own slice plan file, with every issue body drafted to disk for founder review before anything is filed. Use at the start of a sprint, or when asked to plan the sprint, build the backlog, or turn a spec section into issues.
disable-model-invocation: true
---

# Sprint Plan

Turns a scoped phase of spec work into a reviewed, filed backlog: one
GitHub issue per thin vertical slice, each carrying its acceptance
criterion, its mechanism, and a link to its plan file. Nothing is filed
until the founder has approved the drafts. Issue bodies are written to
disk first, then created through the GitHub issue tools.

## Procedure

1. **Scope the work.** Read the spec section the founder names. Dispatch
   `triage` to size it against the current code when that helps. Restate
   the outcome in two sentences and confirm with the founder if it's at
   all ambiguous.

2. **Slice.** Run `tdd-plan` for each feature: thin vertical slices,
   INVEST-checked, a walking-skeleton slice first where infrastructure
   doesn't exist yet. Each slice plan states its mechanism, in this
   order: an existing skill or plugin, then a first-party MCP, then a
   library, then a single model call. Only reach past one option when the
   one before it doesn't fit.

3. **Draft the issues locally. File nothing yet.** One draft per slice,
   written to `<plans>/<feature-slug>/issues/<NN>-<slice-slug>.issue.md`:

   ```markdown
   # <type>(<feature-slug>): <slice goal> [slice NN]

   **Spec:** <specs>/<file>#<section> · **Plan:** <plans>/<feature-slug>/<NN>-<slice-slug>.md
   **Depends on:** #<issue> (or "none")
   **Labels:** sub:<subproject-slug>[, ...]

   ## Deliverable
   <one paragraph: the observable behaviour this issue ships>

   ## Mechanism
   <what it's built with, from the plan's survey, not a design from scratch>

   ## Acceptance criterion
   <the Given/When/Then from the slice plan; this becomes the locked outer test>

   ## Out of scope
   <deferred items from the plan>
   ```

   `<plans>` and `<specs>` default to `plans/` and `specs/`. Use whatever
   the project already keeps its plans and specs under if that's already
   established.

4. **The founder reviews the drafts.** Present the backlog as a table
   (title, dependency, size) plus the draft files. File nothing until
   it's approved.

5. **File on approval**, through the GitHub issue tools, with the
   `sub:<subproject-slug>` label plus any status labels. Back-fill each
   slice plan and the plans index with the real issue numbers, cross-linked
   in both directions.

6. **Report** `DONE` with the filed issue list. `sprint-start` begins the
   first one.

## Labels

`spec-drift`, `blocked`, `needs-context`, `done-with-concerns`, plus one
`sub:<subproject-slug>` per subproject where the project uses that
structure. A starting default, not a fixed set. Check the project's
existing labels before creating any.

## Rules

- Nothing is filed before founder approval of the drafts.
- Every issue links its plan and spec section; every plan links its
  issue.
- Dependencies are explicit. `sprint-start` picks by them.
- One slice per issue. An issue that needs "and" is two issues.
- GitHub issues are the record. Nothing here duplicates them by hand.
