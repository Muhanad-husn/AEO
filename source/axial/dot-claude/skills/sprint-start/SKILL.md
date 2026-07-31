---
name: sprint-start
description: Start executing the next sprint issue - selects the next unblocked issue by dependency, dispatches the builder to take it test-first from red to green (spec updated in the same branch if behavior moves), then prepares the PR and stops for founder approval. Use when the founder says 'start the sprint', 'next issue', or 'continue the sprint'.
---

# Sprint Start — Drive One Issue to a PR

Run from the **main session (orchestrator)**, ideally fresh (`/clear` first — the
issue and its plan carry all context). Take exactly **one issue** from selection to
a prepared PR. The founder runs nothing and approves the merge at the end.

The session is bookended by two short briefs to the founder — a kickoff before any
code, a wrap-up at the pause. Each has a plain-language part (what the product
gains, no jargon) and a technical part (issue, files, test shape / what changed).
They are the founder's window into the session; keep them short.

## Procedure

1. **Select the issue.** List open sprint issues (`list_issues`, filtered on the
   `sub:<subproject>` label). Pick the first whose `Depends on:` issues are all
   closed and which carries no `blocked` / `needs-context` label. Confirm with the
   founder only if two candidates are equally next.

2. **Load the context.** Read the issue, its slice plan under `plans/`, and the
   spec section it cites. A missing or stale spec section is not a stop: the
   builder drafts or corrects it in the branch, and the PR shows the founder both.

3. **Kickoff brief** (plain + technical + one-line "done when").

4. **Cut the worktree.** Every issue is built in its own worktree — no
   exceptions, even when it is the only issue in flight. Pull `main` first, then

   ```
   git worktree add -b feat/<feature-slug>/<NN>-<slice-slug> .claude/worktrees/<NN>-<slice-slug> main
   ```

   and give the builder that absolute path as its working directory. `data/` is
   gitignored and therefore absent in a worktree: any corpus pass the slice needs
   runs in the main checkout `D:/axial`, never there.

5. **Dispatch the builder.** One agent, whole slice: acceptance test written first
   from the spec and watched failing, then implementation to green, test and code
   committed together. **Test scope in the dispatch: the builder runs only its own
   tests** — the test files this slice writes or changes — on top of the automatic
   src-tier commit gate. The phase suite is never run locally; CI runs the full
   `tests/` tree on every push as the required check. On the sprint's first issue,
   declare the phase suite command as a `Sprint suite:` comment on that issue so
   CI expectations are on the record; later issues reference it. If the builder
   edits a pre-existing test or a spec, that gets one explanatory line in the PR
   body. If it reports BLOCKED on a contested design question, put the question to
   the founder and stop.

6. **Review only when warranted.** Dispatch the reviewer if the founder asks, or
   if the change is high-blast-radius (shared modules like `llm.py` / `cli.py` /
   config loading, or anything touching corpus-facing heuristics). Otherwise CI
   plus the founder's PR review is the check.

7. **Prepare the PR** with `safe-pr`: evidence collected and secret-scanned, branch
   pushed, PR opened into `main` with `Closes #<issue>`. Call out cross-phase
   blast radius in the body and wait for CI green. **The pipeline stops here.**

8. **Wrap-up brief, then report and pause.** Post the PR link to the issue, report
   `DONE` with the URL. On the founder's **"approved"** the orchestrator merges,
   runs `/safe-cleanup` on the merged branch (cleanup is pre-approved), then
   `git worktree remove <path>` and `git worktree prune`.

## Invariants

- One issue = one worktree = one branch = one PR. Never batch.
- Both briefs happen; no session runs dark.
- Subagents never merge (hook-enforced); the orchestrator merges only on the
  founder's word. If a gate fires, fix the cause, never the hook.
- A corpus-facing heuristic is validated on the real corpus before promotion; a
  green suite alone is not evidence.
- Labels (`blocked` / `needs-context` / `done-with-concerns`) reflect reality on
  the issue at all times.
