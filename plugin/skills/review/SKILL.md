---
name: review
description: Dispatch the read-only reviewer role for a two-stage check on the current branch's diff against the default branch — spec compliance first, since a green test can still betray its spec, then code quality and over-engineering. Use on demand, or for a change that touches shared modules or carries outsized blast radius.
disable-model-invocation: true
---

# Review — entry point

Dispatches the reviewer role for a two-stage check on the current
branch's diff against the default branch: spec compliance first, since a
green test can still betray its spec, then code quality. Use on demand,
or when a change touches a shared, widely-depended-on module, core
config, or dependency wiring: surface where a defect carries outsized
blast radius.

The reviewer is sealed off from the repository by a `PreToolUse` gate. It
can `Read` nothing but a staged packet, outside the repo entirely. That
makes this skill's real job assembling the packet, not writing the
review.

## Staging the packet

Stage evidence, not pointers. The reviewer cannot open a file around a
hunk, grep for a second occurrence, or run anything. Write, as separate
files:

- the diff against the default branch
- the issue and the spec section under review
- any test evidence the builder produced (the reviewer cannot run tests)
- any spec or contract movement in the branch, with its justification

Stage this under `AEO_REVIEW_PACKET_DIR` when that environment variable
is set (it must be an absolute path; a relative value denies every read,
including the staged one), otherwise under
`<os temp>/aeo-review-packets`. Give each review its own subdirectory,
named for the issue or branch, since more than one review can be staged
at once. The party under review never assembles its own packet.

## Dispatch and relay

Dispatch the reviewer with the packet path. It reports spec compliance,
then quality, in that order. Relay both to the founder and post findings
to the issue thread. Fixes route back to the builder; the reviewer edits
nothing. For a high-risk change, `pr-review-toolkit`'s specialist lenses
add useful depth alongside this, not instead of it: they check code
quality from several angles but not spec compliance, which stays this
lane's job. A passing review earns `safe-pr`, never a merge.
