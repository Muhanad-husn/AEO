# Lessons from production

Mined from the live implementation's postmortems, decision log, runbooks and
trackers. Everything here is grounded in a real incident with a file or commit
behind it. Filtered to what generalises — domain findings about the corpus are
excluded.

Ordered by what it changes, not by where it was found.

---

## Six that change decisions already taken

### L1 — "The reviewer never sees the builder's report" must be a hook, not a convention

The strongest correction in the set. Production learned it and wrote it into a
hook header:

> An agent holding file tools reads the repo whatever it is told, so "we asked it
> not to" is not a seal.

Their implementation is a `PreToolUse` hook that blocks *every* tool for the judge
role except a `Read` of one staged path in the OS temp scratchpad, **outside the
repo entirely**. Reinforced structurally: reviewers dispatch through a call that
has no `tools` parameter to pass, so a reviewer cannot be handed a tool registry
even by mistake.

**What changes.** E3 proposed withholding the builder's narrative as a *dispatch
convention*. A reviewer with `Read`, `Grep` and `Glob` can simply go and read
whatever it likes — including the builder's branch, its commit messages, and the
PR body. The convention is not a seal.

There is a second reason to stage the packet rather than paste it: a large packet
pasted into a dispatch prompt routes through the orchestrator's context multiple
times and risks being mangled.

### L2 — Committing is a data-mutating operation, and it killed a live run four times

Because the commit gate runs the test suite, **`git commit` executes code**. The
runbook states the rule bluntly: *while a corpus run is live, no `pytest` and no
commits, from any session.* It is not theoretical — four simultaneous external
kills of a running pipeline were traced to a concurrent session's commit gate
firing the suite.

**What changes.** `P1.5` currently guards the *data path*. It also needs a
**run-in-progress sentinel that the commit gate refuses to cross.** This is the
concurrency hazard of the four-actor model in its sharpest form: actor B's routine
commit kills actor A's four-hour run.

This is the same asymmetry already noted — every other gate blocks an action; the
commit gate performs one — but with a second victim class nobody had named.

### L3 — Tests reach live data in more ways than a data-path check catches

Three separate incidents, months apart, all invisible in CI *because CI has no
data directory*:

- A module-global logs root meant any test driving `main()` wrote real timestamped
  run directories into the operator's live logs — **79 leaked directories over
  five days**, one of which a status hook then reported as "newest run".
- A lookup resolving through a *default* directory when the argument was omitted
  meant six test call-sites silently read the operator's live 49,674-entry index.
- A conftest fixture snapshotting and restoring a shared state directory — the
  mitigation that existed, which addresses collision but not reach.

**What changes.** Two additions to `P1.5`, both from their fix shape:

1. Repoint **every** default-directory resolver in an autouse fixture, not just
   the one obvious data root.
2. **An environment-variable seam is required**, because in-process monkeypatching
   never reaches a subprocess CLI child — and integration tests shell out.

And a charter line: *"it passed in a worktree" is not verification for anything
data-facing.* These reproduce only on the operator's machine.

### L4 — "File-disjoint" is not disjoint if the files don't exist yet

Two issues were dispatched concurrently, verified as touching no common files.
Both created the same new module and its two test files, with incompatible
content. Reconciled by hand.

**What changes.** Phase 5's independence check as written — "no shared files, no
dependency" — would have passed this pair. **Disjointness must be asserted over
planned new paths**, which means slice plans have to declare the files they intend
to create, not just the ones they will edit.

### L5 — Any destructive tool must fail closed on an empty input set

A garbage collector was built correctly, then review found that an empty keep-set
— which is what you get from running in the wrong working directory — makes
*every* artifact an orphan. `--apply --yes` would have deleted the entire derived
corpus. Fixed by raising before any confirmation, logging or removal, **with no
override flag**.

**What changes.** Generalise to `safe-cleanup` and anything else that sweeps,
prunes or GCs: an empty or suspiciously small keep-set is a hard failure *before*
the confirmation prompt, and there is no bypass. The absence of an override flag
is the point — an override is what you reach for at 2am.

### L6 — The tiered suite creates a blind spot exactly where the interesting failures are

An acceptance-level regression was "invisible locally because the commit gate only
runs the fast tier, not the acceptance directory." The tiering is deliberate and
correct — the full tree is CI's job. The consequence is still real: acceptance
breakage is only ever discovered in CI.

**What changes.** Honest cost of our own E4 design, and it needs a stated
countermeasure rather than silence: any change touching a module with outer
acceptance contracts either runs those contracts locally or waits for CI green
before approval is requested.

---

## Charter lines worth adopting close to verbatim

**On auditing versus using.** Three days of mechanism inspection changed the
product's output exactly zero times — the findings the period ended with were the
same ones it started with, each fix surfacing the next defect one layer down. The
standing rules that came out of it:

- **New issues come from using the product, not from auditing it.**
- Backlog is closed against a bar: anything moving accuracy, latency or cost by
  less than ~5% is dropped, or converted to a future item **with a named trigger**.
- **A ship gate cannot be defined after the ship.**

This is the sharpest anti-over-engineering material in the corpus and it is
evidence for founder principle 1, not just a restatement of it.

**Prefer the reversible error direction.** A measured 5.1× speed lever was
rejected despite a defensible agreement score, because its errors were lopsided
toward the *irreversible* direction — over-merging destroys information, while
under-merging only splits something that can be rejoined. The asymmetry decided
it, not the headline number.

**When two rounds of rewording fail, change the mechanism.** A rule failed twice;
the second attempt made a different half worse. Withdrawn with an explicit note
that the next attempt must change the mechanism rather than open a third round
against a cause the prompt does not control. It shipped as a positional rule with
zero model calls, landing within projection where the model rounds had over-cut.

**Agents are for judgment, not for waiting.** Processes run, the session polls,
subagents summarise. An agent cannot reliably babysit a multi-hour job and
delegating a wait loop burns tokens to do nothing — but handing a subagent a
finished log (thousands of lines in, a paragraph out) is genuinely good
delegation, and keeps the log out of the orchestrator's context.

**Standing delegation is explicit, time-boxed, and never extends to merge.** When
the founder went remote mid-run, the session recorded that everything from that
point ran under standing delegation, labelled each such decision as made
autonomously rather than confirmed live — and the builder dispatched under it was
still told to stop short of merging, no exception.

**Read the actual call site, not the docstring or the plan's claim about it.**
Recorded as happening three times in one session. The worst instance: a parameter
was never passed through, so a checkpointing feature had *never run, for any
input, ever* — which is why eight "retries" were eight cold restarts, and why a
correct fix produced no observable effect when tested.

**A named or locked test encodes a deliberate decision — read it before "fixing"
the gap it looks like.** From the record: *"I almost made an unauthorized code
change here — caught it by reading tests first."*

---

## Gate and tooling patterns worth stealing

- **An unset threshold makes a gate silently skip.** Two budget checks were
  configured `null`, so the gate reported SKIPPED and the retest "would not have
  exercised the gate it exists to be." Unconfigured threshold = hard fail or loud
  skip, never a quiet pass.
- **Budgets are ceilings that never fire.** Set at 1.3–1.6× the highest observed,
  because "a gate one ordinary run from crying wolf is not a ceiling." Check
  whether a budget is *binding* before tightening it.
- **A skip-guard turns a re-run into a silent no-op that reports OK** — named as
  "the trap most likely to waste a night." A resumable pass must print its skip
  count loudly, and a run summary must refuse to report OK on a 100% skip.
- **Every cap that drops input emits a count on both sides.** A prompt composer
  silently truncated: 506 items assembled, 146 composed — 360 paid for and read by
  no model, recorded nowhere.
- **A zero over historical data means "not measured," not "none found."** Three
  independent instances. Any aggregate over derived data must be dated against the
  landing commit of the field it reports.
- **A count-based preflight is not a coverage check.** `Count >= 30` passes with a
  real input missing. Diff the names.
- **Blind same-prompt retry is for transient faults only.** Content-caused
  failures need a reroute, a quarantine, or a re-ask-with-feedback — not the same
  dice again. And **log every retry attempt**: silent retries made exposure
  unmeasurable and made the issue's own framing wrong.
- **A monitor reporting IDLE is not reporting "finished."** A healthy run invoked
  under a different subcommand showed `0 live workers / IDLE` for its entire
  duration. A monitor's negative signal must be distinguishable from "not
  instrumented for this shape of run."
- **Liveness needs movement across two checks, not a snapshot** — "a snapshot
  progress table looks identical whether a run is healthy or dead." CPU alone is
  untrustworthy; a stalled worker can spin at zero progress. And **do not
  blind-restart a suspected stall**; it will re-hang on the same input.
- **Front-load ground truth at session start.** A status answer once repeated a
  five-day-old memory and a never-ticked checkbox about work that had shipped.
  Their `SessionStart` hook prints live repo state and explicitly labels memory
  files and plan checkboxes as *neither ground truth* — worth heeding for our own
  `/status`, and for the memories written this session.
- **A runbook is only valid if it has been executed since the last method
  change.** A documented procedure asserted as surviving a redesign was found to
  describe a workflow superseded three times; running it as written would have
  reproduced the exact defect it was meant to fix.
- **Closure requires named evidence.** An issue was found closed while
  unimplemented.

---

## The Windows-specific fixes, and why they argue for the port

Each of these is a real incident, and **every one of them evaporates when the
hooks are Python**:

- PowerShell `*>>` writes UTF-16 and breaks log monitors.
- `Get-Date -Format 'u'` emits local time with a misleading trailing `Z` — a whole
  run's retry log carried wrong timestamps.
- `"$attempt:"` parses as a drive reference; needs `${attempt}:`.
- Console output and file reads default to the ANSI codepage, turning every em
  dash into mojibake unless UTF-8 is set at the top of every hook.
- A session-provided `cwd` can arrive in MSYS form (`/d/proj`), which `git -C`
  cannot consume.

Five recorded incidents, all encoding-and-quoting accidents in the gate layer.
That is an argument for `A1` independent of portability: this is not a language
anyone should be writing security-critical, fail-closed logic in by accident.

One that does **not** evaporate and must be carried across: a CLI that floods
stdout floods an agent's context. Their extractor printed ~600KB per input, with a
standing instruction to always redirect it.

---

## Measurement discipline

Relevant to Phase 4 (verification) and to any claim this project makes about
whether a change helped.

- **Measure the noise floor before reading any comparison.** Re-running an
  identical generative pass reproduced its own result only **88.9%** of the time.
  That single number reframed two prior verdicts — one apparent regression was
  within noise, another sat 21 points below the floor and was real.
- **Diff the entries that flipped, never just the totals.** A shipped regression
  was hidden by *every* aggregate: two metrics improved to zero while substantive
  output fell by a third. Elsewhere a one-word cosmetic relabel re-rolled 93 of 176
  results.
- **A judge shown a pre-fill rubber-stamps it.** Correction rates of 0.99/1.00/1.00
  against the system's own values — contributing nothing, and the first diagnosis
  drawn from it was wrong. A dispatched judge never sees the answer under test.
- **A test without a positive control pins plumbing, not judgment.** Plant known
  defects and confirm they are caught before trusting any judge's number, "since
  LLM judges are systematically generous and sensitive to confident prose."
  Directly applicable to Phase 4's agent verifier.
- **Internal accuracy against your own system's output is not accuracy against
  truth.** A classifier scored 59–85% against its teacher's labels and 39.7%
  against ground truth — below the teacher.
- **`--limit N` is not a sample.** It takes the alphabetical head. Ship
  `--sample --seed`.
- **Measure one unit before launching thirty.** A probe corrected a wall-clock
  estimate from ~8–15h to ~19–20h *and* surfaced a hard reproducible failure
  before the full run.
- **Check what actually reaches the prompt before tuning the prompt.** "The model
  got it wrong" was wrong three times over — the model never saw the data.

---

*Fifty lessons were surfaced; the ones omitted here are either already captured in
`DOCS-CURRENCY.md` and the divergence list, or specific to the source product's
domain. The full search covered postmortems, the decision log, runbooks, trackers,
plan files and source comments.*
