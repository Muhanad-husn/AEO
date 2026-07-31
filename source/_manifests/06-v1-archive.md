# 06 — v1-archive (the pre-v2 harness, recovered)

## Copy summary

- Source: `D:\$RECYCLE.BIN\S-1-5-21-…-1001\$R9RCG8P\workflow-archive\` — a complete
  v1 harness **recovered from the recycle bin**. The original was left untouched.
- Destination: `D:\AEO\source\v1-archive\`
- **Files copied: 174** (~964 KB)
- Skipped deliberately: `scheduled_tasks.lock` (a runtime lock, not content), and
  the binary evidence blobs under `docs/tdd-evidence/` — `.png`, `.webm`, and
  Playwright HTML reports. All `.txt` and `.json` evidence was kept.
- Contents copied verbatim. No redactions were required (see below).

## Why this source exists

This is a v1 instance of the harness **from a different product** — a web
application with a map frontend, a Playwright e2e layer, and a Node/Python split.
It is the only non-Python instance of this harness that exists anywhere, which
makes it the primary evidence for the generalization work.

It holds five things present in no other vendored source:

1. **`claude/hooks/lib.ps1`** — a shared hook library. The v2 harness has four
   standalone gate scripts that each re-implement stdin parsing, worktree
   resolution and blocking. v1 had factored this out; v2 lost it, and the drift
   between the four copies is directly traceable to that loss.
2. **`claude/hooks/tests/`** — `hook-cwd.test.ps1` and `path-guard.test.ps1`.
   **The gates used to have their own tests.** v2 has none and verifies them by
   hand at a checkpoint.
3. **`claude/skills/VENDORED.md` + `claude/skills/UPSTREAM-LICENSE`** — vendoring
   provenance as committed artifacts. v2 keeps only a SHA in a decision-log line
   and ships no upstream licence at all.
4. **`claude/commands/`** — the lanes as slash commands (`build-resume`, `fix`,
   `review`, `sprint-plan`, `sprint-start`, `triage`) rather than skills.
5. **A non-Python worked example** — `plans/` covering 15 subprojects with
   READMEs and a `backlog-v0`/`backlog-v1` progression, and `docs/tdd-evidence/`
   holding real vitest, Playwright, typecheck and pytest transcripts side by side.

Also present: the v1 `CLAUDE.md` (7.5 KB — roughly 2.5× the length of its v2
replacement, which is what the "handbook shrank to ~45%" claim looks like in
practice) and `docs/agentic-build.md`, the v1 build log.

## v1 hooks not present in v2

`deny.ps1`, `git-guard.ps1`, `tests-green.ps1`, `spec-freeze.ps1`. The last is
correctly dead — specs became living documentation in v2. The first three were
folded into v2's `block-merge` and `commit-gate`, and are worth reading before any
refactor of those.

## Redactions

None required. The tree was scanned for `api[_-]?key`, `token`, `secret`,
`password`, `sk-ant` and `bearer`. Matches were confined to evidence transcripts
referencing test fixtures and OAuth *flow* names — no credential values. The
recovered `settings.local.json` contains only a permission allowlist.
