#!/usr/bin/env python3
"""Grade a scaffolded agentic-engineering-org repo against the eval assertions.

Usage: python grade_repo.py <repo_root> <metadata_json> <out_grading_json>
Emits grading.json: {"expectations": [{"text","passed","evidence"}, ...]}
Robust to reasonable naming variation; heuristic but deterministic.
"""
import json, os, re, sys
from pathlib import Path

def find_repo(root: Path) -> Path:
    """The runner may nest the repo one level down; find the dir with a .claude/."""
    if (root / ".claude").exists() or (root / "CLAUDE.md").exists():
        return root
    for p in root.rglob(".claude"):
        return p.parent
    return root

def read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""

def frontmatter(text: str) -> str:
    m = re.match(r"^\s*---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    return m.group(1) if m else ""

def agent_files(repo: Path):
    d = repo / ".claude" / "agents"
    if not d.exists():
        return {}
    out = {}
    for f in d.glob("*.md"):
        out[f.stem.lower()] = f
    return out

def match_role(agents, *keys):
    for name, f in agents.items():
        if all(k in name for k in keys):
            return f
    return None

def grade(repo: Path):
    res = []
    def add(text, passed, evidence):
        res.append({"text": text, "passed": bool(passed), "evidence": evidence})

    # tree
    need = [".claude/agents", ".claude/skills", ".claude/hooks", "specs", "src",
            "tests", "plans", "docs/tdd-evidence", "secrets"]
    missing = [d for d in need if not (repo / d).exists()]
    add("Directory tree present (.claude/{agents,skills,hooks}, specs, src, tests, plans, docs/tdd-evidence, secrets)",
        not missing, "all present" if not missing else f"missing: {missing}")

    # baseline test
    tests_dir = repo / "tests"
    test_files = list(tests_dir.rglob("*.py")) if tests_dir.exists() else []
    has_test = any("def test" in read(f) for f in test_files)
    add("A baseline test file exists under tests/", has_test,
        f"{[f.name for f in test_files]}" if test_files else "no test files")

    # CLAUDE.md
    cmd = read(repo / "CLAUDE.md")
    cl = cmd.lower()
    merge_ok = ("founder" in cl) and ("merge" in cl)
    add("CLAUDE.md exists and states the founder is the only one who may merge", merge_ok,
        "mentions founder+merge" if merge_ok else "CLAUDE.md missing or lacks founder/merge")
    freeze_ok = ("spec" in cl) and any(w in cl for w in ["freeze", "frozen", "drift"])
    add("CLAUDE.md states specs are frozen during implementation / drift-to-issue", freeze_ok,
        "mentions spec freeze/drift" if freeze_ok else "no spec-freeze language")

    # five agents
    agents = agent_files(repo)
    triage = match_role(agents, "triage") or match_role(agents, "pm")
    spec = match_role(agents, "spec")
    test = match_role(agents, "test")
    impl = match_role(agents, "impl")
    rev = match_role(agents, "review")
    found = {k: v for k, v in {"triage": triage, "spec-author": spec, "test-author": test,
             "implementer": impl, "reviewer": rev}.items() if v}
    add("All five role subagent files exist (triage, spec-author, test-author, implementer, reviewer)",
        len(found) == 5, f"found: {sorted(found)} / all files: {sorted(agents)}")

    # reviewer read-only
    if rev:
        fm = frontmatter(read(rev)).lower()
        tools_line = next((l for l in fm.splitlines() if l.strip().startswith("tools")), "")
        readonly = ("edit" not in tools_line) and ("write" not in tools_line)
        add("Reviewer subagent has no Edit/Write in its tools", readonly, f"tools: {tools_line.strip()}")
    else:
        add("Reviewer subagent has no Edit/Write in its tools", False, "no reviewer file")

    # models
    want = {"triage": ("haiku", triage), "spec-author": ("opus", spec),
            "test-author": ("sonnet", test), "implementer": ("sonnet", impl),
            "reviewer": ("sonnet", rev)}
    model_ev, model_ok = [], True
    for role, (exp, f) in want.items():
        if not f:
            model_ok = False; model_ev.append(f"{role}=MISSING"); continue
        fm = frontmatter(read(f))
        m = re.search(r"(?mi)^\s*model\s*:\s*(\S+)", fm)
        got = (m.group(1).lower() if m else "none")
        ok = exp in got
        model_ok = model_ok and ok
        model_ev.append(f"{role}={got}{'' if ok else f'(want {exp})'}")
    add("Models pinned per roster (triage=haiku, spec=opus, test/impl/review=sonnet)", model_ok,
        ", ".join(model_ev))

    # path guards
    guard_ev, guard_ok = [], True
    for role, f in {"implementer": impl, "spec-author": spec, "test-author": test}.items():
        if not f:
            guard_ok = False; guard_ev.append(f"{role}=MISSING"); continue
        fm = frontmatter(read(f)).lower()
        has = ("hooks" in fm) and ("pretooluse" in fm)
        guard_ok = guard_ok and has
        guard_ev.append(f"{role}={'guard' if has else 'NO-guard'}")
    add("Implementer, spec-author, and test-author carry PreToolUse frontmatter path guards",
        guard_ok, ", ".join(guard_ev))

    # write guards (the iteration-1 bug: guards must cover Write, not only Edit)
    wev, wok = [], True
    for role, f in {"implementer": impl, "spec-author": spec, "test-author": test}.items():
        if not f:
            wok = False; wev.append(f"{role}=MISSING"); continue
        fm = frontmatter(read(f)).lower()
        has_write = bool(re.search(r'if\s*:\s*["\']?\s*write\(', fm))
        wok = wok and has_write
        wev.append(f"{role}={'Write-guarded' if has_write else 'EDIT-ONLY(leaks)'}")
    add("Path guards cover Write() (create-new-file) not only Edit() — no guard leak",
        wok, ", ".join(wev))

    # gh not run (no github remote actually created)
    gitcfg = read(repo / ".git" / "config")
    remote_created = "github.com" in gitcfg
    add("gh repo create / branch-protection prepared but NOT executed (no real remote)",
        not remote_created, "no github remote in .git/config" if not remote_created
        else "FOUND github remote — a real repo may have been created")

    # stopped at phase 2 (no hook wiring)
    settings = read(repo / ".claude" / "settings.json")
    hook_scripts = list((repo / ".claude" / "hooks").glob("*.sh")) if (repo / ".claude" / "hooks").exists() else []
    stopped = ("pretooluse" not in settings.lower()) and (len(hook_scripts) == 0)
    add("Stopped at Phase 2 — no Phase-3 hook wiring (settings.json PreToolUse / hook scripts) written",
        stopped, f"settings has hooks={'yes' if 'pretooluse' in settings.lower() else 'no'}, "
        f"hook scripts={[f.name for f in hook_scripts]}")

    return res

def main():
    root = find_repo(Path(sys.argv[1]))
    out = Path(sys.argv[3])
    expectations = grade(root)
    passed = sum(1 for e in expectations if e["passed"])
    total = len(expectations)
    out.write_text(json.dumps({
        "repo_root": str(root),
        "summary": {
            "pass_rate": round(passed / total, 4) if total else 0.0,
            "passed": passed, "failed": total - passed, "total": total,
        },
        "expectations": expectations,
    }, indent=2), encoding="utf-8")
    print(f"{root}: {passed}/{total} passed")

if __name__ == "__main__":
    main()
