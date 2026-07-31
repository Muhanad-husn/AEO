"""Snapshot the agentic harness into a separate private git repo.

`.claude/` and `CLAUDE.local.md` are gitignored in the main repo (deliberately -- the
harness is kept private, developed toward a future plugin). That leaves the thing that
governs every session with no history and no rollback. This mirrors it into its own
repo and commits, giving history and offsite backup without nesting a repo inside
`.claude/` -- nesting would make `git rev-parse --show-toplevel` resolve to the harness
dir and silently defeat the role fence in path-guard.ps1 (#271).

    uv run python .claude/tools/snapshot-harness.py [--target DIR] [--no-push]

Target defaults to a sibling of the project dir, `../axial-harness`, or $AXIAL_HARNESS_REPO.

Note for future edits: this drives git through subprocess on purpose. Do not inline a
literal `git commit` into a shell command the agent runs -- the commit-gate hook matches
on that string and would resolve the harness repo as the project, then block the commit
when `pytest src` finds no src/ there.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

EXCLUDED_DIRS = {".git", "__pycache__", "worktrees"}
EXCLUDED_SUFFIXES = {".pyc", ".log"}
# Machine-local permission state, not harness definition -- and a global gitignore rule
# (`**/.claude/settings.local.json`) drops it anyway, so mirroring it would only leave an
# untracked file loitering in the snapshot repo.
EXCLUDED_NAMES = {"settings.local.json"}


def git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=False
    )


def keep(path: Path) -> bool:
    if any(part in EXCLUDED_DIRS for part in path.parts):
        return False
    if path.name in EXCLUDED_NAMES:
        return False
    return path.suffix not in EXCLUDED_SUFFIXES


def mirror(src_root: Path, dst_root: Path) -> int:
    """Copy src_root -> dst_root, pruning anything in dst that no longer exists in src."""
    wanted: set[Path] = set()
    changed = 0

    for src in src_root.rglob("*"):
        rel = src.relative_to(src_root)
        if not keep(rel):
            continue
        dst = dst_root / rel
        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
            wanted.add(rel)
            continue
        wanted.add(rel)
        if dst.exists() and dst.read_bytes() == src.read_bytes():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        changed += 1

    if dst_root.exists():
        for dst in sorted(dst_root.rglob("*"), reverse=True):
            rel = dst.relative_to(dst_root)
            # Prune everything the mirror no longer wants, including files that have since
            # become excluded -- otherwise a newly-excluded file loiters in the snapshot
            # forever. Only .git is untouchable.
            if rel in wanted or rel.parts[0] == ".git":
                continue
            if dst.is_dir():
                if not any(dst.iterdir()):
                    dst.rmdir()
            else:
                dst.unlink()
                changed += 1

    return changed


def main() -> int:
    project = Path(__file__).resolve().parents[2]
    default_target = os.environ.get("AXIAL_HARNESS_REPO") or str(project.parent / "axial-harness")

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--target", default=default_target, help="harness repo directory")
    ap.add_argument("--no-push", action="store_true", help="commit locally, do not push")
    args = ap.parse_args()

    target = Path(args.target).resolve()
    if target == project or project in target.parents:
        print(f"refusing: target {target} is inside the project; pick a sibling", file=sys.stderr)
        return 2

    target.mkdir(parents=True, exist_ok=True)
    if not (target / ".git").exists():
        git(target, "init", "-b", "main")
        (target / "README.md").write_text(
            "# axial harness\n\n"
            "Snapshots of `.claude/` and `CLAUDE.local.md` from the axial project.\n"
            "Both are gitignored there, so this repo is their only history.\n\n"
            "Written by `.claude/tools/snapshot-harness.py`. Do not edit by hand -- edit\n"
            "the live harness in the project and re-run the snapshot.\n",
            encoding="utf-8",
        )
        print(f"initialised harness repo at {target}")

    changed = mirror(project / ".claude", target / ".claude")

    local_md = project / "CLAUDE.local.md"
    if local_md.exists():
        dst = target / "CLAUDE.local.md"
        if not dst.exists() or dst.read_bytes() != local_md.read_bytes():
            shutil.copy2(local_md, dst)
            changed += 1

    if not git(target, "status", "--porcelain").stdout.strip():
        print("no changes since the last snapshot")
    else:
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        git(target, "add", "-A")
        msg = f"snapshot: harness @ {stamp} ({changed} file(s) changed)"
        commit = git(target, "commit", "-m", msg)
        if commit.returncode != 0:
            print(commit.stdout + commit.stderr, file=sys.stderr)
            return 1
        sha = git(target, "rev-parse", "--short", "HEAD").stdout.strip()
        print(f"snapshot {sha}: {changed} file(s) changed")

    # Push even when nothing changed. "Nothing to commit" does not mean "nothing to
    # push" -- a remote added after the last snapshot, or an earlier failed push, leaves
    # local commits unmirrored. Returning early there reports success while the offsite
    # copy silently stays empty, which is the one failure this tool exists to prevent.
    if args.no_push:
        return 0
    if not git(target, "remote").stdout.strip():
        print("no remote configured; snapshot is local only")
        return 0
    if not git(target, "log", "--oneline", "@{u}..", "-1").stdout.strip():
        if git(target, "rev-parse", "--abbrev-ref", "@{u}").returncode == 0:
            print("remote already up to date")
            return 0
    push = git(target, "push", "-u", "origin", "main")
    if push.returncode != 0:
        print("push failed:\n" + push.stdout + push.stderr, file=sys.stderr)
        return 1
    print("pushed to origin/main")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
