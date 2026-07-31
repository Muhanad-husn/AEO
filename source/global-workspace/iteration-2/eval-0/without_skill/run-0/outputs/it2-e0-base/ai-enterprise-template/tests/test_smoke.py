"""Smoke test.

Guarantees pytest always collects at least one test, so the "no commit while
tests are failing" guardrail has a real signal to gate on from day one.
"""

import pytest

from app import greet


def test_greet_returns_greeting():
    assert greet("world") == "Hello, world!"


def test_greet_rejects_empty_name():
    with pytest.raises(ValueError):
        greet("")
