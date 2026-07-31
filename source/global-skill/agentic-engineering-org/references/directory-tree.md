# Directory tree (Phase 0)

Create this skeleton. The default profile is Python + `uv` + `pytest` + `ruff`; swap
the manifest/lockfile and the baseline test for the project's real stack (e.g. a
`package.json` + a test runner for Node). Add a **trivial passing test** so the suite
is green from the first commit — the whole workflow depends on a green baseline.

```
ai-enterprise-template/
├── pyproject.toml            # profile manifest (default: uv workspace, pytest + ruff); swap per stack
├── uv.lock                   # default-profile lockfile; swap per stack
├── .gitignore                # ignores secrets/, .env, __pycache__, dist/, etc.
├── README.md                 # one paragraph: what this template is
├── CLAUDE.md                 # placeholder, written in Phase 1
├── specs/.gitkeep
├── src/.gitkeep              # production code; inner unit tests co-locate here later (DEC-20)
├── tests/test_baseline.py    # one passing assertion; tests/ later holds the acceptance contracts, grouped by subproject
├── plans/.gitkeep            # harness slice plans land here
├── docs/tdd-evidence/.gitkeep
├── secrets/secrets.example.toml   # template only; the real secrets file is gitignored
└── .claude/
    ├── agents/.gitkeep       # role subagents (Phase 2)
    ├── skills/.gitkeep       # vendored harness (Phase 4) + sprint skills (Phase 5)
    ├── hooks/.gitkeep        # gate scripts (Phase 3)
    └── settings.json         # hook wiring, written in Phase 3
```

`tests/test_baseline.py` (default profile):

```python
def test_baseline():
    assert True
```

`.gitignore` must exclude the real secrets file while keeping the example:

```gitignore
secrets/secrets.toml
.env
__pycache__/
*.pyc
.pytest_cache/
dist/
build/
.claude/settings.local.json
```

If the runner uses `testpaths`, plan for the DEC-20 layout up front (pytest:
`testpaths = ["tests", "src"]`) — `tests/` holds the acceptance contracts; inner
unit tests co-locate under `src/`. As subprojects appear, group contracts by
subproject (`tests/<subproject>/` or a marker) so slice-close runs and the sprint
suite can target the current subproject with one runner argument (see
`harness-and-sprint.md` § Test-suite architecture).

## Commands to prepare for Checkpoint 0 (run only after approval)

Present these at **Checkpoint 0**; once the founder approves, the orchestrator runs
them itself (rule 3) — do not make the founder run them.

```bash
# 1. Create the remote (adjust owner/visibility to taste). NOTE: branch protection on
#    a PRIVATE repo requires GitHub Pro (DEC-13) — the choices are public visibility,
#    a paid plan, or living without the server-side backstop. Raise this at the
#    checkpoint; the reference build chose public.
gh repo create <owner>/ai-enterprise-template --private --source=. --remote=origin --push

# 2. Branch protection on main: require a PR, block direct pushes even for the owner.
#    Solo-founder shape (DEC-11): required_approving_review_count = 0 — a solo founder
#    cannot approve their own PR, so requiring 1 review deadlocks every merge; review
#    authority lives in the reviewer subagent + founder approval instead. Defer
#    required_status_checks to Phase 4, when the tdd-ci workflow exists to name.
#    (Verify the current ruleset/branch-protection endpoint against gh docs.)
gh api -X PUT repos/<owner>/ai-enterprise-template/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_pull_request_reviews[required_approving_review_count]=0' \
  -F 'enforce_admins=true' \
  -F 'required_status_checks=null' \
  -F 'restrictions=null'
```

**Verify (before the checkpoint):** `uv sync` succeeds; `uv run pytest` is green;
`git log --oneline` shows exactly one commit on `main`.
