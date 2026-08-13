# Review packet — cp4/stage-0-mismatch

Everything the review needs is in this directory. Nothing here points at a file
you are expected to open elsewhere.

| File | What it is |
|---|---|
| `01-claim.md` | The claim, quoted verbatim from the PR body, plus the evidence the author offered for it |
| `02-diff.patch` | `git diff main...cp4/stage-0-mismatch` — the complete change, one file |
| `03-issue-and-spec.md` | Issue status (none for this change), spec status (none exists), pre-change source, and the contract movement in this branch |
| `04-prior-evidence-test-run.txt` | Recorded test output from the earlier input-guard slice, already on `main` |
| `05-prior-evidence-cli-demo.txt` | Recorded CLI demo from that same earlier slice, already on `main` |
| `06-tests-total.test.mjs` | The complete test file as it stands on this branch (unchanged from `main`) |
| `07-src-total-after.mjs` | The complete post-change `src/total.mjs` |
| `08-suite-rerun-at-staging.txt` | The suite re-run by the dispatching party on this branch, raw output |

Facts about the branch, for grounding:

- one commit: `a59f75b feat(running-total): cap the total at a configurable maximum`
- one file changed: `src/total.mjs`, +7 −2
- `tests/total.test.mjs` is byte-identical to `main`; no test file was added or edited
- no file was added under `docs/`
- `src/total.mjs` is the only production source file in the repository
