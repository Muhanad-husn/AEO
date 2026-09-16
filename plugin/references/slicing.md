# Slicing Guide — Thin Vertical Slices

Cut from the original 98 lines to the three parts that decide something: the INVEST bar, the walking skeleton, and L-04 in `docs/EVIDENCE.md`, where two issues checked as file-disjoint both created the same new module with incompatible content and were reconciled by hand. The splitting-pattern catalogue and the worked example are gone; they were a tutorial, not a rule.

## The INVEST quality bar

Every slice must pass INVEST:

- **I**ndependent — can be built and shipped without depending on a sibling slice (order is fine; entanglement is not).
- **N**egotiable — captures intent, not a rigid spec. "A story is not a contract; it IS an invitation to a conversation."
- **V**aluable — delivers something a user or stakeholder can perceive. "If a story does not have discernable value it should not be done. Period."
- **E**stimable — small and clear enough that effort is obvious.
- **S**mall — completable well within an iteration; for this harness, ideally under a day.
- **T**estable — you can write a failing test that defines "done" before you start.

If a slice fails **S** or **T**, split it again. If it fails **V**, drop or merge it.

## The walking skeleton (first slice of a new system)

> "A walking skeleton is an implementation of the thinnest possible slice of real functionality that we can automatically build, deploy, and test end-to-end." — GOOS
>
> "A tiny implementation of the system that performs a small end-to-end function. It need not use the final architecture, but it should link together the main architectural components." — Alistair Cockburn

For any **new** system (no working build/test/deploy path yet), the **first slice is always a walking skeleton**. Its job is to de-risk architecture and infrastructure — project setup, the boundary that runs (a page that loads, an endpoint that responds, a CLI that prints), the test harness (unit runner + Playwright), and ideally the CI pipeline — *before* any real feature content. It carries almost no business logic on purpose; its value is a proven, testable end-to-end thread you can grow.

A canonical walking skeleton slice: "the app starts and serves a page (or endpoint) that returns a hardcoded greeting, proven by one passing unit test and one passing Playwright e2e test." Everything real grows from there.

## Disjointness is asserted over planned paths

L-04, `docs/EVIDENCE.md`: two issues dispatched concurrently were verified as touching no
common files, and both created the same new module and its two test files, with
incompatible content. An independence check of "no shared files, no dependency" passes that
pair.

So a slice plan declares the files it intends to **create**, not only the ones it will
edit. That is what the `aeo-independence` Files block is for, and
`${CLAUDE_PLUGIN_ROOT}/scripts/independence.mjs` reads nothing else.

## Smells that mean "slice again"

- You can't write the acceptance criterion as a single concrete Given/When/Then.
- The slice names a layer ("the API", "the schema") rather than a behaviour.
- "And" appears in the slice's value statement (two behaviours hiding as one).
- You can't imagine finishing it in under a day.
- The only way to test it is through internal functions, not a real endpoint.
- It has no user-visible or stakeholder-visible value.
