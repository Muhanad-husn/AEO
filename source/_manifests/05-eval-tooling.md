# 05 — eval-tooling (skill-creator plugin)

## Copy summary

- Source: `C:\Users\mou97\.claude\plugins\marketplaces\claude-plugins-official\plugins\skill-creator\` (canonical, per instructions)
- Destination: `D:\AEO\source\eval-tooling\skill-creator\`
- **Files copied: 21** — **Total bytes: 237,004** (matches source exactly; verified with `find | wc -l` and per-file `du -b` sum on both source and destination)
- Skipped: nothing was skipped — the source tree contained no `__pycache__`, `.venv`, `node_modules`, or `.git` directories to exclude in the first place. Copy was done file-by-file (not a bulk `cp -r`) filtering those patterns defensively, but the filter matched zero files.
- File contents copied verbatim (no edits) — confirmed no secrets needed redaction (see Redactions section).

### Files copied
```
.claude-plugin/plugin.json
LICENSE
README.md
skills/skill-creator/LICENSE.txt
skills/skill-creator/SKILL.md
skills/skill-creator/agents/analyzer.md
skills/skill-creator/agents/comparator.md
skills/skill-creator/agents/grader.md
skills/skill-creator/assets/eval_review.html
skills/skill-creator/eval-viewer/generate_review.py
skills/skill-creator/eval-viewer/viewer.html
skills/skill-creator/references/schemas.md
skills/skill-creator/scripts/__init__.py
skills/skill-creator/scripts/aggregate_benchmark.py
skills/skill-creator/scripts/generate_report.py
skills/skill-creator/scripts/improve_description.py
skills/skill-creator/scripts/package_skill.py
skills/skill-creator/scripts/quick_validate.py
skills/skill-creator/scripts/run_eval.py
skills/skill-creator/scripts/run_loop.py
skills/skill-creator/scripts/utils.py
```

### Marketplace vs. cache diff

Compared every one of the 21 files at `C:\Users\mou97\.claude\plugins\marketplaces\claude-plugins-official\plugins\skill-creator\` against the corresponding file at `C:\Users\mou97\.claude\plugins\cache\claude-plugins-official\skill-creator\unknown\` byte-for-byte (`diff -q`).

**Result: identical.** No file differed. The cache copy also contained a `.in_use/` directory with numeric lock files (e.g. `20088`, `26800`, `7304.tmp.030634f9`) — these are Claude Code's own plugin-cache process locks, not plugin content, and were correctly excluded.

Since there was no divergence and no cache-only content files, **`D:\AEO\source\eval-tooling\_cache-only-extras\` was not created** (nothing to put in it).

---

## End-to-end eval pipeline

This plugin actually contains **two separate pipelines** that share infrastructure (`utils.py`, subprocess-to-`claude` pattern) but serve different purposes. The SKILL.md ("Skill Creator") stitches them into one workflow.

### Pipeline A — Output quality eval (human-in-the-loop review + benchmark)

This is the "does the skill produce good outputs" loop. It is **not one script** — it's a human/Claude-orchestrated workflow described in SKILL.md, where subagents are spawned manually (no single "run all evals" entrypoint script exists for this half).

| Stage | Who/what does it | Input | Output |
|---|---|---|---|
| 1. Write eval prompts | Claude + user, by hand | — | `evals/evals.json` (schema in `references/schemas.md`) |
| 2. Spawn with-skill and baseline subagent runs | Claude spawns subagents directly (Task/Agent tool), one per test case per config | eval prompt, skill path | run output files under `<workspace>/iteration-N/eval-<id>/<config>/outputs/`; `eval_metadata.json` written per eval dir |
| 3. Capture timing | Claude, from the subagent-completion notification (only available at that moment) | task notification `total_tokens`/`duration_ms` | `timing.json` per run dir |
| 4. Grade each run | Grader subagent following `agents/grader.md`, or a bespoke grading script (e.g. `grade_repo.py` in the `global-workspace` this manifest is paired with) | run outputs + assertions from `eval_metadata.json` | `grading.json` per run dir (must use fields `text`/`passed`/`evidence`) |
| 5. Aggregate | **Entrypoint: `python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name <name> [--skill-path <path>] [-o <output.json>]`** (run from inside `skills/skill-creator/`, since it's invoked as a module — `scripts` must be an importable package, hence `scripts/__init__.py`) | all `grading.json` (+ sibling `timing.json`) files under the iteration dir, in either `eval-N/<config>/run-N/` or `runs/eval-N/<config>/run-N/` layout | `benchmark.json` + `benchmark.md` in the iteration dir (or `--output` path) |
| 6. Analyst pass | Subagent following `agents/analyzer.md` | benchmark.json | notes/observations (fed back into benchmark.json's `notes` array by hand) |
| 7. Launch viewer | **Entrypoint: `python eval-viewer/generate_review.py <workspace>/iteration-N --skill-name <name> --benchmark <workspace>/iteration-N/benchmark.json [--previous-workspace <prev-iter>] [--static <output.html>]`** | workspace dir (scans recursively for any dir containing `outputs/`), optional `benchmark.json`, optional previous iteration for diffing | Either a live HTTP server on port 3117 (default) serving the review UI and a `/api/feedback` endpoint, OR (with `--static`) a single self-contained HTML file — this is what produces `review.html` |
| 8. Collect feedback | User interacts with the viewer, clicks "Submit All Reviews" | — | `feedback.json` in the workspace (written by the server's POST handler, or downloaded by the browser and manually placed into the workspace dir when `--static` is used, since there's no server to write it) |
| 9. Iterate | Claude, by hand, reading feedback.json | — | new `iteration-N+1/` |

### Pipeline B — Description-triggering optimization (fully automated loop)

This is the one true "run and it does everything" pipeline. **Entrypoint: `run_loop.py`.**

```
python -m scripts.run_loop \
  --eval-set <path-to-eval-set.json> \
  --skill-path <path-to-skill-dir> \
  --model <model-id> \
  --max-iterations 5 \
  [--num-workers 10] [--timeout 30] [--runs-per-query 3] \
  [--trigger-threshold 0.5] [--holdout 0.4] \
  [--report auto|none|<path>] [--results-dir <dir>] \
  [--verbose]
```
Run from inside `skills/skill-creator/` (module-style invocation, same reason as above).

- **Input schema** (`--eval-set` file): JSON array of `{"query": "<prompt>", "should_trigger": <bool>}`. This is exactly the shape of the `probe.json` / `trigger-eval.json` / `trigger-eval-final.json` files in `global-workspace`.
- **What it does internally:**
  1. Splits the eval set into train/test (stratified by `should_trigger`, seeded random shuffle, `--holdout` fraction to test) via `split_eval_set()`.
  2. For each iteration (up to `--max-iterations`): calls `run_eval()` (imported from `run_eval.py`) on train+test combined for parallelism, splits results back out, records history.
  3. `run_eval()` (see below) is also independently runnable as `python -m scripts.run_eval --eval-set ... --skill-path ...` and produces exactly the JSON shape found in `trigger-validation.json`: `{"skill_name", "description", "results": [{"query","should_trigger","trigger_rate","triggers","runs","pass"}], "summary": {"total","passed","failed"}}`. Verified by direct structural comparison — `trigger-validation.json`'s top-level keys and each `results[]` entry's fields match `run_eval()`'s return dict field-for-field (SKILL_creator's `run_eval` lines ~247-256).
  4. If not all train queries pass and iterations remain, calls `improve_description()` (from `improve_description.py`) — shells out to `claude -p` with a prompt embedding the failures and iteration history, asking for a revised description (with a follow-up shortening call if the model exceeds 1024 chars).
  5. If `log_dir` is set (only when `--results-dir` is passed), `improve_description()` writes `improve_iter_<N>.json` (prompt, raw response, parsed description, char counts) to `<results-dir>/<timestamp>/logs/`. **This exactly matches** `global-workspace/trigger-opt/2026-07-05_044525/logs/improve_iter_1.json` — the timestamp directory name format `%Y-%m-%d_%H%M%S` is produced verbatim by `run_loop.py` main()'s `results_dir = Path(args.results_dir) / timestamp` line.
  6. After all iterations, picks the best description by **test** score (not train, to avoid overfitting) — falls back to train score if `--holdout 0`.
  7. Writes a live-updating HTML report (`generate_report.py`'s `generate_html()`) to `--report` path (auto = temp file, opened in browser immediately) with auto-refresh while running, then a final static version at the end.
  8. If `--results-dir` given, also writes `results.json` and `report.html` into `<results-dir>/<timestamp>/` (siblings of `logs/`) — **not observed in the current `global-workspace/trigger-opt/2026-07-05_044525/` dir**, which contains only `logs/`. This is either because the workspace-copying agent didn't grab them, or because `--results-dir` was passed but something about the run only produced the logs subfolder. **Unverified** which.
- **Output** (stdout): the full JSON described above (`exit_reason`, `original_description`, `best_description`, `best_score`, `best_train_score`, `best_test_score`, `final_description`, `iterations_run`, `holdout`, `train_size`, `test_size`, `history[]`).
- The trigger check itself (inside `run_single_query()` in `run_eval.py`) works by writing a temporary slash-command file into `<project_root>/.claude/commands/<skill>-skill-<uuid>.md` (so the skill-under-test's description appears in the target Claude session's `available_skills`), running `claude -p "<query>" --output-format stream-json --include-partial-messages`, and watching the streamed tool-use events for either a `Skill` or `Read` tool call referencing the unique command name — this is genuinely running a live nested Claude Code session per query, `--num-workers` of them in parallel via `ProcessPoolExecutor`.

---

## Script → artifact map

| Script | Produces (workspace filename) | Confidence |
|---|---|---|
| `scripts/run_eval.py` (`run_eval()` / CLI) | `trigger-eval.json`-shaped JSON to stdout — i.e., this is the script whose output (or `run_loop.py`'s internal call to it) becomes **`trigger-validation.json`** | Verified — field-for-field match against source |
| `scripts/run_loop.py` (CLI) | Orchestrates the above; its own stdout/`results.json` is the full loop-history JSON, not one of the listed filenames directly, but it repeatedly calls `run_eval()` producing the data underlying **`trigger-validation.json`** and **`trigger-eval-final.json`** (test set after split/dedup — inferred, since `run_loop.py` doesn't itself write a file called that) | `trigger-validation.json` verified; `trigger-eval-final.json` origin **unverified** (plausibly a hand- or `run_loop`-adjacent snapshot of the eval set actually used, but no script in this plugin writes that exact filename) |
| `scripts/improve_description.py` (`improve_description()`, called from `run_loop.py`) | **`trigger-opt/<timestamp>/logs/improve_iter_<N>.json`** | Verified — `log_dir`/filename construction read directly from source (`log_file = log_dir / f"improve_iter_{iteration or 'unknown'}.json"`) |
| `scripts/aggregate_benchmark.py` (CLI, run against an iteration dir) | **`benchmark.json`** and **`benchmark.md`** | Verified — literal `output_json`/`output_md` write calls in `main()` |
| `eval-viewer/generate_review.py` (CLI, `--static` mode) | **`review.html`** (name chosen by caller via `--static <path>`; not hardcoded by the script itself) | Verified mechanism; the exact filename `review.html` / `trigger-eval-review.html` is caller-chosen, not enforced by the script |
| `eval-viewer/generate_review.py` (server mode, `POST /api/feedback` handler) | **`feedback.json`** (written to `<workspace>/feedback.json`) | Verified — `self.feedback_path.write_text(...)` in `do_POST` |
| Grader subagent / bespoke grading script (e.g. `grade_repo.py`, external to this plugin) reading `agents/grader.md` | **`grading.json`** (per run dir) | Verified schema-compat with `aggregate_benchmark.py`'s reader (`summary.pass_rate/passed/failed/total`, `expectations[].{text,passed,evidence}`); the grading script itself is not part of skill-creator — it lives with the skill under test (confirmed: `global-workspace/grade_repo.py` is a separate, skill-specific script, not one of the 8 skill-creator scripts) |
| Task-completion notification, captured by Claude manually per SKILL.md Step 3 (no script involved) | **`timing.json`** (`total_tokens`, `duration_ms`, `total_duration_seconds`) | Verified against SKILL.md's documented schema and the actual `global-workspace` sample, which matches exactly (plus an extra freeform `note` field used ad hoc) |
| Hand-authored by Claude/user per SKILL.md "Interview and Research" / "Test Cases" steps (no script) | **`eval_metadata.json`**, **`probe.json`**, **`trigger-eval.json`** (the eval-set input files) | Verified against SKILL.md's documented schema; `probe.json`/`trigger-eval.json` also verified structurally as valid `run_eval.py`/`run_loop.py` `--eval-set` input |

Not produced by anything in this plugin: `grade_repo.py` itself (it's the skill-under-test's own grader, copied separately into `global-workspace`), and `trigger-validation.log` (plain stdout/stderr capture of a `run_eval.py`/`run_loop.py` invocation — a shell redirect artifact, not a script output).

---

## `package_skill.py` — detailed

**Entrypoint:** `python -m scripts.package_skill <path/to/skill-folder> [output-directory]` (module form; also works as a plain script since it only does a relative import of `scripts.quick_validate`, which requires being run from `skills/skill-creator/` or having that dir on `PYTHONPATH`).

**Expected input layout:** a single **skill folder** — i.e., a directory containing `SKILL.md` directly at its root, optionally with `scripts/`, `references/`, `assets/`, `agents/`, etc. beneath it. This is a **bare skill**, not a plugin: there is no handling anywhere in this script (or `quick_validate.py`) for a `.claude-plugin/plugin.json` manifest, a `skills/<name>/` nesting level, or multiple skills in one package. It packages exactly one skill directory.

**Validation enforced (via `quick_validate.validate_skill()`, run automatically before packaging — packaging aborts on failure):**
- `SKILL.md` must exist and start with `---` YAML frontmatter with a closing `---`.
- Frontmatter must parse as a YAML dict.
- Only these frontmatter keys are allowed: `name`, `description`, `license`, `allowed-tools`, `metadata`, `compatibility`. Any other key fails validation.
- `name` is required, must be a string, kebab-case (`^[a-z0-9-]+$`), no leading/trailing/double hyphens, max 64 chars.
- `description` is required, must be a string, no `<`/`>` characters, max 1024 chars.
- `compatibility`, if present, must be a string ≤ 500 chars.
- Does **not** validate `scripts/`, `references/`, or `assets/` contents, nor check for broken cross-references from SKILL.md into those directories.

**Output artifact:** a zip file named `<skill-folder-name>.skill`, written to `output-directory` if given, else the current working directory. Internally it's a standard `zipfile.ZipFile` with `ZIP_DEFLATED` compression; despite the `.skill` extension it's openable with any zip tool.

**Packaging exclusions** (`should_exclude()`):
- Any path component named `__pycache__` or `node_modules` (anywhere in the tree).
- Files matching `*.pyc`.
- Files named `.DS_Store`.
- A top-level `evals/` directory directly under the skill root (i.e. `<skill>/evals/` is dropped, but a nested `<skill>/scripts/evals/` would *not* be — the exclusion only checks `rel_path.parts[1]`, which is the first path segment under the skill folder).
- Archive paths (`arcname`) are computed relative to `skill_path.parent`, so the zip's internal top-level directory is the skill folder's own name — this is what lets `.skill` files be dropped into a `skills/` directory and unzip cleanly with the right name.

**Portability implication (see also blockers below):** because this script has zero concept of plugin structure, using it to "package a skill as a plugin" (this repo's stated end goal) will require either (a) a wrapper step that also emits/copies `.claude-plugin/plugin.json` alongside the `.skill` zip contents, or (b) pointing `package_skill.py` at the `skills/<name>/` subdirectory of an existing plugin tree and separately packaging the plugin manifest — this script cannot do both in one pass.

---

## Prerequisites

- **Python**: 3.10+ required — all scripts use `str | None` / `tuple[str, str, str]` PEP 604/585-style annotations without `from __future__ import annotations`, which need 3.10+. (`run_eval.py`, `run_loop.py`, `improve_description.py`, `utils.py` all use this syntax directly in function signatures.)
- **Third-party packages imported:**
  - `yaml` (PyYAML) — used only in `quick_validate.py` (`import yaml`). Every other script uses only the stdlib.
  - Everything else (`argparse`, `json`, `os`, `re`, `subprocess`, `sys`, `time`, `uuid`, `select`, `zipfile`, `fnmatch`, `math`, `random`, `tempfile`, `webbrowser`, `base64`, `mimetypes`, `signal`, `http.server`, `concurrent.futures`, `functools`, `datetime`, `pathlib`, `html`) is standard library.
- **Shells out to the `claude` CLI**: yes, in two places —
  - `run_eval.py`'s `run_single_query()` invokes `claude -p <query> --output-format stream-json --verbose --include-partial-messages [--model <model>]` as a subprocess per eval query (parallelized via `ProcessPoolExecutor`, `--num-workers` at a time).
  - `improve_description.py`'s `_call_claude()` invokes `claude -p --output-format text [--model <model>]` with the improvement prompt piped via stdin.
  - Both explicitly strip `CLAUDECODE` from the subprocess env (`env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}`) specifically so a nested `claude -p` can run from inside an already-running Claude Code session without the interactive-terminal guard blocking it.
- **API keys / auth**: none required directly — both `claude -p` invocations rely on the ambient Claude Code CLI session's own authentication ("uses the session's Claude Code auth, no separate ANTHROPIC_API_KEY needed", per `improve_description.py`'s module docstring). No script reads `ANTHROPIC_API_KEY` or any other credential env var itself.
- **Network dependency**: indirect only, via the `claude` CLI subprocess calls reaching Anthropic's API. `eval-viewer/generate_review.py`'s server mode binds to `127.0.0.1` only (loopback), no external network. `run_loop.py`'s `webbrowser.open()` for the live report likewise stays local.
- **Other CLI dependency**: `_kill_port()` in `generate_review.py` shells out to `lsof -ti :<port>` to find and kill a process already bound to the viewer port — this is POSIX-only and will silently no-op with a printed note ("lsof not found") on Windows unless `lsof` is on `PATH` (e.g., via Git Bash/WSL). This does not block functionality: on `FileNotFoundError` it just skips the kill and, if the port is still busy, `main()` falls back to `HTTPServer(("127.0.0.1", 0), ...)` (OS-assigned free port).

---

## Portability blockers

Concrete, cited issues that will surface when running these scripts from `D:\AEO` (or anywhere outside the original `~/.claude/plugins/...` layout):

1. **Module-style invocation requires the right working directory.** Every cross-script import (`from scripts.utils import parse_skill_md`, `from scripts.run_eval import ...`, `from scripts.quick_validate import validate_skill`, etc.) uses the `scripts.` package prefix, which only resolves correctly when invoked as `python -m scripts.<name>` **from inside `skills/skill-creator/`** (so `scripts/__init__.py` makes `scripts` an importable package on the CWD-relative path). Running `python skills/skill-creator/scripts/run_eval.py` directly from a different CWD will raise `ModuleNotFoundError: No module named 'scripts'`. Cite: `skills/skill-creator/scripts/run_eval.py:19` (`from scripts.utils import parse_skill_md`), `run_loop.py:18-21`, `package_skill.py:17`.
2. **`find_project_root()` in `run_eval.py` assumes a `.claude/` directory exists somewhere up the tree from CWD.** Cite: `run_eval.py:22-32`. If run from `D:\AEO` with no `.claude/` ancestor, it falls back to `current` (CWD) itself as the "project root" — the temporary command file then gets written to `D:\AEO\.claude\commands\...` regardless of where the actual skill-under-test lives, which is not obviously wrong but is a silent behavior change worth flagging when porting.
3. **`generate_review.py`'s `_kill_port()` calls `lsof`**, a POSIX-only tool not present on stock Windows. Cite: `eval-viewer/generate_review.py:288-306`. Degrades gracefully (falls back to OS-assigned port) but the "always try to reuse port 3117" behavior won't work out of the box on Windows without Git Bash/WSL `lsof` on `PATH`.
4. **No hardcoded absolute paths** were found in any of the 8 scripts, `utils.py`, or `generate_review.py` — all paths are CLI-argument- or CWD-derived. This is good for portability once the working-directory requirement above is satisfied.
5. **`run_loop.py`'s `--report auto` mode writes to the OS temp dir** (`tempfile.gettempdir()`) and calls `webbrowser.open()` — fine on Windows but will silently do nothing useful in a headless/Cowork environment (the SKILL.md itself flags this and recommends `--static` for `generate_review.py`, but `run_loop.py`'s own live-report mechanism has no equivalent headless fallback — it always tries to open a browser tab unless `--report none` is passed).
6. **`package_skill.py` has no plugin-awareness** (detailed above) — not a bug, but the single largest gap between what this script does and what this repo needs it to do (package a skill *as a plugin*). Cite: `scripts/package_skill.py:42-108` (`package_skill()` function body — operates purely on a bare skill directory).
7. **Grading is not self-contained in this plugin.** `aggregate_benchmark.py` and the viewer both assume `grading.json` files already exist per run, but the plugin ships no grading script itself — only `agents/grader.md` instructions for a subagent to follow, or (as seen in `global-workspace`) a bespoke external script like `grade_repo.py` written per skill-under-test. Anyone trying to run "the whole pipeline" end-to-end from this plugin alone will hit a gap at the grading step unless they also bring/write a grader.

---

## Redactions

None. The source tree was scanned for `api[_-]?key`, `token`, `secret`, `password`, `sk-ant`, and `bearer` (case-insensitive) across all `.py`/`.md`/`.json`/`.html` files. All matches were false positives — references to eval "tokens" (LLM token counts) and "total_tokens" JSON fields, not credentials. No API keys, passwords, or auth tokens were present in any copied file.
