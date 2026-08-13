# Issue and spec section under review

## Issue

There is no issue for this change. The repository's full issue list, read from
GitHub at staging time, is:

```
1  CLOSED  runningTotal throws an unhelpful TypeError when the input is not an array  2026-08-11T17:41:18Z
```

Issue #1 is closed and was resolved by PR #2 (`fix/1-running-total-input-guard`,
merged), which is already on `main` and is not part of this branch. No open or
closed issue describes a maximum, a cap, or a `max` option. The `max` feature on
this branch was not filed as an issue.

## Spec

The repository has no spec or contract document. `docs/` contains only
`docs/tdd-evidence/`, which holds recorded test and CLI output from the earlier
input-guard slice — evidence, not specification. Directory listing of `docs/` at
staging time:

```
docs/
  tdd-evidence/
    running-total/
      01-input-guard/
        cli-demo.txt
        test-run.txt
```

The nearest thing to a written contract for `runningTotal` is therefore the test
suite itself, staged as `06-tests-total.test.mjs`, plus the pre-change source
(reproduced below) that the tests were written against.

### Pre-change source, `src/total.mjs` at `main` (`db5086b`)

```js
export function runningTotal(values) {
  if (!Array.isArray(values)) {
    throw new TypeError(
      `runningTotal: expected 'values' to be an array, received ${typeof values === 'object' && values !== null ? Object.prototype.toString.call(values) : String(values)}`
    );
  }

  return values
    .filter((v) => typeof v === 'number' && !Number.isNaN(v))
    .reduce((a, b) => a + b, 0);
}
```

## Spec or contract movement in this branch, with justification

The branch changes the public signature of `runningTotal` from `(values)` to
`(values, options = {})` and adds a `max` option that changes the return value.
That is a widening of the module's public contract.

No accompanying justification was submitted: the branch contains one commit
touching one file (`src/total.mjs`, +7 −2). No spec was written or amended, no
issue records the requirement, the test file is unchanged from `main`, and no
new evidence file was added under `docs/tdd-evidence/`. The full statement of
intent available anywhere is the PR body's Claim section, staged as
`01-claim.md`.

## Blast radius note

`src/total.mjs` exports the module's only function and is the single production
source file in the repository (`src/` contains `total.mjs` and nothing else), so
every consumer of this package reaches this function.
