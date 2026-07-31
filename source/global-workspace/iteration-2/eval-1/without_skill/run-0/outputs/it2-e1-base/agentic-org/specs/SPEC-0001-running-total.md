# SPEC-0001 — running_total

- Status: Accepted
- Owner role: `architect`
- Implemented by: `src/agentic_org/core.py::running_total`
- Verified by: `tests/test_running_total.py`

## Summary

Provide a pure function that computes the running (cumulative) total of a
sequence of numbers.

## Contract

`running_total(amounts: Iterable[float]) -> list[float]`

- Given an iterable of numbers, return a NEW list where element `i` is the sum
  of input elements `0..i` inclusive.
- Empty input returns an empty list.
- Must accept any iterable (lists, generators, ...), consuming it once.
- Must NOT mutate the caller's input.
- Supports negative and floating-point values.

## Acceptance criteria

| # | Given            | Expect            |
|---|------------------|-------------------|
| 1 | `[]`             | `[]`              |
| 2 | `[5]`            | `[5]`             |
| 3 | `[1,2,3,4]`      | `[1,3,6,10]`      |
| 4 | `[10,-3,-2]`     | `[10,7,5]`        |
| 5 | `iter([2,2,2])`  | `[2,4,6]`         |

## Out of scope

- Streaming / lazy output (return a fully materialised list).
- Overflow handling beyond native Python numeric behaviour.
