---
name: tdd-ci
description: Once a slice is green locally, detect the stack and write the matching GitHub Actions workflow — a unit job plus an e2e or integration job, with artifacts uploaded on failure — so the same tests gate every pull request instead of only running on one machine. Trigger on a request to add CI, wire up GitHub Actions, or make tests a required check. Runs after red-green-refactor and before safe-pr.
---

# TDD CI — promote tests to CI

Phase 3 of the TDD harness: once a slice is green locally, make its tests
run automatically so the same suite gates every pull request rather than
running on one machine only. Read
`${CLAUDE_PLUGIN_ROOT}/skills/tdd-ci/references/github-actions-guide.md` for
workflow anatomy, caching, Playwright-in-CI specifics, and branch-protection
guidance. Templates are in
`${CLAUDE_PLUGIN_ROOT}/skills/tdd-ci/assets/workflows/`.

Action major versions (`actions/checkout@v4`, `actions/setup-node@v4`, and
the rest) and runner images move over time — check the action's own
repository releases page for the current version before committing rather
than trusting a remembered one.

## Preconditions

- The slice is green locally — its acceptance test and the commit gate's
  fast tier, already established by `red-green-refactor`. Don't promote red
  or unrun tests to CI; the full acceptance tree runs there for the first
  time, not before.
- A GitHub remote exists (`git remote -v`). If not, tell the founder CI
  only takes effect once the repo is pushed — write the workflow anyway so
  it's ready.

## Procedure

1. Detect the stack, the project directory, and the test commands — reuse
   `red-green-refactor`'s `test-strategy.md` detection, and read the plan's
   *project directory* field: a subfolder app needs the workflow to run
   there. The project's own scripts (`package.json`, `Makefile`) are the
   source of truth for how tests are invoked.
2. Choose a template from `assets/workflows/`: `node-ci.yml` (or the
   template matching the detected stack) for the unit job, and — only for a
   web slice — `playwright-e2e.yml` for the e2e job, which installs
   browsers with `--with-deps` and uploads the report, screenshots, and
   videos as artifacts. A non-web slice skips Playwright entirely; its
   integration test is just another test run, often the same job as the
   unit tests.
3. Customise it: the real runtime version, the actual install and test
   commands, the e2e start command (web only), and the trigger (push to any
   branch, plus `pull_request` into the default branch). Remove anything
   that doesn't apply; leave no placeholders.

   **Subdirectory app:** set `defaults.run.working-directory` so `run:`
   steps execute there. `uses:` actions resolve from the repo root
   regardless, so prefix the subfolder onto `cache-dependency-path` and any
   `upload-artifact` `path:` — the guide's "Projects in a subdirectory"
   section has both cases worked through.
4. Write the file to `.github/workflows/` with a clear name. Keep unit and
   e2e as separate jobs (or files) so a reviewer sees both signals
   distinctly.
5. Validate — the YAML parses, and the commands match how the tests
   actually run locally.
6. Commit: `ci: add GitHub Actions workflow running unit + e2e tests [slice
   NN]`. Confirm before pushing — `safe-pr` pushes as part of opening the
   PR, so it's fine to leave this commit local and hand off.
7. Once the workflow has a green run, propose making it a required status
   check on the default branch. Changing repo settings needs explicit
   founder approval — present the `gh api` command from the guide and wait.

## What good CI for a slice looks like

- Runs on push (fast feedback) and on `pull_request` into the default
  branch (the gate).
- A unit job and an acceptance job, each its own status check.
- Web slice: browsers installed `--with-deps`, headless, report plus
  screenshots and videos uploaded even on failure. Non-web slice: the
  integration test runs with no browser steps.
- Correct working-directory and repo-root-relative paths for a subdirectory
  app.
- Dependency caching. No secrets committed.

## Hand-off

Once the workflow is committed and valid, recommend `safe-pr` — it pushes
the branch, which triggers this workflow, and assembles the evidence-rich
PR.
