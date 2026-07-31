# Slice P0.2 — Provenance

## Completed

Addressed V-14 (MIT attribution is incomplete) by establishing a complete provenance record for the five vendored skills derived from upstream brainqub3/red-green-refactor.

## Deliverables

1. plugin/UPSTREAM-LICENSE — Byte-for-byte copy of the upstream MIT license.
2. plugin/VENDORED.md — Provenance record identifying source, commit, scope, and divergence.
3. logs/2026-07-31-p0.2-provenance/summary.md — This log entry.

## Verification

- Licence file copy verified by SHA256 hash comparison.
- Four files verified byte-identical between upstream and axial source:
  - safe-pr/scripts/collect-evidence.mjs ✓
  - safe-cleanup/scripts/classify-branches.mjs ✓
  - red-green-refactor/references/test-strategy.md ✓
  - tdd-plan/references/slicing-guide.md ✓
- Plugin directory created; nothing else touched in parallel-owned slice areas.
