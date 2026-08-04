# Vendored skills — provenance

Five skills will derive by copy from:

- **Source:** https://github.com/brainqub3/red-green-refactor
- **Commit:** `593e7abae2dc74f9a21eba3323e78a8fa9520dba` (2026-06-08)
- **Licence:** MIT (© john-adeojo) — see [`UPSTREAM-LICENSE`](UPSTREAM-LICENSE).
- **Vendored:** 2026-07-31 into `source/upstream-red-green-refactor/`.

`red-green-refactor`, `safe-pr`, `safe-cleanup`, `tdd-plan`, and `tdd-ci` are staged for port in Phase 2. Upstream is the migration base; no adaptation has been made yet.

## Scope

Upstream also ships `tdd-harness`, which this plugin does not carry.

Files verified byte-identical between upstream and the production copy —
these will port unchanged:

| File | Type |
| --- | --- |
| `safe-pr/scripts/collect-evidence.mjs` | Code |
| `safe-cleanup/scripts/classify-branches.mjs` | Code |
| `red-green-refactor/references/test-strategy.md` | Reference |
| `tdd-plan/references/slicing-guide.md` | Reference |

Local adaptation is confined to SKILL.md prose. The port (landing in Phase 2) takes upstream as its base and reconciles prose only; the executable code requires no change.

## How to re-sync with upstream

Diff against the pinned commit `593e7ab` and re-apply any local prose adaptations to the SKILL.md files.
