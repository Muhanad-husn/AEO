---
name: safe-pr
description: Use to prepare a safe, reviewable pull request from a feature branch into main once a slice is green and reviewed. It assembles everything a reviewer needs — the slice description, evidence of the tests that ran (terminal transcripts for this non-web stack; Playwright artifacts only for web slices), a checklist, and links to the plan and issue — then pushes the branch and opens the PR with gh. It PREPARES the PR and never merges it; the merge waits for founder approval. Trigger on 'raise a PR', 'open a pull request', 'ship this slice', or 'create the PR with evidence'.
---

# Safe PR — Evidence-Rich Pull Request (role-adapted)

Prepare a pull request the founder can approve with confidence, because the
evidence is right there. This is the last automated step of a slice:
build (red-green-refactor) → CI (tdd-ci) → review (reviewer role) → **prepared
PR**. **This skill never merges** — a prepared PR is where the pipeline pauses
for founder approval; on "approved" the orchestrator (main session) merges. Any
merge attempt from a subagent is hook-blocked anyway.

**This stack is non-web** (Python pipeline/CLI), so the default evidence is
**terminal transcripts**: the test-run output and a real invocation through the
system's boundary. Playwright screenshots/recordings apply only if a web slice
ever appears; the collector supports both.

Bundled resources:
- `assets/pr-body-template.md` — PR description structure (with an
  `<!-- EVIDENCE -->` marker the script fills).
- `scripts/collect-evidence.mjs` — copies evidence into
  `docs/tdd-evidence/<feature>/<NN-slice>/`, secret-scans it, and generates the
  PR body. Two-phase: `--copy-only` before the evidence commit, `--body-only`
  after, so embedded links pin to the commit that contains the files. Run with
  Node 18+.

> Requires `gh` authenticated and a GitHub remote (`gh auth status`,
> `git remote -v`).

## Preconditions (verify, don't assume)

1. **The slice is green.** This is proven by the sprint-suite run in Procedure
   step 1 — its exit code and pass summary are the gate, not a separate re-run
   here. Never open a PR on red.

   **Do not run the whole `tests/` tree here.** An acceptance suite belongs to its
   phase, and the full tree costs ~8 minutes of founder wall-clock while proving
   nothing CI is not already proving on every push as the required check. Run the
   sprint suite locally; let CI cover the rest, off the critical path.
2. **Contract movement is disclosed.** If the branch edits a pre-existing test
   under `tests/` or a `specs/` section, the PR body carries a one-line
   justification for each. Undisclosed contract movement is the thing to stop on.
3. **Review, if one ran** (on-demand in v2 — founder-requested or
   high-blast-radius changes), has its findings addressed or logged in the issue.
4. **CI workflow exists** (from `tdd-ci`) and the working tree is committed on
   the slice branch `feat/<feature-slug>/<NN>-<slice-slug>`.

## Procedure

1. **Produce the evidence by actually running the tests.** Capture two
   transcripts to files, run from the slice's project directory:
   - the test run: the **sprint suite** — the exact command declared on the
     sprint's first issue (`Sprint suite:`), which is the src unit
     tier plus this sprint's own acceptance directory. Typically:

     ```
     uv run pytest src -q -m "not slow" -n auto > test-run.txt 2>&1
     uv run pytest tests/<subproject> -q -m "not slow" >> test-run.txt 2>&1
     ```

     This is the green gate for Precondition 1. Because output is redirected to
     the file, the terminal shows nothing on its own: explicitly confirm each exit
     code is 0 and/or check the pass summary lines in `test-run.txt` before
     proceeding. Stop and report on red — never open a PR on red.
   - a real invocation through the boundary (CLI stdout + exit code, or the
     pipeline entry point on a real sample): e.g.
     `uv run axial <args> > cli-demo.txt 2>&1`
   Show real output, not claims.

2. **Copy the evidence in** (`--copy-only`):

   ```
   node "${CLAUDE_SKILL_DIR}/scripts/collect-evidence.mjs" --feature <feature-slug> --slice <NN-slice-slug> --type cli --transcript test-run.txt --transcript cli-demo.txt --copy-only
   ```

3. **Review the collector output for secrets — BEFORE committing.** On
   `SECRETS SUSPECTED`, open the named files and redact. Committed history is
   hard to un-publish. Do not proceed until clean.

4. **Commit the cleaned evidence:**

   ```
   git add docs/tdd-evidence/<feature>/<NN-slice>/
   git commit -m "docs(<feature>): test evidence [slice NN]"
   ```

   Confirm it actually committed (`git show --stat HEAD`).

5. **Generate the PR body** (`--body-only`), pinned to the evidence commit:

   ```
   node "${CLAUDE_SKILL_DIR}/scripts/collect-evidence.mjs" --feature <feature-slug> --slice <NN-slice-slug> --type cli --body-only --template "${CLAUDE_SKILL_DIR}/assets/pr-body-template.md" --out PR_BODY.md
   ```

   Fill the remaining placeholders from the slice plan: description, what
   changed, how to review, unit-test summary, risk notes, the plan path, and the
   **GitHub issue** (`Closes #NN`). Be honest about anything partial.

6. **Push and open the PR** (outward-facing; if running as a subagent, hand the
   push/PR to the orchestrator — pushes of feature branches are open to the
   orchestrator and to roles, pushes to `main` are not):

   ```
   git push -u origin feat/<feature-slug>/<NN-slice-slug>
   gh pr create --base main --head feat/<feature-slug>/<NN-slice-slug> --title "feat(<feature-slug>): <slice goal> [slice NN]" --body-file PR_BODY.md
   ```

   Never force-push. Never target a base other than `main`.

7. **Stop.** Record the PR URL in the slice plan and the issue thread, then
   report `DONE` with the PR URL. **Do not merge, do not enable auto-merge, do
   not delete branches.** The founder reviews; on "approved" the orchestrator
   merges and later runs `safe-cleanup` (also approval-gated).

## Safety rules (non-negotiable)

- **Prepare, never merge.** The hooks enforce this for subagents; honour it
  everywhere.
- Never force-push; never rewrite shared history; never push to `main`.
- Open the PR only on green, with real evidence attached.
- No secrets, tokens, or oversized binaries in the evidence.

## What the founder gets

A PR whose description proves the slice works: the behaviour in plain language,
the red-then-green outer acceptance test, the unit summary, the two-stage review
outcome, a link to the plan and issue, and embedded transcripts of the passing
run and a real invocation.
