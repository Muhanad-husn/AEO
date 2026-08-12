---
name: safe-pr
description: Open a reviewable pull request once a slice is green — collect the test evidence (a unit summary, plus e2e screenshots and a recording for a UI slice, or terminal transcripts for a CLI, API, or service slice), secret-scan it, generate the PR body from a template, then push and open the PR. Never merges, never force-pushes, never targets a branch other than the repo's default. Trigger on a request to open a PR, raise a pull request, or ship a slice with evidence attached.
---

# Safe PR — evidence-rich pull requests

Phase 4 of the TDD harness: build (`red-green-refactor`), then CI (`tdd-ci`),
then this. Open a PR a reviewer can approve with confidence because the
evidence is right there — a unit summary, plus Playwright screenshots and a
recording for a web slice, or terminal transcripts for a CLI, API, or service
slice.

Bundled resources:
- `${CLAUDE_PLUGIN_ROOT}/skills/safe-pr/assets/pr-body-template.md` — the PR
  description structure, with an `<!-- EVIDENCE -->` marker the script fills.
- `${CLAUDE_PLUGIN_ROOT}/skills/safe-pr/scripts/collect-evidence.mjs` —
  collects evidence into the committed evidence folder and generates the PR
  body. Modality auto-detects from Playwright artifacts, or is forced with
  `--type cli|api|service`. Two phases: `--copy-only` (copy and secret-scan)
  before the evidence commit, `--body-only` (build the body, pinned to that
  commit) after — so every embedded link resolves. Detects repo visibility
  and renders screenshots as blob links rather than inline images on a
  private repo, which wouldn't render there.

Requires `gh` authenticated and a GitHub remote — confirm both early
(`gh auth status`, `git remote -v`).

## Preconditions

1. The slice is green locally — its acceptance test and the fast tier,
   already established through `red-green-refactor` and the commit gate.
   Never open a PR on red; if anything regressed, return there.
2. CI exists (`.github/workflows/`, from `tdd-ci`). If missing, run that
   first.
3. On the slice's feature branch (`feat/<feature-slug>/<NN>-<slice-slug>`),
   not the default branch.
4. Working tree committed, in small green-only commits.

## Procedure

1. Produce the evidence by actually running the tests. Always capture the
   unit summary. Then, by boundary:
   - Web slice: run the e2e suite with video, screenshot, and HTML report
     capture on. The PR needs both a screenshot and a recording of the
     passing run — re-run with video on if either is missing.
   - Non-web slice: capture two transcripts to files — the test-run output
     and a real invocation through the boundary (CLI stdout and exit code,
     or the HTTP request and response), e.g. `npm test > test-run.txt 2>&1`.

   Run from the slice's project directory if the app lives in a subfolder.
2. Copy the evidence in (`--copy-only`), from the repo root:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/safe-pr/scripts/collect-evidence.mjs" --feature <feature-slug> --slice <NN-slice-slug> --report-dir <dir>/playwright-report --results-dir <dir>/test-results --copy-only
   ```

   or, non-web:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/safe-pr/scripts/collect-evidence.mjs" --feature <feature-slug> --slice <NN-slice-slug> --type cli --transcript test-run.txt --transcript cli-demo.txt --copy-only
   ```

   Raw traces and HAR files are dropped by default — they often carry auth
   tokens; pass `--include-traces` only if checked.
3. Review the collector's output for secrets before committing anything. On
   `SECRETS SUSPECTED`, open the named files and redact — this is about to
   be committed and pushed, and history doesn't un-publish. Keep the
   project's raw `test-results/`/`playwright-report/` out of git with an
   anchored `.gitignore` pattern (e.g. `sandbox/web-adder/test-results/`) or
   a `!docs/tdd-evidence/**` exception, so it doesn't also swallow the
   committed copies.

   The collector refuses, rather than warns about, any path resolving inside
   the production data root declared in `AEO_LIVE_DATA_ROOT`, links and `..`
   resolved first. There is no override flag: re-run the tests through
   `sandbox-session.mjs` and collect that evidence instead. Where the
   variable is unset the check cannot run and the summary says
   `production data : NOT CHECKED` — a gap, not a pass.
4. Commit the cleaned evidence:

   ```
   git add docs/tdd-evidence/<feature>/<NN-slice>/
   git commit -m "docs(<feature>): test evidence [slice NN]"
   ```

   `git show --stat HEAD` should list the files — an empty commit means
   `.gitignore` swallowed them.
5. Generate the PR body (`--body-only`), now pinned to the evidence commit:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/safe-pr/scripts/collect-evidence.mjs" --feature <feature-slug> --slice <NN-slice-slug> [--type cli] --body-only --template "${CLAUDE_PLUGIN_ROOT}/skills/safe-pr/assets/pr-body-template.md" --out PR_BODY.md
   ```

   Fill the remaining `<placeholders>`: description, what changed, how to
   review, the unit summary, risk notes, the plan path. Be honest about
   anything partial. `PR_BODY.md` is git-ignored — it isn't committed.
6. Show the founder the title, body, and branch, and get explicit
   confirmation — this is outward-facing. Then push:

   ```
   git push -u origin feat/<feature-slug>/<NN-slice-slug>
   ```

   Never force-push.
7. Open the PR against the repo's default branch, resolved from repository
   evidence the same way the merge gate resolves it — never hardcoded:

   ```
   gh pr create --base <default-branch> --head feat/<feature-slug>/<NN-slice-slug> --title "feat(<feature-slug>): <slice goal> [slice NN]" --body-file PR_BODY.md
   ```
8. Record the PR URL in the slice plan's status log and the feature
   README's slice table; tick the Definition-of-Done.
9. Report to the founder: the branch name, and that it now exists both
   locally and on `origin`; the PR title and URL; and that once it merges or
   closes, `safe-cleanup` retires the branch — this skill doesn't. Every
   slice leaves one behind, so say so every time, even mid-pipeline.

## Safety rules

- Confirm before any push or `gh pr create` — both are outward-facing.
- Never force-push, never rewrite shared history, never push to the default
  branch directly.
- Base is always the repo's default branch, unless the founder says
  otherwise.
- Open the PR only on green, with evidence attached.
- Never collect evidence from production data. The collector enforces this
  and cannot be talked out of it; do not try to route around the refusal.
- No secrets, tokens, or large binaries beyond the necessary evidence.
- This skill prepares and opens the PR. It never merges — that waits for
  founder approval, whether the attempt comes from this skill or any other
  subagent.
