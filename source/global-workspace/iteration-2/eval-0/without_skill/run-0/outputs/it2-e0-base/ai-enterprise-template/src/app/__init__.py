"""Template application package.

Replace this module with real code. It exists so the toolchain, tests, and
guardrails have something to operate on out of the box.
"""

__version__ = "0.1.0"


def greet(name: str) -> str:
    """Return a friendly greeting. Placeholder so the smoke test has a target."""
    if not name:
        raise ValueError("name must be non-empty")
    return f"Hello, {name}!"
