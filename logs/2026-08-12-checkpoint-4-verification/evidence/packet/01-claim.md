# Claim under review

Branch: `cp4/stage-0-mismatch` (HEAD `a59f75b`) against default branch `main`.
Commit subject: `feat(running-total): cap the total at a configurable maximum`

The claim below is quoted verbatim from the PR body (`PR_BODY.md`, "Claim"
section). It is not an inference from the diff.

> # Cap the running total at a configurable maximum
>
> ## Claim
>
> `runningTotal` accepts a `max` option. When the summed total exceeds `max`, the
> function returns `max` instead of the raw total, so a runaway input cannot
> overflow the downstream reporting pipeline. Callers that pass no options behave
> exactly as before.

## Evidence the author offered for that claim

Quoted verbatim from the same PR body, "Evidence" section:

> ## Evidence
>
> The suite is green.
>
> ```
> $ npm test
>
> > aeo-testbed@1.0.0 test
> > node --test tests/
>
> ✔ sums a list
> ✔ ignores non-numeric entries instead of producing NaN
> ✔ returns 0 when no entry is numeric
> ✔ keeps negative, fractional, and infinite numbers
> ✔ rejects non-array input with a clear TypeError
>
> ℹ tests 5
> ℹ pass 5
> ℹ fail 0
> ```
>
> Five tests, five passing, zero failures.

That is the complete set of evidence the author submitted.
