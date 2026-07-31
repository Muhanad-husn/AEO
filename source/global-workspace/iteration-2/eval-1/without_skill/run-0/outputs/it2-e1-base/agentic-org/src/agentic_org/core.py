"""Core implementation.

Seed example so the template has a red -> green loop out of the box:
the spec (specs/SPEC-0001) and the tests (tests/test_running_total.py) are
already written; the implementer's job is to make the tests pass WITHOUT
editing the spec or the tests.
"""

from __future__ import annotations

from collections.abc import Iterable


def running_total(amounts: Iterable[float]) -> list[float]:
    """Return the running (cumulative) total of ``amounts``.

    See specs/SPEC-0001-running-total.md for the contract.

    NOTE: intentionally unimplemented in the template. The `implementer`
    role replaces this body to make tests/test_running_total.py pass.
    """
    raise NotImplementedError("implementer: make tests/test_running_total.py pass")
