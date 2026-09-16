# Second reader

One fresh agent, asked to judge a change the tests cannot settle. It is the model's
call, never a lane. Blinding is what the packet omits, not what tools are denied: that
is L-01, and `review-jail`, which denied tools instead, showed a 67 to 100 percent
refusal rate on clean work (PLAN.md section 3).

## What a second reader is for

Tests answer anything with an oracle. A second reader is for what is left over: a
rendered screen, a sentence someone reads, a sequence somebody has to follow, a claim
the suite reports green on without ever weighing. The reader judges the result, not
the change that made it.

Findings are advisory. They post to the pull request, the founder weighs them, and
nothing a second reader returns blocks a merge. A probabilistic judgment wired to a
gate is a gate that fails in a direction nobody can predict. Merge stays with the
founder, and the `block-merge` hook is the only thing in this repository that holds a
tool call back.

Anything a second reader finds that could have been a failing test becomes one. A
judgment call standing in for a deterministic check is a worse version of a test.

## When to call one

It is the model's call, and the pull request body says which way the call went and
why. One sentence is enough: "no second reader, a comment-only change" or "second
reader called, this moves the acceptance contract". Not saying is the only mistake
here, because a silent skip and a considered skip read the same from outside.

A second reader sits at or above the builder's tier. A cheaper reader judging a
harder slice returns an opinion about the parts it could follow.

## The signals that make a change worth one

These are the rows of the old risk rubric, kept as signals rather than as a scoring
lane. Nothing here computes a verdict.

| The change touches | What that signals |
| --- | --- |
| A contract or spec | The strongest signal. Call a reader, stage the contract text beside the artifact, and work every claim the change makes rather than sampling. A contract change is the one case where "we checked the interesting parts" is not enough, because the parts nobody found interesting are what a contract exists to pin. |
| Behaviour covered by an acceptance test | Worth a reader for what the acceptance test names but cannot judge: what a person sees, reads, or has to do. |
| Docs, comments, formatting | The tests are the whole check. This is the common outcome and a finished result, not a gap. |

Two readings of the table that carry their own history:

- **Touching is about what the change moves, not how much of it there is.** A
  one-character edit to a contract is a contract change. A thousand-line rename of
  comments is a comment change.
- **When the signal is genuinely unclear, read it as the stronger one.** An
  unnecessary second reader costs one dispatch. A skipped one costs a wrong artifact
  merged with a green suite standing behind it.

## Blinding is what the packet omits

Blinding is done by what the packet leaves out, not by denying the reader tools. That
is the correction L-01 forced and the reason `review-jail` is gone. Production's own
hook header states the part that stands: an agent holding file tools reads the repo
whatever it is told, so "we asked it not to" is not a seal. The answer is not to take
the tools away. A reader working through a keyhole cannot open a file around a hunk,
cannot check a second occurrence, and cannot run anything, and the measured cost of
that was the 67 to 100 percent refusal rate on clean work.

What goes into the packet, staged as separate files, and assembled by someone other
than the party under test:

- **The claim on its own.** What the change is supposed to do for whoever uses it,
  written from the issue. A claim inferred from the diff is one the evidence cannot
  fail to match.
- **The artifact.** The rendered thing: screenshots and a recording for a screen, the
  real output for a command, the rendered text for prose, the file as a reader will
  meet it.
- **The contract or spec text**, when the change touches one.

What is stripped before dispatch: the builder's reasoning, the pull request body's
rationale, any self-assessment, any prior review, a test result presented as a
verdict, and any statement of what the right answer is. A judge shown a pre-filled
answer agrees with it, at rates near 1.00, and the resulting number measures plumbing
rather than judgment. Read what you staged and take out anything that tells the reader
what to conclude.

The packet is staged outside the repository, under `AEO_REVIEW_PACKET_DIR` when that
variable is set (it must be an absolute path; a relative value denies every read,
including the staged one), otherwise under `<os temp>/aeo-review-packets`, one
subdirectory per reading. A packet staged inside the repository is reachable by an
ordinary read and the omission buys nothing. There is a second reason to stage rather
than paste: a large packet pasted into a dispatch prompt routes through the
orchestrator's context repeatedly and risks being mangled (L-01).

The dispatch carries the packet path and nothing else. Not what you expect, not what
anyone else said, not that anything is suspected. If the reader comes back saying it
lacks context, that is about the packet. Restage; do not answer its question for it.

## Believing the verdict

A clean result from a reader that has never been shown a defect measures the plumbing
and nothing else. Judges of this kind are generous. Where a second reader's verdict is
going to carry weight, plant known defects in packets, run clean twins of the same
packets beside them, and read the detection rate as a range over repeated runs rather
than as one number from one run.
