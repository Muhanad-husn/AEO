# Phase 2 verification — Checkpoint 2

2026-08-11. Branch `feat/phase-2/roles-and-lanes`.

**Status: build slices complete, verification partial.** Everything Phase 2 was to
author exists and is committed. The end-to-end run named in PLAN's verify line has not
been performed. This record is open until it is.

## What landed

| Slice | Model | Output |
| --- | --- | --- |
| P2.0 | Haiku | 11 reference, asset and script files vendored from upstream `593e7ab` |
| P2.1 | Sonnet | `builder`, `reviewer`, `triage` charters |
| P2.2 | Sonnet | `sprint-plan`, `sprint-start`, `fix`, `review`, `triage` lanes |
| P2.3 | Sonnet | `red-green-refactor`, `safe-pr`, `safe-cleanup`, `tdd-ci`, `tdd-plan` |
| P2.4 | Orchestrator | `classify-branches.mjs` fail-closed guards, with tests |
| P2.M | Sonnet | `evals/grade-plugin.mjs`, with tests |

Ten skills ported, not eleven. `status` remains a stub by its own contract and lands in
Phase 6.

P2.4 was written by the orchestrator rather than dispatched, on founder instruction. It
is the one exception to the authoring rule in this phase and it is recorded here so it
stays precedent rather than drift: the founder's standing instruction was that subagents
write and the orchestrator checks, with the orchestrator taking the pen only for
fail-closed logic, which is what P2.4 is.

## Numbers

| Measure | Value |
| --- | --- |
| Acceptance grader | 91 expectations, 91 pass |
| Planted-defect control | 4 planted, 4 caught |
| Fast tier | 139 pass, 0 fail |
| Integration tier | 486 tests, 485 pass, 1 skipped |
| Tests added this phase | 49 |

The one skip is a platform-conditional directory-link case in `review-jail.test.mjs`, not
a guarded group silently declining to run.

**The grader's noise floor is zero by construction** — it is deterministic and
text-based. Nothing was measured for variance, and saying "zero noise floor" here means
"there is no sampling", not "we sampled and found none".

**91/91 is not a quality score.** It says the plugin satisfies static claims it makes
about itself. It does not install or run anything (D21), does not dispatch an agent, does
not judge prose, and does not measure whether a skill triggers. It has **no continuity**
with the vendored skill's 1.0-versus-0.27–0.45 benchmark: different harness, different
artifact shape. Any comparison between those numbers would be invented.

## What is missing from this checkpoint, stated rather than carried

**The end-to-end run has not happened.** PLAN's verify line requires a throwaway issue
driven idea → `/aeo:sprint-start` → prepared PR on a scratch repo with no manual git.
Nothing in this phase substitutes for it. It needs the plugin installed somewhere
disposable, per D21, and it is the first exercise of the whole chain.

**There is no trigger-accuracy number, deliberately** ([D23](../../docs/DECISIONS.md)).
The trigger eval moved to Phase 6, where descriptions are tuned, because a number taken
here would read text scheduled to change and Phase 6's `skill-creator` pass over the same
five skills would re-roll it. Approved by the founder. The gap is real and this is where
it is recorded.

**Dogfooding has not started.** PLAN says it begins the moment Phase 1 closes; D21
forbids installing the plugin into this repository while its skills are stubs that read
as work orders. Both cannot hold. The stubs are now filled, so the constraint expires
with this phase — but Phase 2 was built ungoverned by its own gates, exactly as Phases 0
and 1 were.

## Findings no single slice could see

**A live gate hole, found by a currency check rather than by a test.** C-07's background
tool list names `PowerShell` alongside `Bash`. Every gate decided on the literal string
`Bash`. `sandbox-guard` was genuinely open — it is the only gate that does not exempt the
main session, so it refused `cat <file in the production data root>` while allowing
`Get-Content` on the same file. That is D22's file-tool hole one tool short of closed.
`block-merge` and `commit-gate` were latent. Fixed, with the tool set in `lib.mjs` and
`hooks.json` asserted against it.

`path-guard` was deliberately **not** widened, and a test pins that decision: a shell
writes through a redirect it cannot see whatever its matcher says. That remains D22's
carried finding.

**Two tests that passed for the wrong reason, both caught before they were trusted.** A
shimmed `gh` never resolved on Windows — Node cannot spawn a `.cmd` without a shell and
does not append PATHEXT — so every call reached the operator's real GitHub CLI and the
failure-path assertions passed because the real tool also failed. And `skip: null` skips
in Node's runner, so three tests reported as coverage were not running. The second is
L-08's own skip-guard trap, reproduced inside the tests written to enforce L-08.

**The tier-accounting guard was scoped to one directory.** It scanned `tests/hooks/`
only, so the first test file written outside it was accounted for by nothing — the exact
failure that guard exists to catch. It reads the whole tree now.

**Two subagent reports were wrong and would have made things worse if acted on.** One
flagged a dangling `find-docs` reference that had already been stripped; one reported
L-06's countermeasure as unhomed when it was in `sprint-start` step 5. Both were checked
against the files rather than taken on report.

**A `tools:` allowlist excludes MCP tools.** The current docs use `tools: Read, Grep,
Glob, Bash` as their worked example of a subagent that cannot use MCP tools. The triage
charter had been written to prefer the GitHub MCP issue tools over `gh`, which instructed
it to use something it did not have. Naming a server in `tools:` would hardcode an
identifier that varies per install — D14's failure with new names — so the charter uses
`gh`, which is gated identically.

## Corrections to the record

**D8's supporting fact is stale.** It states that `python3` on this machine is a
Microsoft Store alias stub. Python 3.13.14 runs here. D8's decision stands on its other
reasoning — one runtime, and L-09's five Windows encoding incidents — but the stated fact
is no longer true and should not be repeated.

## Standing constraints

**Did this phase remove more than it adds?** No, and it could not: it replaces stubs with
content. The honest check is against the sources ported. All five harness skills are
shorter than upstream in words. Of the five lanes, three are level or smaller; two grew,
each carrying an obligation the source did not have — EN-2's mechanism field, and packet
staging for a reviewer that did not used to be jailed. The three charters shrank from
62/43/22 lines to 26/20/17.

**Did anything hit a tripwire?** One candidate, resolved rather than justified. The L-05
keep-set guard needed a notion of "suspiciously small", which is a hand-tuned constant by
default. It ships as a categorical zero instead — a run that kept nothing on evidence —
with protected-by-name branches excluded from the count, since base and current exist in
every repository and counting them would make the check pass everywhere. No threshold, no
tunable, nothing to defend.
