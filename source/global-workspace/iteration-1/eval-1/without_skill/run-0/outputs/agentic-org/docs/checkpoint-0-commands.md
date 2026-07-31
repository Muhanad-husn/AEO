# Checkpoint 0 — commands for the founder to run (DO NOT let an agent run these)

These create the remote and lock `main`. They are the gates this enterprise is built
around, so only the founder runs them.

```bash
# 1. Create the remote (adjust owner/visibility to taste)
gh repo create <owner>/ai-enterprise-template --private --source=. --remote=origin --push

# 2. Branch protection on main: require a PR, require status checks, block direct pushes.
#    (Verify the current ruleset/branch-protection endpoint against gh docs.)
gh api -X PUT repos/<owner>/ai-enterprise-template/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_pull_request_reviews[required_approving_review_count]=1' \
  -F 'enforce_admins=true' \
  -F 'restrictions=null'
```

Status: NOT RUN in this build (no real GitHub repo was created, per operator instruction).
