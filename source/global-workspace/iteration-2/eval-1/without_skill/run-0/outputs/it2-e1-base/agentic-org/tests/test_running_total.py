"""Tests for agentic_org.core.running_total.

OWNED BY: the `test-author` role. The `implementer` role is hard-locked out
of this directory (enforced by .claude/hooks/role_guard.py). These tests are
the executable contract derived from specs/SPEC-0001-running-total.md.
"""

import pytest

from agentic_org.core import running_total


def test_empty_input_returns_empty_list():
    assert running_total([]) == []


def test_single_element():
    assert running_total([5]) == [5]


def test_cumulative_sequence():
    assert running_total([1, 2, 3, 4]) == [1, 3, 6, 10]


def test_handles_negative_values():
    assert running_total([10, -3, -2]) == [10, 7, 5]


def test_accepts_any_iterable():
    assert running_total(iter([2, 2, 2])) == [2, 4, 6]


def test_does_not_mutate_source_list():
    src = [1, 2, 3]
    running_total(src)
    assert src == [1, 2, 3]


@pytest.mark.parametrize(
    "amounts,expected",
    [
        ([0], [0]),
        ([1.5, 2.5], [1.5, 4.0]),
    ],
)
def test_parametrized(amounts, expected):
    assert running_total(amounts) == expected
