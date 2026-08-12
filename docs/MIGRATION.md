# Migration

What happens to the global `agentic-engineering-org` skill and to `D:\axial\.claude\`
once the plugin ships. Presented for approval. **Nothing in this document has been
executed, and P7.5 executed no part of it.**

Written 2026-08-13, against the trees as they actually are on this machine on that date.

## The thing that changed before the plan was written

Both trees were already retired, by founder decision, on **2026-08-12**, one day before
this plan. The plan you are reading is therefore not a plan to remove anything. It is a
plan to finish a switch that is already half-done.

| | Global skill | Axial harness |
| --- | --- | --- |
| State | Deleted | Deleted |
| When | 2026-08-12, ~23:46 | 2026-08-12, 23:50:50 (`settings.json` emptied); recorded 23:52 |
| Record | none in the repo it served | Axial `docs/DECISIONS.md`, **DEC-70**, commit `ede0223` |
| Backup | `C:\Users\mou97\.claude\backups\agentic-engineering-org-retired-2026-08-12.tar.gz` | `C:\Users\mou97\.claude\backups\axial-harness-retired-2026-08-12.tar.gz` **and** `github.com/Muhanad-husn/axial-harness` (private) |

`C:\Users\mou97\.claude\skills\` now holds two unrelated skills, `plan-sessions` and
`start-session`. Nothing under `~/.claude/` mentions `agentic-engineering-org` any more.

`D:\axial\.claude\` now holds only what the retirement deliberately kept:
`settings.json` (contents: `{}`), `settings.local.json`, `tools/axial-watch.py`,
`tools/run-monitor.py`, `obsidian-backup-2026-08-03/`, `scheduled_tasks.lock`, and an
empty `worktrees/`. No agents, no hooks, no skills.

Three consequences run through everything below.

1. **The gate outage is not a future risk. It is open now**, and has been since
   2026-08-12 23:50. See "What axial has lost".
2. **The rollback question is answerable with a file path**, because the backups already
   exist and one of them has been verified.
3. **`source/global-skill/` is not the surviving copy of the retired skill.** It is a
   stale copy taken earlier. The tarball is newer. See "Stale snapshots".

## 1. Per-path disposition

Every file that existed in each tree at the moment of its retirement. Three dispositions:
**superseded** (the plugin does this job), **kept** (survives, plugin has no claim on it),
**gap** (nothing in the plugin does this job).

### Tree A — `C:\Users\mou97\.claude\skills\agentic-engineering-org\` (7 files)

| Path | Disposition | Plugin equivalent |
| --- | --- | --- |
| `SKILL.md` | **Gap** | None. This is the scaffolder: detect the stack, write the tree, write the handbook. Phase 6 builds it, and Phase 6 is deferred until the plugin has been used |
| `references/agents.md` | Superseded | `plugin/agents/` — five charters (builder, reviewer, triage, verifier, monitor-designer) |
| `references/hooks.md` | Superseded | `plugin/hooks/*.mjs` + `hooks.json`; the lessons it carried are restated in `docs/EVIDENCE.md` |
| `references/harness-and-sprint.md` | Superseded | `plugin/skills/{sprint-plan,sprint-start,red-green-refactor,safe-pr,safe-cleanup,worker-dispatch}` |
| `references/directory-tree.md` | **Gap** | None. The scaffold skeleton. Read only by the scaffolder, so it is blocked on the same deferred phase |
| `references/claude-md-handbook.md` | **Gap** | None. How to write a project's `CLAUDE.md`. Same deferred phase |
| `evals/evals.json` | **Partial gap** | `evals/grade-plugin.mjs` grades the shipped tree. The trigger eval this file fed moves to Phase 6 ([D23](DECISIONS.md)), so no trigger measurement exists today |

Two further artifacts went with it:

| Artifact | Disposition |
| --- | --- |
| `agentic-engineering-org.skill` (41,167 bytes, the packaged bundle) | Superseded by plugin packaging: `.claude-plugin/marketplace.json` + `plugin/.claude-plugin/plugin.json` |
| `~/.claude/skills/agentic-engineering-org-workspace/` (186 files, the eval workspace) | **Kept as provenance**, in `source/global-workspace/` and in the tarball. Its `benchmark.json` holds the number P7.2 measures against: with-skill pass rate 1.0 against without-skill 0.27–0.45 |

**Three of seven files are gaps, and they are the same gap.** The plugin ships the org
but not the thing that creates the org. Everything a running project needs is superseded.
Everything a *new* project needs to become such a project is missing. That is the
scaffolder, and it is not an oversight: Phase 6 owns it and was deliberately deferred
until Phase 7's dry run produces usage to tune against. It does mean a reader installing
the plugin into an empty repository today gets lanes and gates and no starting shape.

### Tree B — `D:\axial\.claude\` (38 files) plus `CLAUDE.local.md`

**Agents (5)**

| Path | Disposition | Plugin equivalent |
| --- | --- | --- |
| `agents/builder.md` | Superseded | `plugin/agents/builder.md` |
| `agents/reviewer.md` | Superseded | `plugin/agents/reviewer.md`, plus the `review-jail.mjs` seal |
| `agents/triage.md` | Superseded | `plugin/agents/triage.md` |
| `agents/spec-author.md` | **Deliberate drop** | None. Removed at P0.3 as dead weight (V-07): it appeared in no lane and no skill |
| `agents/peer-reviewer.md` | **Deliberate drop** | None. A sealed academic judge for Axial's product, not an engineering role. Its *seal* ports; its job does not |

**Hooks (7 files, 6 gates)**

| Path | Disposition | Plugin equivalent |
| --- | --- | --- |
| `hooks/commit-gate.ps1` | Superseded | `plugin/hooks/commit-gate.mjs`, with the toolchain resolved by `stack.mjs` instead of hard-coded |
| `hooks/block-merge.ps1` | Superseded | `plugin/hooks/block-merge.mjs` |
| `hooks/path-guard.ps1` | Superseded | `plugin/hooks/path-guard.mjs` |
| `hooks/session-status.ps1` | Superseded | `plugin/hooks/session-status.mjs` |
| `hooks/seal-packet.ps1` | Superseded | `plugin/hooks/review-jail.mjs`, re-scoped (see divergence 6) |
| `hooks/format.ps1` | **Deliberate drop** | None. [D13](DECISIONS.md): it never blocked, hard-coded `ruff`, carried an unfixed bug, and silently rewrote the user's files |
| `hooks/.gitkeep` | Deleted | Placeholder |

**Wiring and local settings (2)**

| Path | Disposition | Plugin equivalent |
| --- | --- | --- |
| `settings.json` | Superseded | `plugin/hooks/hooks.json`. Axial's copy is already `{}` and stays that way |
| `settings.local.json` | **Kept** | Machine-local permission allow-list. Nothing to do with the harness; contains no credential |

**Skills (21 files, 10 skills)**

All ten are superseded, one for one: `fix`, `red-green-refactor`, `review`,
`safe-cleanup`, `safe-pr`, `sprint-plan`, `sprint-start`, `tdd-ci`, `tdd-plan`, `triage`,
each at `plugin/skills/<name>/` with its references, assets and scripts. The plugin adds
four the harness never had: `monitor-design`, `verify`, `worker-dispatch`, and `status`.

**Tools (3)**

| Path | Disposition | Plugin equivalent |
| --- | --- | --- |
| `tools/run-monitor.py` | Superseded | `plugin/scripts/run-monitor.mjs`, generalized off Axial's stage map. The Python file stays on disk in axial and is now dead |
| `tools/axial-watch.py` | **Gap** | None. Per-unit cost, latency, token and ETA reporting. `monitor-design` is where such an overlay belongs, but no overlay ships, and the plugin has no cost accounting at all |
| `tools/snapshot-harness.py` | **Obsolete by design** | None needed. It existed because `.claude/` was gitignored and had no history (V-06). An installed plugin has version history by construction |

**Handbook**

| Path | Disposition |
| --- | --- |
| `CLAUDE.local.md` | **Kept.** Already rewritten on 2026-08-12 (135 lines down to 54) to describe a post-harness Axial. Nothing further to do |

### Every gap, in one list

1. **The scaffolder** (`SKILL.md`, `directory-tree.md`, `claude-md-handbook.md`). No
   plugin equivalent. Phase 6, deferred. The plugin cannot yet stand up a new project.
2. **Trigger measurement** (`evals/evals.json`). Deferred to Phase 6 with the
   descriptions it would measure ([D23](DECISIONS.md)).
3. **Cost and ETA reporting** (`axial-watch.py`). No plugin equivalent, no phase owns it,
   and `monitor-design` only describes where it would go. Of every gap here this is the
   one nothing is scheduled to close.
4. **`status`** ships as a stub that declares its contract and says so. It is not a gap in
   the trees, but it is a hole in the plugin a migrating reader will meet.

## 2. What axial has lost, and for how long

**The switch is not atomic, and it was not made atomic.** The local harness came out on
2026-08-12 23:50. The plugin is not installed. Axial has had no local gates since then.
As of 2026-08-13 that window is about one day old and still open.

What is not running:

| Gate | What it enforced | Since 2026-08-12 |
| --- | --- | --- |
| `commit-gate.ps1` | Suite green and lint clean before any commit; no code commits on `main` | Not running |
| `block-merge.ps1` | Subagents never merge, never push to `main`, never delete a branch | Not running |
| `path-guard.ps1` | Role subagents cannot write into `.claude/` | Not running |
| `session-status.ps1` | Live branch, issue and PR state injected at session start | Not running |
| `seal-packet.ps1` | The peer reviewer reaches nothing but its packet | Not running |

What still holds, per DEC-70:

- **CI on every push** runs the full `tests/` tree and is the required PR check.
- **Server-side branch protection** requires a pull request, so the merge seat is still
  the founder's. This is the one property the local gates duplicated rather than owned.

So the real loss is **pre-commit**, not pre-merge: nothing stops a red commit or a commit
straight onto `main` locally, and a bad commit is caught minutes later by CI instead of
seconds earlier by a hook. DEC-70 accepted that, and Axial's `CLAUDE.local.md` already
states the manual replacement: `uv run pytest src -q -m "not slow" -n auto` plus
`uv run ruff check` before committing.

**How to keep the window short.** It cannot be shortened retroactively. It can be closed
in one step, because installing the plugin is a settings edit and a restart, not a
migration:

1. Add `"aeo@aeo": true` to `enabledPlugins` in `~/.claude/settings.json`.
2. Restart Claude Code.
3. Confirm at session start. `session-status.mjs` reports gate health in its first block;
   `hooks.json` also emits an explicit line when `node` does not resolve, because a hook
   that cannot start fails open ([D8](DECISIONS.md)).

The marketplace is already registered: `~/.claude/settings.json` carries
`extraKnownMarketplaces.aeo` as a **directory** source at `D:\AEO`, recorded
2026-08-04. `aeo@aeo` appears in neither `enabledPlugins` nor
`~/.claude/plugins/installed_plugins.json`, so the plugin has never been enabled.

**Two caveats on that install.** A directory source makes the plugin root the development
tree, so every edit in `D:\AEO\plugin\` takes effect in axial on the next session. That is
useful while proving it and wrong afterwards. P7.3 requires a clean install from GitHub
into a fresh repository, and that is the one to keep. Second,
`~/.claude/plugins/cache/` still holds `aeo/` and `aeo-phase0-verify/` from Phase 0
verification; they are stale and should be removed before an install so that what runs is
unambiguous.

## 3. Divergences the plugin does not carry

Compared against the harness as it was at retirement, not against the snapshot.

| # | What axial did | Status | Reason |
| --- | --- | --- | --- |
| 1 | `format.ps1` reformatted every written file | Deliberate drop | [D13](DECISIONS.md). Never blocked, hard-coded `ruff`, and rewrote files the user did not ask it to touch. Formatting belongs to the project's own pre-commit or CI |
| 2 | `spec-author` role | Deliberate drop | V-07. Referenced by no lane and no skill |
| 3 | `peer-reviewer` role, an academic judge pinned to `claude-opus-5` | Deliberate drop | Product-specific to Axial. The plugin ports the seal, not the judge |
| 4 | `axial-watch.py`: per-unit cost, latency, tokens, ETA, with a pinned price table | **Unshipped** | No plugin equivalent and no phase owns one. The price table was Axial-specific, which is why it was not ported; nothing replaced the capability |
| 5 | `snapshot-harness.py` mirrored `.claude/` into a sibling git repo | Obsolete | V-06. An installed plugin is versioned; there is nothing gitignored to mirror |
| 6 | The seal was attached to one agent through `hooks:` frontmatter on `peer-reviewer.md` | **Re-implemented, not dropped** | Plugin subagents cannot carry `hooks:` frontmatter (C-01), so `review-jail.mjs` is wired globally and self-scopes by role name, anchored because a plugin subagent reports the namespaced `aeo:reviewer` (C-02). Same property, different mechanism |
| 7 | Worktrees lived at `.claude/worktrees/<slug>` | Changed deliberately | The plugin cuts sibling worktrees (`../wt/<n>`). A worktree inside `.claude/` is a second full checkout inside the repo, and [D12](DECISIONS.md) keeps plugin-adjacent state out of that path |
| 8 | Gates hard-coded `uv`, `pytest` and `ruff` | Replaced, not dropped | `stack.mjs` resolves the test command per change (V-05, [D10](DECISIONS.md)) |

Nothing in the retired harness is unaccounted for. Rows 4 and 6 are the two a reader is
most likely to be surprised by: one is a real capability loss with no owner, the other is
the same guarantee rebuilt on a different mechanism because the old mechanism is
impossible in a plugin.

Going the other way, the plugin carries nine things the harness never had:
`sandbox-guard.mjs`, `sentinel.mjs`, `stack.mjs`, `runlog.mjs`, `independence.mjs`, the
`verifier` and `monitor-designer` roles, and the `worker-dispatch` and `verify` lanes.

## 4. Rollback

Rollback means putting the retired harness back. Both trees are restorable, and neither
restore depends on the plugin being uninstalled first.

### Where the backups are

| Tree | Backup | Size | Contents |
| --- | --- | --- | --- |
| Global skill | `C:\Users\mou97\.claude\backups\agentic-engineering-org-retired-2026-08-12.tar.gz` | 198,850 bytes | 194 files: the skill (7), the packaged `.skill` bundle, the 186-file eval workspace |
| Axial harness | `C:\Users\mou97\.claude\backups\axial-harness-retired-2026-08-12.tar.gz` | 82,112 bytes | 39 files: 38 under `.claude/` plus `CLAUDE.local.md` as it stood before the rewrite |
| Axial harness (second copy) | `github.com/Muhanad-husn/axial-harness`, private, last pushed 2026-08-11T04:07:20Z | — | Same 38 harness files, **minus `settings.local.json`**, plus a README and two non-harness files |

**DEC-70's claim about the GitHub copy was checked, and it holds with one exception.** A
fresh clone diffed against the tarball is byte-identical across every harness file, in
spite of the repo's last push predating the deletion by nearly 42 hours. The one difference is
that the repo does not carry `.claude/settings.local.json`. That file was never deleted
from axial and is still on disk, so nothing is lost, but the two backups are not
interchangeable. **Restore from the tarball.**

### Restoring the global skill

```
mkdir -p ~/.claude/skills
tar -xzf ~/.claude/backups/agentic-engineering-org-retired-2026-08-12.tar.gz \
    -C ~/.claude/skills agentic-engineering-org
```

**How the reader knows it worked.** `~/.claude/skills/agentic-engineering-org/SKILL.md`
exists, and the directory holds exactly 7 files. In a new Claude Code session, the skill
appears in the available-skills list. If the plugin is also enabled, expect the skill and
the plugin's lanes to compete for the same triggers; that is a reason to restore one or
the other, not both.

### Restoring the axial harness

```
tar -xzf ~/.claude/backups/axial-harness-retired-2026-08-12.tar.gz -C D:/axial
```

This overwrites `D:\axial\.claude\settings.json` (currently `{}`) with the wiring, and
overwrites `D:\axial\CLAUDE.local.md` with the pre-retirement 135-line version. Take a
copy of the current 54-line file first if the post-harness notes are worth keeping.

**How the reader knows it worked**, in order of strength:

1. `D:\axial\.claude\` holds `agents/` (5 files), `hooks/` (7), `skills/` (21) and
   `settings.json` with a non-empty `hooks` block.
2. Start a session in `D:\axial`. `session-status.ps1` prints branch, issues and PRs
   before the first prompt. Silence here means the wiring did not load.
3. The real proof is a blocked action, not a present file. On a scratch branch, break a
   test and attempt a commit. The commit gate must refuse with `BLOCKED: test suite is
   red.` A commit that succeeds means the gate is inert, which is exactly the failure
   mode that went unnoticed in production for weeks (see "Stale snapshots").

Nothing needs to be restored in git. The harness was untracked from Axial's repository on
2026-07-17 and `.gitignore` still excludes `.claude/`, so restoring files changes no
tracked content and produces no diff.

## Stale snapshots

`source/` is a verbatim snapshot taken before either retirement. Two parts of it are now
out of date, and both matter.

**`source/global-skill/` is stale, substantially.** The skill kept growing after the
snapshot was taken; its files carry mtimes of 2026-08-11, and the drift is 68 changed
lines in `SKILL.md` and 109 in `references/hooks.md`. What the snapshot is missing:

- **DEC-21**, one issue = one worktree = one branch = one PR, and a whole
  "Worktrees and harness ops" section.
- **The `Bash|PowerShell` matcher rule.** A `matcher: "Bash"` misses the `PowerShell`
  tool, which on this machine is where most commands go
  (`~/.claude/settings.json` sets `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`). In production the
  commit gate matched `Bash` only, so every PowerShell-issued commit skipped the suite,
  the lint check and the no-commits-on-main rule, silently, for weeks.
- **A warning about the `allow-red-commit` escape hatch** surviving a v1 migration as a
  live bypass.

The plugin is not exposed to either. `plugin/hooks/hooks.json` matches
`^(Bash|PowerShell)$` on both shell gates, and `commit-gate.mjs` has no escape hatch and
names the flag only to warn against reintroducing it. The staleness is a documentation
risk, not a shipped defect: **anyone reading `source/global-skill/` as the record of what
the skill finally said will be reading a version that is missing its two hardest-won
lessons.** The tarball is the authoritative copy.

**`source/axial/dot-claude/` is stale in seven files and missing two.** Missing:
`agents/peer-reviewer.md` and `hooks/seal-packet.ps1`, so the snapshot shows five hooks
where DEC-70 retired six. Changed: `commit-gate.ps1` (25 lines: the `allow-red-commit`
hatch removed, PowerShell command parsing added), `block-merge.ps1` (4 lines, the same
parsing), `settings.json` and three agent frontmatters (`Bash` to `Bash|PowerShell`), and
`settings.local.json`. The remaining thirty-one files differ only in line endings. The
skills are untouched.

Neither snapshot should be edited. `source/` is verbatim by rule. The correction belongs
here and in `docs/INVENTORY.md`, which currently describes the axial harness as
"four role agents ... five PowerShell hooks" and is one role and one hook short.

## Order of operations

Steps 1 to 4 are already done. They are numbered anyway, because a reader who has never
touched either tree needs to know they happened and needs to be able to check.

1. **Global skill retired.** Deleted from `~/.claude/skills/`, backed up to
   `~/.claude/backups/agentic-engineering-org-retired-2026-08-12.tar.gz`. **Done
   2026-08-12.** Check: the directory does not exist and the tarball does.
2. **Axial harness retired.** Agents, hooks and skills deleted; `settings.json` emptied
   to `{}`; backed up to the tarball and mirrored to the private `axial-harness` repo.
   **Done 2026-08-12.** Check: `D:\axial\.claude\` holds no `agents/`, `hooks/` or
   `skills/`.
3. **Retirement recorded.** DEC-70 in Axial's `docs/DECISIONS.md`, commit `ede0223`, and
   `CLAUDE.local.md` rewritten to describe a post-harness repo. **Done 2026-08-12.**
4. **Backups verified.** The GitHub copy diffed against the tarball; identical except for
   `settings.local.json`. **Done 2026-08-13**, in this slice.

---

⛔ **APPROVAL POINT. Steps 5 onward are the founder's call and nothing below has been
started.** Checkpoint 7 must pass first: the packaging surface (P7.1), the acceptance
grader re-run (P7.2), the clean install proof (P7.3) and the dry run on a non-Python
stack (P7.4). The gap window in axial stays open until step 7, and that is the cost of
waiting.

---

5. **Clear the stale plugin cache.** Remove `~/.claude/plugins/cache/aeo/` and
   `~/.claude/plugins/cache/aeo-phase0-verify/`, both left over from Phase 0
   verification. Check: neither directory exists.
6. **Install the plugin from GitHub, not from the directory source.** Replace the
   `extraKnownMarketplaces.aeo` directory entry pointing at `D:\AEO` with the GitHub
   source, then install. Check: `aeo@aeo` appears in
   `~/.claude/plugins/installed_plugins.json` with a `gitCommitSha`.
7. **Enable it for axial and close the gap window.** Add `"aeo@aeo": true` to
   `enabledPlugins`, restart, and open a session in `D:\axial`. Check, in order: the
   session-start block prints branch, issues and PRs; no `GATES NOT ENFORCING` line
   appears; a deliberately red commit on a scratch branch is refused.
8. **Confirm the toolchain resolves.** Axial is a `uv`/`pytest`/`ruff` project, and the
   plugin resolves that per change through `stack.mjs` instead of hard-coding it. Check:
   the commit gate runs Axial's suite, not a guess at one.
9. **Correct `docs/INVENTORY.md`** for the two stale snapshots, naming the six hooks and
   five agents the harness actually retired with. `source/` itself is not edited.
10. **Decide the three gaps.** The scaffolder and the trigger eval are Phase 6 work and
    have an owner. Cost and ETA reporting has none. Either open an issue for it or record
    that it is dropped.

Steps 5 to 8 are reversible in one edit: remove `"aeo@aeo": true` and restart. That
returns axial to its current state, not to its pre-retirement state. The tarball restore
in "Rollback" is what returns it to the harness.
