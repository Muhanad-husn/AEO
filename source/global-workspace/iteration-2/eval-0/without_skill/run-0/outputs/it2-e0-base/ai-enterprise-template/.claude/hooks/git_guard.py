#!/usr/bin/env python3
"""Claude Code PreToolUse guardrail for the AI dev team.

Wired to Bash tool calls via .claude/settings.json. It enforces two hard rules
that subagents must never break:

  1. Never merge to (or commit directly on) a protected branch, never push,
     never run repo/branch administration.
  2. Never commit while the test suite is failing.

Protocol: read the tool call as JSON on stdin. Exit 0 to allow. Exit 2 to BLOCK
(stderr is shown to the model). Any other failure exits 0 (fail-open) so a bug
in the guard never bricks the agent -- the native git hooks in .githooks/ are
the backstop for that case.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys

PROTECTED = {"main", "master", "release", "production"}


def _load() -> dict:
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def _block(msg: str) -> None:
    sys.stderr.write("[git_guard] BLOCKED: " + msg + "\n")
    sys.exit(2)


def _current_branch() -> str:
    # symbolic-ref resolves the branch name even on an unborn branch (fresh repo
    # with no commits yet), where rev-parse --abbrev-ref returns the literal
    # "HEAD" and would silently defeat the protected-branch check.
    for args in (
        ["git", "symbolic-ref", "--short", "-q", "HEAD"],
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
    ):
        try:
            r = subprocess.run(args, capture_output=True, text=True, timeout=15)
            name = r.stdout.strip()
            if name and name != "HEAD":
                return name
        except Exception:
            continue
    return ""


def main() -> None:
    data = _load()
    tool = data.get("tool_name", "")
    if tool and tool != "Bash":
        sys.exit(0)

    cmd = (data.get("tool_input") or {}).get("command", "")
    if not cmd or "git" not in cmd and "gh" not in cmd:
        sys.exit(0)

    norm = " ".join(cmd.split())
    branch = _current_branch()

    # --- Rule 1: no push / no PR merge / no repo+branch administration -------
    if re.search(r"\bgit\s+push\b", norm):
        _block("agents may not 'git push'. The human founder pushes and opens PRs.")
    if re.search(r"\bgh\s+pr\s+merge\b", norm):
        _block("agents may not merge pull requests. Merging to main is human-only.")
    if re.search(r"\bgit\s+merge\b", norm) and branch in PROTECTED:
        _block(f"refusing to merge while on protected branch '{branch}'. "
               "Do all work on a feature branch and hand the PR to the human.")
    if re.search(r"\bgh\s+repo\s+create\b|\bgh\s+api\b|branch.?protection", norm):
        _block("repository and branch-protection administration is human-only.")
    if re.search(r"\bgit\s+push\b.*(--force|-f)\b|--force-with-lease", norm):
        _block("force pushing is forbidden.")

    # --- Rule 2: no commit on protected branch, no commit with failing tests -
    if re.search(r"\bgit\s+commit\b", norm):
        if branch in PROTECTED:
            _block(f"refusing to commit directly on protected branch '{branch}'. "
                   "Create a feature branch first: git switch -c feat/<slug>")
        r = subprocess.run(
            [sys.executable, "-m", "pytest", "-q"],
            capture_output=True, text=True,
        )
        # pytest exit codes: 0 = passed, 5 = no tests collected. Anything else
        # (1 failures, 2 interrupted, 3 internal, 4 usage) blocks the commit.
        if r.returncode not in (0, 5):
            tail = (r.stdout or "")[-1500:]
            _block("test suite is not green -- commit refused. Fix tests first.\n"
                   "--- pytest tail ---\n" + tail)

    sys.exit(0)


if __name__ == "__main__":
    main()
