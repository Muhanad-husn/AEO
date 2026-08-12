---
name: verify
description: Run an independent verification of a change before it goes in front of the founder — classify it against the risk rubric, and where the rubric asks for it, stage a packet and dispatch a fresh verifier over what the tests cannot settle. Findings post to the pull request as advisory. Use on demand, on a change that moves a contract, a spec, or behaviour a person will see.
disable-model-invocation: true
---

# Verify — entry point

An operator lane, not a reflex. Verification runs when the rubric says it runs,
and most changes do not reach it. That restraint is the design, and its reason is
in [D4](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md).

## 1. Classify

Read `${CLAUDE_PLUGIN_ROOT}/skills/verify/references/risk-rubric.md` and take the
row. That file is the only copy of the table; do not paraphrase it here or
anywhere else. The merge path in
`${CLAUDE_PLUGIN_ROOT}/skills/safe-pr/SKILL.md` reads the same file, which is why
the two cannot drift apart.

On **Tests only**, say so and stop. That is a finished outcome and the common one.

## 2. Assemble the packet

The party under test never assembles the packet. That is this lane's job, and the
lane is not the builder.

Stage, as separate files:

- **The claim, on its own.** One statement of what the change is supposed to do
  for whoever uses it, written from the issue, not lifted from the builder's
  report. If the issue does not state a claim in those terms, write one and say in
  your report that you did.
- **The artifact.** The rendered thing: screenshots and a recording for a screen,
  the actual output for a command, the rendered text for prose, the file as a
  reader will meet it. Not the diff that produced it. The verifier is judging the
  result, not the change that made it.
- **The contract or spec text**, on the top row only.

Then strip. The packet must not contain the builder's reasoning, the pull request
body's rationale, a self-assessment, a prior review, a test result presented as a
verdict, or any statement of what the right answer is. A judge shown a pre-filled
answer agrees with it, at rates near 1.00, and the resulting number measures
plumbing rather than judgment. Read what you staged and take out anything that
tells the verifier what to conclude.

Stage under `AEO_REVIEW_PACKET_DIR` when that variable is set (it must be an
absolute path; a relative value denies every read, including the staged one),
otherwise under `<os temp>/aeo-review-packets`. Give each verification its own
subdirectory. The packet lives outside the repository because a packet staged
inside it is reachable by an ordinary repository read, and the isolation would buy
nothing.

## 3. Dispatch

Dispatch the `verifier` role with the packet path and nothing else. Do not tell it
the row, what you expect, what the reviewer said, or that anything is suspected.
On the top row, tell it to work through every claim in the packet rather than
sampling.

## 4. Relay

Post the findings to the pull request, labelled as advisory, with the confidence
each one carries. Relay them to the founder alongside the tests. Then do two
things with them:

- **Anything with an oracle goes to CI, not into the verdict.** If a finding could
  have been a failing test, the outcome is a test, filed and written. A judgment
  call standing in for a check that could be deterministic is the slow, invisible
  way this lane turns into ceremony.
- **Nothing here blocks a merge.** No finding from this lane becomes a required
  check, and no count of findings converts into a refusal. The founder weighs them
  against everything else and decides. A probabilistic judgment wired to a gate is
  a gate that fails in a direction nobody can predict.

A `NEEDS_CONTEXT` verdict is about the packet, not the change. Restage and dispatch
again; do not answer the verifier's question for it.

## Why you can believe the verdict at all

This role was not trusted until it had been shown defects it did not know were
there. Known defects were planted in packets, clean twins of the same packets were
run beside them, and the detection rate was read as a range over repeated runs
rather than as one number from one run. Judges of this kind are generous, and a
clean result from a judge that has never been shown a defect measures the plumbing
and nothing else.

That measurement belongs to the charter, so any edit to the verifier's charter
retires it. Re-run the control before the next verdict is worth reading.
