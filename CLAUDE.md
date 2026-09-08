# AEO handbook

Read `RULES.md` first. It is one page and binding. This file says how a session works
here; it does not repeat the rules.

**What this is.** The harness repository. `plugin/` is the first build, `v0.2.0`:
fifteen skills, five agents, six hooks, lanes from issue to pull request. It ran
`RLM-Challenge` for sixteen days and 122 pull requests without a graded report. The RLM
rebuild ran under one page of rules, one hook and two skills, and reached rubric 90 on
the reference sample in four days for $3.50 (`D:\RLM`, `PLAN.md` section 4a). This
repository is now run the same way. What it builds next is the founder's decision and
goes in `PLAN.md` when he opens it. `plugin/`, `docs/`, `logs/` and `source/` are the
first build's record: read them for the incidents they hold, never for the process.

**Who decides.** Muhanad. He merges. He wants one recommendation with the number behind
it, not an options list, and no reminders about what is uncommitted.

**How work moves.** One issue is one session and one pull request. The founder reads the
pull request and merges or not. There are no reviewer or verifier roles, no evidence
packets, no fix rounds, no pull request template. A pull request body says what changed,
what it cost, and which consumer number it expects to move.

**How an issue is built** (the founder's rules, 2026-09-05, carried from RLM):
1. One git worktree per issue.
2. Code is written by a dispatched agent: Opus for a hard slice, Sonnet for an easy one.
3. Prose is written by a dispatched Haiku agent. A rule or a skill is code-grade prose
   and takes the slice's tier instead.
4. Prose gets no mechanical test. Text is read, diffed and fixed by hand. The eval scripts
   under `evals/` still run; they gate nothing.
5. A coding task starts with its behavioural tests. They are committed red; the builder
   makes them green with the minimum code; then refactor and retest.
6. Unblocked issues run concurrently, at most four at a time.
7. The founder is briefed in concise executive style: no jargon, actionable points, one
   recommendation.

**The harness: one hook, two skills, one readout, nothing else.**
- `block-merge`, at `~/.claude/hooks/block-merge.mjs`, wired in `~/.claude/settings.json`.
  It keeps merging and branch deletion with the founder and applies to every subagent.
  Known limit: it matches command text, so a subagent cannot grep for or commit a message
  containing the two words `git merge` side by side; write them apart.
- `/sprint-plan`, typed by the founder once per phase. It slices the phase into issues
  under `plans/` and files them on his approval.
- `/status`, for the readout at any time. The same renderer runs at session start from
  `.claude/settings.local.json`, so every session opens on the open issues and pull
  requests rather than on a memory file's word for them.
- Not used, and not to be invoked by name or by description: the `aeo` plugin. It is off
  in `.claude/settings.local.json`. None of its lanes, agents or gates run here, and
  nothing under `plugin/` is loaded. Building is done by plain dispatched agents under the
  rules above.

**Tracking.** GitHub issues and milestones, one issue per slice. A phase's closing pull
request writes its row into `PLAN.md`'s status table. `docs/DECISIONS.md` is the first
build's log and is closed at D35; a new decision is one line in `PLAN.md`, dated.

**Tests.** `npm test` is the fast tier and runs locally. `npm run test:integration` runs
in CI only; a tier CI already ran on a commit is cited, never re-run. A harness red gets
minutes. A logic red gets two attempts.

**Worktrees and branches.** Cut from `main`, one per issue, deleted after merge. Nothing
is left behind that a later session has to classify.

**Prose.** Plain, no em dashes, certainty words inherited from the source. This applies
to code comments, commit messages and pull request bodies.

**Reporting.** What shipped, what it cost, one recommendation. One message per phase and
per day.
