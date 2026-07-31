# Manifest 01 — global-skill: `agentic-engineering-org`

Copied the global Claude Code skill `agentic-engineering-org` verbatim, plus the
two small external plugin dependencies it names by reference, into
`D:\AEO\source\global-skill\`. No file contents were edited during copy.

## Files copied

| Destination (relative to `D:\AEO`) | Source (absolute) | Size (bytes) |
|---|---|---|
| `source\global-skill\agentic-engineering-org\SKILL.md` | `C:\Users\mou97\.claude\skills\agentic-engineering-org\SKILL.md` | 32,973 |
| `source\global-skill\agentic-engineering-org\evals\evals.json` | `C:\Users\mou97\.claude\skills\agentic-engineering-org\evals\evals.json` | 3,060 |
| `source\global-skill\agentic-engineering-org\references\agents.md` | `C:\Users\mou97\.claude\skills\agentic-engineering-org\references\agents.md` | 12,001 |
| `source\global-skill\agentic-engineering-org\references\claude-md-handbook.md` | `C:\Users\mou97\.claude\skills\agentic-engineering-org\references\claude-md-handbook.md` | 7,215 |
| `source\global-skill\agentic-engineering-org\references\directory-tree.md` | `C:\Users\mou97\.claude\skills\agentic-engineering-org\references\directory-tree.md` | 3,857 |
| `source\global-skill\agentic-engineering-org\references\harness-and-sprint.md` | `C:\Users\mou97\.claude\skills\agentic-engineering-org\references\harness-and-sprint.md` | 14,513 |
| `source\global-skill\agentic-engineering-org\references\hooks.md` | `C:\Users\mou97\.claude\skills\agentic-engineering-org\references\hooks.md` | 18,076 |
| `source\global-skill\_deps\github-plugin\unknown\.claude-plugin\plugin.json` | `C:\Users\mou97\.claude\plugins\cache\claude-plugins-official\github\unknown\.claude-plugin\plugin.json` | 271 |
| `source\global-skill\_deps\github-plugin\unknown\.mcp.json` | `C:\Users\mou97\.claude\plugins\cache\claude-plugins-official\github\unknown\.mcp.json` | 178 |
| `source\global-skill\_deps\pr-review-toolkit-plugin\unknown\.claude-plugin\plugin.json` | `C:\Users\mou97\.claude\plugins\cache\claude-plugins-official\pr-review-toolkit\unknown\.claude-plugin\plugin.json` | 266 |
| `source\global-skill\_deps\pr-review-toolkit-plugin\unknown\LICENSE` | `...\pr-review-toolkit\unknown\LICENSE` | 11,358 |
| `source\global-skill\_deps\pr-review-toolkit-plugin\unknown\README.md` | `...\pr-review-toolkit\unknown\README.md` | 7,528 |
| `source\global-skill\_deps\pr-review-toolkit-plugin\unknown\agents\code-reviewer.md` | `...\pr-review-toolkit\unknown\agents\code-reviewer.md` | 3,635 |
| `source\global-skill\_deps\pr-review-toolkit-plugin\unknown\agents\code-simplifier.md` | `...\pr-review-toolkit\unknown\agents\code-simplifier.md` | 5,292 |
| `source\global-skill\_deps\pr-review-toolkit-plugin\unknown\agents\comment-analyzer.md` | `...\pr-review-toolkit\unknown\agents\comment-analyzer.md` | 4,925 |
| `source\global-skill\_deps\pr-review-toolkit-plugin\unknown\agents\pr-test-analyzer.md` | `...\pr-review-toolkit\unknown\agents\pr-test-analyzer.md` | 4,560 |
| `source\global-skill\_deps\pr-review-toolkit-plugin\unknown\agents\silent-failure-hunter.md` | `...\pr-review-toolkit\unknown\agents\silent-failure-hunter.md` | 7,807 |
| `source\global-skill\_deps\pr-review-toolkit-plugin\unknown\agents\type-design-analyzer.md` | `...\pr-review-toolkit\unknown\agents\type-design-analyzer.md` | 4,999 |
| `source\global-skill\_deps\pr-review-toolkit-plugin\unknown\commands\review-pr.md` | `...\pr-review-toolkit\unknown\commands\review-pr.md` | 4,997 |

**Totals: 19 files, 147,511 bytes (~144 KB).**

The `pr-review-toolkit` full source path (elided with `...` above for width) is
`C:\Users\mou97\.claude\plugins\cache\claude-plugins-official\pr-review-toolkit`.

Note: each source plugin cache directory also contained a `.in_use\<pid>` folder
of ephemeral session-lock marker files (process IDs, timestamps). These are
Claude Code's own runtime bookkeeping, not plugin content, so they were deleted
from the copies after `Copy-Item` and are correctly absent from the table/totals
above.

## Dependencies referenced by the skill

The skill's `SKILL.md` and its five `references/*.md` files were read in full.
Search covered absolute paths, `~/.claude/...` paths, other skill names, invoked
scripts, and template/asset files. Findings:

| Dependency | Referenced by | Location on disk | Disposition |
|---|---|---|---|
| `references/agents.md`, `references/claude-md-handbook.md`, `references/directory-tree.md`, `references/harness-and-sprint.md`, `references/hooks.md` | `SKILL.md` ("Full skeletons live in `references/`; load the named file when you reach the phase.") | Inside the skill's own tree | Copied as part of the skill tree (step 1) — internal, not an external dependency. |
| GitHub plugin (`mcp__plugin_github_github__…` tool namespace) | `SKILL.md` lines 98, 155–159, 244–246, 316–321; `references/hooks.md` (settings.json matcher `mcp__plugin_github_github__.*(merge\|...)`); `references/agents.md`, `references/harness-and-sprint.md` (issue/PR tools) | `C:\Users\mou97\.claude\plugins\cache\claude-plugins-official\github\unknown\` | **Copied** to `_deps\github-plugin\`. It is a thin remote-MCP declaration only (`.mcp.json` points to `https://api.githubcopilot.com/mcp/`) — no bundled code, 449 bytes total. |
| `pr-review-toolkit` plugin (`code-reviewer`, `pr-test-analyzer` agents) | `references/agents.md` line 215–221 ("the official `pr-review-toolkit` plugin was inspected and **not** reused as the reviewer's base... The plugin's agents stay available as supplementary tools.") | `C:\Users\mou97\.claude\plugins\cache\claude-plugins-official\pr-review-toolkit\unknown\` | **Copied** to `_deps\pr-review-toolkit-plugin\` (~55 KB, all markdown + LICENSE). Referenced by name and inspected for design lineage; also usable as a supplementary tool per the skill text. |
| `brainqub3/red-green-refactor` GitHub repo (the TDD harness to vendor, DEC-6) | `SKILL.md` lines 97, 239, 344; `references/harness-and-sprint.md` lines 3–11 ("Vendor by copy... Clone and copy the `.claude/skills/*` tree in.") | Not found as a pristine standalone checkout anywhere on disk. (See "External references" below — adapted derivatives exist elsewhere but are out of scope.) | **Not copied** — see below. |
| Claude Code docs pages (sub-agents, hooks, discover-plugins) | `SKILL.md` lines 236–239 | Live URLs (`https://code.claude.com/docs/en/...`), not local files | Not applicable — external web docs, no local dependency to copy. |
| `C:\Users\mou97\.claude\skills\agentic-engineering-org-workspace\` | Not actually referenced anywhere in `SKILL.md` or `references/*.md` (it is the skill's own eval/benchmark workspace, generated by external tooling, not read or pointed to by the skill text) | `C:\Users\mou97\.claude\skills\agentic-engineering-org-workspace\` | Per task instructions: **owned by another agent, not copied.** Confirmed by inspection: contains `iteration-*/`, `benchmark.json`, `trigger-opt/` — skill-authoring/eval tooling output, unrelated to what the skill's own text references. |

## External references that could not be resolved

- **`brainqub3/red-green-refactor`** (MIT-licensed TDD harness on GitHub,
  `SKILL.md` DEC-6 and Phase 4) — no pristine local checkout of the upstream
  repo exists on this machine. The skill's own instructions treat this as
  something to `git clone` fresh at build time (Phase 4 of *using* the skill),
  not as a static asset the skill ships with, so this is expected, not a gap.
  For transparency: this machine does have **adapted derivative copies** of a
  vendored `red-green-refactor` (already renamed/restructured into
  `skills/{red-green-refactor,safe-pr,safe-cleanup,tdd-plan,tdd-ci}` plus
  Python hook scripts) inside two unrelated installed plugins —
  `C:\Users\mou97\.claude\plugins\cache\aeo\agentic-engineering-org\0.1.0\` and
  `...\aeo\agentic-engineering-solo-org\0.1.0\`. These are **build outputs from
  previous runs of this very skill** (or a close variant), not the pristine
  upstream source, are not referenced by `SKILL.md`/`references/*.md` text at
  all, and sit alongside the excluded eval workspace. Left uncopied as
  out-of-scope per the task's file-reference-driven copy rule.
- Three doc URLs (`code.claude.com/docs/en/sub-agents`, `.../hooks`,
  `.../discover-plugins`) are live web pages the skill tells the *builder
  agent* to consult at run time ("Prefer these live docs over any syntax in
  this skill") — not fetchable/vendorable local files, and the skill doesn't
  ask us to bundle them.

## Notes for generalization

Concrete blockers to packaging this as a portable, org-agnostic plugin:

- **Windows/PowerShell is baked into the gate scripts, not abstracted.**
  `references/hooks.md` lines 70–117, 125–203, 216–261, 265–275 give the
  *only* full implementations of `block-merge.ps1`, `commit-gate.ps1`,
  `path-guard.ps1`, `format.ps1` in PowerShell; POSIX is a one-line aside
  ("port to bash for POSIX hosts, preserving the stdin-deciding logic
  exactly", `hooks.md` line 59) with no bash reference implementation
  provided anywhere in the skill.
- **Hook invocation form is Windows-specific by explicit design decision.**
  `SKILL.md` lines 143–146 and `hooks.md` lines 28–32 mandate
  `powershell -NoProfile -ExecutionPolicy Bypass -File "<path>"` because the
  `& '<path>'` + `shell:` form "silently fails to register... verified live
  on 2.1.201" — a machine/version-specific empirical finding hardcoded as a
  rule, with no equivalent verified note for macOS/Linux.
  `references/agents.md` lines 66, 70, 126, 171, 198 and
  `references/hooks.md` lines 292–313 (the `settings.json` skeleton) hardcode
  this PowerShell invocation into every subagent frontmatter block and the
  global hook wiring.
- **Default stack profile is opinionated and Python-specific.** `SKILL.md`
  lines 242–250 fix "Python 3.13+ with `uv`, `pytest`, `ruff`" as the
  *default* profile; `references/directory-tree.md` bakes `pyproject.toml`,
  `uv.lock`, `tests/test_baseline.py` with `def test_baseline(): assert True`
  directly into the skeleton tree, and `hooks.md` lines 188–190 hardcode
  `uv run pytest src -q -m "not slow" -n auto` and `uv run ruff check .`
  inside `commit-gate.ps1`. A non-Python/non-uv team must edit hook script
  bodies, not just config.
- **Absolute Windows drive-letter paths appear as worked examples inside
  logic comments**, e.g. `references/hooks.md` line 48 (`D:\proj-xref` vs
  `D:\proj`) and line 41 (`/d/proj` MSYS-path normalization) — these leak a
  specific author's directory-naming convention into what should be
  generic path-safety guidance.
- **The GitHub plugin's exact MCP tool namespace is hardcoded from one
  observed install**, `mcp__plugin_github_github__…` (`SKILL.md` line 155;
  `hooks.md` line 297 matcher string) — the skill tells Phase 0 to
  "Confirm the exact names... with `/plugin`" but ships the specific string
  as the working example, which will silently stop matching if the plugin's
  namespace or the user's install ever renames it.
- **`gh repo create`/branch-protection commands in
  `references/directory-tree.md` lines 60–79 hardcode a personal/example
  repo name** (`ai-enterprise-template`) and a specific GitHub Pro-tier
  assumption ("branch protection on a **private** repo requires GitHub Pro")
  presented as settled fact rather than a check-your-plan step.
- **The evals in `evals/evals.json` hardcode a personal scratch path**,
  `D:/eval-scratch/ai-enterprise-template` and `D:/eval-scratch/agentic-org`
  (lines 8, 16) — machine-specific and will not run unmodified on another
  contributor's machine or CI.
- **The skill assumes a specific plugin-provided merge tool and a specific
  reviewer plugin exist to be diffed against**, e.g. `references/agents.md`
  lines 215–221 name `pr-review-toolkit`'s `code-reviewer`/`pr-test-analyzer`
  by exact identifier as prior art the reviewer role was designed against —
  portable packaging should either vendor that comparison as a doc note or
  drop the specific plugin name.
- **No bash/POSIX equivalents ship anywhere in the skill tree** (confirmed by
  full-text read of all 6 files) — every runnable artifact (hook scripts,
  settings.json command strings, hook invocation syntax) is PowerShell-only,
  so "swap in the bash port" is an instruction to the *builder agent*, not
  something a non-Windows team can use as-is without first writing that port
  themselves.
