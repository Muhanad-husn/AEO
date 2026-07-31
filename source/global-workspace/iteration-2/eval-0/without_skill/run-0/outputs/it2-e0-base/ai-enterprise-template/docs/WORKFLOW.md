# How the AI dev team works

A single human founder plus five role subagents run a test-first pipeline. Work
flows one direction; only the founder crosses the final line into `main`.

```
  request
     │
     ▼
 ┌─────────┐   problem     ┌──────────────┐   spec      ┌──────────────┐
 │ triage  │──────────────▶│ spec-writer  │────────────▶│ test-writer  │
 │ (haiku) │  statement    │   (opus)     │  docs/specs │  (sonnet)    │
 └─────────┘               └──────────────┘             └──────┬───────┘
                                                 failing tests │ (red)
                                                               ▼
                                       ┌──────────────┐   green + commit
                                       │ implementer  │   on feat/ branch
                                       │  (sonnet)    │────────────────────┐
                                       └──────────────┘                    │
                                                                           ▼
   ┌───────────────────────┐   APPROVE / REQUEST-CHANGES   ┌──────────────┐
   │  HUMAN FOUNDER merges  │◀─────────────────────────────│  reviewer    │
   │  the PR into main      │       PR summary             │  (opus)      │
   └───────────────────────┘                              └──────────────┘
```

## Roles
| Agent | Writes to | Never does |
|-------|-----------|------------|
| triage | nothing (read-only) | design solutions |
| spec-writer | `docs/specs/` | touch code or tests |
| test-writer | `tests/` | write source; commit red suites |
| implementer | `src/` | merge, push, commit red, gut tests |
| reviewer | nothing (read-only) | merge, push, approve red suites |

## The two hard guardrails
1. **No merge to main / no push by agents.** Enforced by `git_guard.py`
   (PreToolUse), the `permissions.deny` list in `.claude/settings.json`, and the
   native `.githooks/pre-push` + protected-branch checks. Merging a PR is the
   founder's decision alone.
2. **No commit while tests fail.** `git_guard.py` runs `pytest` before every
   commit and refuses on a red suite; `.githooks/pre-commit` repeats the check
   natively so it holds even outside Claude Code.

## Branch model
- `main` is protected. Agents work on `feat/<slug>` branches only.
- The founder reviews the reviewer's PR summary and merges (see
  `docs/SETUP_COMMANDS.md` for enabling server-side branch protection).
