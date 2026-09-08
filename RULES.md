# Rules

One page. Read before any work in this repository.

## The gates

1. **The product is a consuming project's number, not this repository's.** A harness
   change earns its place by moving what a project that uses it delivers: days to a correct
   deliverable, dollars spent, or both. `D:\RLM` is the reference consumer and its
   `PLAN.md` status table is the score. A pull request says which number it expects to
   move and by how much; one that moves nothing says so, and the founder decides.
2. **Two attempts per shape, then replace.** A fix that fails twice is not tried a third
   time on the same shape. The third attempt changes the shape, or stops and says the
   method is wrong. That report is a first-class message, not an apology.
3. **Merge stays with the founder.** The `block-merge` hook enforces it on every subagent.
   Nothing else in this repository refuses a tool call.
4. **Cost is reported beside the change.** Node processes fired per tool call, lines a
   session reads before its first action, lines of tests over lines of source. A change
   that raises any of them names the number in its pull request.
5. **Kill line.** A sentence edit that costs more than one commit means a rule is wrong,
   not the sentence. Stop and remove the rule before touching the sentence again.

## The two rules that stop the loop

- **A rule earns its place by removal.** Take it out, run the consumer, compare. If the
  number holds without it, it is deleted, whatever it cost to write. The first build's
  gates are already measured this way once (D30) and every survivor is due the same test.
- **No fix is aimed at a check.** Work is aimed at a consumer's deliverable. An eval number
  (trigger accuracy, `grade:plugin`) is read and reported, never protected. Prose gets no
  mechanical test.

## Reporting

One message per phase and per day: what shipped, what it cost, one recommendation with
its number. Nothing else.

## Prose

Plain. No marketing register. No em dashes. Certainty words come from the source, never
invented. A rule states what holds now and cites nothing.

## Decisions the founder has made, and one he has not

Made: the `aeo` plugin is off in this repository; one hook, two skills and one readout are
the whole harness; `plugin/`, `docs/`, `logs/` and `source/` are the first build's record;
merge is his; prose is free to change.

Open, with this file's proposal:

1. The score for this repository while `D:\RLM` is its only consumer. Proposed: RLM's
   status table, as is, until a second consumer exists; then days and dollars across both.
