# Source inventory

What was copied into `source/`, where it came from, and what is missing. Assembled
from the five per-source manifests in [`source/_manifests/`](../source/_manifests/).

**Total: 299 files, 1,431,585 bytes (1.4 MB).**

| Destination | Files | Bytes | Copied from | Manifest |
| --- | ---: | ---: | --- | --- |
| `source/global-skill/` | 19 | 147,511 | `~/.claude/skills/agentic-engineering-org/` + 2 plugin deps | [01](../source/_manifests/01-global-skill.md) |
| `source/global-workspace/` | 185 | 349,961 | `~/.claude/skills/agentic-engineering-org-workspace/` | [02](../source/_manifests/02-global-workspace.md) |
| `source/axial/` | 66 | 599,418 | `D:\axial\` — `.claude/`, selected `docs/`, root files | [03](../source/_manifests/03-axial-claude.md), [04](../source/_manifests/04-principles-and-metrics.md) |
| `source/eval-tooling/` | 21 | 237,004 | `skill-creator` plugin (marketplace copy) | [05](../source/_manifests/05-eval-tooling.md) |
| `source/global-claude/` | 3 | 1,337 | `~/.claude/` CLAUDE.md + settings | [04](../source/_manifests/04-principles-and-metrics.md) |
| `source/_manifests/` | 5 | 96,354 | Written during the copy | — |

## What each source contributes

**`global-skill/`** — the artifact being generalized. `SKILL.md` (33 KB) plus five
references (`agents`, `hooks`, `harness-and-sprint`, `directory-tree`,
`claude-md-handbook`) and `evals/evals.json`. Two plugins it names are vendored
under `_deps/`: `github` (a thin remote-MCP declaration) and `pr-review-toolkit`
(cited as design lineage).

**`axial/.claude/`** — the matured implementation, and the most load-bearing
source here. Four role agents (builder, reviewer, spec-author, triage), five
PowerShell hooks, ten skills, three Python tools.

Hook wiring, from `settings.json`:

| Event | Matcher | Script | Enforces |
| --- | --- | --- | --- |
| SessionStart | — | `session-status.ps1` | Injects branch/issue/PR state; never blocks |
| PreToolUse | Bash | `commit-gate.ps1` | Blocks commits on `main` (except docs-only); blocks commit when pytest or ruff is red |
| PreToolUse | Bash, GitHub merge tools | `block-merge.ps1` | Blocks subagent merge, push-to-main, branch delete |
| PreToolUse | Edit\|Write | `path-guard.ps1` | Blocks role subagents writing into `.claude/` |
| PostToolUse | Edit\|Write | `format.ps1` | Runs `ruff format`; never blocks |

Each role agent re-declares `path-guard` and `block-merge` in its own frontmatter
as defense-in-depth against a known Claude Code frontmatter-hook bug.

**Process-metrics tooling** (`axial/.claude/tools/` and `axial/docs/_found/src/`):

| Mechanism | What it measures | Output |
| --- | --- | --- |
| `axial-watch.py` | Live per-brief status/ETA, gate pass/fail, retrieval turns, LLM latency/tokens/cost | stdout only, no persistence |
| `run-monitor.py` | Hang detection: CPU%, checkpoint growth, log growth → HEALTHY/SUSPECT/STALLED | stdout only |
| `snapshot-harness.py` | Not metrics — mirrors the gitignored `.claude/` into a sibling git repo so the harness has history | `../axial-harness` |
| `runlog.py` | The run-logging seam | `run.jsonl`, `console.log`, `summary.md` |
| `run.py` | Corpus-wide pass runner with resume ledger | ledger + run logs |
| `run_report.py` | Per-brief run report | report file |
| `docs/tdd-evidence/` | Pytest evidence trail, 61 feature dirs / 191 files | described only, not copied |

**`global-workspace/`** — the measurement history. Two things live here: skill-trigger
accuracy (`probe.json`, `trigger-eval*.json`, `trigger-validation.*`, `trigger-opt/`)
and scaffold grading (`grade_repo.py`, 170 lines, 9–11 deterministic checks).
`benchmark.json` records the skill's measured value: **with_skill pass_rate 1.0 vs
without_skill 0.27–0.45** in iteration-2.

**`eval-tooling/skill-creator/`** — the orchestrator that produced the workspace data.
It was not in the original scope; the workspace holds the grader but not the runner,
so it was pulled in separately.

| Script | Produces |
| --- | --- |
| `run_eval.py` | `trigger-validation.json`-shaped output |
| `improve_description.py` | `trigger-opt/<ts>/logs/improve_iter_N.json` |
| `aggregate_benchmark.py` | `benchmark.json`, `benchmark.md` |
| `generate_review.py` | `review.html`, or `feedback.json` via server POST |
| — hand-authored — | `grading.json`, `eval_metadata.json`, `probe.json`, `trigger-eval.json` |

**Principles** — `axial/root/CLAUDE.md` lines 23–36 ("Developer principles") and
44–62 ("Answering the founder"); `axial/root/CLAUDE.local.md` lines 55–75 ("Build
philosophy", the same four principles with worked examples), 12–20 ("two rules"),
123–129 ("Run logging" mandate). The global `~/.claude/CLAUDE.md` "Core Principle"
is consistent with Axial's "specs are living documentation, not law". No
contradictions found. The active subset is restated in [`CLAUDE.md`](../CLAUDE.md).

## Gaps and open questions

1. **`red-green-refactor` is docs-only.** Axial vendors `SKILL.md` plus two reference
   docs (40 KB) — no harness code. The skill instructs the builder agent to clone
   `brainqub3/red-green-refactor` from GitHub at runtime. That external dependency is
   still unmet, and the repo is not self-contained until it is resolved. **Not fetched
   — awaiting your decision.**
2. **`package_skill.py` cannot build a plugin.** It packages a bare skill folder into a
   `.skill` zip and has no `.claude-plugin/plugin.json` awareness at all. The existing
   tooling cannot produce the artifact this repo is aiming for.
3. **Grading is not reproducible from the copy alone.** `grade_repo.py` grades the
   `ai-enterprise-template` scaffold specifically, and `grading.json` is hand-authored
   per the skill-creator workflow — no script in `eval-tooling/` generates it.
4. **The eval pipeline shells out to `claude -p`** and must run from inside
   `skills/skill-creator/` because of module-style imports. Running it from `D:\AEO`
   needs a wrapper.

## Portability blockers for plugin packaging

Collected across manifests; each is cited with file and line in its manifest.

- All five hooks are Windows PowerShell only, with MSYS path normalization baked in.
  No POSIX implementation exists anywhere.
- Hook invocation is hardcoded to `powershell -NoProfile -ExecutionPolicy Bypass -File`,
  from an empirical finding pinned to Claude Code 2.1.201.
- The Python/`uv`/`pytest`/`ruff` toolchain is hardcoded into `commit-gate.ps1`,
  `format.ps1`, and the directory-tree skeleton.
- Absolute paths: `D:/axial`, `D:/axial-vault-query`, `../axial-vault-hold` in
  `settings.local.json`; `D:\proj-xref` / `D:\proj` in worked examples;
  `D:/eval-scratch/...` in `evals/evals.json` and captured grading records.
- `run-monitor.py` uses `REPO = parents[2]` and an Axial-specific pipeline-stage map;
  `axial-watch.py` carries a hardcoded per-model price table and shells out to
  `powershell.exe Get-CimInstance`.
- The GitHub MCP tool namespace (`mcp__plugin_github_github__…`) is hardcoded from one
  observed install.
- Multiple skills assume `main` as the default branch and `gh`/GitHub as the forge.
- `directory-tree.md` hardcodes the example repo name `ai-enterprise-template` and
  states a GitHub Pro tier assumption as settled fact.

## Deliberately not copied

| Left behind | Reason |
| --- | --- |
| `axial/.claude/worktrees/` | Live git worktree with a full `.venv` |
| `axial/docs/tdd-evidence/` | 191 process-output artifacts; structure described in manifest 04 |
| `axial/docs/academic/`, `sim-academic/`, `eval/`, `exploration/` | Research domain content, not engineering process |
| `axial/data/`, `.venv/`, caches | Bulk and binary |
| `axial/secrets/` | Secrets policy |
| Axial product specs, CHARTER, experiments, config, scratchpad | Domain-specific to Axial |
| `~/.claude/.credentials.json` | Never touched |

No secrets were copied. Across all five agents the only finding was a placeholder
token (`ghp_example_replace_me`) in captured eval data, which is not a real
credential. Zero redactions were required.

## Snapshot integrity notes

- `.gitattributes` sets `source/** -text` so git performs no line-ending
  normalization on the copies. Without it, `core.autocrlf` would rewrite LF to
  CRLF and the snapshot would no longer be byte-identical to its originals.
- `source/axial/root/.gitignore` is a **copy** of Axial's ignore file, but git
  treats it as a live nested rule in this repo. It suppressed three verbatim
  files — `CLAUDE.local.md`, `PR_BODY.generated.md`, `.tdd-branch-cleanup.log`.
  They were committed with `git add -f` rather than by editing the copied ignore
  file, which would have broken verbatim fidelity. Any future file added under
  `source/axial/root/` may need the same treatment.
- Verified: 299 files under `source/` on disk, 299 tracked in git.

## Provenance rules

`source/` is a verbatim snapshot. Nothing in it was edited during the copy. Do not
edit it during migration either — changes belong in the plugin tree once that tree
exists. The originals at `~/.claude/` and `D:\axial` remain untouched and are not
read at runtime by anything in this repo.
