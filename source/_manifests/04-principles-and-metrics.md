# Manifest 04 — Founder/developer principles and process-metric mechanisms

Scope: `D:\AEO\source\axial\docs\`, `D:\AEO\source\axial\root\`, `D:\AEO\source\global-claude\`.
Sources are read-only: `D:\axial`, `C:\Users\mou97\.claude`. `D:\AEO\source\axial\.claude\` was not touched (pre-existing, 36 files / 208,422 bytes, owned by another agent; since renamed to `dot-claude\`).

## Copy summary per destination

| Destination | Files | Bytes |
|---|---|---|
| `D:\AEO\source\axial\root\` (incl. `.github\workflows\ci.yml`) | 9 | 41,220 |
| `D:\AEO\source\axial\docs\` (excluding `_found\`) | 9 | 153,728 |
| `D:\AEO\source\axial\docs\_found\` | 12 | 196,048 |
| `D:\AEO\source\global-claude\` (incl. empty `commands\`) | 3 | 1,337 |
| **Total copied by this task** | **33** | **392,333 (~383 KB)** |

Well under the 50 MB limit; no binaries copied.

### File listing

`axial\root\`: CLAUDE.md, CLAUDE.local.md, README.md, .gitignore, .gitattributes, pyproject.toml, PR_BODY.generated.md, .tdd-branch-cleanup.log, .github\workflows\ci.yml.

`axial\docs\`: DECISIONS.md, phase-a-rerun-2026-07-24.md, postmortem\gold-run-2026-07\{README.md, canary-run-runbook.md, canary-set.md, content-filter-exposure.md, model-tier-decision.md, parse_run.py, waste_breakdown.py}.

`axial\docs\_found\` (relative paths preserved under axial): `src\axial\run.py`, `src\axial\runlog.py`, `src\axial\answer\run_report.py`, `plans\run\{README.md, 01-runner-core-and-failure-isolation.md, 02-unified-resume-ledger.md, 03-source-sets-and-run-summary.md}`, `plans\run-logging\{README.md, 01-run-logging-seam.md, 02-wire-remaining-passes.md}`, `plans\phase-a-completion\{TRACKER.md, STAGE-4-RUNBOOK.md}`.

`global-claude\`: CLAUDE.md, settings.json, settings.local.json, empty `commands\` directory (source had none).

## Founder and developer principles

Three sources, read closely. No genuine contradiction found between them — see "Alignment / duplication" below.

### 1. `D:\axial\CLAUDE.md` (repo root, committed — the short public-facing version)

- **Developer principles**, lines 23–36:
  > "**Practicality over perfectionism.** 80/20 rule: build the smallest thing that meets the acceptance bar, and keep the bar strict, not the mechanism. Polishing past the bar is a process bug, not diligence."
  > "**Over-engineering tripwires** — stop and simplify, or justify in one line in the PR body: a hand-tuned constant or magic number in a heuristic; an abstraction with one implementation; a config option nobody sets; a fix larger than its bug."
  > "**Don't reinvent the wheel.**... Check existing tools and libraries — or a single LLM call — before building."
  > "**Measure, don't speculate.** When in doubt, prototype and measure rather than analyze indefinitely."
- **Writing conventions / "Answering the founder"**, lines 38–62: plain direct prose, ≤2 em dashes per 500 words, and a communication protocol for replies to the founder — lead with the answer, default to a few sentences, no jargon, structure only when it does work, no hedging, but never drop a caveat or number that changes the decision.
- **Working-in-repo norms**, lines 11–21: domain content is data not code (`config/domains/<domain>/`, never gates in `src/`); a structural tree is extracted once and reused; GitHub issues/PRs are system of record.

### 2. `D:\axial\CLAUDE.local.md` ("Axial Engineering Handbook v2", gitignored, the operating manual)

- **What this is / two rules**, lines 1–20: one-operator AI software enterprise — founder decides, orchestrator + builder subagent do the work, deterministic gates hold the line. v2 explicitly tore out v1's role ceremony (test-author/implementer/fixer split, spec-freeze, red-commit flags).
  > "1. **Nothing merges without the founder's word.**... Subagents are hook-blocked from merging entirely."
  > "2. **Specs are living documentation, not law.** Whoever changes behavior updates the spec *in the same PR*... Nobody stops the world over a wording mismatch."
- **Build philosophy**, lines 55–75: restates the same four CLAUDE.md principles (practicality, tripwires, don't-reinvent, measure-don't-speculate) with worked examples, e.g. issue #268: "3 review rounds hand-tuning 6 constants that read 4/30 real cases; one model call replaced them." Adds: "Surplus quality nobody asked for is not free: it costs review now and maintenance forever."
- **Lanes/roles**, lines 22–36: `/sprint-start` (issue → PR) vs `/fix` (bug-sized, fast lane); roles builder/reviewer/triage, builder never touches `.claude/` and never merges.
- **Worktrees**, lines 38–53: one issue = one worktree = one branch = one PR, cut from `.claude/worktrees/<branch-slug>`; `data/` is gitignored so operational work (corpus passes, regens, evals) must run in the main checkout, not a worktree.
- **Gates**, lines 77–93: commit gate (pytest + ruff hook, blocks red commits/direct main commits, with a docs-only exception), merge gate (hook-blocked subagents + branch protection, founder-only merge), CI (full `tests/` tree per push), real-corpus validation as a norm not a hook (citing #222/#268 as cases where a green suite wasn't enough evidence).
- **Test scope**, lines 95–113: acceptance suites live per-phase under `tests/`; the full phase suite is CI-only, never run locally; a task runs only its own new/changed test files locally, on top of the ~6s commit-gate tier.
- **The harness itself**, lines 115–121: `.claude/` and CLAUDE.local.md are gitignored and edited live, no PR ceremony, but still gated on founder approval; role subagents are path-guard-fenced out of `.claude/`; `uv run python .claude/tools/snapshot-harness.py` mirrors harness changes to a private `axial-harness` rollback repo (not copied — lives under `.claude/tools/`, out of this task's scope).
- **Run logging**, lines 123–129 — the process-metric mandate in prose form (mechanism itself documented below):
  > "Every run that matters (corpus-wide passes, regens, rollouts, evals) writes `data/logs/<YYYY-MM-DD>-<run-name>/` with `run.jsonl` (one record per unit of work), `console.log` (raw output), and `summary.md` (command, counts, outliers, next steps). Decisions still go in the GitHub issue."
- **Conventions**, lines 131–139: model tiering (Haiku/Sonnet/Opus by task), fixed status vocabulary per dispatched task (`DONE`, `DONE_WITH_CONCERNS`, `BLOCKED`, `NEEDS_CONTEXT`), writing style repeated once more.

### 3. `C:\Users\mou97\.claude\CLAUDE.md` (global, all projects)

- **Core Principle**, lines 1–5, in full:
  > "Common sense and semantic logic always take priority over rigid contract adherence. If a rule, schema, specification, or convention produces an outcome that is obviously wrong — semantically, logically, or practically — flag it and fix it. We can always modify the contract; we cannot accept nonsensical results. Never sacrifice a clearly correct answer to satisfy a technicality. The system exists to serve its purpose, not the other way around."

### Alignment / duplication (no contradiction found)

- The four "developer principles" in axial `CLAUDE.md` (23–36) and axial `CLAUDE.local.md`'s "Build philosophy" (55–75) are the **same principles stated twice**: the short form lives in the committed, public file; the long form with worked examples lives in the gitignored handbook. Intentional duplication per the handbook's own design (short file for quick reference, handbook for the "why"), not drift — wording is consistent, no version disagrees with another.
- The global CLAUDE.md's "common sense over rigid contract" principle is consistent with, and arguably the general case of, axial CLAUDE.local.md's "specs are living documentation, not law" (line 17) — both put judgment above literal-contract compliance. No tension: axial's strict gates (commit/merge) are process-integrity checks, not semantic contracts the global principle would tell you to override.
- The "Answering the founder" reply protocol (axial CLAUDE.md, 44–62) has no counterpart or conflict in the global file, which is silent on reply style.

## Process metrics mechanisms

Every mechanism found that captures how work is done, in descending order of how central it is:

1. **Run-logging seam — `src/axial/runlog.py`** (copied to `docs/_found/src/axial/runlog.py`). `run_context(name, *, root, clock)` is a context manager (stdlib `logging` + `FileHandler`, deliberately not a logging framework) that opens `data/logs/<name>-<ts>/` per run and produces:
   - `run.jsonl` — one JSON record per unit of work via `RunHandle.record(...)`: `source_id`, `pass`, `model` (nullable), `status`, `duration_sec`, `error`. Fixed keyword-only scalar fields only, by design (DEC-23), so no record can carry a chunk or source passage.
   - `console.log` — everything the run's logger emits, teed to file.
   - `summary.md` — header stub only; the narrative (command, counts, outliers, next action) is operator-authored at run end, not generated.
   Design docs: `plans/run-logging/README.md` and `01-run-logging-seam.md`, `02-wire-remaining-passes.md` (copied to `docs/_found/plans/run-logging/`). Issue #270, founder-set mandate.

2. **Corpus-wide pass runner — `src/axial/run.py`** (copied to `docs/_found/src/axial/run.py`). `axial run <pass> --worklist <file>` / `--corpus`: drives any registered per-source pass over a source set, one source at a time, with per-source failure isolation (only that pass's own declared error type is caught, never a bare `except`) and a single unified resume ledger, `data/run/ledger.tsv` (TSV, keyed `(pass, source_id)`, append-only). Each pass descriptor carries a `done_predicate` so already-completed sources are skipped with zero pipeline work. Ends every run with a structured `RunSummary` (OK/FAIL/SKIP tally). Explicitly the retirement of a prior "bare-`except Exception` loop wrapper" that a postmortem named as a root cause of run fragility. Design docs: `plans/run/README.md`, `01-runner-core-and-failure-isolation.md`, `02-unified-resume-ledger.md`, `03-source-sets-and-run-summary.md` (copied to `docs/_found/plans/run/`). Issue #277.

3. **Per-brief run report — `src/axial/answer/run_report.py`** (copied to `docs/_found/src/axial/answer/run_report.py`). One report per Phase-B brief run at `data/runs/<brief_id>.json`, keyed on `brief_id` + `corpus_pin`. Every figure is derived from the persisted record except per-pass wall clock, captured live by a `PassClock` as `run_brief` drives each stage — the run TOTAL is the sum of per-pass figures, never a second independent stopwatch. Nothing in the pipeline gates on this report; it is pure measurement (specs/PHASE-B.md §7.15, §8 P0-14, issue #491).

4. **`docs/tdd-evidence/`** — the TDD harness's evidence trail (described, not copied — see next section).

5. **`docs/postmortem/gold-run-2026-07/`** — a measured operational retrospective, with its own small analysis tooling: `parse_run.py` (parses `=== <source> START/END ===` blocks and `finish_reason` events out of the 8 raw worker logs into tables) and `waste_breakdown.py` (both copied). Feeds the tables in `content-filter-exposure.md` and the top-level `README.md`'s 40-hour wall-clock accounting.

6. **`docs/phase-a-rerun-2026-07-24.md`** (copied) — a second, later run narrative in the same spirit: cites `run.jsonl` directly ("Every FAIL/ERROR in `run.jsonl` across the whole run was one of a small number of real, since-fixed issues"), reports LLM-call counts, latency, quarantine rates, and lists every code fix shipped mid-run with its PR number.

7. **`plans/phase-a-completion/TRACKER.md`** (copied) — a live, hand-maintained "what's done, what's next" tracker read first by any fresh session picking up Phase-A completion work; a lightweight sprint-tracking mechanism distinct from GitHub issues (which remain system of record).

8. **Ingestion TSV ledger** (referenced, not a separate file to copy — implementation detail inside `axial.ingest`, predates and is generalized by mechanism #2 above): a per-source TSV row (`source_id, status, notes_count, duration, exit_code, timestamp`) appended to `data/gold/ingest.results.tsv`, called out in `plans/run-logging/README.md` as "a proto-`run.jsonl` bolted onto one command."

9. **Gates as metrics enforcement** (documented in CLAUDE.local.md, not a separate artifact): the commit gate (`uv run pytest src -q -m "not slow" -n auto` + ruff, ~6s) and CI's full `tests/` run (~8 min) are the two automated checkpoints; "real-corpus validation" is a named norm (not a hook) requiring a corpus-facing heuristic to be validated against `data/sources/` before promotion, because a green suite alone was twice proven insufficient (#222, #268).

10. **`.claude/tools/snapshot-harness.py`** (NOT copied — lives under `D:\axial\.claude\`, out of scope, owned by another agent) — mirrors any harness change to a private `axial-harness` repo, described in CLAUDE.local.md 115–121 as the only rollback point for `.claude/`. Flagging its existence since it is a process mechanism, even though the file itself is off-limits.

## `docs\tdd-evidence\` — structure (described, not copied)

- **61 top-level feature/slice directories**, **191 files total**, e.g. `analysis-record`, `chunk`, `chunk-redesign`, `envelope`, `envelope-bibliography`, `run`, `tag`, `xref`, `vault-write-per-note-fault-isolation`, `run-unicode-encode-error`, `postmortem`, etc. — one directory roughly per feature or `/fix`-lane bug, matching the plan-slice/issue naming used across `plans/`.
- Each feature directory holds one or more numbered sub-slice directories (e.g. `chunk/01-size-guard/`), each containing typically two files:
  - `cli-demo.txt` — a saved `pytest` transcript for just the new/changed acceptance test(s) for that slice (e.g. 2 tests: `test_oversized_section_is_skipped_never_sent_to_llm_as_target`, `test_source_of_only_oversized_section_completes_with_zero_chunks`, both `PASSED`).
  - `test-run.txt` — a saved full-suite (or full-scope) `pytest` run proving no regression, e.g. `677 passed in 264.63s (0:04:24)`.
- **Who/what generates it:** the builder subagent, as part of the TDD lane (`/sprint-start` or `/fix`): acceptance test first, then code to green (CLAUDE.md lines 26–27), with the pytest output saved as durable evidence attached to the PR/issue rather than trusted to CI logs alone. This is the file-level implementation of the "acceptance bar" principle — proof the bar was actually met, not just claimed.
- Not copied per task instructions: hundreds of near-identical evidence artifacts, no unique process information beyond the pattern described above.

## Deliberately not copied

- `docs/eval/` (README + 01–04) — evaluates the **product's** output (answer quality, tagging-distillation cost, agentic-trajectory of the query agent), explicitly *not* the engineering-org workflow (eval 3's own scope note excludes "the role-subagent TDD harness"). Domain/research eval, not process eval.
- `docs/academic/`, `docs/sim-academic/` — academic-outreach and simulated-labeler content for building the product's gold corpus; pure domain content.
- `docs/exploration/` (`extract-text-normalization.md`, `hybrid-tagging-classifier.md`) — pipeline/product research findings (OCR text garble, a tagging-cost idea), not engineering process.
- `docs/tag-reliability-best-of-n.md` and `-external.md` — a method note on the product's LLM-tagging reliability fix; research/methodology content, not engineering process.
- `docs/tdd-evidence/` bulk contents (191 files) — described above instead; copying would add ~no new information per file beyond the one sample already described.
- `specs/CHARTER.md`, `specs/PRODUCT.md`, `specs/PHASE-B.md`, `specs/PHASE-C.md` — the product's own behavioural constitution and phase specs ("the model is an analyst, not a witness," grounding/auditability principles). These are principles, but about the **product's output**, not about how the founder/developers run the engineering process — out of this task's stated scope (which is about founder/developer/process principles).
- `plans/charter/CONSTITUTION.draft.md` — draft staging area for the above; same reason.
- `plans/rung3-gates/` — "gates" here means product **eval** gates (attribution/grounding/calibration on synthesized answers), not the engineering commit/merge gates already captured from CLAUDE.local.md.
- `config/pipeline.yaml`, `config/domains/`, `config/briefs/`, `config/canary-manifest.toml`, `config/probe-138-content-filter.toml` — product/pipeline configuration, not process/metrics mechanisms.
- `evals/` (`cases/`, `corpus_pin/`) — corpus-pin manifests and eval case sets; product measurement inputs, not engineering-process artifacts.
- `experiments/mechanical_merge/` — a standalone research experiment (name-merging heuristic benchmark); unrelated to process metrics.
- `scratchpad/*.py` (`measure_504.py`, `validate_49x.py`, …) — one-off ad hoc validation scripts tied to specific closed issues; not a durable mechanism.
- `tests/test_run*.py`, `src/axial/test_run.py`, `src/axial/test_runlog.py`, `src/axial/panel/run.py` — the test suites proving mechanisms #1–#2 above; noted as evidence the mechanisms are real and CI-gated, not copied since the mechanism code itself (`run.py`, `runlog.py`) was already copied.
- `plans/phase-a-completion/README.md`, `STAGE-4-EXECUTION.md` — the fuller planning/runbook narrative around the same phase as `TRACKER.md`/`STAGE-4-RUNBOOK.md` (which were copied); the two copied files carry the process-metric content (live tracker, measured costs/traps), the rest is planning detail.
- `uv.lock` (636 KB) — dependency lockfile; not principles/process content and would blow past the spirit of "select, not bulk."
- `.venv/`, `data/`, `.pytest_cache/`, `.ruff_cache/`, `.git/`, `secrets/`, `.claude/worktrees/` — excluded per task instructions (binary/cache/generated/secret/another-agent's-turf).

## Redactions

None. `settings.json` and `settings.local.json` under `C:\Users\mou97\.claude\` contained no secrets, tokens, or API keys — copied verbatim. `.credentials.json` was not touched (never opened, never copied), per hard instruction.
