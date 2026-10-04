# chore(phase-6): a project installs a release tag, not main [slice 07]

**Spec:** PLAN.md#11-decisions-the-founder-has-made, line "Made 2026-10-04" · **Plan:** plans/phase-6/07-release-pin.md · **Issue:** #268
**Depends on:** #260 · **Labels:** phase-6

## Deliverable

The aeo marketplace entry serves the plugin from a release tag, so a merge to main changes nothing a consumer installs. main is tagged v0.5.0 at the commit that set plugin.json to 0.5.0 (f293ee2), and the marketplace entry points at v0.5.0. Cutting a release is: bump plugin.json, merge, tag, then move the marketplace entry to the new tag in a pull request of its own.

## Mechanism

The marketplace format's own ref field, read from Claude Code's plugin marketplace documentation. No script. Opus builds, because release mechanics are novel here.

## Acceptance criterion

Given v0.5.0 tagged at f293ee2, when the marketplace entry is changed to name that tag and a fresh install is made from the marketplace into a temporary project (`claude plugin marketplace add` and `claude plugin install aeo@aeo --scope project`), then the installed plugin.json reads 0.5.0 and its tree matches `git archive v0.5.0 plugin`; and a commit pushed to main after that, on a scratch branch merged or simulated, does not change what a fresh install resolves. The pull request prints both checks. If Claude Code's marketplace format cannot serve a subdirectory of a tagged ref, the pull request says so with the documentation quoted and recommends the nearest shape; the founder decides.

## Files

```aeo-independence
slice: 07-release-pin
depends-on: 04-prose
edits: .claude-plugin/marketplace.json
```

## Out of scope

The v1.0.0 tag, which the gate (06) cuts under this rule; RLM's Docker recipe; any CI change.
