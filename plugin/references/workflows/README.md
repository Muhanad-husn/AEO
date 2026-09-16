# Workflow templates

Three GitHub Actions templates, one per stack, carried unchanged from the deleted
`tdd-ci` skill. They run the process-level tier, which is CI's half of the two-tier
split (D17); the in-process tier stays on the machine that made the commit. A run
these produce is cited on a later commit, not repeated locally (D24).

| File | What it runs |
| --- | --- |
| `node-ci.yml` | Node or TypeScript unit tests and a build. |
| `python-ci.yml` | Python unit tests with pytest. |
| `playwright-e2e.yml` | Playwright end-to-end tests, with the report, screenshots and videos kept as artifacts. |

Each template opens with its own customisation notes, including what to set when the
project sits in a subdirectory rather than at the repository root. `../ci.md` says what
the tiers are for and what makes a job worth promoting to a required status check.

These are copies to start from, not a shared library. A project takes one, edits the
versions and commands to match its own manifest, and owns it from then on. Nothing here
reads a project's configuration or runs at session time.
