# Risk rubric — when an independent verification runs

One table, two consumers, one copy. This file is the copy.

| Change touches | Verification |
| --- | --- |
| A contract or spec | Full verification |
| Behaviour covered by an acceptance test | Verification |
| Docs, comments, formatting | Tests only |

## The two consumers

- **The `verify` lane**, deciding whether to assemble a packet and dispatch the
  verifier at all.
- **The merge path**, in `${CLAUDE_PLUGIN_ROOT}/skills/safe-pr/SKILL.md`, deciding
  whether a pull request is ready to put in front of the founder.

Both read this file. Neither restates the table. A second copy of it somewhere
else is the defect this rule exists to prevent: two consumers that agree today,
one of them edited next month, and nothing in either file to say which reading is
current.

## Reading the table

The rows are ordered by strictness, top to bottom. A change matching more than one
row takes the highest row it matches, so a spec edit shipped alongside a
formatting sweep is a spec change.

"Touches" is about what the change moves, not how much of it there is. A
one-character edit to a contract sits on the top row. A thousand-line rename of
comments sits on the bottom one.

When the row is genuinely unclear, take the higher one. An unnecessary
verification costs one dispatch. A skipped one costs a wrong artifact merged with
a green suite standing behind it.

## What each level means

**Tests only.** The project's tests are the whole check and no agent is
dispatched. This is the common outcome, and it is a finished result rather than a
gap.

**Verification.** One fresh verifier, over the claim and the artifact, covering
what the acceptance test names but cannot judge: what a person sees, reads, or has
to do.

**Full verification.** The same dispatch, with the contract or spec text staged
alongside the artifact, and every claim the change makes enumerated in the packet
rather than sampled. A contract change is the one case where "we checked the
interesting parts" is not enough, because the parts nobody found interesting are
what the contract exists to pin.

## The line this table does not draw

The rubric decides whether an agent looks. It does not decide what the agent looks
at. That split is fixed and sits outside the table: **anything with an oracle
belongs to CI, on every row.** If a check can be written as a test that passes or
fails deterministically, it is a test, and a judgment call about it is a worse
version of a test you already could have had. What is left over — a rendered
screen, a sentence a user reads, a sequence somebody has to follow — has no
oracle, and that leftover is the verifier's whole territory.

Nothing the verifier returns blocks a merge. Its findings are advisory, they post
to the pull request, and the founder weighs them. A probabilistic judgment that
can stop a merge on its own is a gate the project does not have and does not want.
