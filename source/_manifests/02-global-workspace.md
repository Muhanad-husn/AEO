# 02 — global-workspace copy manifest

Source: `C:\Users\mou97\.claude\skills\agentic-engineering-org-workspace\` (read-only)
Destination: `D:\AEO\source\global-workspace\`

## Copy summary

- **Files copied:** 185
- **Total bytes:** 349,961 (~342 KiB)
- **Directories:** 130
- **Method:** `robocopy /E /XD __pycache__ .venv node_modules .pytest_cache .ruff_cache .git /XJ`
- **Directories skipped:** none — a scan of the source tree found zero matches for
  `__pycache__`, `.venv`, `node_modules`, `.pytest_cache`, `.ruff_cache`, or `.git`.
  The exclude flags were applied defensively but had nothing to exclude.
- **Verification:** post-copy `find`-based file listing of source vs. destination
  (relative paths) diffed identical; byte totals matched (349,961 bytes both sides).
- **Content edits:** none. Every file was copied byte-for-byte verbatim.

Top-level contents copied: `grade_repo.py`, `probe.json`, `trigger-eval.json`,
`trigger-eval-final.json`, `trigger-eval-review.html`, `trigger-validation.json`,
`trigger-validation.log`, `iteration-1/`, `iteration-2/`, `trigger-opt/`.

## What the harness measures

Two independent harnesses live in this workspace:

**1. Skill-trigger accuracy** (`probe.json`, `trigger-eval.json`,
`trigger-eval-final.json`, `trigger-validation.json/.log`, `trigger-opt/`) —
measures whether the `agentic-engineering-org` skill's description correctly
triggers Claude to invoke it. Each file is a list of `{"query": ..., "should_trigger":
true|false}` pairs (10 true, 10 false in the full 20-query sets). `trigger-validation.json`
records, per query, `trigger_rate` (fraction of N repeated runs — 3 in this
data — where the skill actually fired), then a boolean `pass` (trigger_rate ≥ 0.5
for `should_trigger:true` rows, or 0 triggers for `should_trigger:false` rows).
`trigger-opt/2026-07-05_044525/logs/improve_iter_1.json` is a prompt-optimization
transcript: it feeds the current description + failing queries to a model and asks
for a revised, ≤1024-character description, iterating on trigger accuracy without
overfitting to individual queries.

**2. Repo-scaffold grading** (`grade_repo.py`, driven by each `iteration-N/eval-*/eval_metadata.json`)
— grades whether a Claude Code session that used the skill (or didn't — the
`with_skill` vs. `without_skill` A/B) actually produced a correct
`ai-enterprise-template` scaffold. `grade_repo.py` (170 lines) implements 9 (iteration-1)
or 10-11 (iteration-2, one more check added) deterministic, heuristic checks against
the output repo tree:

- L50-54: required directory tree exists (`.claude/{agents,skills,hooks}`, `specs`,
  `src`, `tests`, `plans`, `docs/tdd-evidence`, `secrets`).
- L56-61: a baseline test file exists under `tests/` containing `def test`.
- L63-71: `CLAUDE.md` mentions both "founder" and "merge" (merge authority is human-only),
  and separately mentions "spec" plus one of "freeze"/"frozen"/"drift" (spec-freeze rule).
- L73-83: all five role subagent files exist under `.claude/agents/` — triage,
  spec-author, test-author, implementer, reviewer (fuzzy-matched by substring).
- L85-92: the reviewer subagent's frontmatter `tools:` line excludes `edit` and `write`
  (read-only enforcement).
- L94-109: each role's frontmatter `model:` matches the expected tier — triage=haiku,
  spec-author=opus, test-author/implementer/reviewer=sonnet.
- L111-121: implementer, spec-author, and test-author frontmatter each declare
  `hooks:` + `PreToolUse` (path-guard wiring present).
- L123-133 (iteration-2 addition, the "iteration-1 bug" fix): those same guards must
  also match a `Write(` rule, not just `Edit(` — otherwise `Write` (new-file creation)
  leaks past the guard.
- L135-140: no real GitHub remote was created (`.git/config` has no `github.com`) —
  i.e. `gh repo create` was prepared but not executed.
- L142-148: the build stopped at Phase 2 — `.claude/settings.json` has no
  `PreToolUse` hook wiring and `.claude/hooks/*.sh` is empty (Phase 3 not reached).

Scoring (`grade_repo.py` L152-166): `pass_rate = passed / total` over all
expectations for that run; `grading.json` records `summary.{pass_rate,passed,failed,total}`
plus a per-expectation `{text, passed, evidence}` array. There is no single global
pass/fail threshold in `grade_repo.py` itself — `benchmark.json` aggregates pass_rate,
`time_seconds`, and `tokens` across runs per configuration (`with_skill` /
`without_skill`) as mean/stddev/min/max, plus a `delta` block comparing the two
configurations. Iteration-2's `without_skill` runs score materially lower
(0.27–0.45 pass_rate) than `with_skill` (1.0) — that delta is the skill's
measured value-add.

## How to run it

**Entrypoint:** `python grade_repo.py <repo_root> <metadata_json> <out_grading_json>`
(source: `D:\AEO\source\global-workspace\grade_repo.py`, L4).

- `<repo_root>`: path to a scaffolded output repo (e.g. an `ai-enterprise-template/`
  produced by running the skill). `find_repo()` (L11-17) will descend one level via
  `rglob(".claude")` if the repo isn't directly at the given root.
- `<metadata_json>`: NOT actually read by `grade_repo.py` — `sys.argv[2]` is unused
  in `main()` (L152-155 only consumes `argv[1]` and `argv[3]`). It's accepted
  positionally for symmetry with the eval harness's calling convention but has no
  effect on grading. (This looks like dead code / an unused parameter — worth
  flagging if reusing the script.)
- `<out_grading_json>`: output path; `grading.json` is written here with the
  `expectations` array described above.
- **Working directory:** no cwd assumption inside `grade_repo.py` — it only uses the
  `repo_root` argument. Safe to invoke from any directory, e.g. from
  `D:\AEO\source\global-workspace\`.
- **Prerequisites:** Python 3 standard library only (`json`, `os`, `re`, `sys`,
  `pathlib`) — no third-party packages, no `pip install` needed. Any Python 3.x
  works; nothing version-pinned in the script.

This repo does **not** contain the orchestrator that actually runs Claude Code
sessions, diffs `with_skill` vs `without_skill`, times them, counts tokens, and
calls `grade_repo.py` per run to assemble `benchmark.json` — only `grade_repo.py`
(the grading half) and the JSON/HTML artifacts it and the (missing) orchestrator
produced. To exercise the full with/without-skill comparison you would need:
- the `claude` CLI (or Agent SDK), authenticated, to run the actual eval sessions
- the `agentic-engineering-org` skill itself (lives under
  `C:\Users\mou97\.claude\skills\agentic-engineering-org\` — **not copied**, per
  instructions; it is owned by another workspace/agent)
- a harness script (not present in this workspace) that: creates a scratch output
  dir per run, invokes Claude with/without the skill loaded, captures
  `timing.json`-style stats, calls `grade_repo.py` on the result, and rolls
  everything up into `benchmark.json` / `eval_metadata.json`-shaped output
- network access to the Claude API (the eval sessions themselves call out)

**What you CAN re-run standalone today:** `grade_repo.py` against any of the
already-captured `outputs/` trees under `iteration-1/` or `iteration-2/`, to
confirm grading is reproducible/deterministic — e.g.:
```
python grade_repo.py "D:\AEO\source\global-workspace\iteration-2\eval-0\with_skill\run-0\outputs\it2-e0-with\ai-enterprise-template" iteration-2\eval-0\eval_metadata.json out.json
```
(the middle arg is accepted but ignored, per above).

## Metrics captured

Per completed eval run (under `iteration-N/eval-M/{with_skill,without_skill}/run-0/`):

- **`grading.json`** — `grade_repo.py`'s output: `repo_root` (absolute path where
  the run happened — see Portability blockers), `summary.{pass_rate,passed,failed,total}`,
  and `expectations[]` (`text`, `passed` bool, `evidence` string) — the full audit
  trail behind each pass/fail.
- **`timing.json`** — process-level cost metrics for that run: `total_tokens` (int),
  `duration_ms` (int), `total_duration_seconds` (float, redundant with duration_ms/1000).
- **`outputs/`** — the full scaffolded repo tree the session actually produced
  (`.claude/agents/*.md`, `CLAUDE.md`, `README.md`, `docs/`, `pyproject.toml`,
  `secrets/secrets.example.toml`, `tests/`, and for the iteration-2 `without_skill`
  runs also `.claude/hooks/*.py`, `.claude/settings.json`, `.env.example`, `src/`,
  `specs/`) — this is the raw artifact `grade_repo.py` grades and what a human
  reviewer inspects in `review.html`.

Per iteration (rollup, in `benchmark.json` and mirrored in `benchmark.md`):

- `metadata`: skill_name, skill_path/executor_model/analyzer_model (placeholders
  `<path/to/skill>` / `<model-name>` in this data — not filled in), timestamp,
  which eval IDs ran, runs-per-configuration (3, though only run-0 outputs were
  retained/copied here — runs 1-2's outputs weren't present in source either).
- `runs[]`: one entry per (eval_id, configuration, run_number) with `result`
  (pass_rate, passed, failed, total, time_seconds, tokens, tool_calls — always 0 in
  this data, errors) and the full `expectations[]` array duplicated inline.
- `run_summary`: per-configuration (`with_skill`/`without_skill`) mean/stddev/min/max
  for pass_rate, time_seconds, tokens, plus a `delta` block (with minus without).

Other files: `iteration-N/eval-M/eval_metadata.json` (the eval definition itself:
`eval_id`, `eval_name`, `prompt` given to the session, `assertions[]` — the
human-readable spec `grade_repo.py`'s checks implement); `iteration-N/feedback.json`
(free-text human review notes keyed by run_id, `status: "in_progress"`);
`iteration-2/review.html` and `trigger-eval-review.html` (self-contained HTML
viewers with `EMBEDDED_DATA` — a JS object literal embedding the grading JSON for
browser review, no external assets).

## Portability blockers

- **`D:\eval-scratch\...` hardcoded absolute paths in captured data.** Every
  `grading.json`'s `repo_root` field, and the `EMBEDDED_DATA` blob inside
  `iteration-2/review.html`, records the machine-specific scratch path the
  original eval run used (e.g. `D:\\eval-scratch\\it2-e0-with\\ai-enterprise-template`).
  This is historical output, not live config — `grade_repo.py` doesn't read or
  depend on it — but it means the copied `grading.json`/`review.html` files
  describe a run location that doesn't exist on this machine at that path. One
  hit is inside actual generated content, not just metadata: `iteration-1/eval-1/with_skill/run-0/outputs/agentic-org/docs/DECISIONS.md`
  mentions `eval-scratch` in its prose (the scaffolded template's own decision log).
- **No orchestrator script was found in the source tree.** `grade_repo.py` alone
  can be re-run (see "How to run it"), but the piece that actually launches Claude
  Code with/without the skill, times it, and assembles `benchmark.json` is not
  present anywhere under `agentic-engineering-org-workspace\` — it must live
  elsewhere (not under `D:\axial\` per a targeted check finding nothing, and not
  identified during this copy). Re-running a full with/without-skill comparison
  from `D:\AEO` requires writing or locating that harness.
- **The skill under test is not co-located.** The workspace grades output that
  depends on `C:\Users\mou97\.claude\skills\agentic-engineering-org\` (the actual
  skill definition, referenced by name throughout `eval_metadata.json` and
  `improve_iter_1.json`). Per task instructions this was intentionally **not**
  copied (owned by another agent). Without it, only `grade_repo.py` standalone
  and the historical JSON can be exercised — you cannot regenerate fresh
  `with_skill` runs from this repo alone.
- **`sys.argv[2]` (metadata_json) is accepted but unused** in `grade_repo.py`'s
  `main()` (L152-155) — not a portability blocker per se, but a latent footgun:
  passing a wrong/missing path there silently has no effect.
- **`iteration-2/eval-0/without_skill/run-0/outputs/.../secrets/` is absent** for
  that one run (it has `.env.example` instead of `secrets/secrets.example.toml`,
  and adds `.claude/hooks/git_guard.py` + `.claude/settings.json` not present in
  other runs) — reflects genuine model-output variance under the `without_skill`
  condition, not a copy defect; confirmed present in source and copied verbatim.
- No `venv`/`node_modules`/lockfiles were present to pin exact tool versions —
  `grade_repo.py`'s only real prerequisite is a Python 3 interpreter on PATH.

## Redactions

None. The only credential-shaped strings found were placeholder values in example
config templates that are part of the graded *output* artifacts, not real secrets:
- `secrets/secrets.example.toml` (present in `iteration-1/eval-0/without_skill/run-0/...`
  and `iteration-1/eval-1/without_skill/run-0/...`) contains
  `token = "ghp_example_replace_me"` — an explicit placeholder, not a live token.
No API keys, passwords, or other credentials were found anywhere in the copied tree
(checked via pattern search for `sk-ant-`, `sk-proj-`, `AKIA...`, generic
`api_key`/`token =`/`password =` assignments across `.json`, `.toml`, `.py`, `.md`,
`.log`, `.html` files).
