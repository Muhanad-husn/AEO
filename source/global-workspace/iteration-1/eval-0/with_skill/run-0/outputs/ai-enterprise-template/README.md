# ai-enterprise-template

A reusable template repository that encodes a one-person AI software enterprise inside
Claude Code. Tool-locked role subagents do triage, spec authoring, test authoring,
implementation, and review; a single human (the founder) holds architecture and merge
authority. Two deterministic hook gates make the boundary real: agents never merge, and
no one commits a red suite. Default stack profile: Python 3.13+ with `uv`, `pytest`,
`ruff`.

See `CLAUDE.md` for the operating handbook and `docs/` for the decision log and progress
tracker.
