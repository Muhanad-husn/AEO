# Founder setup commands (run these yourself)

These are **printed, not executed**. The AI team is not allowed to create the
remote, push, or configure branch protection — those are your calls. Run them
once to turn the local template into a governed GitHub repo.

## 1. Create the GitHub repo (private) and set the remote
```bash
gh repo create <your-org>/<repo> --private --source . --remote origin
```

## 2. Push the bootstrap commit
```bash
git push -u origin main --no-verify   # --no-verify: pre-push hook blocks agents, not you
```

## 3. Protect main (require PR + green checks, block direct pushes)
```bash
gh api -X PUT repos/<your-org>/<repo>/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=tests" \
  -f "enforce_admins=true" \
  -f "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "restrictions=null"
```

## 4. (Recommended) Add a CI check named `tests`
Create `.github/workflows/ci.yml` so the branch-protection `tests` context is
real:
```yaml
name: tests
on: [pull_request]
jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - run: uv sync --extra dev
      - run: uv run pytest -q
      - run: uv run ruff check src tests
```

## 5. Enable the native git hooks on any fresh clone
`core.hooksPath` is repo-local config and is **not** cloned. Each clone must run:
```bash
git config core.hooksPath .githooks
```
(Consider adding this to your onboarding script.)

## Why the AI team can't do steps 1–3
`gh repo create`, `gh api`, `gh pr merge`, and `git push` are in the
`permissions.deny` list and are blocked by `git_guard.py`. That is intentional:
the boundary between "AI proposes" and "human disposes" lives exactly here.
