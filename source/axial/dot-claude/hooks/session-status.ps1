# Live-state injection. SessionStart hook. Prints the repo's actual current state
# to stdout, which the harness adds to context before the first prompt arrives.
#
# Why this exists: on 2026-07-26 a status answer repeated "the vault rewrite of ~17k
# notes' source_meta is still open" from a 5-day-old memory and a never-ticked line in
# plans/phase-a-completion/STAGE-4-RUNBOOK.md. It had shipped days earlier (#278 via
# #285, then made moot by the Phase A rerun). Memories carry a staleness warning and it
# was not enough. Hooks cannot inspect prose, so nothing can block a stale claim
# directly -- this instead front-loads ground truth so recall is never the cheap path.
#
# Never blocks and never fails a session: every step is guarded, exit is always 0.

$ErrorActionPreference = 'Continue'

# Windows PowerShell defaults both console output and Get-Content to the ANSI
# codepage, which turns every em dash and × in a summary.md into mojibake.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$out = [System.Text.StringBuilder]::new()
function Emit([string]$s) { [void]$out.AppendLine($s) }

try {
    $j = $null
    try { $j = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { $j = $null }

    # Resolve the repo from the session's own cwd, never $PSScriptRoot or
    # CLAUDE_PROJECT_DIR -- .claude/ is gitignored, so it exists only in the launch
    # checkout and a worktree session would report the wrong tree (fixed twice
    # already: commit-gate/path-guard 2026-07-08, block-merge 2026-07-21).
    $opDir = if ($j) { "$($j.cwd)" } else { '' }
    if (-not $opDir) { $opDir = (Get-Location).Path }
    # $j.cwd can arrive in MSYS form (/d/axial); git -C cannot consume that.
    if ($opDir -match '^/([A-Za-z])(/.*)?$') {
        $opDir = "$($matches[1]):$(if ($matches[2]) { $matches[2] } else { '/' })"
    }

    $root = $null
    try { $root = (& git -C $opDir rev-parse --show-toplevel 2>$null) } catch { $root = $null }
    if (-not $root) { exit 0 }   # not a git worktree; nothing to report
    $root = "$root".Trim()

    Emit "## Live repo state (fetched at session start)"
    Emit ""
    Emit "Ground truth, read from GitHub and disk just now. Memory files and ``plans/``"
    Emit "checkboxes are neither -- they lag merged reality and have caused wrong status"
    Emit "answers. Prefer what follows; verify anything older against it."
    Emit ""

    try {
        $branch = (& git -C $root rev-parse --abbrev-ref HEAD 2>$null)
        $head = (& git -C $root log -1 --format='%h %s' 2>$null)
        if ($branch) { Emit "**Branch:** $("$branch".Trim())  |  **HEAD:** $("$head".Trim())" ; Emit "" }
    } catch { }

    # --- Open issues -------------------------------------------------------
    try {
        $raw = (& gh issue list --state open --limit 40 --json number,title,labels 2>$null) | Out-String
        $issues = if ($raw.Trim()) { $raw | ConvertFrom-Json } else { @() }
        if ($issues.Count -eq 0) {
            Emit "**Open issues:** none."
        } else {
            Emit "**Open issues ($($issues.Count)):**"
            foreach ($i in $issues) {
                $labels = ($i.labels | ForEach-Object { $_.name }) -join ', '
                $suffix = if ($labels) { "  [$labels]" } else { '' }
                Emit "- #$($i.number) $($i.title)$suffix"
            }
        }
        Emit ""
    } catch { Emit "**Open issues:** unavailable (gh failed)."; Emit "" }

    # --- Open PRs: the founder-approval queue ------------------------------
    try {
        $raw = (& gh pr list --state open --limit 20 --json number,title,isDraft 2>$null) | Out-String
        $prs = if ($raw.Trim()) { $raw | ConvertFrom-Json } else { @() }
        if ($prs.Count -eq 0) {
            Emit "**Open PRs:** none awaiting approval."
        } else {
            Emit "**Open PRs ($($prs.Count)) -- awaiting founder approval:**"
            foreach ($p in $prs) {
                $d = if ($p.isDraft) { ' (draft)' } else { '' }
                Emit "- #$($p.number) $($p.title)$d"
            }
        }
        Emit ""
    } catch { Emit "**Open PRs:** unavailable (gh failed)."; Emit "" }

    # --- Recently merged: what shipped, so it is never reported as pending --
    try {
        $raw = (& gh pr list --state merged --limit 10 --json number,title,mergedAt 2>$null) | Out-String
        $merged = if ($raw.Trim()) { $raw | ConvertFrom-Json } else { @() }
        if ($merged.Count -gt 0) {
            Emit "**Last $($merged.Count) merged PRs (already shipped):**"
            foreach ($m in $merged) {
                $when = if ($m.mergedAt) { ([string]$m.mergedAt).Substring(0, 10) } else { '?' }
                Emit "- #$($m.number) $($m.title)  _($when)_"
            }
            Emit ""
        }
    } catch { }

    # --- Newest run log ----------------------------------------------------
    try {
        $logDir = Join-Path $root 'data/logs'
        if (Test-Path -LiteralPath $logDir) {
            $newest = Get-ChildItem -LiteralPath $logDir -Directory -ErrorAction SilentlyContinue |
                ForEach-Object { Join-Path $_.FullName 'summary.md' } |
                Where-Object { Test-Path -LiteralPath $_ } |
                Get-Item -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 1
            if ($newest) {
                $rel = $newest.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
                Emit "**Newest run log:** ``$rel``"
                $head = Get-Content -LiteralPath $newest.FullName -TotalCount 40 -Encoding UTF8 -ErrorAction SilentlyContinue |
                    Where-Object { $_.Trim() } | Select-Object -First 8
                foreach ($line in $head) { Emit "> $line" }
                Emit ""
            }
        }
    } catch { }

    [Console]::Out.Write($out.ToString())
} catch {
    # A broken status probe must never cost a session. Stay silent and continue.
}

exit 0
