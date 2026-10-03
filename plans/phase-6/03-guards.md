# 03: The guard rules the audit marks delete are gone

Issue: [#259](https://github.com/Muhanad-husn/AEO/issues/259)

## Goal

Every enforcing rule audit.md marks delete is removed from plugin/hooks with its tests and its comment block. Every kept rule still refuses what its tests say.

## Acceptance criterion

Given audit.md approved, when the rules marked delete are removed, then no test names them, `npm test` is green, the integration tier is green in CI on the pull request (cited by URL), node processes per Bash call stay at or under 2 armed, and the pull request prints lines of hook source and test before and after.

## Mechanism

Deletion. The existing suite is the oracle for the kept rules. If a whole guard module loses all its rules, gate.mjs stops calling it and the module goes.

## Files

```aeo-independence
slice: 03-guards
depends-on: 02-audit
edits: plugin/hooks/gate.mjs
edits: plugin/hooks/sandbox-guard.mjs
edits: plugin/hooks/redirect-guard.mjs
edits: plugin/hooks/path-guard.mjs
edits: plugin/hooks/lib.mjs
edits: tests/hooks/sandbox-guard.test.mjs
edits: tests/hooks/redirect-guard.test.mjs
edits: tests/hooks/path-guard.test.mjs
edits: tests/hooks/gate.test.mjs
```

## Out of scope

Rules marked keep or kept-by-founder-decision. Rewording kept rules. Skills.
