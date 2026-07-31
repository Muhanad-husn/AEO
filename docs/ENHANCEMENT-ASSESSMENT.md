# Enhancement assessment

Evaluation of the 13 proposed enhancements in [PRINCIPLES.md](PRINCIPLES.md)
against principle 1 (practicality, 80/20) and principle 2 (over-engineering
tripwires), grounded in what is actually vendored under `source/`.

Requested by enhancement 10: *"evaluate every proposed enhancement against the
practicality-first principle and the 80/20 rule."*

## The headline

**The 13 proposals are not 13 units of work.** Measured against the vendored
source, six already exist and need *generalizing, not building*; three are policy
or prose costing near-zero; and only four are genuinely new engineering.

| Bucket | Enhancements | Work |
| --- | --- | --- |
| Already built, needs de-Axialing | 3, 4, 5, 9, 10, 11 | Strip hardcoding |
| Policy / prose only | 2, 7, 8 | Write it down, pick one owner |
| Genuinely new engineering | 1, 6, 12, 13 | Build |

The migration's real cost sits in enhancements 1, 6, 12, and 13. Everything else
is editing.

## Per-enhancement verdict

| # | Proposal | Already in `source/`? | Verdict | Cost |
| --- | --- | --- | --- | --- |
| 1 | Requirements before stack | ❌ Opposite — Python/`uv`/`pytest`/`ruff` hardcoded in `commit-gate.ps1`, `format.ps1`, `directory-tree.md` | **Build** — as config, not framework | M |
| 2 | Survey existing tooling first | ❌ | **Adopt** — one step in the planning skill | XS |
| 3 | Independent review | ✅ `review` skill dispatches read-only reviewer subagent; fresh context by default | **Keep** — make default-on for risky changes | XS |
| 4 | Risk-based test scoping | ✅ `safe-pr` already refuses the full tree: *"the full tree costs ~8 minutes of founder wall-clock while proving nothing CI is not already proving"* | **Keep** — generalize the "sprint suite" wording | S |
| 5 | Fast lane for surgical changes | ✅ `fix` skill; bounces feature-scale work to `sprint-start` | **Keep** — generalize | S |
| 6 | Concurrency by default | ⚠️ Worktrees exist; no orchestration pattern | **Build — narrowly** (see below) | M |
| 7 | Project tracker as source of truth | ⚠️ Conflict: GitHub issues *are* the record per Axial's CLAUDE.md, yet a hand-maintained `TRACKER.md` also exists | **Adopt — but pick one** | S |
| 8 | Preset command per routine task | ✅ `fix`, `safe-pr`, `safe-cleanup`, `triage`, `sprint-*`, `tdd-*` | **Keep** — resolve the reviewer duplication | S |
| 9 | Orchestrator capabilities | ✅ Per-role model pinning is already a graded check in `grade_repo.py` | **Document, don't build** | XS |
| 10 | Briefings, not code review | ✅ "Answering the founder" conventions | **Keep** — enforce at PR boundary | XS |
| 11 | Deterministic evidence | ✅ **Strongest asset in the set.** `collect-evidence.mjs` runs tests, copies transcripts, secret-scans, pins links to the evidence commit; 61 features / 191 artifacts in `docs/tdd-evidence/` | **Keep** — generalize beyond CLI transcripts | S |
| 12 | Independent verifier | ❌ | **Build — highest-value new idea** | L |
| 13 | Verification gates deployment | ⚠️ Gates exist (`commit-gate`, `block-merge`); verification does not | **Build on existing gates** | M |

## Answering the question in #8

You asked whether `safe-pr` and `pr-review-toolkit:review-pr` overlap. **They
don't** — the premise needs correcting.

- **`safe-pr` *produces* the PR.** Runs the suite, captures transcripts,
  secret-scans, generates the body, pushes, opens the PR, stops. Never merges.
- **`review-pr` *critiques a diff*.** Fans out six specialist agents (comments,
  tests, error handling, types, general quality, simplification) and aggregates
  findings.

One authors, the other criticizes. They are sequential, not competing — standardize
on **both**.

**The real duplication is elsewhere:** Axial's own `review` skill overlaps
`pr-review-toolkit:review-pr`. Both are "dispatch fresh agents to critique a
change." They differ in a way that matters:

| | Axial `review` | `pr-review-toolkit:review-pr` |
| --- | --- | --- |
| Spec compliance | ✅ Two-stage: spec first, then quality | ❌ No spec awareness |
| Contract-movement justification | ✅ Checks the PR body | ❌ |
| Specialist lenses | ❌ One reviewer role | ✅ Six specialists |

**Recommendation:** keep Axial's `review` as the gate — spec compliance and
contract-movement checking are load-bearing for principle 3 and `review-pr`
cannot do them. Borrow `review-pr`'s specialist lenses as optional depth for
high-risk changes. Do not standardize on `review-pr` alone; it would silently
drop the spec gate.

## Where the 80/20 line falls

**Enhancement 1 — parameterize, don't abstract.** The stack appears in exactly
three places: the test command, the format command, and the scaffold's directory
skeleton. Fix it with a stack profile the scaffold writes once, read by the hooks.
A pluggable stack-provider system for a plugin with one or two real stacks would
trip tripwire 2 ("an abstraction with only one implementation").

**Enhancement 6 — split read-only from write concurrency.** Parallel *read-only*
work (review, research, verification, evidence checking) is safe, needs no
coordination, and is where most of the wall-clock win is. Parallel *implementation*
needs worktree isolation and is where conflicting edits and coordination overhead
bite. Ship read-only fan-out first; treat parallel implementation as a separate,
later decision. That is ~80% of the benefit at ~20% of the risk. This session is
itself the evidence: five parallel read-only agents completed the vendoring in one
pass with zero conflicts, because destinations were disjoint.

**Enhancement 7 — one source of truth, or it rots.** A hand-maintained tracker
alongside GitHub issues is two records that will disagree. Since issues are already
the system of record and `session-status.ps1` already injects branch/issue/PR state
at SessionStart, the cheap correct move is to make the tracker a *generated view*
of issues, not a parallel document.

**Enhancement 13 — "proportional to risk" needs teeth.** As written it is the
clause preventing this from becoming ceremony, but it has no definition. Left
vague, every change becomes "medium risk" and full verification runs every time —
exactly the process defect principle 1 warns against. It also needs a rubric that
is not a magic number (tripwire 2). Suggested split, using signals the system
already has: touches a contract or spec → full verification; changes behaviour
covered by an existing acceptance test → verification; docs, comments, formatting →
gate on tests only.

## Tensions with the fixed principles

Flagging these because they will surface during migration, not to reopen them.

1. **Principle 5 versus principle 1.** Mandating subprojects → contracts → phases
   → stages on *every* project is heavy for a plugin intended for other people's
   repos. A small CLI does not need the hierarchy, and forcing it is the
   perfectionism principle 1 rejects. Recommend it as the default for
   multi-component products, not a hard requirement.

2. **Principle 3 versus enhancement 6.** Spec changes need founder approval;
   concurrency is default-on. Several parallel agents each hitting a spec question
   will serialize on you and stall. Worth deciding now whether agents batch spec
   questions or park them and continue.

3. **Enhancement 12 versus principle 1.** An independent verifier per slice
   roughly doubles agent cost. Justified for behaviour changes; ceremony for a
   typo fix. Its trigger must be the same risk rubric as enhancement 13, or the
   two will disagree.

## Suggested sequencing

1. **De-Axialize what exists** (3, 4, 5, 9, 10, 11) — mechanical, unblocks
   everything, and makes the plugin installable at all.
2. **Enhancement 1** — stack config. Without it the plugin only works for Python.
3. **Enhancement 13's risk rubric** — needed before 12 and 6 have a trigger.
4. **Enhancement 12** — independent verifier, gated by that rubric.
5. **Enhancement 6** — read-only concurrency first.
6. **Enhancements 2, 7, 8** — policy, cheap, can land any time.

## Open decision

The PowerShell-only hook problem is unresolved and blocks all of the above. All
five hooks are Windows PowerShell with no POSIX implementation anywhere in the
vendored source, invoked through a hardcoded `powershell -NoProfile
-ExecutionPolicy Bypass -File` line pinned to an observation on Claude Code
2.1.201. A plugin distributed to other people cannot assume Windows. This needs a
decision — port to Python (already a dependency), ship both, or declare
Windows-only — before enhancement 13's gates mean anything on another machine.
