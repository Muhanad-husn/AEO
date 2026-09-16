---
name: new-project
description: Stand up a new project repository with its goal already written down, so its first session start reads a real number instead of "none declared". Asks which product oracle the project has before writing a line, then writes the tree with logs/ first, RULES.md with a kill line, PLAN.md with a status table, LEDGER.md when money moves and COMMITMENTS.md, lands one green commit on main, and prepares the GitHub remote and its branch protection for the founder. Trigger on starting a new project, repo or codebase from scratch, on scaffolding or bootstrapping an empty folder, or on asking what to do first after installing this plugin.
---

# New project

An empty directory becomes a repository with one green commit on `main` and with the files
the session-start sensorium reads. A project scaffolded without them is one whose every
session start says `none declared` on every line.

Bundled resource: `${CLAUDE_PLUGIN_ROOT}/skills/new-project/assets/scaffold-plan.json`.
It holds the steps and the tree they produce, the answers this skill asks for, the
per-stack seeds, and the rule for filing the founder's own documents. It is data: a step
marked `authored` carries no text there and never will, and its words are yours to write.

## The question asked first

**Which oracle tells this project it is right?** `answers.oracle` offers four.

- *a key and rubric*, when the deliverable can be scored against something already known
- *an acceptance suite*, when a sample set says pass or fail
- *the founder as reader*, with a written checklist, when judgement is the only oracle
- *none yet*, an honest answer that stays visible until it changes

*None yet* still gets a status table, so its score prints as `0 of <n> phases done`.

**Does money move, and what is the ceiling?** A yes writes `LEDGER.md` with the number in
its first line. A no writes no ledger at all, which is what `when` on that step means. Ask
both questions, and the stack question, before writing anything.

## What the scaffold leaves behind, and why each file is there

- **`RULES.md`**, one page, carrying a `**Kill line.**` item. The kill line is the bar the
  sensorium prints beside the score (phase 2 decision 4). It says what result means the
  method is wrong rather than the attempt; a project that cannot say that has no bar.
- **`PLAN.md`**, with a status table under a `Status` heading whose header runs
  `| Phase | State | Score |`. That table is the oracle as the harness sees it (phase 2
  decision 3), one row per phase, `State` turning `done` as each closes.
- **`LEDGER.md`**, when money moves: first line holding `Ceiling $<n>`, then a table with
  `Phase`, `Dollars` and `Balance` columns. A phase's dollars are summed from here and
  never from the status table (phase 0 decision 2).
- **`COMMITMENTS.md`**, empty apart from its `| Date | Recommendation | Executed |`
  header. One row per session's closing recommendation, judged at the next session start
  (phase 0 decision 4). Empty is the right starting state; absent is not.
- **`README.md`**, one paragraph in the founder's own words about what this product is.

Each of those strings is a marker a reader under `plugin/hooks/` matches on, which is why
the steps declare them in `requires`. A file that keeps its heading but loses its marker
still looks written and reports nothing.

## The rest of the tree

Walk `steps` in array order, taking every step whose `stage` is 0 and whose `when` matches
the answers. `logs/` is first, and that is not cosmetic: every run record this plugin
writes lands there, and a project that gets its observability after its first product code
is one whose first runs went unrecorded. Nothing under `src/` and no manifest exists
before `logs/` does.

Before any of that, file the founder's own Markdown from the project root into
`founderDocs.destination`, skipping the fixed `excludeAtRoot` names. A PRD is the input
this skill starts from, not something it produces (issue #124). A name already taken under
`docs/` stays at the root and is named in the report.

Steps carrying `from` take path and content from the chosen stack's seed. Node is the only
seeded stack, because node is the one toolchain this plugin already requires (D8). For any
other stack write the manifest, one trivial passing test and `aeo-tests.json` yourself, to
that stack's conventions. `aeo-tests.json` is the project's record of its own test
command, one key holding one command line, tracked in git (D29, amended by D30).
`sandbox-guard` reads it to recognise this project's suite by name, so a suite it cannot
name is one it cannot hold back while a long job runs. Confirm the record resolves to
exactly one unit by calling `resolveTestPlan` from `${CLAUDE_PLUGIN_ROOT}/hooks/stack.mjs`
with the target directory as `toplevel`, importing it through `pathToFileURL`, since a
bare dynamic import of an absolute Windows path is read as a `d:` URL scheme and fails.
Then run the command it names and require green. Exactly one commit lands, on `main`,
green, or the founder's first real change is where they find out the baseline was never
trustworthy.

## The remote and its branch protection

Outward-facing, so both commands are prepared with the owner and repository filled in, put
to the founder, and run by you on an explicit approval rather than handed over to type.

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

Every non-string value carries `-F`, and that is load-bearing. `gh api -f` sends its value
as a string, the API types the review count as an integer, and the call comes back 422
having set nothing. The review count is zero because a solo founder cannot approve their
own pull request. Status checks stay null until CI exists to name, and
`enforce_admins=true` makes the rule hold for the founder's own hands.

Whether protection is available at all is settled by making the call, never by inspecting
the account: `gh api user` reports `plan` only on a token carrying the `user` scope, which
`gh auth login` does not grant. A 403 is the tier answer and a cost decision belonging to
the founder, so put the real options to them rather than picking one. A 422 is a bug in
the command; the message names the property.

## The handbook, and the bounds

`CLAUDE.md` at the root, around 100 lines, in the product's own terms and never a pasted
template. A fresh reader with no other context should be able to answer two questions from
it alone: who may merge, and what happens when code and spec disagree. Land it on a branch
and through a pull request, since branch protection now forbids the direct push.

Scaffold only into the directory the founder named, never into this plugin's own
repository and never into `~/.claude`. A table producing an answer nobody gave is how a
project ends up with a bar it never chose. This skill does not merge and does not open a
pull request on its own judgement.
