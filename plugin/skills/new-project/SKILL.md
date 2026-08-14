---
name: new-project
description: Stand up a new project repository this plugin's lanes and gates can actually work in. Preflight the toolchain, resolve the stack, write the tree with logs/ before any product code, land one green commit on main, prepare the GitHub remote and branch protection for founder approval, then write the project handbook. Trigger on starting a new project, repo, or codebase from scratch, on scaffolding or bootstrapping an empty folder, on setting up the engineering org somewhere for the first time, or on asking what to do first after installing this plugin. To slice work inside a project that already exists, use tdd-plan instead.
---

# New Project — from an empty directory to a green first commit

Every other skill here assumes the organization already exists: a repository with
a handbook, a green suite, a remote, branch protection, and gates that can tell
what the project's test command is. This skill is what stands that up.

Two stages. Stage 0 produces the repository and stops at a checkpoint for the
remote and its branch protection. Stage 1 writes the handbook every session and
subagent inherits. Nothing else is scaffolded, because the harness ships as an
installed plugin rather than as files copied into the project.

Bundled resource:

- `${CLAUDE_PLUGIN_ROOT}/skills/new-project/assets/scaffold-plan.json` — the
  ordered step list, the tree it produces, and the Node starting seed. Read it
  and follow the array order literally. It is data only; nothing in it is prose,
  and the two authored files carry no content there by design.

## Stage 0 — repository foundation

1. **Preflight the toolchain.** Three checks, all of them before anything is
   written:

   ```
   git --version
   gh auth status
   node --version
   ```

   The node check is the load-bearing one. A hook that cannot start its runtime
   exits non-zero but not 2, which Claude Code treats as a non-blocking error, so
   the tool call proceeds and the gate fails open
   ([D8](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)). A project scaffolded on a machine
   without node on `PATH` gets gates that guard nothing and look installed. If
   node does not resolve, say so plainly and stop; Node 18 or newer is the
   prerequisite. A missing or unauthenticated `gh` does not stop Stage 0's local
   work, but it does stop the checkpoint, so raise it now rather than at step 7.

2. **Settle the stack and the test command, never guess either.** Two outcomes,
   and they lead different places.

   - **The directory is empty**, which is the ordinary case. Ask the founder
     which stack the product is in. One question, answered before anything is
     written. Do not infer a stack from the product description and do not
     default to one.
   - **The directory already holds a project.** The scaffold wraps the
     organization around what is there. Find how it is already tested — the
     script its manifest defines, a Makefile target, whatever a contributor
     actually types — and confirm that command with the founder. Skip the seed
     entirely: do not write a second manifest over a project that has one.

   Either way you finish this step holding one command line: the thing that runs
   this project's fast suite. That is what step 3 records and what the commit
   gate will run on every commit from here on
   ([D10](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)). The gate never invents a command
   and never falls back to one, so a project with no record blocks every commit
   until the record exists. A gate that runs nothing and says OK is worse than no
   gate.

3. **Write the tree, in the plan's order.** Walk `scaffold-plan.json`'s `steps`
   array from the top, taking every step whose `stage` is 0, and create each path
   as you reach it.

   `logs/` is first and that is not cosmetic. It is where every run record this
   plugin writes will land, and a project that gets its observability after its
   first product code is a project whose first runs went unrecorded.
   Nothing under `src/`, no project manifest, and no test file is created before
   `logs/` exists on disk.

   For the three steps carrying `from`, take the path and the content from the
   seed for the chosen stack. Node is the only seeded stack, because node is the
   one toolchain this plugin already requires, so it is the only one a seed can
   assume is installed. For any other stack, write the project's manifest, one
   trivial passing test, and `aeo-tests.json` yourself, to that stack's own
   conventions: a `go.mod` and a `_test.go` with `{"test": "go test ./..."}`, a
   `Cargo.toml` and a `#[test]` with `{"test": "cargo test"}`. Step 4 is what
   confirms you got it right, so write the smallest thing that could work and let
   the check tell you.

   `aeo-tests.json` is the project's record of its own test command, and it is
   the whole of what the commit gate reads. One key, `test`, holding a command
   line rather than a list — a project that needs two suites writes
   `npm test && pytest`. There is no directory field, because the record runs
   where it sits; a mono-repo puts one record in each project directory and the
   nearest one above a changed file is the one that runs. It is tracked in git
   and it is deliberately not under `.claude/`, so that a builder who changes the
   test setup can update it in the same slice.

   The two steps marked `authored` are yours to write, not the plan's to hand
   you. `README.md` is one paragraph in the founder's own words: what this
   product is. `CLAUDE.md` is stage 1.

   One of the tracked steps is `.claude/settings.json`, declaring
   `AEO_LIVE_DATA_ROOT` and `AEO_DATA_ROOT` both blank. This is Claude Code's own
   settings file, not a place to configure this plugin, and `.gitignore` only
   excludes `settings.local.json`, so this one lands in the first commit. A blank
   pair leaves `sandbox-guard` inert — the same state as a fresh install with no
   file at all — rather than accidentally refusing every command. Point the
   founder at it in your Stage-0 report: filling in `AEO_LIVE_DATA_ROOT` with the
   absolute path to wherever this project's production data lives, and
   `AEO_DATA_ROOT` with a sandbox path outside it, is what turns the guard on.

4. **Confirm the gate can see the project.** Run the resolver the commit gate
   uses, from the target directory:

   ```
   node --input-type=module -e "import { pathToFileURL } from 'node:url'; const m = await import(pathToFileURL('${CLAUDE_PLUGIN_ROOT}/hooks/stack.mjs')); console.log(JSON.stringify(m.resolveTestPlan({ toplevel: process.cwd(), files: [] }), null, 2));"
   ```

   The `pathToFileURL` wrapper is not decoration. A bare dynamic import of an
   absolute Windows path is read as a `d:` URL scheme and refused.

   It must return exactly one unit whose `command` is the command line you
   settled in step 2. Anything else means the record is missing, in the wrong
   place, or does not parse — the output says which. Fix the record and do not
   proceed on the assumption that it will sort itself out later.

5. **Run that command and require green.** Not a command you think is
   equivalent; the one the record names. A red or erroring baseline means
   the first commit installs a suite the commit gate will refuse, and the founder
   discovers it on their first real change instead of now.

6. **Initialize git and commit once.**

   ```
   git init -b main
   git add -A
   git commit -m "chore: scaffold the project"
   ```

   Exactly one commit, on `main`. Verify it: `git log --oneline` shows one line
   and `git rev-parse --abbrev-ref HEAD` says `main`.

   The commit gate allows this one and refuses every commit on `main` after it.
   Before the first commit exists, `HEAD` is unborn and there is no branch for the
   gate to compare, which is deliberate rather than a loophole: blocking here would
   make the first commit in a new repository impossible. The gate still runs the
   suite, which is the other reason step 5 has to be green before you get here.

7. **⛔ Checkpoint — the remote and its branch protection.** Prepare both
   commands, fill in the owner and repository name, and present them to the
   founder with what each does. On an explicit approval, run them yourself. Do
   not hand the founder commands to type.

   ```
   gh repo create <owner>/<repo> --private --source=. --remote=origin --push
   ```

   ```
   gh api -X PUT repos/<owner>/<repo>/branches/main/protection \
     -H "Accept: application/vnd.github+json" \
     -F 'required_pull_request_reviews[required_approving_review_count]=0' \
     -F 'enforce_admins=true' \
     -F 'required_status_checks=null' \
     -F 'restrictions=null'
   ```

   That protection shape is deliberate. A pull request is required before a merge
   and direct pushes to `main` are blocked for admins too, so the rule holds for
   the founder's own hands and not only for the roles. The approving review count
   is zero because a solo founder cannot approve their own pull request, and
   requiring one review would deadlock every merge; merge authority lives in the
   founder's explicit approval and in the merge gate, not in a review counter.
   Required status checks are left null until CI exists to name, which `tdd-ci`
   creates on the first slice.

   Every value that is not a string carries `-F`, and that is load-bearing rather
   than stylistic. `gh api -f` sends its value as a string, so the review count
   would go as `"0"` against a field the API types as an integer and the whole
   call would be rejected.

   Two things belong in the checkpoint as choices rather than as assertions.
   Visibility is the founder's call, and the command above defaults to private
   only because that is the safer default to present. Whether protection is
   available at all is the other, and it is settled by attempting the call rather
   than by inspecting the account first. Do not look up the plan tier: `gh api
   user` reports `plan` only on a token carrying the `user` scope, which
   `gh auth login` does not grant, so on an ordinary token the field comes back
   null and answers nothing. Run the protection call and read what comes back.

   - **Success.** Protection is on. Report the properties it set.
   - **403.** The tier refusal. Protection on a private repository has
     historically required a paid GitHub tier, and this is where that bites. It
     is a cost decision and it belongs to the founder, so put the real options to
     them rather than choosing one: public visibility, a paid plan, or running
     without the server-side backstop and relying on the merge gate alone.
   - **422.** A malformed request — a bug in the command rather than a limit on
     the account. The message names the property the API rejected. Fix the
     command and rerun it, and do not present a cost decision the account is not
     actually facing.

   Then report: the tree, the recorded test command, the green baseline, the one
   commit, whether protection is on, and that `.claude/settings.json` declares
   `AEO_LIVE_DATA_ROOT` and `AEO_DATA_ROOT` blank for the founder to fill in
   whenever this project has production data to protect.

## Stage 1 — the project handbook

`CLAUDE.md` at the repository root, written by you and reviewed by the founder.
Around 100 lines. The constraint is not stylistic: a rulebook nobody can hold
gets resented and routed around, and the length is the only thing keeping it
holdable.

Write it in the product's own terms, in plain, direct prose. Do not paste a
template and do not copy this file's sentences into it. A fresh reader with no
other context must be able to answer two questions from it alone: **who may
merge**, and **what happens when code and spec disagree**. Answer both explicitly
near the top, then elaborate.

Cover these, briefly, in this order:

- **The two rules.** Nothing merges without the founder's word. The roles are
  hook-blocked from merging entirely, and on an approval the main session runs
  the merge itself, so approval is the gate rather than founder execution. And
  specs are living documentation rather than law: whoever changes behavior
  updates the spec in the same pull request, so the founder reviews code and
  contract together. Only a genuinely contested design intent becomes an issue;
  nobody stops the world over wording.

- **The lanes, and which are operator-invoked.** Seven run only when the founder
  types them — `sprint-plan`, `sprint-start`, `fix`, `review`, `triage`,
  `status`, `verify`. The rest trigger on description, so Claude can reach for
  them mid-session: `tdd-plan`, `red-green-refactor`, `tdd-ci`, `safe-pr`,
  `safe-cleanup`, `worker-dispatch`, `monitor-design`, and this one. Say what the
  two or three the founder will actually use do, not the whole list.

- **The roles.** Builder writes `src/`, `tests/` and `specs/`, never `.claude/`,
  and never merges. Reviewer and verifier are read-only; the reviewer reads
  every pull request, the verifier only when the risk rubric asks for it.
  Triage scopes and files nothing. One short paragraph.

- **Build philosophy, as its own top-level section.** Never a closing bullet: a
  principle without tripwires does not bind. Practicality over perfectionism,
  the smallest thing that meets a strict acceptance bar, do not reinvent the
  wheel, measure rather than speculate.

- **Over-engineering tripwires, as their own section under it.** Hitting one
  means stop and simplify, or keep it and justify it in one line in the pull
  request body. A hand-tuned constant or magic number in a heuristic. An
  abstraction with one implementation. A config option nobody sets. A fix larger
  than its bug, or test scaffolding larger than the behavior it pins.
  Hand-rolling what a library or a single model call already does. Close it with
  the reason: surplus quality nobody asked for costs review now and maintenance
  forever, so polishing past the bar is a process defect rather than diligence.

- **The gates, and what each refuses.** These are hooks with exit-code
  enforcement, not advice. `commit-gate` refuses a commit on the protected branch
  and a commit while the suite is red or `aeo-tests.json` records no command.
  `block-merge` refuses a role or the GitHub forge tool merging, deleting a
  branch, or pushing to the protected branch. `path-guard` refuses a role editing
  the harness's own `.claude/` configuration. `sandbox-guard` refuses anything
  reaching declared production data — `.claude/settings.json` ships with
  `AEO_LIVE_DATA_ROOT` and `AEO_DATA_ROOT` blank, and the guard stays off until
  you fill both in. `review-jail` confines the reviewer and verifier to reading
  their own staged evidence. `session-status` refuses nothing; it reports which
  of the others are actually wired. Close with: if a gate fires, fix the cause,
  never the hook.

- **Conventions**, in a few lines. Model tiering, the four statuses
  (`DONE`, `DONE_WITH_CONCERNS`, `BLOCKED`, `NEEDS_CONTEXT`), and the prose rules
  the project wants for anything generated.

Land the handbook on a branch and through a pull request rather than straight on
`main`. Branch protection now forbids the direct push anyway, and the first real
exercise of the gates the founder just approved is worth more than one saved
minute. Then stop for the founder's approval of the wording.

## Safety rules

- Scaffold only into the directory the founder named. Never into this plugin's
  own repository, and never into `~/.claude`.
- One question about the stack, asked before anything is written. Never a guess
  and never a silent default. The test command is recorded because somebody
  settled it, never because a table produced it.
- The first commit lands green or it does not land.
- `gh repo create` and the branch-protection call are outward-facing and wait for
  an explicit approval. Prepared by this skill, run by the main session, never
  handed to the founder to type.
- This skill never merges anything and never opens a pull request on its own
  judgment.
