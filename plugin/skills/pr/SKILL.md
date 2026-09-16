---
name: pr
description: Open a pull request on a branch that is green, with a body that says what changed, what it cost and which consumer number it expects to move, and with a secret scan over anything attached. Use when a slice is done and wants a pull request, when a branch is ready to propose, or when asked to ship work for the founder to read.
---

# `pr`: what changed, what it cost, which number

A pull request is a proposal. It is inert until the founder merges it, so it is
cheap to open and expensive to pad. What makes it readable is three answers in
the body, in whatever order reads best:

- **What changed.** The behaviour that is different now, not a file list. The
  diff already carries the file list.
- **What it cost.** Lines added against lines deleted, dollars if the session
  can see them, and the tier that ran. The exhaustive tier is `test_full` in
  `aeo-tests.json`, falling back to `test` where a project declares one key
  (D31). Cite CI's run on this SHA rather than repeating it locally.
- **Which consumer number it expects to move.** Days to a correct deliverable,
  dollars, or the consumer's own score row. A change that moves nothing says so
  plainly and lets the founder decide.

There is no template. `safe-pr` shipped one, with an evidence packet the same
size for a one-line fix as for a new subsystem, and nothing in it could be
trimmed because the shape was fixed rather than argued. Writing three answers
from scratch costs less than editing a form down.

## Evidence

Attach evidence when it demonstrates something a reader cannot get from the
diff: a screenshot of a rendered view, a transcript of a command that now
behaves differently, a before and after number. When the diff already shows it,
write one sentence saying the tests are green and where CI ran them, and attach
nothing.

`scripts/collect-evidence.mjs` copies evidence into the repository and runs the
secret scan over it. The scan is cheap and it is about an outcome that cannot be
undone: a pushed token is published. Read its summary before committing anything
it copied, and redact what it names.

```
node "${CLAUDE_PLUGIN_ROOT}/skills/pr/scripts/collect-evidence.mjs" --feature <slug> --slice <NN-slug> --type cli --transcript test-run.txt --copy-only
```

Raw traces and HAR files are dropped unless `--include-traces` is passed,
because they carry auth tokens. Any path resolving inside the production data
root named by `AEO_LIVE_DATA_ROOT` stops the run with no override flag (L-05);
re-run the tests against a sandbox and collect that. With the variable unset the
check cannot run at all, and the summary says `production data : NOT CHECKED`,
which is a gap rather than a pass.

## Opening it

Push the branch and open the pull request against the repository's default
branch, resolved from the repository rather than assumed to be `main`
(`git symbolic-ref --short refs/remotes/origin/HEAD`, or
`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`). A branch
push and `gh pr create` need no approval. Merging and branch deletion stay with
the founder, and the `block-merge` hook holds that line for every subagent.

Never force-push, never rewrite shared history, never push to the default
branch. Say the branch name in the report, because something has to retire it
later and this skill does not.
