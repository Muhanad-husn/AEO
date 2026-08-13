# Source inventory

What was copied into `source/`, where it came from, and what is missing. Assembled from
the seven per-source manifests in [`source/_manifests/`](../source/_manifests/).

**Total: 556 files, 2,648,377 bytes (2.5 MB). All 556 tracked in git.**

| Destination | Files | Bytes | Copied from | Manifest |
| --- | ---: | ---: | --- | --- |
| `source/global-skill/` | 19 | 147,511 | `~/.claude/skills/agentic-engineering-org/` + 2 plugin deps | [01](../source/_manifests/01-global-skill.md) |
| `source/global-workspace/` | 185 | 349,961 | `~/.claude/skills/agentic-engineering-org-workspace/` | [02](../source/_manifests/02-global-workspace.md) |
| `source/axial/` | 66 | 599,418 | `D:\axial\` — `.claude/`, selected `docs/`, root files | [03](../source/_manifests/03-axial-claude.md), [04](../source/_manifests/04-principles-and-metrics.md) |
| `source/eval-tooling/` | 21 | 237,004 | `skill-creator` plugin (marketplace copy) | [05](../source/_manifests/05-eval-tooling.md) |
| `source/global-claude/` | 3 | 1,337 | `~/.claude/` CLAUDE.md + settings | [04](../source/_manifests/04-principles-and-metrics.md) |
| `source/v1-archive/` | 174 | 596,641 | The pre-v2 harness, recovered from the recycle bin | [06](../source/_manifests/06-v1-archive.md) |
| `source/plugin-format/` | 43 | 314,895 | `~/.claude/plugins/marketplaces/claude-plugins-official/` | [07](../source/_manifests/07-plugin-format.md) |
| `source/upstream-red-green-refactor/` | 38 | 300,120 | `github.com/brainqub3/red-green-refactor` @ `593e7ab` (MIT, © john-adeojo) | [DECISIONS D2](DECISIONS.md) |
| `source/_manifests/` | 7 | 101,490 | Written during the copy | — |

## What each source contributes

**`global-skill/`** — the artifact being generalized. `SKILL.md` (33 KB) plus five
references (`agents`, `hooks`, `harness-and-sprint`, `directory-tree`,
`claude-md-handbook`) and `evals/evals.json`. Two plugins it names are vendored under
`_deps/`: `github` (a thin remote-MCP declaration) and `pr-review-toolkit` (cited as
design lineage).

**`axial/dot-claude/`** — the matured implementation, and the most load-bearing source
here. Four role agents (builder, reviewer, spec-author, triage), five PowerShell hooks,
ten skills, three Python tools.

Hook wiring, from `settings.json`:

| Event | Matcher | Script | Enforces |
| --- | --- | --- | --- |
| SessionStart | — | `session-status.ps1` | Injects branch/issue/PR state; never blocks |
| PreToolUse | Bash | `commit-gate.ps1` | Blocks commits on `main` (except docs-only); blocks commit when pytest or ruff is red |
| PreToolUse | Bash, GitHub merge tools | `block-merge.ps1` | Blocks subagent merge, push-to-main, branch delete |
| PreToolUse | Edit\|Write | `path-guard.ps1` | Blocks role subagents writing into `.claude/` |
| PostToolUse | Edit\|Write | `format.ps1` | Runs `ruff format`; never blocks. **Not ported** — [D13](DECISIONS.md) |

Each role agent re-declares `path-guard` and `block-merge` in its own frontmatter as
defence-in-depth against a known Claude Code frontmatter-hook bug. That second layer is
impossible in a plugin (C-01).

**Process-metrics tooling** (`axial/dot-claude/tools/` and `axial/docs/_found/src/`):

| Mechanism | What it measures | Output |
| --- | --- | --- |
| `axial-watch.py` | Live per-brief status/ETA, gate pass/fail, retrieval turns, LLM latency/tokens/cost | stdout only, no persistence |
| `run-monitor.py` | Hang detection: CPU%, checkpoint growth, log growth → HEALTHY/SUSPECT/STALLED | stdout only |
| `snapshot-harness.py` | Not metrics — mirrors the gitignored `.claude/` into a sibling git repo so the harness has history | `../axial-harness` |
| `runlog.py` | The run-logging seam | `run.jsonl`, `console.log`, `summary.md` |
| `run.py` | Corpus-wide pass runner with resume ledger | ledger + run logs |
| `run_report.py` | Per-brief run report | report file |
| `docs/tdd-evidence/` | Pytest evidence trail, 61 feature dirs / 191 files | described only, not copied |

**`v1-archive/`** — the pre-v2 harness recovered from the recycle bin, from a *different
product*: a web app with a map frontend, a Playwright e2e layer and a Node/Python split.
The only non-Python instance of this harness that exists, which makes it primary evidence
for the generalization. It holds two things present nowhere else: **`hooks/lib.ps1`**, the
shared hook library v2 lost (V-13), and **`hooks/tests/`**, the only gate tests that exist.
Also six slash-command lanes (V-15) and a committed `VENDORED.md` + `UPSTREAM-LICENSE`
(V-14).

**`plugin-format/`** — three official plugins as format references. `example-plugin` is
the canonical minimal layout. `pr-review-toolkit` is the closest structural analogue to
our role roster, and its six specialists are candidate optional reviewer lenses.
**`hookify` is the one that matters**: it ships gates through `hooks/hooks.json` with
`${CLAUDE_PLUGIN_ROOT}` and per-hook timeouts — the precedent for our own wiring. Its
`python3` invocation is the precedent we do **not** follow ([D8](DECISIONS.md)).

**`global-workspace/`** — the measurement history. Two things live here: skill-trigger
accuracy (`probe.json`, `trigger-eval*.json`, `trigger-validation.*`, `trigger-opt/`) and
scaffold grading (`grade_repo.py`, 170 lines, 9–11 deterministic checks). `benchmark.json`
records the skill's measured value: **with_skill pass_rate 1.0 vs without_skill 0.27–0.45**
in iteration-2. That is the number Phase 2 must reproduce against the plugin.

**`eval-tooling/skill-creator/`** — the orchestrator that produced the workspace data. The
workspace holds the grader but not the runner, so it was pulled in separately.

| Script | Produces |
| --- | --- |
| `run_eval.py` | `trigger-validation.json`-shaped output |
| `improve_description.py` | `trigger-opt/<ts>/logs/improve_iter_N.json` |
| `aggregate_benchmark.py` | `benchmark.json`, `benchmark.md` |
| `generate_review.py` | `review.html`, or `feedback.json` via server POST |
| — hand-authored — | `grading.json`, `eval_metadata.json`, `probe.json`, `trigger-eval.json` |

**Principles** — `axial/root/CLAUDE.md` lines 23–36 ("Developer principles") and 44–62
("Answering the founder"); `axial/root/CLAUDE.local.md` lines 55–75 ("Build philosophy",
the same four principles with worked examples), 12–20 ("two rules"), 123–129 ("Run logging"
mandate). The global `~/.claude/CLAUDE.md` "Core Principle" is consistent with production's
"specs are living documentation, not law". No contradictions found. The active subset is
restated in [`CLAUDE.md`](../CLAUDE.md).

## Gaps and open questions

1. **`package_skill.py` cannot build a plugin.** It packages a bare skill folder into a
   `.skill` zip with no `.claude-plugin/plugin.json` awareness. Closed by
   [D3](DECISIONS.md): we write our own.
2. **Grading is not reproducible from the copy alone, and is about to be wrong anyway.**
   `grade_repo.py` grades the `ai-enterprise-template` scaffold specifically — a
   `.claude/{agents,skills,hooks}` tree the plugin will no longer produce, so every check
   fails by design after migration. `grading.json` is hand-authored per the skill-creator
   workflow; no script generates it. Owned by Phase 2's measurement slice.
3. **The eval pipeline shells out to `claude -p`** and must run from inside
   `skills/skill-creator/` because of module-style imports. Running it from `D:\AEO` needs
   a wrapper.

## Portability blockers for plugin packaging

Each is cited with file and line in its manifest. Every one now has an owner.

| Blocker | Owner |
| --- | --- |
| All five hooks are Windows PowerShell only, with MSYS path normalization baked in. No POSIX implementation exists | [D8](DECISIONS.md) · Phase 1 |
| Hook invocation hardcoded to `powershell -NoProfile -ExecutionPolicy Bypass -File`, from a finding pinned to Claude Code 2.1.201 | [D8](DECISIONS.md) · C-05 |
| The Python/`uv`/`pytest`/`ruff` toolchain is hardcoded into `commit-gate.ps1`, `format.ps1` and the directory-tree skeleton | [D10](DECISIONS.md) · P1.3 |
| Absolute paths: `D:/axial`, `D:/axial-vault-query`, `../axial-vault-hold` in `settings.local.json`; `D:\proj-xref` / `D:\proj` in worked examples; `D:/eval-scratch/…` in `evals/evals.json` | Phase 2 |
| `run-monitor.py` uses `REPO = parents[2]` and an Axial-specific stage map; `axial-watch.py` carries a hardcoded price table and shells out to `powershell.exe Get-CimInstance` | Phase 3 · V-10 |
| The GitHub MCP tool namespace (`mcp__plugin_github_github__…`) is hardcoded from one observed install | [D14](DECISIONS.md) · P1.2 |
| Multiple skills assume `main` as the default branch and `gh`/GitHub as the forge | [D14](DECISIONS.md) · P1.2 |
| `directory-tree.md` hardcodes the example repo name `ai-enterprise-template` and states a GitHub Pro tier assumption as settled fact | Phase 6 |

## Deliberately not copied

| Left behind | Reason |
| --- | --- |
| `axial/.claude/worktrees/` | Live git worktree with a full `.venv` |
| `axial/docs/tdd-evidence/` | 191 process-output artifacts; structure described in manifest 04 |
| `axial/docs/academic/`, `sim-academic/`, `eval/`, `exploration/` | Research domain content, not engineering process |
| `axial/data/`, `.venv/`, caches | Bulk and binary |
| `axial/secrets/` | Secrets policy |
| Axial product specs, CHARTER, experiments, config, scratchpad | Domain-specific to Axial |
| v1's binary evidence blobs (`.png`, `.webm`, Playwright HTML reports) | Bulk; all `.txt` and `.json` evidence kept |
| `~/.claude/.credentials.json` | Never touched |

No secrets were copied. Across all seven copies the only finding was a placeholder token
(`ghp_example_replace_me`) in captured eval data, which is not a real credential. Zero
redactions were required.

## Snapshot integrity notes

- **The two `.claude/` directories under `source/` were renamed to `dot-claude/`** —
  `source/axial/` and `source/upstream-red-green-refactor/`. Claude Code discovers
  directory-scoped skills from any `<dir>/.claude/skills/`, so the frozen snapshot was
  loading **sixteen skills into every session in this repo**, competing for triggers and
  spending context on material that is reference, not product. Worse, one of them
  (`safe-pr`) shells out to `uv run pytest`. The rename changes no file bytes and git
  tracked it as a pure rename, so verbatim fidelity is intact. Any future `.claude/`
  copied under `source/` needs the same treatment. The eight `.claude/` directories inside
  `global-workspace/` eval outputs contain no `skills/` and were left alone.
- `.gitattributes` sets `source/** -text` so git performs no line-ending normalization on
  the copies. Without it, `core.autocrlf` would rewrite LF to CRLF and the snapshot would
  no longer be byte-identical to its originals.
- `source/axial/root/.gitignore` is a **copy** of Axial's ignore file, but git treats it as
  a live nested rule in this repo. It suppressed three verbatim files — `CLAUDE.local.md`,
  `PR_BODY.generated.md`, `.tdd-branch-cleanup.log`. They were committed with `git add -f`
  rather than by editing the copied ignore file, which would have broken fidelity. Any
  future file added under `source/axial/root/` may need the same treatment.
- `source/upstream-red-green-refactor/.gitattributes` is likewise a **copy** that git
  treats as live, and it sets `* text=auto`. Nested attributes files win over the root, so
  `source/** -text` cannot suppress it and git normalizes that subtree to LF. This is
  harmless: the round-trip (upstream stores LF → clone writes CRLF into the working tree →
  we commit LF) lands on upstream's own bytes. Verified by comparing blob hashes against
  the source repo — `SKILL.md`, `tdd-harness/SKILL.md` and `README.md` all match `593e7ab`
  exactly. Preserving the CRLF working-tree artifact would have been *less* faithful.

## Publish disposition

Recorded for [#98](https://github.com/Muhanad-husn/AEO/issues/98), which asks whether
`source/` can be published when the repository goes public. Every directory below was
opened and read before it was dispositioned. The full reasoning, including what was
checked against GitHub rather than assumed, is in
[`logs/2026-08-13-issue-98-disclosure-review/summary.md`](../logs/2026-08-13-issue-98-disclosure-review/summary.md).

**The finding that governs the rest: the two products this snapshot is drawn from are
already public.** `github.com/Muhanad-husn/axial` and `github.com/Muhanad-husn/Zij` are
both public repositories under the founder's own account, and Zij's README openly
describes the product and states that it is archived. Issue #98's premise — that
`source/axial/` holds "a private project's internals" — was out of date when it was
written. What remains is the narrower question of which files here are *not* already
public, and that set is engineering process only.

| Directory | Disposition | Reason |
| --- | --- | --- |
| `source/global-skill/` | **Publishable** | The founder's own skill, and the artifact this plugin generalizes. Its two vendored dependencies are official Anthropic plugins under Apache-2.0 with their licence files intact |
| `source/global-workspace/` | **Publishable** | Not private work. Zero references to axial, Zij, or any real product — the eval outputs grade a synthetic `ai-enterprise-template` scaffold. The only credential-shaped string is the placeholder already recorded below. Local paths under `D:\eval-scratch` are the only residue |
| `source/axial/` | **Publishable** | Mixed, and the split matters. The product is public; the table below says which files are and are not already on `axial`'s default branch. Everything in the not-public half is engineering process — agents, hooks, skills, slice plans, a branch-cleanup log. No credentials, no corpus content, no third-party data. The operational numbers a reader might consider sensitive (the 69% waste share, the moderation-refusal exposure, the model-tier decision) are published by the founder himself in `axial/docs/postmortem/gold-run-2026-07/`. **One licence caveat applies — see below** |
| `source/eval-tooling/` | **Publishable** | The official `skill-creator` plugin, Apache-2.0, licence file present |
| `source/global-claude/` | **Publishable** | Three files, 1,337 bytes. The `CLAUDE.md` is a single paragraph of general engineering principle, cited by manifest 04 as principles lineage. `settings.json` discloses an enabled-plugin list, `effortLevel`, a `D:\AEO` marketplace path, and `skipDangerousModePermissionPrompt`. That last is a local interface preference and grants a reader nothing, but it is the one line in `source/` that describes the founder's own security posture rather than the work |
| `source/v1-archive/` | **Publishable** | The largest genuinely-new disclosure here, and #98 did not name it. 174 files of Zij's v1 harness plus 74 pytest evidence transcripts, none of it on public Zij — it was recovered from the recycle bin, not from the repository. The product it belongs to is public and self-described; what this adds is the internal build record of a project the founder publicly archived. Evidence transcripts contain local paths including `C:\Users\mou97\AppData\Local\Temp`. **The same licence caveat applies** |
| `source/plugin-format/` | **Publishable** | Three official Anthropic plugins plus the public marketplace catalogue. Apache-2.0, licence file with each plugin |
| `source/upstream-red-green-refactor/` | **Publishable** | MIT, © john-adeojo, `LICENSE` shipped alongside. The upstream obligation was already met at copy time ([D2](DECISIONS.md)) |
| `source/_manifests/` | **Publishable** | The provenance record, and the reason every disposition above could be checked. Its source paths carry the founder's Windows account name (`C:\Users\mou97\`) on most lines. That is an OS account name, not a credential, and the founder's GitHub identity is public already; redacting it would break the verbatim rule and destroy the record's value |

Nothing is dispositioned **redact** or **drop**.

### What is not already public

Checked file by file against each repository's default branch through the GitHub API.

| Path under `source/` | Public counterpart | Status |
| --- | --- | --- |
| `axial/dot-claude/` (33 files) | `axial/.claude/` is gitignored; its history lives in `Muhanad-husn/axial-harness`, which is **private** | Not public |
| `axial/root/CLAUDE.local.md` | Gitignored in axial | Not public |
| `axial/root/PR_BODY.generated.md` | Gitignored in axial | Not public |
| `axial/root/.tdd-branch-cleanup.log` | Gitignored in axial | Not public |
| `axial/docs/_found/` | Not at axial's HEAD | Not public at HEAD |
| `axial/docs/phase-a-rerun-2026-07-24.md` | Not at axial's HEAD | Not public |
| `v1-archive/` (all 174 files) | Zij's `.claude/`, `plans/` and `docs/tdd-evidence/` are absent from the public repo | Not public |

Already public, and therefore not a disclosure at all: `axial/root/README.md`,
`axial/root/CLAUDE.md`, `axial/docs/DECISIONS.md`, the whole
`axial/docs/postmortem/gold-run-2026-07/` folder, `axial/root/pyproject.toml`,
`axial/root/.github/workflows/ci.yml`.

### The licence caveat

The root `LICENSE` is MIT, matching what `package.json` declares. It covers AEO's own
work. It does not resolve the licence layering underneath `source/`, and adding it does
not create a conflict so much as leave one unstated:

- `source/axial/` is copied from a repository published under **PolyForm Noncommercial
  1.0.0**, not MIT.
- `source/v1-archive/` is copied from Zij, which is public with **no licence file at
  all** — that is all rights reserved.
- `source/upstream-red-green-refactor/`, `source/plugin-format/`,
  `source/eval-tooling/` and `source/global-skill/_deps/` each carry their own
  third-party licence (MIT and Apache-2.0), which a root MIT would nominally sweep.

The founder authored both axial and Zij and may relicense his own work at will, so nothing
here is an infringement. It is a **statement** problem: a bare root MIT would represent
terms for those trees that their upstream licences do not grant. A one-paragraph scope
note saying the licence covers AEO's own work and that `source/` is a vendored snapshot
under its own terms would close it. That note is now in the root
[`LICENSE`](../LICENSE) itself, below the unmodified MIT text.

### History

Nothing found under `source/` needs to be kept out of git history. No credential exists
anywhere in the tree — a fresh sweep for key- and token-shaped strings returned only the
`ghp_example_replace_me` placeholder already recorded above. The one personal identifier
is a Windows account name with no access value. Everything not already public is process
material belonging to two already-public products. **No history rewrite is required
before publishing.**

## Provenance rules

`source/` is a verbatim snapshot. No file content was edited during the copy. Do not edit
it during migration either — changes belong in the plugin tree once that tree exists. The
originals at `~/.claude/` and `D:\axial` remain untouched and are not read at runtime by
anything in this repo.
