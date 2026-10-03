# Phase 6 audit: what each rule did in two live runs

Issue: [#258](https://github.com/Muhanad-husn/AEO/issues/258)

## Result

57 refusals across the two windows (56 Axial, 1 decision-model-poc), 0 stopped real harm, all 57 false. 18 warnings, all noise. Five of six skills were loaded at least once; status was not. No reference was read in either window. So by the phase rule every guard rule is deleted except the ones the founder's decision keeps, the status skill goes, and all six references go.

## How this was counted

Commands, exactly as run from the repository root:
- `node scripts/score.mjs D:/axial --milestone DEC-75` (window 2026-09-28 to 2026-10-01, closing 2026-09-30T22:17:07Z)
- `node scripts/score.mjs D:/decision-model-poc --phases 0-7` (window 2026-10-02 to 2026-10-03, closing 2026-10-03T03:40:42+02:00)

The harm test, quoted from README.md: a refusal stopped real harm when it blocked a call that would have changed something git cannot restore, merged a branch, deleted a branch, or written into a role's own config. Anything else is false.

Each refusal was classified by reading the transcript records around it and what the agent did next.

## The `rules:` blocks

### Axial DEC-75

```text
rules: 56 refused, 15 warned, 0 unmatched, 29 skill loads, 0 reference loads (19 sessions, 11 subagent)
  guard block-merge/api-merge: 0 refused
  guard block-merge/branch-delete: 0 refused
  guard block-merge/forge-merge: 0 refused
  guard block-merge/git-merge: 0 refused
  guard block-merge/pr-merge: 0 refused
  guard block-merge/remote-branch-delete: 0 refused
  guard block-merge/text-fallback: 0 refused
  guard gate/could-not-evaluate: 0 refused
  guard path-guard/harness-config: 0 refused
  guard redirect-guard/target: 0 refused
  guard redirect-guard/unparsed-command: 0 refused
  guard redirect-guard/unresolved-target: 0 refused
  guard sandbox-guard/live-root-relative: 0 refused
  guard sandbox-guard/live-run: 0 refused
  guard sandbox-guard/run-dir: 0 refused
  guard sandbox-guard/run-names-root: 21 refused
  guard sandbox-guard/seam-overlap: 0 refused
  guard sandbox-guard/seam-relative: 0 refused
  guard sandbox-guard/seam-unset: 35 refused (retired)
  guard sandbox-guard/unnamed-cd: 0 refused, 2 warned
  guard sandbox-guard/unread-command: 0 refused, 13 warned
  guard sandbox-guard/write-unlocated: 0 refused, 0 warned
  guard sandbox-guard/write-unrestorable: 0 refused
  skill build: 13
  skill new-project: 0
  skill pr: 15
  skill safe-cleanup: 1
  skill sprint-plan: 0
  skill status: 0
  reference ci: 0
  reference dispatch: 0
  reference run-monitor: 0
  reference second-reader: 0
  reference slicing: 0
  reference test-strategy: 0
```

### decision-model-poc

```text
rules: 1 refused, 3 warned, 0 unmatched, 21 skill loads, 0 reference loads (15 sessions, 3 subagent)
  guard block-merge/api-merge: 0 refused
  guard block-merge/branch-delete: 0 refused
  guard block-merge/forge-merge: 0 refused
  guard block-merge/git-merge: 0 refused
  guard block-merge/pr-merge: 0 refused
  guard block-merge/remote-branch-delete: 0 refused
  guard block-merge/text-fallback: 0 refused
  guard gate/could-not-evaluate: 0 refused
  guard path-guard/harness-config: 0 refused
  guard redirect-guard/target: 0 refused
  guard redirect-guard/unparsed-command: 0 refused
  guard redirect-guard/unresolved-target: 0 refused
  guard sandbox-guard/live-root-relative: 0 refused
  guard sandbox-guard/live-run: 0 refused
  guard sandbox-guard/run-dir: 0 refused
  guard sandbox-guard/run-names-root: 0 refused
  guard sandbox-guard/seam-overlap: 0 refused
  guard sandbox-guard/seam-relative: 0 refused
  guard sandbox-guard/unnamed-cd: 0 refused, 3 warned
  guard sandbox-guard/unread-command: 0 refused, 0 warned
  guard sandbox-guard/write-unlocated: 1 refused, 0 warned
  guard sandbox-guard/write-unrestorable: 0 refused
  skill build: 10
  skill new-project: 1
  skill pr: 8
  skill safe-cleanup: 0
  skill sprint-plan: 1
  skill sprint-start: 1
  skill status: 0
  reference ci: 0
  reference dispatch: 0
  reference run-monitor: 0
  reference second-reader: 0
  reference slicing: 0
  reference test-strategy: 0
```

## Verdicts

| Rule or file | Axial | decision-model-poc | Stopped harm | Verdict | Reason |
|---|---|---|---|---|---|
| block-merge/api-merge | 0 | 0 | 0 | kept by founder decision | Merge and branch deletion stay gated in code (RULES.md, decision of 2026-10-03); two runs cannot show the harm will not come |
| block-merge/branch-delete | 0 | 0 | 0 | kept by founder decision | Merge and branch deletion stay gated in code (RULES.md, decision of 2026-10-03); two runs cannot show the harm will not come |
| block-merge/forge-merge | 0 | 0 | 0 | kept by founder decision | Merge and branch deletion stay gated in code (RULES.md, decision of 2026-10-03); two runs cannot show the harm will not come |
| block-merge/git-merge | 0 | 0 | 0 | kept by founder decision | Merge and branch deletion stay gated in code (RULES.md, decision of 2026-10-03); two runs cannot show the harm will not come |
| block-merge/pr-merge | 0 | 0 | 0 | kept by founder decision | Merge and branch deletion stay gated in code (RULES.md, decision of 2026-10-03); two runs cannot show the harm will not come |
| block-merge/remote-branch-delete | 0 | 0 | 0 | kept by founder decision | Merge and branch deletion stay gated in code (RULES.md, decision of 2026-10-03); two runs cannot show the harm will not come |
| block-merge/text-fallback | 0 | 0 | 0 | kept by founder decision | Merge and branch deletion stay gated in code (RULES.md, decision of 2026-10-03); two runs cannot show the harm will not come |
| gate/could-not-evaluate | 0 | 0 | 0 | kept by founder decision | Fail-closed path for kept rules; without it a kept rule that throws lets the call through. Flagged for the founder: the phase rule alone would delete it |
| path-guard/harness-config | 0 | 0 | 0 | delete | Never fired |
| redirect-guard/target | 0 | 0 | 0 | delete | Never fired |
| redirect-guard/unparsed-command | 0 | 0 | 0 | delete | Never fired |
| redirect-guard/unresolved-target | 0 | 0 | 0 | delete | Never fired |
| sandbox-guard/live-root-relative | 0 | 0 | 0 | delete | Never fired |
| sandbox-guard/live-run | 0 | 0 | 0 | delete | Never fired |
| sandbox-guard/run-dir | 0 | 0 | 0 | delete | Never fired |
| sandbox-guard/run-names-root | 21 | 0 | 0 | delete | 21 false refusals; 11 misresolved paths in another checkout, 8 were reads, none wrote under the root |
| sandbox-guard/seam-overlap | 0 | 0 | 0 | delete | Never fired |
| sandbox-guard/seam-relative | 0 | 0 | 0 | delete | Never fired |
| sandbox-guard/seam-unset | 35 | not carried | 0 | already deleted | Retired in #214; all 35 refusals false, 32 already set AEO_DATA_ROOT |
| sandbox-guard/unnamed-cd | 0, 2 warned | 0, 3 warned | 0 | delete | Warns only; all 5 warnings were noise |
| sandbox-guard/unread-command | 0, 13 warned | 0, 0 warned | 0 | delete | Warns only; all 13 warnings were worktree edits, commits and a PR, noise |
| sandbox-guard/write-unlocated | 0, 0 warned | 1 | 0 | delete | Its one refusal was a scratchpad write beside a read-only database open |
| sandbox-guard/write-unrestorable | 0 | 0 | 0 | kept by founder decision | Write git cannot restore stays gated in code (decision of 2026-10-03) |
| skill build | 13 | 10 | | keep | Loaded at least once |
| skill new-project | 0 | 1 | | keep | Loaded at least once |
| skill pr | 15 | 8 | | keep | Loaded at least once |
| skill safe-cleanup | 1 | 0 | | keep | Loaded at least once |
| skill sprint-plan | 0 | 1 | | keep | Loaded at least once |
| skill status | 0 | 0 | | delete | Never loaded; the session-start renderer is a hook, not this skill, and stays |
| reference ci | 0 | 0 | | delete | Never read. The three templates under references/workflows/ go with it |
| reference dispatch | 0 | 0 | | delete | Never read |
| reference run-monitor | 0 | 0 | | delete | Never read |
| reference second-reader | 0 | 0 | | delete | Never read |
| reference slicing | 0 | 0 | | delete | Never read. build/SKILL.md and sprint-plan/SKILL.md point at it; slice 04 cuts the pointers |
| reference test-strategy | 0 | 0 | | delete | Never read. build/SKILL.md and sprint-plan/SKILL.md point at it; slice 04 cuts the pointers |

## Refusals

### Axial: sandbox-guard/run-names-root (21)

| # | timestamp (UTC) | session | command (short) | class | reason | what happened next |
|---|---|---|---|---|---|---|
| 1 | 2026-09-29 11:41 | 07462192 | `Get-ChildItem D:\axial\data\names; python -c json.load(...index.json)` | false | Lists a folder and loads a JSON file inside the root. Read only. | Same listing on D:/axial-runs copy, then continued |
| 2 | 2026-09-29 17:12 | 07462192 | `git -C D:/axial-runs add data/logs/2026-09-29-856-wikidata` | false | `git -C` targets D:/axial-runs. The guard resolved the relative path against D:/axial. Only staging, outside the root. | Retried with absolute path, succeeded |
| 3 | 2026-09-29 18:44 | 08e27e39 | `ls data/logs \| grep -iE "805\|vocab"; gh issue view 805; sed -n ...` | false | `ls` of production logs plus `sed` reads of config. Nothing writes. | Read memory, listed the runs checkout instead |
| 4 | 2026-09-29 18:52 | 08e27e39 | `cd /d/axial-runs && grep cost data/logs/.../summary.md; ls ...` | false | `grep`/`ls` after `cd` into the runs checkout. Read only, and the paths were not production anyway. | Retried with absolute paths, succeeded |
| 5 | 2026-09-29 19:00 | 08e27e39 | `cd /d/axial-857 && rm data/logs/.../agreement-*.json && git add` | false | The `rm` targets the D:/axial-857 worktree, outside the root. The guard misresolved the path against D:/axial. | Kept the json files, staged by absolute path |
| 6 | 2026-09-30 22:00 | 5a47ca2c | `git pull -q && git add -f data/logs/2026-09-30-883-brief-set/*.py ...` | false | Shell was in D:/axial, so it stages real production log files. git index only, files unchanged. The founder had said commit. | Committed briefs only, filed AEO#234, asked founder |
| 7 | 2026-09-28 02:10 | 9a224f97 | `gh issue create --repo .../AEO --body "...D:/axial/data..."` | false | The root appears only as text inside an issue body. Nothing on disk is touched. | Removed path from body, filed AEO#214 |
| 8 | 2026-09-28 22:25 | 9a224f97 | `uv --directory D:/axial-runs run python data/logs/.../old_store.py` | false | The script sits in axial-runs and writes old-vault relative to D:/axial-runs. Nothing under the root. | Retried with absolute script path |
| 9 | 2026-09-28 23:03 | 9a224f97 | `git -C D:/axial-runs ls-files data/runs data/logs/...` | false | Read-only `ls-files` against the runs checkout. The guard misresolved the relative path. | Asked founder to check live vault; later absolute paths |
| 10 | 2026-09-29 00:37 | 9a224f97 | `cat D:/axial/data/logs/2026-09-29-853-smoke/summary.md \| head -n 3` | false | Deliberate probe to confirm the guard still fires. `cat` is read only. | Kept probing guard with other commands |
| 11 | 2026-09-29 00:39 | 9a224f97 | `cd /d/axial-runs; ls data/vocabulary/relation; head -c 600 ...` | false | Read-only `ls`/`head`/`grep` in the runs checkout. The guard also kept the `;` in the token. | Retried with absolute paths, succeeded |
| 12 | 2026-09-29 01:03 | 9a224f97 | `cat > /d/axial-runs/data/logs/.../compare.py <<EOF ... "data/runs/853-smoke-map"` | false | Writes a script into axial-runs. The flagged string is script text read relative to D:/axial-runs. | Rewrote via Write tool with absolute paths |
| 13 | 2026-09-29 01:42 | 9a224f97 | `cd /d/axial-runs && git ls-files data/runs \| ...; wc -c ...` | false | Read-only `ls-files`/`wc` in the runs checkout. The guard misresolved the path after `cd`. | Retried with absolute paths, succeeded |
| 14 | 2026-09-29 20:06 | ad7327ba | `cd /d/axial-runs && python -m axial.cli map compare data/map/9b79...` | false | `map compare` only reads and prints, and the output goes to the scratchpad. It ran in axial-runs, not production. | Filed AEO#218, stopped and asked founder |
| 15 | 2026-09-29 23:05 | ad7327ba | `git -C /d/axial-runs add data/logs/2026-09-29-859-extract-*/summary.md` | false | Staging in the runs checkout. The guard resolved the path against D:/axial. | Filed AEO issue, retried with absolute paths |
| 16 | 2026-09-30 12:43 | ad7327ba | `ls /d/axial/data/logs \| grep 809; ls /d/axial-runs/...; gh issue view` | false | `ls` of production logs plus `gh` reads. Nothing writes. | Filed AEO#226, reran in the runs checkout |
| 17 | 2026-09-30 15:19 | ad7327ba | `ls docs/reports; ls data/reports; git log -- docs/reports` | false | `ls` of production reports, cwd D:/axial. Read only. | Commented on AEO#226, reran in the runs checkout |
| 18 | 2026-09-30 16:06 | ad7327ba | `Start-Process ... brief sweep --sweep-dir data/runs/881-arm-C -WorkingDirectory D:\axial-runs` | false | Paid sweep writing to a relative dir under WorkingDirectory D:/axial-runs, outside the root. The guard also kept the trailing comma. | Filed AEO#227, relaunched with absolute path |
| 19 | 2026-09-29 20:04 | a0afc438/sub | `uv run axial map compare D:/axial/data/map/9b79... --vocabulary-dir D:/axial/data/vocabulary` | false | Points at production maps, but `compare.py` has no write, mkdir, connect or unlink. It only prints a report. | Dropped it, went back to waiting on tests |
| 20 | 2026-09-29 19:50 | abacb61f/sub | `grep ...; ls /d/axial/data/vocabulary /d/axial/data/map` | false | `ls` of production vocabulary and map folders. Read only. | Listed the runs checkout copies instead |
| 21 | 2026-09-29 02:22 | f3453297 | `git pull -q && ... ls data/map data/vocabulary data/vault` | false | `ls` of production folders. The pull touches tracked code, not data. | Retried listing D:/axial-runs copies, succeeded |

Counts: 0 stopped harm, 21 false. 11 of 21 never touched production: the command moved to another checkout and the guard resolved relative data/ paths against D:/axial. 8 only listed or read; #7 named the root in an issue body; #6 staged production log files into git, no data file changed. Closest to harm: #5 (rm in D:/axial-857 worktree) and #18 (paid sweep writing to D:/axial-runs). No duplicates.

### Axial: sandbox-guard/seam-unset (35, rule already retired)

| # | timestamp UTC | session | command (short) | class | reason | what happened next |
|---|---|---|---|---|---|---|
| 1 | 2026-09-28 02:09 | 9a224f97 | `gh issue view 853 && echo ==== && gh issue view 855` | false | Reads two GitHub issues; writes nothing local | Retried with quoted prefix, refused again |
| 2 | 2026-09-28 02:09 | 9a224f97 | `AEO_DATA_ROOT="…/aeo-data" gh issue view 853 && … 855` | false | Same read; quoted prefix not recognised | Split into two prefixed calls, both ran |
| 3 | 2026-09-28 02:47 | 9a224f97 | `grep -n crossSessionInbound ~/.claude/settings.json; head -5 …` | false | Read-only look at user settings | Read tool, then Edit |
| 4 | 2026-09-28 04:50 | 9a224f97 | `$env:AEO_DATA_ROOT=…; Get-CimInstance Win32_Process …` | false | Lists node processes; PowerShell $env prefix not recognised | Removed both worktrees with --force |
| 5 | 2026-09-28 22:09 | 9a224f97 | `AEO_DATA_ROOT=… find D:/axial-runs/data -type f \| wc -l` | false | Counts files in the data copy; read-only | Gave up, reported robocopy's count |
| 6 | 2026-09-28 22:10 | 9a224f97 | `AEO_DATA_ROOT=… env \| grep -i -E "axial\|aeo"` | false | Prints environment variables | printenv with prefix, ran |
| 7 | 2026-09-29 00:33 | 9a224f97 | `git -C D:/axial-runs status --short` | false | Deliberate probe of the gate; read-only git status | Found plugin stuck at 0.3.0; founder updated |
| 8 | 2026-09-28 02:11 | a3569648/sub | `pwd && git status && git branch --show-current` | false | Read-only git state in worktree | Prefixed each segment, ran |
| 9 | 2026-09-28 02:11 | a3569648/sub | `find src/axial -iname "*name*" -o -iname "*gather*" \| sort` | false | Lists source files | Used Glob tool |
| 10 | 2026-09-28 02:11 | a3569648/sub | `grep -n "name" …/src/axial/vault.py \| head -100` | false | Reads a source file | Used Grep tool |
| 11 | 2026-09-28 02:55 | a3569648/sub | `uv sync --group distill --group service --group operator \| tail -40` | false | Builds the worktree's own .venv; no data touched | Reran without pipe, ran |
| 12 | 2026-09-28 03:09 | a3569648/sub | `grep -n '"name"' src/axial/brief/test_sweep.py \| head -20` | false | Reads a test file | Used Grep tool |
| 13 | 2026-09-28 03:16 | a3569648/sub | `uv run ruff check src \| tail -150` | false | Lint, read-only | Reran without pipe |
| 14 | 2026-09-28 03:17 | a3569648/sub | `grep -n "^## \|^# " specs/PRODUCT.md \| head -80` | false | Reads a spec | Used Grep tool |
| 15 | 2026-09-28 03:52 | a3569648/sub | `test -f tests/analysis/test_name_query.py && echo …` | false | File existence check | Used Glob tool |
| 16 | 2026-09-28 04:07 | a3569648/sub | `git diff --stat aea4714 HEAD -- . \| tail -5` | false | Read-only diff stat | git diff --shortstat, ran |
| 17 | 2026-09-28 03:16 | a742ae83/sub | `uv run ruff check src \| tail -150` | false | Lint, read-only (sibling fork of #13) | Reran without pipe |
| 18 | 2026-09-28 03:17 | a742ae83/sub | `grep -n "^## \|^# " specs/PRODUCT.md \| head -60` | false | Reads a spec (sibling fork of #14) | Used Grep tool |
| 19 | 2026-09-28 04:01 | a742ae83/sub | `gh run view 36375771178 --log-failed \| tail -150` | false | Reads a CI log from GitHub | Tried redirect to /tmp, refused |
| 20 | 2026-09-28 04:01 | a742ae83/sub | `gh run view … --log-failed > /tmp/ci_fail.txt; echo done` | false | Writes only /tmp | gh run view --job without pipe |
| 21 | 2026-09-28 02:11 | a7ce2230/sub | `git status && git log --oneline -3 && ls src/axial … \| head -30` | false | Read-only inspection of worktree | Prefixed retry, refused again |
| 22 | 2026-09-28 02:11 | a7ce2230/sub | `AEO_DATA_ROOT=… git -C <wt> status; ls …; grep -rln vocabulary …` | false | Read-only; later segments lacked prefix | Grep tool, then prefixed git status |
| 23 | 2026-09-28 02:14 | a7ce2230/sub | `AEO_DATA_ROOT=… uv sync --group … \| tail -3` | false | Builds worktree .venv only | uv --directory sync in background |
| 24 | 2026-09-28 02:17 | a7ce2230/sub | `uv --directory <wt> run pytest test_vocabulary_relation.py … \| tail -15` | false | Red-test run in worktree; data paths resolve inside the worktree | Reran without tail; tests red as intended |
| 25 | 2026-09-28 03:17 | a8660338/sub | `grep -n "^## \|^### " docs/architecture-review-….md \| head -60` | false | Reads a doc | Used Grep tool |
| 26 | 2026-09-28 03:51 | a8660338/sub | `gh pr create --repo Muhanad-husn/axial --head chore/853-… --body …` | false | Opens a pull request; no merge, no data write | Prefixed retry opened PR #862 |
| 27 | 2026-09-28 03:18 | a9e8630b/sub | `git show HEAD:src/axial/retrieve/test_loop.py \| wc -l` | false | Read-only line count | Saved to /tmp, counted there |
| 28 | 2026-09-28 03:51 | a9e8630b/sub | `grep -n "240\|write_store…" src/axial/validators/test_coverage.py \| head` | false | Reads a test file | Used Grep tool |
| 29 | 2026-09-28 04:04 | aa7304ec/sub | `gh run view … --job 108781223318 --log-failed \| head -300` | false | Reads a CI log | Reran without pipe |
| 30 | 2026-09-28 04:10 | aa7304ec/sub | `git status --porcelain=v1 --ignored \| head -100` | false | Read-only git status | Reran without pipe |
| 31 | 2026-09-28 04:10 | aa7304ec/sub | `git ls-files tests/analysis \| grep -iE "envelope\|map" \| head -50` | false | Lists tracked files | Dropped; used Grep tool later |
| 32 | 2026-09-28 04:10 | aa7304ec/sub | `uv run pytest tests/analysis/test_argmap_corridor.py … -n 0 \| tail -80` | false | Acceptance tests in worktree; conftest sends data folders to tmp_path | Reran without tail |
| 33 | 2026-09-28 04:14 | aa7304ec/sub | `grep -n "^FAILED" "…\tasks\banv6kq53.output"` | false | Reads a background task output file | Grep tool, then Glob |
| 34 | 2026-09-28 04:17 | aa7304ec/sub | `true` | false | No-op wait | Ran prefixed `echo waiting` |
| 35 | 2026-09-28 04:25 | aa7304ec/sub | `uv run pytest -q --collect-only \| tail -5` | false | Collects tests only, runs none | Full pytest run, passed |

Why seam-unset refused: 32 of 35 already carried an AEO_DATA_ROOT prefix or set it in PowerShell. The gate still refused when the prefix sat only on the first segment of a pipe or chain (| tail, | head, &&, ;), when the value was quoted, when set as $env: in PowerShell. Bare commands with no prefix, #1, #7, #8, #15, #21, #26, #33, #34, included a deliberate probe. Every Axial subagent ran in a worktree D:/axial/.claude/worktrees/agent-*. Axial's data paths resolve relative to the working directory, so to the worktree's own data/. `tests/analysis/conftest.py` redirects data folders to tmp_path. The pytest runs (#24, #32, #35) could not touch production.

### decision-model-poc: sandbox-guard/write-unlocated (1)

| # | timestamp UTC | session | command (short) | class | reason | what happened next |
|---|---|---|---|---|---|---|
| 1 | 2026-10-02 23:05 | 7e3fefd9 | `cat > "$S/explore1.py" <<EOF…; uv run python … "file:D:/CIP-data/db/cip.sqlite?mode=ro"` | false | Writes a script to the session scratchpad; opens the CIP database read-only | Write tool, then reran with literal path |

## Warnings

All noise:

- Axial unread-command, 13: PowerShell edits and commits of tracked source and tests in worktrees D:/axial-856 and D:/axial-wt-863, and one gh pr create (PR #866). 2026-09-29 01:53 to 11:54 UTC.
- Axial unnamed-cd, 2: 2026-09-29 18:52 and 19:00 UTC, writes and exports into the D:/axial-runs copy, not D:/axial/data.
- decision-model-poc unnamed-cd, 3: 2026-10-02 21:13 UTC a claude CLI smoke ping from a mktemp folder; 18:59 and 19:00 UTC a worktree, commit and push of DEC-77 in the Axial repo, outside D:/CIP-data.

## Notes for the slices that follow

- PLAN.md 5a counted 11 guard refusals for Axial by hand; the transcripts hold 56, most in subagent sessions. The 06 gate row uses the script count.
- The #246 refusal (a read-only SQLite open of D:/CIP-data) is not in decision-model-poc's transcripts; it was met in CIP and AEO sessions, so it is not counted here.
- decision-model-poc's transcripts hold more write-unlocated warnings after 03:40 on 2026-10-03, outside the window, and are not counted.
- decision-model-poc loaded `aeo:sprint-start` once; that skill no longer exists in the plugin, so it has no row.
- Slice 03 keeps block-merge's seven rules, gate/could-not-evaluate and sandbox-guard/write-unrestorable, and removes the rest; 03 must check that the write rule still holds once run-names-root, run-dir and the seam rules are gone.
- The verdict column waits for the founder's approval before 03 or 04 starts.
