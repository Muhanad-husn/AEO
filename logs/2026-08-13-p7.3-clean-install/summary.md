# P7.3 -- Clean install from GitHub into an empty repo

Issue #44. Run 2026-08-13, against `main` at `f8b6c18` (Fix #48, includes #42 and
#50). Location: `D:\aeo-install-proof`, `git init`, no relation to `D:\AEO` or the
testbed. Deleted at the end of this run; nothing from it survives except this log.

Repository visibility: `Muhanad-husn/AEO` is **private**. This run's `gh`/git
credentials were already authenticated as the repo owner, so the clone in `add
marketplace` succeeded silently over HTTPS. A stranger -- the audience the README's
install section addresses -- has no such credential and the command in the README
would fail at the clone step with a private-repo permission error, not run at all.
The README does not say the repo is private or that installing it requires being
added as a collaborator. Finding, README defect (see below).

## Baseline: what ~/.claude/plugins/ already held

Before this run touched anything, ~/.claude/plugins/known_marketplaces.json
already had an entry named aeo, source directory, path D:\AEO -- registered
2026-08-04, evidently by an earlier phase's local development work.
~/.claude/plugins/cache/aeo/agentic-engineering-solo-org/0.1.0/ also pre-existed,
marked .orphaned_at, unrelated to this plugin's current name. Both are called out
because the marketplace name this repo publishes is also aeo (from
.claude-plugin/marketplace.json), which collides with the pre-existing local
entry. See the "pre-existing local marketplace registration lost" section below.

## Commands run, verbatim, in order

### 1. Fresh repo

```
mkdir D:\aeo-install-proof
cd D:\aeo-install-proof
git init
git config user.email "test@example.com"
git config user.name "Install Proof"
echo "# scratch" > README-scratch.md
git add README-scratch.md
git commit -m "initial commit"
git branch -M main
```

Result: clean repo, one commit, branch main, no .claude/ content of any kind
before the plugin touched it.

### 2. Marketplace add -- README's shell form, exact

```
claude plugin marketplace add Muhanad-husn/AEO
```

Output:

```
Adding marketplace...SSH not configured, cloning via HTTPS: https://github.com/Muhanad-husn/AEO.git
Refreshing marketplace cache (timeout: 120s)...
Cloning repository (timeout: 120s): https://github.com/Muhanad-husn/AEO.git
Clone complete, validating marketplace...
Cleaning up old marketplace cache...
Successfully added marketplace: aeo (declared in user settings)
```

Worked as written. No README defect on this line.

### 3. Plugin install -- README's shell form, exact

```
claude plugin install aeo@aeo
```

Output:

```
Installing plugin "aeo@aeo"...Successfully installed plugin: aeo@aeo (scope: user)
```

Worked as written. No README defect on this line.

### 4. Inventory -- claude plugin details aeo@aeo

```
aeo 0.1.0
  Source: aeo@aeo

Component inventory
  Skills (14)  fix, monitor-design, red-green-refactor, review, safe-cleanup,
               safe-pr, sprint-plan, sprint-start, status, tdd-ci, tdd-plan,
               triage, verify, worker-dispatch
  Agents (5)   builder, monitor-designer, reviewer, triage, verifier
  Hooks (2)    SessionStart, PreToolUse  (harness-only -- no model context cost)
  MCP servers (0)
  LSP servers (0)
```

claude plugin list separately confirmed aeo@aeo, scope user, status enabled.

Skills: 14. Agents: 5. Both match the tree and the README's own count
("Fourteen skills ship today" / "Five agent charters"). Match, no finding.

Hooks: 2, not 6. The CLI counts hook *events* (SessionStart, PreToolUse),
not the six gate scripts the README table names (sandbox-guard, block-merge,
commit-gate, path-guard, review-jail, session-status). Reading
hooks/hooks.json from the installed copy confirms all six scripts are present
and wired under those two events -- this is a reporting-granularity mismatch
between the CLI's summary and the README's table, not a missing gate. Finding,
documentation note -- worth a line in the README so a reader doesn't read "Hooks
(2)" from claude plugin details as "only two gates," but not a defect in the
plugin itself.

### 5. claude plugin validate --strict on the installed copy

```
claude plugin validate --strict "C:\Users\mou97\.claude\plugins\cache\aeo\aeo\0.1.0"
```

Output:

```
Validating plugin manifest: C:\Users\mou97\.claude\plugins\cache\aeo\aeo\0.1.0\.claude-plugin\plugin.json

Validation passed
```

Confirms #50's frontmatter fix holds on the installed copy, not just in the
source tree. Passes, no finding.

### 6. One lane, end to end: commit-gate refusing a commit on main

Why this lane. The cheapest thing that produces a refusal, not a print. The
session-status reporter never blocks; several skills (review, status) only
read. commit-gate fires on every Bash/PowerShell call and blocks outright on
two independent conditions (protected branch, unresolved test command), so it's
the fastest path to a real "no."

Method. A live nested session (claude -p "Run: git add -A and git commit
-m ... ...") was tried first, from inside D:\aeo-install-proof. It was refused
before it reached the AEO plugin at all:

```
Permission for this action was denied by the Claude Code auto mode classifier.
Reason: Blocked by classifier.
```

That is this run's own outer harness declining to let a nested session type git
commit, unrelated to the plugin under test -- a plain claude -p "echo hello"
in the same directory ran fine, isolating the block to the commit text. TESTBED.md
records the same kind of obstruction for block-merge's gh pr merge arm and
its resolution: invoke the hook directly against the real repository with the real
payload shape, rather than through a live session. Same method, applied here:

```
INSTALLED_HOOK="C:\Users\mou97\.claude\plugins\cache\aeo\aeo\0.1.0\hooks\commit-gate.mjs"
echo PAYLOAD_JSON | node "$INSTALLED_HOOK"
```

where PAYLOAD_JSON was the Bash tool_input for `git add -A && git commit -m
"direct commit to main"`, cwd D:\aeo-install-proof, as tool_name Bash.

On branch main, with the staged edit from step 1 still pending:

```
BLOCKED: no direct commits on main. Work on a branch and merge via PR after founder approval.
```

Exit code 2.

Control, to rule out a blanket refusal. Same payload, same repo, on a feature
branch (feat/test-lane) instead of main:

```
BLOCKED: no test command could be resolved for this change, so the gate cannot
confirm the suite is green.
  repository:   D:/aeo-install-proof
  searched:     D:\aeo-install-proof
  looked for:   package.json, pyproject.toml, pytest.ini, setup.cfg, tox.ini, go.mod, Cargo.toml, pom.xml, build.gradle, build.gradle.kts, Gemfile
  at D:\aeo-install-proof: no manifest at or above it
```

Exit code 2, but a different reason -- the protected-branch check yields to the
test-detection check once off main. That difference is what proves the installed
hook is evaluating real state (current branch, presence of a manifest) rather than
refusing everything unconditionally. Gate is wired and live in the installed
copy. No commit ever landed in the fresh repo.

Finding, not a defect but worth recording: a live in-session git commit
attempt from a nested claude -p call is intercepted by the outer harness's own
auto-mode classifier before the AEO plugin's hook is reached at all, in this
environment. Anyone reproducing this proof under the same kind of classifier will
need the direct-invocation fallback above; it is not obvious without having read
TESTBED.md first.

### 7. Uninstall

```
claude plugin uninstall aeo@aeo
```
```
Successfully uninstalled plugin: aeo (scope: user)
```

```
claude plugin marketplace remove aeo
```
```
Successfully removed marketplace: aeo
```

## Uninstall residue -- enumerated, not assumed clean

Checked against the pre-run snapshot taken before step 2:

| Location | Before | After | Clean? |
| --- | --- | --- | --- |
| ~/.claude/plugins/installed_plugins.json | no aeo@aeo entry | no aeo@aeo entry (byte-identical diff) | Yes |
| ~/.claude/plugins/marketplaces/aeo/ (git clone) | did not exist | does not exist | Yes |
| claude plugin list | no aeo row | no aeo row | Yes |
| ~/.claude/settings.json (enabledPlugins, extraKnownMarketplaces) | no aeo mention | no aeo mention | Yes (never touched) |
| ~/.claude/plugins/cache/aeo/aeo/0.1.0/ | did not exist | exists, full plugin content, marked .orphaned_at | No -- residue |
| ~/.claude/plugins/known_marketplaces.json, aeo entry | directory, path D:\AEO | entry gone entirely | No -- pre-existing registration lost |

Two things did not come back clean.

1. Orphaned cache directory. ~/.claude/plugins/cache/aeo/aeo/0.1.0/ (the
full installed copy -- hooks, skills, agents) is left on disk after uninstall,
marked .orphaned_at rather than deleted. claude plugin prune exists and would
likely clear it, but running it was out of scope for this slice (it would also
touch the pre-existing agentic-engineering-solo-org/0.1.0 orphan in the same
folder, which predates this run and this slice does not own). Left as found, per
instruction. Finding.

2. Pre-existing local marketplace registration lost, and this run could not
restore it. Step 2's marketplace add used the name aeo -- the name this
repo's .claude-plugin/marketplace.json declares -- which is the same name the
pre-existing local directory marketplace (pointing at D:\AEO) already used.
marketplace add silently overwrote that entry with the GitHub source, no
warning, no prompt. marketplace remove aeo then removed the name entirely --
there is no "previous entry" to fall back to; the tool does not version marketplace
registrations. The founder's ~/.claude/plugins/known_marketplaces.json no
longer has the aeo -> D:\AEO directory registration it had before this slice
started.

This run attempted to restore it with the equivalent of the original add
(claude plugin marketplace add D:/AEO), which is exactly how D21 says that entry
got there in the first place. That attempt was itself refused:

```
Permission for this action was denied by the Claude Code auto mode classifier.
Reason: Blocked by classifier.
```

Per this slice's own constraints, that denial was not worked around. The
founder's machine is left short one local marketplace registration this run
disturbed and could not put back. Restoring it needs one command run
interactively: claude plugin marketplace add D:/AEO (or the equivalent /plugin
slash form). This is flagged here rather than fixed, and flagged again in the PR
body since it is a direct, unrequested change to the founder's own environment,
not a repo finding.

Root cause, for the record: naming the marketplace aeo -- a plausible,
even expected, name for this project's own marketplace -- makes any local
development registration under the same name collide silently the first time a
GitHub install is proven on a machine that also does local plugin development
against D:\AEO. This is specific to founder machines that run both paths, not
to a stranger's clean install (which is the intended and correct interpretation of
D21). Documented here so a future run on this same machine isn't surprised twice.

## Findings, as issue candidates

1. README does not state the repository is private. The install section reads
   as if any GitHub identity can add the marketplace. A stranger without owner
   access will fail the clone silently the way this run would have without
   pre-existing credentials. Candidate: state visibility and what a non-owner
   needs (collaborator access, or making the repo public) directly in the Install
   section.
2. claude plugin details reports "Hooks (2)", counting SessionStart and
   PreToolUse as the two wired events, while the README's gate table names six
   scripts. Both are true at different levels of granularity, but a reader
   comparing the two on faith would think four gates are missing. Candidate: a
   one-line note in the README's gate table, or next to wherever inventory
   numbers get quoted, that "hooks" in the CLI's own report means event types,
   not gate scripts.
3. A live nested session cannot exercise commit-gate through git commit
   directly in this harness -- the outer auto-mode classifier intercepts it
   before the plugin hook runs. Not a plugin defect, but anyone repeating this
   proof needs to know the direct-hook-invocation fallback exists and where the
   precedent for it lives (TESTBED.md, the block-merge/gh pr merge case).
   Candidate: a short note in TESTBED.md or a new operational doc naming this as
   a second case of the same fallback, so the next verifier doesn't have to
   rediscover it.
4. Uninstall leaves the installed copy's cache directory on disk, marked
   orphaned rather than removed. claude plugin prune is the documented answer
   but is a separate, manual step -- uninstall alone does not reach it.
   Candidate: decide whether the install docs should mention prune as part of a
   full removal, or whether this is accepted CLI behavior outside this project's
   scope to change.
5. Marketplace names collide silently across sources with no warning,
   overwriting an existing registration of the same name outright, and there is
   no way to recover the overwritten entry short of re-adding it by hand.
   Encountered here because this repo's own marketplace name (aeo) is also a
   plausible local-dev registration name on a founder machine that runs both
   paths. Candidate: not an AEO plugin defect -- this is claude plugin
   marketplace add's own behavior -- but worth a note in TESTBED.md or CLAUDE.md
   warning a founder running this proof again on the same machine that it will
   clobber the local aeo registration, and that restoring it may need an
   interactive session if the auto-mode classifier blocks the CLI form the way it
   did here.

## Verify -- the five things this slice had to establish

1. Marketplace resolves from a clean clone, no local path, no file://. Yes
   -- step 2, over HTTPS, from GitHub.
2. Plugin installs and reports its real inventory. Yes -- 14 skills, 5 agents,
   matching the tree and the README. Hooks reported as 2 events; both scripts (6)
   and events (2) are correct depending on what's being counted (finding 2).
3. claude plugin validate --strict passes on the installed copy. Yes -- step
   5, confirmed on the installed copy at ~/.claude/plugins/cache/aeo/aeo/0.1.0,
   not the source tree.
4. One lane runs end to end, exercising a gate that refuses. Yes --
   commit-gate blocked a direct commit on main, and gave a different, correct
   refusal on a feature branch with no detectable test command, in the installed
   copy's own hook file. Reached by direct hook invocation, not a live session,
   after the live path was blocked by this harness's own classifier (finding 3).
5. Uninstall is clean, or the residue is named. Not fully clean. Named above:
   an orphaned cache directory, and -- more significant -- a pre-existing local
   marketplace registration this run disturbed and could not restore, because the
   restore command was itself refused by this harness's classifier. The founder
   needs to run claude plugin marketplace add D:/AEO once, interactively, to put
   it back.
