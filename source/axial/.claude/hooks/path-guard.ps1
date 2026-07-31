# Harness fence (#271). PreToolUse hook on Edit|Write. Reads tool input as JSON on
# stdin; exits 2 (block) when a role subagent writes into .claude/ — the config that
# governs the roles is not theirs to edit. Harness v2 (2026-07-20): this is the only
# path rule left. The builder writes src/, tests/ and specs/ freely; the per-role
# tests//specs/ boxes were removed with the role split. The main session and
# non-role agents (no role name, no agent_type) pass through.
#
# Two wirings, one script (DEC-18): role frontmatter passes the role name
# explicitly; the global settings.json wiring passes no arg and the role is taken
# from stdin agent_type.

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
# call's cwd — a subagent's reported cwd can point at the launch checkout while the
# file lives in a sibling worktree. Walk up to the nearest existing ancestor first,
# since the file (or its parent dir) may not exist yet.
$full = [System.IO.Path]::GetFullPath($filePath)
$probe = Split-Path -Parent $full
while ($probe -and -not (Test-Path -LiteralPath $probe)) { $probe = Split-Path -Parent $probe }
if (-not $probe) { Block "cannot resolve a directory for the target path ($filePath)." }
# git errors on a non-repo dir; under ErrorActionPreference=Stop that surfaces as a
# terminating NativeCommandError, so catch it and treat "no root" as a clean block.
$projectDir = $null
try { $projectDir = (& git -C $probe rev-parse --show-toplevel 2>$null) } catch { $projectDir = $null }
if (-not $projectDir) { Block "target is not inside a git worktree ($filePath)." }

$rootTrim = [System.IO.Path]::GetFullPath($projectDir).TrimEnd('\', '/')
$rel = $full.Substring($rootTrim.Length).TrimStart('\', '/').Replace('\', '/')

# The fence must not depend on how git happens to resolve the root. If .claude/ is
# ever made its own repo, rev-parse --show-toplevel returns <root>/.claude and a bare
# '^\.claude/' test silently stops matching — re-opening #271 with no signal. So also
# detect the case where the resolved root IS the harness dir. Deliberately narrow: a
# root *named* .claude, not any path containing one, so a future plugin checkout
# under ~/.claude/plugins/<name> still resolves normally.
$inHarness = ($rel -match '^\.claude/') -or ($rootTrim -match '[\\/]\.claude$')

if ($inHarness) { Block "role subagents may not touch .claude/ - harness config governs the roles, so a role does not edit it. Ask the orchestrator (tried: $rel)." }

exit 0
