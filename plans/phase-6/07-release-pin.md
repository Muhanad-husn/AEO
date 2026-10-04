# 07: A project installs a release tag, not main

Issue: [#268](https://github.com/Muhanad-husn/AEO/issues/268)

## Goal

The aeo marketplace entry serves the plugin from a release tag, so a merge to main changes nothing a consumer installs. main is tagged v0.6.0 at the commit where 08 sets plugin.json to 0.6.0, and the marketplace entry points at v0.6.0. Cutting a release is: bump plugin.json, merge, tag, then move the marketplace entry to the new tag in a pull request of its own.

## Acceptance criterion

Given v0.6.0 tagged at 08's merge commit, when the marketplace entry is changed to name that tag and a fresh install is made from the marketplace into a temporary project (`claude plugin marketplace add` and `claude plugin install aeo@aeo --scope project`), then the installed plugin.json reads 0.6.0 and its tree matches `git archive v0.6.0 plugin`; and a commit pushed to main after that, on a scratch branch merged or simulated, does not change what a fresh install resolves. The pull request prints both checks. If Claude Code's marketplace format cannot serve a subdirectory of a tagged ref, the pull request says so with the documentation quoted and recommends the nearest shape; the founder decides.

## Mechanism

The marketplace format's own ref field, read from Claude Code's plugin marketplace documentation. No script. Opus builds, because release mechanics are novel here.

## Files

```aeo-independence
slice: 07-release-pin
depends-on: 04-prose, 08-services
edits: .claude-plugin/marketplace.json
```

## Out of scope

The v1.0.0 tag, which the gate (06) cuts under this rule; RLM's Docker recipe; any CI change.
