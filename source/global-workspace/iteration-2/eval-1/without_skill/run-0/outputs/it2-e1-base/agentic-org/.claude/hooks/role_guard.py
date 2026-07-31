#!/usr/bin/env python3
"""role_guard — the hard gate behind the agentic workflow.

One script, wired to three hook events in .claude/settings.json:

  * SubagentStart : push the starting subagent's name onto a per-session stack
  * SubagentStop  : pop it
  * PreToolUse    : read the top of the stack (= the acting role) and DENY any
                    write that lands outside that role's owned tree.

Why a stack file instead of reading the agent from the PreToolUse payload:
PreToolUse input does not reliably carry the subagent identity, but
SubagentStart input DOES (delivered as `agent_type`). So we capture identity at
SubagentStart and consult it on every subsequent tool call in that session.

Ownership (a role may WRITE only its own tree):
    specs/           -> architect
    tests/           -> test-author
    src/             -> implementer
    .orchestration/  -> integrator
    (reviewer owns nothing and, by its tools allowlist, has no write tools)

When no subagent is active (the human's own top-level session) nothing is
restricted — the human is the merge seat.

Enforcement is two-pronged:
  * Write/Edit/MultiEdit/NotebookEdit -> checked by target file_path (reliable).
  * Bash -> best-effort scan that blocks shell commands which MUTATE a forbidden
    tree (redirects, rm/mv/cp, sed -i, python open(...'w'), etc.). This stops the
    obvious ways to route around the tool-level guard; read-only commands such as
    `uv run pytest tests/` are unaffected.

Fails closed for a known role writing outside its tree; fails open (allows) only
for the human's own session.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

OWNER = {
    "specs": "architect",
    "tests": "test-author",
    "src": "implementer",
    ".orchestration": "integrator",
}

PROJECT_DIR = Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")).resolve()
STATE_DIR = PROJECT_DIR / ".claude" / ".role_state"

# Shell tokens that indicate a command WRITES rather than merely reads.
_MUTATION = re.compile(
    r"(>>?|\brm\b|\bmv\b|\bcp\b|\bdel\b|\bRemove-Item\b|\bSet-Content\b|"
    r"\bAdd-Content\b|\bOut-File\b|\bNew-Item\b|\btee\b|\btruncate\b|"
    r"\bmkdir\b|\brmdir\b|\bshutil\b|sed\s+-i|git\s+apply|git\s+checkout|"
    r"\bpatch\b|open\s*\(|write_text|write_bytes|\.write\s*\(|\.dump\s*\()",
    re.IGNORECASE,
)


def _payload() -> dict:
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def _state_file(session_id: str | None) -> Path:
    return STATE_DIR / f"{session_id or 'default'}.json"


def _read_stack(session_id: str | None) -> list[str]:
    f = _state_file(session_id)
    if f.exists():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except Exception:
            return []
    return []


def _write_stack(session_id: str | None, stack: list[str]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    _state_file(session_id).write_text(json.dumps(stack), encoding="utf-8")


def _agent_name(payload: dict) -> str | None:
    for key in ("agent_type", "subagent_type", "agent_name", "agent", "name"):
        val = payload.get(key)
        if isinstance(val, str) and val:
            return val
    agent = payload.get("agent")
    if isinstance(agent, dict):
        for key in ("type", "name"):
            if isinstance(agent.get(key), str) and agent[key]:
                return agent[key]
    return None


def _tree_of(path_str: str) -> str | None:
    """Return the top-level owned tree a path falls under, else None."""
    if not path_str:
        return None
    norm = path_str.replace("\\", "/")
    proj = str(PROJECT_DIR).replace("\\", "/").rstrip("/")
    if proj and norm.lower().startswith(proj.lower() + "/"):
        norm = norm[len(proj) + 1:]
    segments = [s for s in norm.split("/") if s not in ("", ".")]
    for seg in segments:
        if seg in OWNER:
            return seg
    return None


def _deny(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def _enforce(payload: dict) -> None:
    stack = _read_stack(payload.get("session_id"))
    role = stack[-1] if stack else None
    if role is None:
        return  # human's own session — the merge seat is unrestricted.

    tool = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {}) or {}

    if tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
        path = (
            tool_input.get("file_path")
            or tool_input.get("path")
            or tool_input.get("notebook_path")
            or ""
        )
        tree = _tree_of(path)
        if tree and OWNER.get(tree) != role:
            _deny(
                f"role_guard: role '{role}' may not write into '{tree}/'. "
                f"That tree is owned by '{OWNER[tree]}'. If you believe the "
                f"contract there is wrong, STOP and report to the human — do not "
                f"edit another role's tree."
            )
        return

    if tool == "Bash":
        cmd = tool_input.get("command", "") or ""
        forbidden = [t for t, owner in OWNER.items() if owner != role]
        for tree in forbidden:
            if re.search(rf'(^|[\s"\'/=(:]){re.escape(tree)}/', cmd) and _MUTATION.search(cmd):
                _deny(
                    f"role_guard: role '{role}' attempted a shell command that "
                    f"writes into '{tree}/' (owned by '{OWNER[tree]}'). Blocked. "
                    f"Run only read-only commands against trees you do not own."
                )
        return


def main() -> None:
    payload = _payload()
    event = payload.get("hook_event_name", "")
    sid = payload.get("session_id")

    if event == "SubagentStart":
        stack = _read_stack(sid)
        stack.append(_agent_name(payload) or "unknown")
        _write_stack(sid, stack)
    elif event == "SubagentStop":
        stack = _read_stack(sid)
        if stack:
            stack.pop()
        _write_stack(sid, stack)
    elif event == "PreToolUse":
        _enforce(payload)
    # Any other event: no-op, allow.
    sys.exit(0)


if __name__ == "__main__":
    main()
