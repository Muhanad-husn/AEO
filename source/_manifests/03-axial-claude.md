# 03 — Axial `.claude/` Harness Copy

Source: `D:\axial\.claude\` (read-only, not modified, no git commands run against it)
Destination: `D:\AEO\source\axial\.claude\`

## Copy summary

- **Files copied:** 36 (verified 1:1 path match between source and destination, excluding the
  `worktrees` prefix difference).
- **Total bytes:** 208,422 bytes (~203.5 KB) copied via `robocopy /E` (source-reported: 203.5 KB /
  36 files / 0 mismatches / 0 failures — robocopy exit code 1, which is its "files copied
  successfully" code, not an error).
- **Skipped:** `D:\axial\.claude\worktrees\` — a live git worktree directory (verified present)
  containing a full checkout + `.venv`, excluded per hard instruction; excluded via `robocopy /XD`
  along with `__pycache__`, `.venv`, `node_modules`, `.pytest_cache`, `.ruff_cache` (none of the
  latter five actually occurred elsewhere in the source tree — the only real skip was
  `worktrees`).
- **No file contents were edited** during copy (verbatim byte-for-byte copy, confirmed by
  robocopy's 0-mismatch report).
- **Empty file noted:** `hooks/.gitkeep` is 0 bytes in the source and was copied as 0 bytes
  (correct — it's a placeholder to keep the otherwise-populated `hooks/` dir under git if hooks
  were ever removed).

### Directory contents copied

```
.claude/
├── settings.json
├── settings.local.json
├── agents/
│   ├── builder.md
│   ├── reviewer.md
│   ├── spec-author.md
│   └── triage.md
├── hooks/
│   ├── .gitkeep
│   ├── block-merge.ps1
│   ├── commit-gate.ps1
│   ├── format.ps1
│   ├── path-guard.ps1
│   └── session-status.ps1
├── skills/
│   ├── fix/SKILL.md
│   ├── red-green-refactor/SKILL.md + references/{red-green-refactor-philosophy.md, test-strategy.md}
│   ├── review/SKILL.md
│   ├── safe-cleanup/SKILL.md + scripts/classify-branches.mjs
│   ├── safe-pr/SKILL.md + assets/pr-body-template.md + scripts/collect-evidence.mjs
│   ├── sprint-plan/SKILL.md
│   ├── sprint-start/SKILL.md
│   ├── tdd-ci/SKILL.md + assets/workflows/{node-ci.yml, playwright-e2e.yml, python-ci.yml} + references/github-actions-guide.md
│   ├── tdd-plan/SKILL.md + assets/plan-template.md + references/slicing-guide.md
│   └── triage/SKILL.md
└── tools/
    ├── axial-watch.py
    ├── run-monitor.py
    └── snapshot-harness.py
```

---

## Hook wiring

`settings.json` wires four hooks globally (plus per-role duplicate wiring in agent frontmatter —
see "Agents" table). All commands run via
`powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/<script>.ps1"`.

| Hook event | Matcher | Script | What it enforces |
|---|---|---|---|
| `SessionStart` | (all) | `session-status.ps1` | Injects live repo state (branch, HEAD, open issues, open PRs, recently-merged PRs, newest run log) into context at session start via `gh` + `git`. Never blocks (always exits 0); exists to stop the agent repeating stale memory about what's shipped. |
| `PreToolUse` | `Bash` | `commit-gate.ps1` | Blocks (`exit 2`) a `git commit` on branch `main` (docs-only commits are allowed directly on main). Blocks a commit if the `src/` pytest suite is red or `ruff check` fails, unless `.claude/allow-red-commit` flag file exists (founder-approved one-time escape hatch for the DEC-1 outer-test red commit). Resolves the true target worktree from an explicit leading `cd <dir> &&`, else `$j.cwd`, else `CLAUDE_PROJECT_DIR`. |
| `PreToolUse` | `Bash` | `block-merge.ps1` (no arg — subagent-conditional) | Blocks any `git merge`, `gh pr merge`, `gh api ...merge`, `git branch -d/-D`, `git push --delete`, or `git push` while on `main` — but only when the caller is a subagent (stdin carries `agent_type`); the orchestrator's Bash calls pass through. |
| `PreToolUse` | `mcp__plugin_github_github__.*(merge\|create_or_update_file\|push_files\|delete_file).*` | `block-merge.ps1` | Blocks the GitHub plugin's `merge_pull_request` tool outright (for everyone, including the orchestrator) and blocks `create_or_update_file`/`push_files`/`delete_file` calls targeting branch `main`/`refs/heads/main`. |
| `PreToolUse` | `Edit\|Write` | `path-guard.ps1` (no arg — role-conditional via stdin `agent_type`) | Blocks (`exit 2`) any Edit/Write whose target path resolves (via the target file's own git worktree root) to inside a `.claude/` directory, when the caller is a role subagent. Applies only when `agent_type`/role is present; the orchestrator and non-role agents pass through. |
| `PostToolUse` | `Edit\|Write` | `format.ps1` | Runs `uv run ruff format <file>` on any `.py` file that was just edited/written. Never blocks (always exits 0). |

Additional **per-role** hook wiring lives in each agent's own frontmatter (belt-and-suspenders
against a known Claude Code frontmatter-hook reliability bug, GH issue #18392, per the comment at
the top of `block-merge.ps1`):

| Agent | Frontmatter hook | Script + arg |
|---|---|---|
| `builder` | `PreToolUse: Edit\|Write` | `path-guard.ps1 builder` |
| `builder` | `PreToolUse: Bash` | `block-merge.ps1 subagent` |
| `reviewer` | `PreToolUse: Bash` | `block-merge.ps1 subagent` |
| `spec-author` | `PreToolUse: Edit\|Write` | `path-guard.ps1 spec-author` |
| `triage` | `PreToolUse: Bash` | `block-merge.ps1 subagent` |

`settings.local.json` carries no hook wiring — it's purely a `permissions.allow` allowlist of
specific pre-approved Bash command patterns (vault data moves, `uv run *`, a couple of
`Get-CimInstance`/process-inspection one-liners, `git checkout *`, `git stash *`, and `git -C
D:/axial fetch|pull`). No secrets or tokens in it.

---

## Agents

| Agent file | Role | Model | Tools declared | Hooks (frontmatter) |
|---|---|---|---|---|
| `builder.md` | Builds one issue/fix end-to-end, test-first, in its own worktree; writes `src/`, `tests/`, `specs/`; never `.claude/`; never merges. Reports one of DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT. | `sonnet` | `Read, Grep, Glob, Edit, Write, Bash` | `path-guard.ps1 builder` (Edit\|Write), `block-merge.ps1 subagent` (Bash) |
| `reviewer.md` | Read-only two-stage reviewer (spec-compliance, then code-quality); dispatched on demand; never edits. | `sonnet` | `Read, Grep, Glob, Bash` | `block-merge.ps1 subagent` (Bash) |
| `spec-author.md` | Authors/revises `specs/` only, for deliberate spec passes (new phase spec, charter, redesign); never code/tests. | `opus` | `Read, Grep, Glob, Edit, Write` | `path-guard.ps1 spec-author` (Edit\|Write) |
| `triage.md` | Triage/PM: reads issues/PRs/code, proposes scoping/decomposition/priority/labels; writes no code, never merges. | `haiku` | `Read, Grep, Glob, Bash` | `block-merge.ps1 subagent` (Bash) |

All four end with the same four-status report contract (DONE / DONE_WITH_CONCERNS / BLOCKED /
NEEDS_CONTEXT) and all explicitly defer merge/push-to-main/branch-delete to the orchestrator on
founder approval — consistent with the hook enforcement above.

---

## Skills

| Skill | Purpose (one line) | External dependencies (outside `.claude/`) |
|---|---|---|
| `fix` | Fast lane for a scoped bug/small change: cut a worktree, dispatch builder, prep PR via safe-pr, pause for founder approval. | `git worktree add ... .claude/worktrees/fix-<slug> main` (branch name convention `fix/<slug>`); main axial checkout at `D:/axial` for any corpus check (hardcoded path); `specs/` dir for spec updates. |
| `red-green-refactor` | Double-loop TDD: outer acceptance test (from spec) + inner unit-test red/green/refactor, one slice at a time, builder authors both layers. | `plans/<feature-slug>/<NN>-<slice-slug>.md` plan files; `tests/<subproject>/` (outer/acceptance tests) and `src/**/test_*.py` (inner unit tests) trees in the axial repo; repo's `pytest` config (`testpaths = ["tests", "src"]`); Conventional Commits convention. |
| `review` | Thin entry point dispatching the `reviewer` subagent for two-stage review against `main`. | Relies on the `reviewer` agent (already copied); references `llm.py`, `cli.py`, config-loading modules in axial's `src/` as "high blast radius" examples; `CLAUDE.md` conventions. |
| `safe-cleanup` | Safely delete stale LOCAL feature branches (merged/abandoned) after PRs ship, local-only, never touches remote. | `scripts/classify-branches.mjs` (bundled, copied); `gh` CLI + GitHub remote; writes `.tdd-branch-cleanup.log` at the axial repo root; references `.claude/worktrees/<slug>` (excluded from this copy) and explicitly protects `.claude/worktrees/axial-harness`; `plans/<feature>/<NN>-<slice>.md` optional bookkeeping update. |
| `safe-pr` | Assemble an evidence-rich PR (test transcripts, CLI demo, secret-scanned) and open it via `gh`, never merges. | `assets/pr-body-template.md` + `scripts/collect-evidence.mjs` (both bundled/copied); `gh` CLI authenticated + GitHub remote; writes evidence to `docs/tdd-evidence/<feature>/<NN-slice>/` in the axial repo; branch naming convention `feat/<feature-slug>/<NN-slice-slug>`; base branch hardcoded to `main`. |
| `sprint-plan` | Decompose a subproject/spec section into a founder-reviewed, GitHub-filed sprint backlog of issues linked to `plans/`. | `specs/` (spec sections); dispatches `triage` role; writes `plans/<feature-slug>/issues/<NN>-<slice-slug>.issue.md` drafts; GitHub issue labels (`sub:<subproject-slug>`, `spec-drift`, `blocked`, `needs-context`, `done-with-concerns`) via GitHub plugin `issue_write` / `gh issue create` / `gh label create`; calls the `tdd-plan` skill. |
| `sprint-start` | Select the next unblocked sprint issue by dependency, dispatch the builder to a green PR, pause for approval. | GitHub issues/labels (system of record, `sub:<subproject>` label, `Depends on:` field, `blocked`/`needs-context` labels); `plans/` slice files; `specs/`; worktree convention `git worktree add -b feat/<feature-slug>/<NN>-<slice-slug> .claude/worktrees/<NN>-<slice-slug> main`; main axial checkout `D:/axial` for any corpus pass; calls `safe-pr` and (conditionally) `review`/`safe-cleanup`. |
| `tdd-ci` | Write/validate a GitHub Actions CI workflow (unit + acceptance, Playwright for web / pytest for non-web) once a slice is green locally. | `references/github-actions-guide.md` + `assets/workflows/{python-ci.yml,node-ci.yml,playwright-e2e.yml}` (bundled/copied); writes to `.github/workflows/` in the axial repo (not part of `.claude/`); repo's default stack assumed as **Python 3.13 + uv + pytest**; references `red-green-refactor`'s `references/test-strategy.md` for non-default-stack detection; branch-protection change via `gh api` requires separate founder approval. |
| `tdd-plan` | Decompose a feature into thin vertical slices, write execution plans under `plans/`. Phase 1 of the harness. | `references/slicing-guide.md` + `assets/plan-template.md` (bundled/copied); writes `plans/<feature-slug>/README.md` + per-slice `.md` files in the axial repo; each plan links to a GitHub issue (filed later by `sprint-plan`). |
| `triage` | Thin entry point dispatching the `triage` role subagent to scope/groom backlog items. | Relies on the `triage` agent (already copied); GitHub plugin's issue tools; feeds into `sprint-plan`'s draft-then-approve flow. |

Common thread: nearly every skill assumes axial's own root-level conventions — `specs/`, `plans/`,
`tests/`, `src/`, `docs/tdd-evidence/`, `.github/workflows/`, `CLAUDE.md`, and a `uv`+`pytest`+
`ruff` Python 3.13 toolchain — none of which live under `.claude/` and none of which were copied
by this task (per instructions, only named here for the orchestrator).

---

## Process metrics tooling (`tools/`)

### `axial-watch.py` — live operator dashboard for a running pipeline sweep

- **What it measures:** Tails a running pipeline's `console.log` incrementally (byte-offset
  resume, so a 50MB log costs one scan at startup) and derives a live terminal dashboard covering:
  - **Brief-level progress**: per-brief status (`starting`/`OK`/`FAIL`/`SKIP`) parsed from
    `sweep: <brief> draw <n> <status> (<secs>s): <reason>` log lines; a progress bar
    (done/failed/in-flight out of a hardcoded total of 30), mean seconds/brief, and an ETA
    computed as `remaining * mean / max(1, in-flight-count)`.
  - **Gate scoring**: `sweep: <brief> gate '<name>' ... passed=<bool>` lines, aggregated into
    pass/fail counts per gate.
  - **Retrieval turns**: `retrieve: turn <n>/<total> called '<tool>', <n> result` lines — current
    turn, last tool called, per-tool call counts, and a running total of retrieval results
    (explicitly labeled "run total, not per-brief" because concurrent workers interleave and
    per-brief attribution isn't recoverable from the log).
  - **Interrogation/synthesis state**: current case name, disposition, synthesis lens, evidence
    count, and a rolling list of claims-per-brief (last 8 shown, with a mean).
  - **LLM call telemetry**: parses `llm_call_response pass=... model=... outcome=... status=...
    elapsed=...s ... total_tokens=...` lines into a 4000-entry rolling deque; computes
    calls/minute and mean latency over a trailing 60-second window, cumulative tokens by model,
    and estimated USD spend via a **hardcoded price table** (`$/1k tokens, blended in/out`):
    `deepseek/deepseek-v4-pro=0.00065`, `deepseek/deepseek-v4-flash=0.00015`,
    `z-ai/glm-5.2=0.0016` — noted in-code as mirroring `llm.PRICE_TABLE_USD_PER_1K` in the axial
    source, i.e. this table can drift out of sync with the real one and is a portability/staleness
    risk.
  - **Errors/retries**: counts of `llm_retry` events and non-`received`/non-200 outcomes.
  - **Live OS processes**: shells out to `powershell.exe -Command "Get-CimInstance Win32_Process |
    Where-Object {$_.ExecutablePath -like '*axial*\.venv\*'}"` to list currently-running processes
    matching the axial venv path — a **Windows-only, PowerShell-only** mechanism.
- **Invocation:** `uv run python .claude/tools/axial-watch.py [<log-dir>] [--interval N]` (auto-
  picks the newest `data/logs/*/console.log` dir if none given).
- **Where it writes output:** Nowhere persistent — it is a live, ANSI-colored terminal redraw loop
  (clears screen each tick via `ESC[H ESC[2J`) reading `data/logs/<run>/console.log` and writing
  only to stdout/stderr. It is explicitly documented as read-only and never writes to `data/`.
- **Output schema:** None (no file/JSON emitted) — purely an interactive terminal view. Internal
  in-memory `State` dataclass fields (not persisted) are: `ok: dict[brief, seconds]`,
  `fail: dict[brief, reason]`, `started: list[brief]`, `gates: dict[brief, dict[gate, passed]]`,
  `turn: (cur, total) | None`, `last_tool: (name, n) | None`, `tool_counts: Counter`,
  `results_total: int`, `case/disposition/lens: str`, `evidence: int`, `claims: list[int]`,
  `repairs: int`, `calls: deque[(ts, model, elapsed)]`, `tokens_by_model: Counter`,
  `errors: Counter`, `retries: int`, `events: deque[(ts, str)]`.

### `run-monitor.py` — hang/liveness monitor for long-running detached corpus passes

- **What it measures:** Detects whether a long-running detached `axial run <pass>` worker (stage-4
  passes running for hours) is healthy, suspect, or stalled, using three independent signals that
  must **all** be flat before declaring `STALLED`:
  1. **CPU** — sums `cpu_percent()` across live `axial run` worker processes (found via `psutil`,
     matching argv token `axial` immediately followed by `run` — deliberately not substring
     matching, since the repo path `D:\axial` makes every process's argv contain "axial", which an
     earlier version matched incorrectly). Also collapses the `uv run axial run <pass>` process
     chain to leaves only (drops parents of matched processes) so one real worker isn't counted
     3x.
  2. **Checkpoint growth** — counts lines/files under a per-pass glob from a hardcoded map
     `PASS_CHECKPOINTS`: `tag→data/tags/*.jsonl` (per chunk), `xref→data/xref/*.jsonl` (per
     chunk), `vault-write→data/xref/*.jsonl` (per chunk via xref), `artifacts→data/artifacts/*.jsonl`
     (per artifact), `extract→data/source_meta/*.json` (per source — needs a higher stall
     threshold), `envelope→data/envelopes/*.json` (per source), `chunk→data/chunks/*.jsonl` (per
     source). Also tracks newest-write age across those files.
  3. **Log byte growth** — size of `*.log` files under the given `--run-dir`.
  Also reports the ledger row count across `data/run/ledger*.tsv` files (header row excluded).
  Default stall threshold is **2400 seconds** (`DEFAULT_STALL_SECONDS`), documented as set above
  the slowest measured single source (2168s, referencing "the #272 xref rollout" — an axial-
  specific historical incident).
- **Invocation:**
  `uv run python .claude/tools/run-monitor.py --pass <name> [--run-dir <data/logs/RUN>] [--watch |
  --once] [--interval N] [--stall-seconds N]`. `--once` is meant for a Claude session to get one
  snapshot; `--watch` is a human-refreshing dashboard.
- **Where it writes output:** Nowhere persistent — prints a formatted text report to stdout (and
  clears the screen each refresh in `--watch` mode via `os.system('cls'|'clear')`). No file is
  written by this tool.
- **Output schema:** No structured/JSON schema — plain text report with fixed sections: header line
  (`axial run monitor | <timestamp> | pass=<name> (<granularity note>)`), worker count + total CPU%,
  a table of `PID / WORKER label / CPU% / RSS MB / ELAPSED` per live worker, checkpoint
  line/file counts (+ delta since last poll), ledger row/file counts, last-write age, log byte
  delta, and a final `STATUS` line: `IDLE` (no workers), `*** STALLED ***` (all three signals
  flat), `SUSPECT` (writes cold + CPU idle but growth signal not yet confirmed), or `HEALTHY`.
  Internally: `Worker(pid, cmdline, cpu, rss_mb, elapsed, label)` and
  `Snapshot(pass_name, workers, ledger_rows, ledger_files, checkpoint_lines, checkpoint_files,
  newest_write_age, log_bytes)` dataclasses, not persisted anywhere.
- **Portability note:** `REPO = Path(__file__).resolve().parents[2]` hardcodes a **3-levels-up**
  relationship (`.claude/tools/run-monitor.py` → repo root), i.e. it silently breaks if this
  file's location relative to the repo root changes. Also depends on the optional `psutil`
  package (degrades gracefully — CPU/process columns disabled — if not installed).

### `snapshot-harness.py` — offsite backup/version-history mirror for the gitignored `.claude/` dir

- **What it measures/does:** Not a metrics tool in the same sense as the two above — it's an
  operational **backup mechanism**. `.claude/` and `CLAUDE.local.md` are gitignored in the main
  axial repo (kept private, "developed toward a future plugin" per the in-code comment), so this
  script mirrors them into a **separate sibling git repository** to give the harness configuration
  its own commit history and offsite backup, since otherwise the rules governing every agent
  session would have zero version history or rollback capability.
- **How it measures "change":** A byte-for-byte mirror (`shutil.copy2`) of `.claude/` (excluding
  `.git`, `__pycache__`, `worktrees` dirs, `*.pyc`/`*.log` files, and the file named
  `settings.local.json` specifically — the last is excluded because it's "machine-local permission
  state, not harness definition" and is dropped by a global gitignore rule already) into the
  target repo, pruning any file in the target that's no longer wanted, then commits with message
  `snapshot: harness @ <UTC timestamp> (<N> file(s) changed)` and (unless `--no-push`) pushes to
  `origin/main` if a remote is configured. It counts and reports the number of files changed per
  run.
- **Invocation:** `uv run python .claude/tools/snapshot-harness.py [--target DIR] [--no-push]`.
- **Where it writes output:** To a **separate git repository** — by default
  `../axial-harness` (a sibling directory of the axial project root) or the path in the
  `AXIAL_HARNESS_REPO` environment variable if set. This is a **hardcoded relative-sibling default
  path**, not a path under `.claude/` itself (by design — nesting a repo inside `.claude/` would
  break `git rev-parse --show-toplevel` and silently defeat the `path-guard.ps1` role fence, per
  the in-code comment referencing issue #271). On first run it `git init -b main`s the target and
  writes a `README.md` there explaining the mirror's purpose.
- **Output schema:** Not JSON/structured — it's a full mirrored **file tree** (the entire
  `.claude/` directory structure plus `CLAUDE.local.md`) committed as a normal git repo; the
  "schema" is git commit history itself, one commit per snapshot run, each tagged with a UTC
  timestamp and changed-file count in the commit message.
- **Guardrails noted in-code:** Refuses to run if `--target` resolves to the project directory
  itself or an ancestor of it (`target == project or project in target.parents`). Explicitly warns
  future editors never to inline a literal `git commit` string into a shell command run by an
  agent, because `commit-gate.ps1`'s regex would match it and misattribute the commit to the
  harness-mirror repo (which has no `src/`), blocking it.

---

## External dependencies not copied

Named for the orchestrator's later decision — not copied under this task's scope (destination is
`.claude/` only):

| Reference | Where referenced | Absolute path (axial repo) |
|---|---|---|
| `specs/` (spec sections) | `builder`, `spec-author`, `fix`, `red-green-refactor`, `review`, `sprint-plan`, `sprint-start` | `D:\axial\specs\` |
| `plans/<feature-slug>/` (slice plans + issue drafts) | `red-green-refactor`, `tdd-plan`, `sprint-plan`, `sprint-start`, `safe-cleanup` | `D:\axial\plans\` |
| `tests/<subproject>/` (outer acceptance tests) | `red-green-refactor`, `tdd-ci`, `safe-pr` | `D:\axial\tests\` |
| `src/**/test_*.py` (inner unit tests) | `red-green-refactor` | `D:\axial\src\` |
| `docs/tdd-evidence/<feature>/<NN-slice>/` (PR evidence) | `safe-pr` | `D:\axial\docs\tdd-evidence\` |
| `.github/workflows/` (CI workflow files) | `tdd-ci` | `D:\axial\.github\workflows\` |
| `CLAUDE.md` (handbook / conventions / Developer Principles) | `builder`, `reviewer`, `spec-author`, `triage`, `review` | `D:\axial\CLAUDE.md` |
| `CLAUDE.local.md` | `snapshot-harness.py` (mirrored alongside `.claude/`) | `D:\axial\CLAUDE.local.md` |
| `data/logs/<run>/console.log`, `data/vault/`, `data/tags/`, `data/xref/`, `data/artifacts/`, `data/source_meta/`, `data/envelopes/`, `data/chunks/`, `data/run/ledger*.tsv` | `axial-watch.py`, `run-monitor.py`, `session-status.ps1`, `settings.local.json` allowlist | `D:\axial\data\` (all gitignored / runtime data, not source) |
| `llm.py`, `cli.py`, config-loading modules (named as "high blast radius" examples) | `review` skill, `sprint-start` | `D:\axial\src\...\llm.py`, `...\cli.py` |
| `llm.PRICE_TABLE_USD_PER_1K` | `axial-watch.py` (its own price table claims to mirror this) | somewhere in `D:\axial\src\` |
| GitHub repo (issues/PRs/labels system of record) | `sprint-plan`, `sprint-start`, `triage`, `session-status.ps1`, `safe-cleanup`, `safe-pr` | remote `origin` on GitHub, resolved via `gh` / `git remote -v` |
| `axial-vault-hold` (sibling scratch dir for a vault data move) | `settings.local.json` allowlist only | `D:\axial-vault-hold\` (sibling of `D:\axial`) |
| `D:\axial-vault-query` (a separate, apparently sibling project) | `settings.local.json` allowlist (one `Bash(cd /d/axial-vault-query && ...)` entry) | `D:\axial-vault-query\` |
| `../axial-harness` / `$AXIAL_HARNESS_REPO` (offsite harness mirror repo) | `snapshot-harness.py` | `D:\axial-harness\` (sibling, default) |

---

## Portability blockers

Every hardcoded absolute path, Windows/PowerShell assumption, or axial-specific name found in the
copied files:

| File | Line(s) | Blocker |
|---|---|---|
| `settings.local.json` | 19–20 | Hardcoded absolute path `D:/axial` in two allowlisted Bash patterns: `git -C D:/axial fetch origin`, `git -C D:/axial pull`. |
| `settings.local.json` | 4–13 | Allowlist entries reference a sibling dir `../axial-vault-hold` and a project `D:/axial-vault-query` — axial-specific, non-portable. |
| `skills/fix/SKILL.md` | 28 | Hardcoded reference: "any corpus check runs in `D:/axial`" (the main checkout, since worktrees lack `data/`). |
| `skills/sprint-start/SKILL.md` | 39 | Same hardcoded pattern: "runs in the main checkout `D:/axial`, never there." |
| `tools/run-monitor.py` | 94 | Comment states "the repo lives at D:\\axial" as the reason substring-matching on process argv is unsafe — logic itself is portable, but the justifying comment is axial/Windows-specific. |
| `tools/snapshot-harness.py` | 93 | Default target path assembled as `project.parent / "axial-harness"` — i.e., a sibling directory literally named `axial-harness`; overridable via `AXIAL_HARNESS_REPO` env var but the fallback name is axial-specific. |
| `tools/snapshot-harness.py` | 155 | Non-blocker false-positive: `"push failed:\n"` matched the `D:` grep only because of `\n` in the string; no actual path there. |
| All 5 `hooks/*.ps1` | throughout | Written in **Windows PowerShell** and invoked via `powershell -NoProfile -ExecutionPolicy Bypass -File ...` in `settings.json` — will not run as-is on macOS/Linux without a PowerShell Core install or a full rewrite to POSIX shell/Python. |
| `hooks/commit-gate.ps1`, `hooks/block-merge.ps1`, `hooks/session-status.ps1` | multiple (e.g. commit-gate.ps1:62-63, block-merge.ps1:56-63) | All three contain explicit MSYS/Git-Bash path normalization (`/d/axial-wt/x` → `d:/axial-wt/x`) — a Windows-only concern baked into the logic, not just comments. |
| `hooks/commit-gate.ps1` | 105–107 | Hardcoded test/lint commands assume the **axial stack specifically**: `uv run pytest src -q -m "not slow" -n auto`, `uv run ruff check .` — i.e., Python 3.13 + `uv` + `pytest` + `ruff`. Any other stack requires rewriting this gate. |
| `hooks/format.ps1` | 9 | Hardcoded formatter invocation `uv run ruff format $filePath` — Python/`uv`/`ruff`-specific; a non-Python project needs a different formatter hook. |
| `tools/axial-watch.py` | 24 | Hardcoded relative path `Path("data/logs")` — assumes the tool is always invoked from the axial repo root. |
| `tools/axial-watch.py` | 47–51 | Hardcoded `PRICE` dict of per-model USD/1k-token rates (`deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash`, `z-ai/glm-5.2`) — axial-specific model choices and pricing that will silently drift/mismatch if reused elsewhere. |
| `tools/axial-watch.py` | 166–184 | `procs()` shells out to Windows-only `powershell.exe -Command "Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -like '*axial*\.venv\*'}"` — both Windows-only and axial-path-pattern-specific (`*axial*\.venv\*`). |
| `tools/axial-watch.py` | 264 | Hardcoded `total = 30` briefs assumed for the progress bar — a magic constant tied to axial's current sweep size, not derived dynamically. |
| `tools/run-monitor.py` | 35 | `REPO = Path(__file__).resolve().parents[2]` — hardcodes the tool's location exactly 3 directories below the repo root (`.claude/tools/`); moving the file breaks this. |
| `tools/run-monitor.py` | 39–47 | `PASS_CHECKPOINTS` dict hardcodes axial's own pipeline stage names and `data/` subpaths (`tag`, `xref`, `vault-write`, `artifacts`, `extract`, `envelope`, `chunk`) — entirely pipeline-specific, not reusable for a different project without a rewrite. |
| `tools/run-monitor.py` | 52 (`DEFAULT_STALL_SECONDS = 2400`) | Threshold justified in-comment by a specific historical axial incident ("#272 xref rollout", 2168s) — a magic number tuned to this one pipeline's observed behavior. |
| `hooks/session-status.ps1` | 56–70, 73–86, 89–100 | Depends on the `gh` CLI being installed, authenticated, and pointed at a GitHub remote; silently degrades to "unavailable" text if not, so functionally portable but practically GitHub-specific. |
| `skills/safe-pr/SKILL.md`, `skills/safe-cleanup/SKILL.md`, `skills/sprint-plan/SKILL.md`, `skills/tdd-ci/SKILL.md` | throughout | All assume `gh` CLI + a `github.com` remote (`safe-pr` explicitly notes GitHub Enterprise hosts are "not auto-detected" in `collect-evidence.mjs`, e.g. line 204). |
| `skills/fix/SKILL.md`, `skills/sprint-start/SKILL.md` | worktree commands | Both hardcode the branch/worktree naming convention against `main` specifically (`git worktree add -b feat/<...> .claude/worktrees/<...> main`) — not parameterized for repos using `master`/`develop` as their default branch (though `classify-branches.mjs` itself does auto-detect the base branch generically). |
| `hooks/commit-gate.ps1` | 73–83 | Hardcodes the protected branch name literally as `'main'` — a repo using `master` as default would need this hook edited. |

---

## Redactions

None. No API keys, tokens, passwords, or private-key material were found in any of the 36 copied
files. `settings.local.json`'s `permissions.allow` list contains only Bash command *patterns*
(paths, flags, `git`/`uv`/`powershell.exe` invocations) with no embedded credentials.
`skills/safe-pr/scripts/collect-evidence.mjs` itself implements a secret-scanner (patterns for
Bearer tokens, AWS keys, PEM private-key blocks, Slack/GitHub tokens, assigned
`key=value`-style credentials) used at PR-evidence-collection time — those are detection patterns
in the tool's own source, not actual secret values, and were left as-is (not applicable to
redact).
