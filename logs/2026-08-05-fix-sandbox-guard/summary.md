# Fix: the sandbox guard's two blocking defects

2026-08-05. Branch `fix/phase-1/sandbox`. Both found in the Checkpoint 1 review round,
which returned the one `REJECT` of the round on this gate.

Scope: `plugin/hooks/sandbox-guard.mjs` and its tests. `lib.mjs`, `stack.mjs`,
`sentinel.mjs` and every other gate are untouched.

## Defect 1 — the operation directory was never compared against the production root

`sandboxGuard` computed the directories a call operates in, used them to resolve relative
tokens, and never asked whether one of them was itself inside `live.root`.

`pathCandidates` skips a token with no `/` or `\` in it. That is right on its own: a bare
`corpus` is not a claim about a location. In combination with an operation directory the
guard already holds, it is a hole. Probe, guard fully armed, no sentinel, `cwd` one level
above production:

```
cd corpus && rm -rf index        exit 0   ALLOWED
cd <abs>/corpus && rm -rf index  exit 2   blocked
rm -rf <abs>/corpus/index        exit 2   blocked
rm -rf index      (cwd = corpus) exit 0   ALLOWED
```

No token carries a separator, so the candidate list is empty and the rule never ran. The
guard caught the spelled-out form and missed the ordinary one. The Bash tool persists its
working directory between calls, so the two-step form reaches the same place, and so does
a session whose cwd already sits in production data and types no `cd` at all.

### The change

A fourth rule, after the rule that names a path outright:

```js
for (const dir of dirs) {
  if (isPathInside(liveReal, realise(dir))) block(`this command operates in ${realise(dir)}, ...`);
}
```

It runs **after** the named-path rule on purpose. Both block; the named-path rule gives
the more actionable message, so the spelled-out forms keep the message they had.

`dirs` is what `operationDirs` already returned: the resolved `cd` target and the session
cwd, both realpathed before comparison like every other path in this file.

One direction only, `isPathInside(liveReal, dir)`. An operation directory that *contains*
production data is not blocked. See defect 3.

### After

```
cd corpus && rm -rf index        exit 2   blocked   "operates in <abs>/corpus"
rm -rf index      (cwd = corpus) exit 2   blocked   "operates in <abs>/corpus"
cd <abs>/corpus && rm -rf index  exit 2   blocked   "names <abs>/corpus"      (control, unchanged)
rm -rf <abs>/corpus/index        exit 2   blocked   "names <abs>/corpus/index" (control, unchanged)
```

### The redundant local resolution, removed

`operationDirs` carried its own copy of the `cd`-target resolution that
`fix/phase-1/lib-resolve` landed in `lib.mjs`. The library now returns an absolute path or
null from that branch, so the local `else if (path.isAbsolute(base)) path.resolve(...)`
arm was unreachable:

- `source: 'cd'` returns absolute or null, never relative.
- `source: 'payload.cwd'` returns exactly `base`, so if it is relative, so is `base`, and
  the arm's own guard is false.
- `CLAUDE_PROJECT_DIR` and `process.cwd` only occur when `base` is empty, and the arm's
  guard is false again.

Six lines became one filter. Behaviour is identical; `lib.mjs` was not edited.

## Defect 2 — the inline seam was read positionally-blind

`resolveRoots` looped every shell token and took any that started with `AEO_DATA_ROOT=`,
last one winning. The comment called that "the shell's own rule". It is not. The shell's
rule concerns assignment **prefixes**: position-sensitive, re-anchoring after `&&`, `||`,
`;`, `|` and a newline.

The failure that matters is the gate being defeated by its own advice. With the seam
misconfigured inside production, the guard blocks and says to set the variable. The model
then runs:

```
echo 'AEO_DATA_ROOT=<safe>' >> .claude/settings.json && npm test
```

The guard read the safe value out of the echoed string, found it disjoint, and allowed,
while the child still ran with the production-pointing seam, because writing a settings
file changes nothing about a running process. Reproduced by probe, exit 0. A grep pattern
did it just as cheaply, also reproduced. A commit message with the variable inside an
unquoted span does it, and the commit gate then runs the suite (L-02).

### The change

One helper, `leadingPositions(tokens)`, returns each command in a token list reduced to
what sits in leading position: its `NAME=value` assignments and its program. `resolveRoots`
takes the seam only from the assignments; the value is still last-wins across the whole
command. Assignments before it are allowed, so `NODE_ENV=ci AEO_DATA_ROOT=<x> npm test`
reads the way the shell reads it.

Newlines are split before tokenising, because `shellTokens` treats a newline as ordinary
whitespace and would lose the re-anchor.

**The limit, stated:** a separator is recognised when it stands as its own token, which is
how a Bash tool call writes one. `a&&b` stays one token and reads as one command. Both
misses that causes fall in the fail-safe direction: an inline seam read from the session
instead of from the command, and a program not recognised as a suite. Both block.

### After

```
echo 'AEO_DATA_ROOT=<safe>' >> settings.json && npm test   exit 2   blocked
grep -r AEO_DATA_ROOT=<safe> .                             exit 2   blocked
git commit -m "point AEO_DATA_ROOT=<safe> at a sandbox"    exit 2   blocked
AEO_DATA_ROOT=<safe> npm test                              exit 0   allowed
cd sub && AEO_DATA_ROOT=<safe> npm test                    exit 0   allowed
```

## Defect 3 — named-path containment is one-directional. Closed with a comment.

The named-path rule uses `isPathInside(liveReal, resolved)` while the seam rule twenty
lines above uses `overlaps`, which tests both directions. So `rm -rf D:/` names an
ancestor of the production root and is allowed.

Kept as it is, and said in the file. Blocking ancestors means refusing `ls /` and `cd ..`,
and the reviewer did not ask for it. The rule now states the limit, names what the limit
costs (the 19,000-document incident was a sweeper run from the wrong root), and names what
covers it instead: the seam, which the sweeper reads to decide where to sweep. A narrowing
that blocked only *destructive* ancestor commands needs a table of destructive commands,
which is the classifier this file already refuses to build.

Defect 1's new rule is one-directional for the same reason and says so.

## Defect 4 — suite recognition over-blocked on a common token

`invokesDeclaredSuite` matched the declared command's final significant token **anywhere**
in the command. Flags and globs are dropped, so that token is the literal `test` for Node,
Go, Rust and Maven. During a live run, `grep -r test .`, `mkdir test` and `git add test`
were each refused with "`npm test` will not run", naming a command the operator never
typed. The slice's own analysis says a guard people cannot work around is a guard people
delete; that is the mechanism.

Fixed, not recorded, because it is the same `leadingPositions` helper defect 2 needed: the
token must be in **program position**: the start of a command, after a separator, past
any flags and leading assignments. Coverage is preserved where it was real:

```
npm test                     blocked  (full sequence, unchanged)
pytest -k thing              blocked  (program position)
cd sub && pytest             blocked  (program position after a separator)
AEO_DATA_ROOT=/tmp/s pytest  blocked  (program position past an assignment)
grep -r test .               allowed
mkdir test / git add test    allowed
```

## Two findings recorded, not fixed

**`invokesDeclaredSuite` compares against the wrong tree in a linked worktree.**
`sandboxGuard` calls `resolveTestPlan` with `projectAnchor(dir)`, and `projectAnchor`
resolves a linked worktree to its main checkout — correct for finding the shared sentinel
set, wrong for reading `scripts.test`. A worktree that changes its declared test command is
compared against the main checkout's declaration. Commits are backstopped by the commit
gate, which refuses to cross a live sentinel with no recognition involved. A hand-typed
`npm test` during a live run is not. Restructuring anchoring is out of scope for a fix
branch and belongs to whoever owns `sentinel.mjs`'s anchor contract.

**`file://` escapes the candidate filter.** `URL_LIKE` skips every `scheme://` token, and
`file://` is a path wearing a scheme. It is not a one-line fix: excluding `file:` from the
pattern leaves `file:///D:/corpus` in the candidate list as a string `path.isAbsolute`
rejects, so it would then be resolved against the operation directory and compared as
nonsense. A correct fix converts the URL to a path first. Recorded rather than attempted.

**`node --test` is still not recognised as this project's suite**, and it is how this
project's own suite runs. The declared command is `npm test`; what `scripts.test` expands
to is `stack.mjs`'s to read, not this function's to guess. Stated in the doc comment on
`invokesDeclaredSuite` as a known miss with its backstop.

## Tests

`tests/hooks/sandbox-guard.test.mjs`, 10 new tests, +151 lines, nothing removed.

- **`the operation directory`** (4, new describe). A relative `cd` into production data;
  a session already sitting there with no `cd` at all, across three commands that carry no
  separator anywhere; the two spelled-out probe controls, asserted to still block by the
  *named-path* rule rather than the new one; and the allow side, including an ancestor of
  production data, which pins defect 3's decision.
- **`the seam`** (+2). Every positionally-blind form (the echo remediation, a grep pattern,
  a commit message, a bare echo) against a production-pointing session seam; and the four
  genuinely-leading forms still honoured, including after `&&`, after another assignment,
  and after a newline.
- **`the sentinel`** (+2). Five commands containing the bare word `test` that must not
  block during a live run; four forms of the declared program that must.
- **`tokenising and matching`** (+2, unit). `invokesDeclaredSuite` program position, and
  `resolveRoots` leading position, both stated as direct assertions rather than only
  through the spawned gate.

Every block asserts **which** rule fired, per this file's existing convention. The new
`OPERATES_IN` pattern joins the list.

## Mutation tests

Each defect's fix was reverted on its own and `sandbox-guard.test.mjs` re-run.

| Mutation | tests | pass | fail | killed by |
| --- | --- | --- | --- | --- |
| Defect 1: rule 4 iterates `[]` instead of `dirs` | 56 | 54 | **2** | `a relative cd into production data blocks`, `a session already sitting in production data blocks with no cd at all` |
| Defect 2: `resolveRoots` back to the positionally-blind token loop | 56 | 54 | **2** | `the seam is read only from an assignment in leading position`, `an inline seam is read only in leading position` |

Defect 1's first pass killed only one test, which is the single-test tripwire the bar
refuses. The case was split into the two hole shapes it actually covers — the `cd` form and
the already-there form — and both now die.

Each mutation is killed by tests at two levels for defect 2 (spawned gate and unit), and by
two independent payload shapes for defect 1. The controls stay green under both, which is
what proves the mutation was caught by the rule under test and not by a neighbour.

## Counts

| | Before | After |
| --- | --- | --- |
| `npm test` (fast tier) | 103 | 103 |
| `npm run test:integration` | 375 | 385 |
| `npm run test:all` | **478** | **488** |

Nothing red, the commit-gate tests included. The fast tier is untouched:
`sandbox-guard.test.mjs` is in the integration tier.

## Lines

| | + | - |
| --- | --- | --- |
| `plugin/hooks/sandbox-guard.mjs` | 107 | 25 |
| `tests/hooks/sandbox-guard.test.mjs` | 151 | 0 |

Net +82 gate lines, of which 52 are comment: the two limits that must not be rediscovered
(the one-directional containment, and the separator recognition), and the reason each rule
is shaped the way it is. Executable gate lines added: about 30, of which 20 are the one
helper two defects both needed. No new exported surface, no new dependency.
