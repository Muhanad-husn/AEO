# Hard gates — hooks (Phase 3)

The two deterministic gates plus the harness fence, all enforced by **exit code 2**
(a PreToolUse hook exiting 2 blocks the tool call and feeds stderr back to the
model). This is the most important phase — do not proceed on an unverified gate.

**Verify the schema first** against `https://code.claude.com/docs/en/hooks`. Confirmed
as of authoring: hooks live in `.claude/settings.json`; each `PreToolUse` entry has a
`matcher` (tool name or regex, incl. MCP names like `mcp__plugin_github_github__.*`)
and a `hooks` array. **Tool input arrives on stdin as JSON — there is no
`$CLAUDE_TOOL_INPUT_FILE_PATH`.** The stdin JSON also carries `tool_name`, `cwd`,
and — only inside subagent calls — `agent_type`.

## Design rules (learned in live verification — do not regress)

1. **Scripts decide from stdin JSON; never rely on `if:` permission-rule filters for
   enforcement (DEC-16).** An `if: "Bash(git merge *)"` filter is dodged by compound
   commands (`git add . && git merge …`), and `Edit(...)` globs are fragile
   against absolute Windows paths. Fire the hook on the whole tool matcher (`Bash`,
   `Edit|Write`) and let each script parse `tool_input` itself and exit 0/2.
2. **Double-wire the critical gates (DEC-18).** Frontmatter hooks have a documented
   reliability history (GH issue #18392; live dispatches have run on stale agent
   snapshots with dead guards). So: wire `block-merge` and `path-guard` **globally**
   in `settings.json` too. The scripts read `agent_type` from stdin — present only in
   subagent calls — so subagents are enforced while the orchestrator's approved
   merge/cleanup path stays open. Frontmatter wiring passes explicit args
   (`subagent` / role name) and remains as a second layer. Two wirings, one script.
3. **Hook command form (Windows).** Write hook scripts in PowerShell and invoke as
   `powershell -NoProfile -ExecutionPolicy Bypass -File "<path>" [args]`. The
   `& '<path>'` command form with a `shell:` field **silently fails to register**
   (verified on 2.1.201) — hooks never spawn and nothing warns you. On POSIX hosts,
   port to bash and invoke the script path directly (`chmod +x`).
4. **Resolve the worktree from the tool payload, never from `CLAUDE_PROJECT_DIR`
   alone.** That env var stays bound to the launching session's checkout; in
   git-worktree sessions the branch guard misfires (a feature-branch commit blocked
   as "on main") and rules mis-scope. Two refinements proven in production:
   - **Commits:** a worktree commit is issued as `cd <worktree> && git commit …`,
     and a subagent's `$j.cwd` is unreliable across calls (often pinned to the
     launch checkout). When the command explicitly `cd`s first, honor that target
     as the commit's real working directory; otherwise fall back to `$j.cwd`, then
     `CLAUDE_PROJECT_DIR`. Normalize MSYS/Git-Bash paths (`/d/proj`) to Windows
     form before handing them to `git -C`.
   - **File writes:** resolve the root from the **target file's own ancestors**
     (`git -C <nearest-existing-ancestor> rev-parse --show-toplevel`) — the file's
     path unambiguously identifies its worktree even when `cwd` lies. Walk up to
     the nearest existing ancestor first; the file may not exist yet.
   When testing "is this path inside the project", require a trailing separator on
   the root so a name-prefix sibling worktree (`D:\proj-xref` vs `D:\proj`) is
   never treated as inside the project.
5. **There are no flag files in v2.** v1 had two founder-toggled flags
   (`.claude/spec-mode` lifting a spec freeze; `.claude/allow-red-commit` for the
   intended red commit). Both died with their ceremonies: specs are living docs
   (DEC-5 v2) and test+code land together (DEC-1 v2), so no intended red commit
   exists. Do not reintroduce them.

## Hook scripts (`.claude/hooks/`)

Four scripts. The PowerShell bodies below are the verified reference implementation;
port to bash for POSIX hosts, preserving the stdin-deciding logic exactly.

### `block-merge.ps1` — subagents-never-merge

Blocks, for subagents: `git merge`, `gh pr merge`, `gh api …merge…`, branch deletion
(`git branch -d/-D/--delete`, `git push --delete`), pushes naming `main`, and any push
while the checkout is on `main`. Blocks, for **everyone** (orchestrator included): the
GitHub plugin's merge tool, and plugin write tools (`create_or_update_file`,
`push_files`, `delete_file`) whose `branch` targets `main` — the orchestrator merges
via `gh pr merge` instead.

```powershell
# Subagents-never-merge gate (DEC-3). PreToolUse hook: reads tool input as JSON on
# stdin, exits 2 (block) on any merge / push-to-main / branch-delete attempt.
# Two wirings, one script (DEC-18): frontmatter passes 'subagent'; the global
# settings.json wiring passes no arg and enforces Bash only when stdin carries
# agent_type (i.e. a subagent is running).
param([string]$Mode = '')
$ErrorActionPreference = 'Stop'
function Block([string]$reason) {
    [Console]::Error.WriteLine("BLOCKED: $reason Prepare the PR; the main session merges after founder approval.")
    exit 2
}
try { $j = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { exit 0 }
$tool = "$($j.tool_name)"
$isSubagent = ($Mode -eq 'subagent') -or ("$($j.agent_type)" -ne '')

if ($tool -like 'mcp__*') {
    if ($tool -match 'merge_pull_request$' -or $tool -match 'merge') {
        Block "subagents and the plugin merge tool never merge."
    }
    if ($tool -match '(create_or_update_file|push_files|delete_file)$') {
        $branch = "$($j.tool_input.branch)"
        if ($branch -eq 'main' -or $branch -eq 'refs/heads/main') {
            Block "no direct writes to main through the GitHub plugin."
        }
    }
    exit 0
}

if ($tool -eq 'Bash') {
    if (-not $isSubagent) { exit 0 }
    $cmd = "$($j.tool_input.command)"
    if ($cmd -match 'git\s+(\S+\s+)*merge')            { Block "subagents never run git merge." }
    if ($cmd -match 'gh\s+pr\s+merge')                 { Block "subagents never merge PRs." }
    if ($cmd -match 'gh\s+api\s+\S*merge')             { Block "subagents never merge via the API." }
    if ($cmd -match 'git\s+branch\s+(-d|-D|--delete)') { Block "subagents never delete branches; cleanup runs on founder approval." }
    if ($cmd -match 'git\s+push\s+.*--delete')         { Block "subagents never delete remote branches." }
    if ($cmd -match 'git\s+push') {
        if ($cmd -match '\bmain\b') { Block "subagents never push to main." }
        $projectDir = $env:CLAUDE_PROJECT_DIR
        if (-not $projectDir) { $projectDir = Split-Path (Split-Path $PSScriptRoot) }
        $current = (& git -C $projectDir rev-parse --abbrev-ref HEAD 2>$null)
        if ($current -eq 'main') { Block "subagents never push while on main." }
    }
    exit 0
}
exit 0
```

### `commit-gate.ps1` — no commit on a red suite, no code commits on `main`

Acts only when the Bash command contains a `git commit`. Order matters: docs-only
classification first (it feeds two decisions), then the main-branch block (with the
docs-only exception), then the test run.

```powershell
# Tests-green-before-commit gate (DEC-3) + no-code-commits-on-main.
$ErrorActionPreference = 'Stop'
try { $j = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { exit 0 }
$cmd = "$($j.tool_input.command)"
if ($cmd -notmatch '\bgit\s+((-C|-c)\s+\S+\s+|-\S+\s+)*commit(?![-\w])') { exit 0 }

# Resolve the worktree this commit actually targets (design rule 4): honor an
# explicit `cd <dir> &&` prefix first, then $j.cwd, then the env var. Normalize
# MSYS paths (/d/proj) to Windows form for git -C.
$opDir = $null
if ($cmd -match '^\s*cd\s+(?:"([^"]+)"|([^\s&|;]+))\s*&&') {
    $opDir = if ($matches[1]) { $matches[1] } else { $matches[2] }
}
if (-not $opDir) { $opDir = "$($j.cwd)" }
if (-not $opDir) { $opDir = $env:CLAUDE_PROJECT_DIR }
if (-not $opDir) { $opDir = Split-Path (Split-Path $PSScriptRoot) }
if ($opDir -match '^/([A-Za-z])(/.*)?$') { $opDir = "$($matches[1]):$(if ($matches[2]) { $matches[2] } else { '/' })" }
$projectDir = $null
try { $projectDir = (& git -C $opDir rev-parse --show-toplevel 2>$null) } catch { $projectDir = $null }
if (-not $projectDir) { $projectDir = $opDir }

# Docs-only status, computed once and used twice: (1) docs-only commits may land on
# main directly (founder-approved policy), and (2) they skip the suite. "Docs-only"
# = every file is .md/.txt/.rst or under plans|docs/, AND nothing is under .claude/.
# The .claude/ deny is evaluated FIRST and wins over the .md allow: agent and skill
# definitions are all .md, and without the deny a harness-config change would land
# on main with no branch, no PR, and no suite run. Fails safe: empty set, any
# non-docs file, or any error -> the stricter branch-and-suite path. `git commit -a`
# sweeps in tracked-but-unstaged edits, so fold those in.
$docsOnly = $false
try {
    $staged = @(& git -C $projectDir diff --cached --name-only 2>$null | Where-Object { $_ })
    if ($cmd -match '(^|\s)-[A-Za-z]*a[A-Za-z]*(\s|$)' -or $cmd -match '--all\b') {
        $staged += @(& git -C $projectDir diff --name-only 2>$null | Where-Object { $_ })
    }
    $files = @($staged | Select-Object -Unique)
    $nonDocs = @($files | Where-Object {
        $_ -imatch '^\.claude/' -or -not ($_ -imatch '\.(md|txt|rst)$' -or $_ -imatch '^(plans|docs)/')
    })
    $docsOnly = ($files.Count -gt 0 -and $nonDocs.Count -eq 0)
} catch { $docsOnly = $false }

$branch = $null
try { $branch = (& git -C $projectDir rev-parse --abbrev-ref HEAD 2>$null) } catch { $branch = $null }
if ($branch -eq 'main') {
    if ($docsOnly) {
        [Console]::Error.WriteLine("Docs-only commit on main ($($files.Count) file(s)); allowed directly - no branch required.")
        exit 0
    }
    [Console]::Error.WriteLine("BLOCKED: no direct commits on main. Work on a branch; merge via PR after founder approval. (Docs-only commits may land on main directly.)")
    exit 2
}

if ($docsOnly) {
    [Console]::Error.WriteLine("Docs-only commit ($($files.Count) file(s)); skipping the test suite - no code changed.")
    exit 0
}

# Fast per-commit gate: the profile's FAST hermetic unit suite plus lint (see
# policy note below). Swap the commands for the profile's real ones.
Push-Location $projectDir
try {
    & uv run pytest src -q -m "not slow" -n auto 2>&1 | Out-Null; $green = ($LASTEXITCODE -eq 0)
    $lintOk = $true
    if ($green) { & uv run ruff check . 2>&1 | Out-Null; $lintOk = ($LASTEXITCODE -eq 0) }
}
finally { Pop-Location }

if (-not $green) {
    [Console]::Error.WriteLine("BLOCKED: test suite is red. Get to green before committing.")
    exit 2
}
if (-not $lintOk) {
    [Console]::Error.WriteLine("BLOCKED: lint failed. Fix before committing.")
    exit 2
}
exit 0
```

**Per-commit speed policy (founder-approved pattern):** the commit gate is the
lowest of three run tiers (see `harness-and-sprint.md` § Test-suite architecture) and
runs only the fast, hermetic unit suite (with DEC-20's co-located layout:
`pytest src -q`, parallel via `pytest-xdist`, slow markers excluded — seconds, not
minutes). Slice close runs the current subproject's acceptance contracts; the full
suite runs once per PR in CI as the required check. "No commit on a red suite" stays
a real, fast signal, and the expensive end-to-end contracts never run inside the
inner red-green loop — the gate's command is a per-repo design decision, recorded in
the Decision Log with founder approval. Note there is **no red-commit escape hatch**:
test and code land together (DEC-1 v2), so no intended red commit exists.

### `path-guard.ps1` — the harness fence (DEC-19)

One rule: role subagents never write under `.claude/` — the config that governs the
roles is not theirs to edit. Frontmatter passes the role name; the global wiring
reads it from stdin `agent_type`. Non-role agents and the main session pass through.

```powershell
# Harness fence (DEC-19). PreToolUse hook on Edit|Write. Exits 2 when a role
# subagent writes into .claude/. This is the only path rule (v2): the builder
# writes src/, tests/ and specs/ freely. Two wirings, one script (DEC-18).
param([string]$Role = '')
$ErrorActionPreference = 'Stop'
function Block([string]$reason) {
    [Console]::Error.WriteLine("BLOCKED by path guard ($Role): $reason")
    exit 2
}
try { $j = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { exit 0 }
if (-not $Role) { $Role = "$($j.agent_type)" }
if (-not $Role) { exit 0 }
$filePath = "$($j.tool_input.file_path)"
if (-not $filePath) { exit 0 }

# Resolve the project root from the TARGET FILE'S own git worktree, not the tool
# call's cwd (design rule 4). Walk up to the nearest existing ancestor first; the
# file (or its parent dir) may not exist yet.
$full = [System.IO.Path]::GetFullPath($filePath)
$probe = Split-Path -Parent $full
while ($probe -and -not (Test-Path -LiteralPath $probe)) { $probe = Split-Path -Parent $probe }
if (-not $probe) { Block "cannot resolve a directory for the target path ($filePath)." }
$projectDir = $null
try { $projectDir = (& git -C $probe rev-parse --show-toplevel 2>$null) } catch { $projectDir = $null }
if (-not $projectDir) { Block "target is not inside a git worktree ($filePath)." }

$rootTrim = [System.IO.Path]::GetFullPath($projectDir).TrimEnd('\', '/')
$rel = $full.Substring($rootTrim.Length).TrimStart('\', '/').Replace('\', '/')

# The fence must not depend on how git resolves the root. If .claude/ is ever made
# its own repo, rev-parse returns <root>/.claude and a bare '^\.claude/' test
# silently stops matching. So also detect a root NAMED .claude (narrow: not any
# path containing one, so a plugin checkout under ~/.claude/plugins/<name> still
# resolves normally).
$inHarness = ($rel -match '^\.claude/') -or ($rootTrim -match '[\\/]\.claude$')

if ($inHarness) { Block "role subagents may not touch .claude/ - harness config governs the roles, so a role does not edit it. Ask the orchestrator (tried: $rel)." }
exit 0
```

### `format.ps1` — PostToolUse formatter (never blocks)

```powershell
try { $j = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { exit 0 }
$filePath = "$($j.tool_input.file_path)"
if ($filePath -and $filePath -match '\.py$' -and (Test-Path $filePath)) {
    $projectDir = $env:CLAUDE_PROJECT_DIR
    if (-not $projectDir) { $projectDir = Split-Path (Split-Path $PSScriptRoot) }
    Push-Location $projectDir
    try { & uv run ruff format $filePath 2>$null | Out-Null } catch {} finally { Pop-Location }
}
exit 0
```

Swap `ruff format` and the `.py` match for the profile's formatter.

## `settings.json` wiring (the global backstop layer)

This is the verified live shape. The MCP matcher covers the merge tool **and** the
plugin's direct-write tools (`create_or_update_file`, `push_files`, `delete_file`) —
record the exact names from `/plugin` in Phase 0.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"${CLAUDE_PROJECT_DIR}/.claude/hooks/commit-gate.ps1\"" },
          { "type": "command", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"${CLAUDE_PROJECT_DIR}/.claude/hooks/block-merge.ps1\"" }
        ]
      },
      {
        "matcher": "mcp__plugin_github_github__.*(merge|create_or_update_file|push_files|delete_file).*",
        "hooks": [
          { "type": "command", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"${CLAUDE_PROJECT_DIR}/.claude/hooks/block-merge.ps1\"" }
        ]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"${CLAUDE_PROJECT_DIR}/.claude/hooks/path-guard.ps1\"" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"${CLAUDE_PROJECT_DIR}/.claude/hooks/format.ps1\"" }
        ]
      }
    ]
  }
}
```

Note there is **no `if:` filter anywhere** — the global Bash wiring is safe for the
orchestrator because `block-merge.ps1` and `path-guard.ps1` pass through when stdin
carries no `agent_type` (rule 2). `commit-gate.ps1` intentionally applies to the
orchestrator too: nobody commits red, and only docs-only commits land on `main`.
Add the frontmatter layer per `agents.md`.

Gitignore local settings (there are no flag files in v2):

```gitignore
.claude/settings.local.json
```

## Verify (live — capture transcripts for the checkpoint)

Run a script-level exit-code battery (compound commands, `Write`-vs-`Edit`, path
traversal, out-of-project paths, worktree cwd cases; feed each script real JSON on
stdin — beware shell quoting mangling `\\` escapes in test JSON: use forward-slash
paths, which are valid JSON and valid on Windows) **and** a live in-session battery:

- A `git merge` / `gh pr merge` / `git push origin main` / `git branch -D x` from a
  **subagent** is **blocked** with a reason — including inside a compound command.
- A merge through the **GitHub plugin's merge tool** is **blocked**, and a plugin
  `create_or_update_file`/`push_files`/`delete_file` targeting `main` is blocked.
- The **orchestrator's** `gh pr merge` (after founder approval) **succeeds**.
- A `git commit` with a deliberately failing test is **blocked**; reverting to green
  lets it through; a docs-only commit skips the suite and may land on `main`; a
  commit touching `.claude/` is never classified docs-only.
- The **builder** editing (and `Write`-creating) under `.claude/` is blocked; its
  writes to `src/`, `tests/`, and `specs/` pass; the main session's `.claude/`
  writes pass.
- `/hooks` lists every configured hook. If a hook seems inert, suspect the command
  form (design rule 3) before anything else.

**⛔ CHECKPOINT 3** — founder confirms each gate fires, including the plugin merge
path, while the orchestrator's approved merge path stays open.
