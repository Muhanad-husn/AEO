# Progress Tracker

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| 0 — Repository foundation | DONE | 2026-07-05 | Directory tree created; green baseline (`uv run pytest` → 1 passed); `uv.lock` generated; committed on `main`. `gh repo create` + branch-protection commands prepared, not run (no remote this run). |
| 1 — CLAUDE.md handbook | DONE | 2026-07-05 | Project-agnostic constitution written; a fresh reader can answer "who may merge?" (founder only) and "who may edit specs, and when?" (spec-author, in a deliberate pass after drift adjudication). |
| 2 — Role subagents | DONE | 2026-07-05 | Five tool-locked, model-pinned subagents written under `.claude/agents/`. Reviewer read-only (no Edit/Write). Path guards declared in frontmatter (deny.sh referenced; proven in Phase 3). |
| 3 — Hard gates (hooks) | NOT STARTED | — | Deferred: out of scope for this run. |
| 4 — Vendor TDD harness | NOT STARTED | — | Deferred. |
| 5 — Sprint & role wiring | NOT STARTED | — | Deferred. |
| 6 — Dry run & validation | NOT STARTED | — | Deferred. |

## Human checkpoints (self-approved this run — founder is the only human)

- **CHECKPOINT 0:** Would present the green baseline + prepared `gh repo create` and branch-protection commands. Approved by founder; proceeded. No remote created (per run constraints).
- **CHECKPOINT 1:** Would present the `CLAUDE.md` handbook wording. Approved by founder; proceeded.
- **CHECKPOINT 2:** Would present each role's tools/model/prompt and the `pr-review-toolkit` reuse decision (decision: wrote reviewer from scratch preserving two-stage ordering and the "does the test encode intent?" check; `pr-review-toolkit` not vendored this run). Approved by founder. **STOP here per run scope.**
