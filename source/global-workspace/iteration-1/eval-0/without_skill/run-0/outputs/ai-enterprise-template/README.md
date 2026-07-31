# ai-enterprise-template

A reusable template for a **one-operator AI software enterprise** inside Claude Code.
Tool-locked role subagents (triage, spec, test, implement, review) build and check;
the founder specifies and decides. Two deterministic hook gates hold the line: agents
never merge, and no one commits a red suite. Default stack: Python 3.13+ with `uv`,
`pytest`, and `ruff`.

Start a new product by copying this template, dropping a PRD in `specs/`, and running
the sprint workflow. See `CLAUDE.md` for the constitution and `docs/BUILD-LOG.md` for
the build's decision log and progress tracker.
