# CI: workflow templates and required checks (D17, D24)

Two test tiers exist and they run on different machines. The in-process tier is
the commit gate's own, and the process-level tier is CI's (D17). Once a commit
has a tier CI run, that run is cited by run id, SHA and conclusion; it is not
re-run locally (D24). This reference replaces the deleted `tdd-ci` skill.

## Workflow templates

Three templates live at `${CLAUDE_PLUGIN_ROOT}/references/workflows/`. Adapt
the real project's runtime version, install and test commands, and trigger
branches into them; leave no placeholders.

- `${CLAUDE_PLUGIN_ROOT}/references/workflows/node-ci.yml`: a `unit` job for
  a Node project (checkout, `setup-node` with dependency caching, install,
  run the full test command).
- `${CLAUDE_PLUGIN_ROOT}/references/workflows/playwright-e2e.yml`: an `e2e`
  job for a web slice. It installs browsers with `--with-deps`, starts the
  app (Playwright's `webServer` config keeps local and CI consistent), runs
  headless, and uploads the report plus `test-results/` with
  `if: ${{ !cancelled() }}` so evidence survives a red run.
- `${CLAUDE_PLUGIN_ROOT}/references/workflows/python-ci.yml`: the Python
  equivalent of `node-ci.yml` (`setup-python` with pip caching, install, run
  the test command).

A non-web slice skips Playwright entirely; its integration test is just
another test run, often folded into the same job as the unit tests rather
than split for a second status check.

## Which tier runs where (D17)

The fast, in-process tier is what the commit gate runs on every commit,
locally, and it stays cheap because it never spawns a real process per case.
The process-level tier (real git repositories, spawned browsers, started
services) is exhaustive and belongs in CI, on a machine nobody is waiting
at. A workflow's `unit` (and, for a non-web integration slice, its test) job
should run the same full test command the project declares, not a trimmed
local subset, because CI is where that full run happens for the first time.

## Cite CI, don't re-run it locally (D24)

A local run only answers whether uncommitted work is green, about a tree CI
has never seen. A CI run answers whether a given commit was green, and that
answer does not improve by being computed again on slower hardware while
another actor is competing for the same machine. Once CI has already run a
tier on a commit, a builder, a reviewer, or anyone reading a pull request
cites that run (id, SHA, conclusion) instead of reproducing it locally. This
holds for a branch point pulled fresh into a worktree as much as for the
branch's own tip; a green branch point still says nothing about the branch's
own changes, which is what the PR's own CI check is for.

## Anatomy and triggers

- A workflow is a YAML file in `.github/workflows/`. Each job is its own
  status check, so keeping `unit` and `e2e` (or an integration job) separate
  gives a reader two distinct green or red signals instead of one blended
  one.
- `push:` gives fast feedback on any branch while a slice is in progress.
  `pull_request: branches: [<default>]` is the gate: the trigger that
  branch protection can later make required.
- Pin third-party action major versions (`actions/checkout@v4`,
  `actions/setup-node@v4`, and so on); check the action's own releases page
  for the current version rather than trusting a remembered one, since these
  move over time.
- Never commit secrets; use `${{ secrets.NAME }}`. The default
  `GITHUB_TOKEN` covers status checks.

## Subdirectory apps

`run:` steps honour `defaults.run.working-directory`, so `npm ci`, `npm
test`, or `pytest` execute in the app's own folder once that is set. `uses:`
actions do not honour it: their path inputs resolve from the repo root, so
`cache-dependency-path` and any `upload-artifact` `path:` need the subfolder
prefixed on by hand (for example `apps/web/package-lock.json`), or the cache
key is wrong and the artifact upload silently captures nothing.

## What makes a job worth promoting to a required check

A job earns a required-status-check promotion once it has a green run against
real project code, not a smoke test, and its command matches what the tests
actually run locally. At that point branch protection is what stops a merge
on a red suite: a pull request cannot merge into the default branch while its
required checks are red or still running. The default branch is resolved
from repository evidence, never assumed to be `main`. Promote `unit` and
`e2e` (or the integration job) as separate required contexts so a red e2e run
cannot hide behind a green unit run. Changing branch protection is a
repository setting, not a test-writing step, and it is applied only with the
person who owns that decision agreeing first; the plugin does not
re-derive or second-guess anything GitHub already enforces server-side once
the checks are set.
