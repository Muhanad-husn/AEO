# Claude Code docs currency check

Checked 2026-07-31 against the current official docs. The vendored skill was
written against an older Claude Code and several of its **locked decisions no
longer hold**. Three findings change the plugin design; one changes a decision
taken earlier in this project.

Every claim below carries its doc URL. Where a doc contradicts the skill, the doc
wins — the skill's own operating rule 6 says to verify mechanics against current
docs before writing them.

---

## Findings that break locked decisions

### 1. DEC-18's double-wiring is impossible in a plugin

`https://code.claude.com/docs/en/sub-agents`

> "For security reasons, plugin subagents don't support the `hooks`, `mcpServers`,
> or `permissionMode` frontmatter fields. These fields are ignored when loading
> agents from a plugin."

DEC-18 wires every critical gate twice — once in each subagent's frontmatter, once
globally in `settings.json` — as defence against frontmatter-hook unreliability.
**A plugin gets only one layer.** The frontmatter half is silently ignored, which
is worse than absent: an agent file carrying a `hooks:` block reads as guarded and
is not.

**Consequence.** All enforcement moves into `hooks/hooks.json`. That layer is not a
"backstop" any more, it is the whole gate. It also means the gates must be right
the first time, which raises the value of the shared library and its tests rather
than lowering it.

If per-agent frontmatter hooks are ever genuinely required, the plugin must ship
the agent file *plus* an instruction for the user to copy it into `.claude/agents/`
— an install step, not a plugin capability.

### 2. `agent_type` is not a "this is a subagent" flag

`https://code.claude.com/docs/en/hooks`

> "`agent_type` — Agent name… **Present when the session uses `--agent` or the hook
> fires inside a subagent.** … For subagents shipped by a plugin, this is the
> plugin-scoped identifier such as `my-plugin:reviewer`, not the bare frontmatter
> name."

Two live bugs in the port plan, both silent:

- **A main session launched with `--agent` carries `agent_type`.** Every gate
  currently reads "`agent_type` present ⇒ subagent ⇒ enforce", so the orchestrator's
  own approved merge path would be blocked in that mode. The whole "the
  orchestrator merges on approval" design depends on this test.
- **Plugin subagents report `plugin-name:reviewer`.** Any matcher written against
  the bare name silently never fires. And because a colon makes a matcher a regex,
  it must be anchored: `^aeo:builder$`.

This is the same bug class as `run-monitor`'s substring-vs-token match and the
path-prefix trailing-separator rule — an identity test that is *nearly* right.

### 3. Commands have been merged into skills — this reverses decision D-B

`https://code.claude.com/docs/en/skills` (`/slash-commands` now redirects here)

> "**Custom commands have been merged into skills.** A file at
> `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both
> create `/deploy` and work the same way."

And the plugin reference, on `commands/`: *"Skills as flat Markdown files. **Use
`skills/` for new plugins.**"*

**This overturns decision D-B.** I recommended six commands plus five skills, split
by who invokes. That split was built on a distinction — deterministic invocation
versus description-matching — that the platform no longer draws. The mechanisms are
the same mechanism.

What survives of the reasoning, expressed in the current model:

- `disable-model-invocation: true` makes a skill **user-invocable only** — that is
  the determinism the six lanes wanted, without a second directory.
- `user-invocable: false` hides a skill from the `/` menu for workflow-internal
  pieces.
- Plugin skills are **always namespaced** `/aeo:sprint-start`, which removes the
  trigger-competition risk that motivated half of D-B.

**Revised recommendation: ship `skills/` only.** Set
`disable-model-invocation: true` on the six lanes.

---

## Findings that correct the skill's stated corrections

### 4. `if:` filters are not dodged by compound commands — but they fail open

`https://code.claude.com/docs/en/hooks`

The skill's DEC-16 says `if: "Bash(git merge *)"` is dodged by `git add . && git
merge`. The docs say otherwise — each subcommand is checked, leading assignments
are stripped, and `$()`/backtick substitutions are checked too.

The real caveat is different, and better:

> "The filter also fails open, running your hook regardless of pattern, when the
> Bash command can't be parsed. Because the `if` filter is best-effort, **use the
> permission system rather than a hook to enforce a hard allow or deny**."

Also: `if` holds exactly one rule — no `&&`, `||`, or lists.

**Net effect on the design: unchanged, for a better reason.** Keep scripts deciding
from stdin. `if:` is a cheap pre-filter, never the security boundary. But the
skill's stated rationale is wrong and should be corrected rather than repeated.

### 5. A `shell` field exists

The per-hook schema includes `shell` (`bash` | `powershell`). The skill records
that the `& '<path>'` form with a `shell:` field "silently fails to register" —
that observation was pinned to Claude Code 2.1.201 and should be re-verified rather
than carried forward as fact.

---

## Findings that add capability

### 6. Structured blocking is preferred over bare exit 2

Exit 2 still blocks and still feeds stderr back to the model. But exit 0 with JSON
on stdout supports outcomes exit codes cannot express:

```json
{ "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "…" } }
```

`permissionDecision` ∈ `allow` | `deny` | `ask` | `defer`. **`ask` (escalate to the
user) and `defer` (fall through to normal permissions) have no exit-code
equivalent.**

`ask` is interesting here: a gate that is unsure could escalate to the founder
instead of guessing. Worth considering for the data-sandbox guard — though
"fails closed" argues for `deny`, and a guard that asks is a guard that gets
click-through approved. **Recommend: keep hard blocks on exit 2** (it still blocks
even if JSON fails schema validation, per v2.1.214+), and use JSON only where
`ask`/`defer` is genuinely wanted.

### 7. Subagents run in the background by default, and lose tools there

As of v2.1.198 subagents default to background, where the available tool set is
filtered to a fixed list. "The same definition can resolve to different tools in
the foreground and the background."

**Consequence:** a role listing a tool outside that list silently loses it. Any
capability assumption in a role charter has to be checked against the background
list, not just the `tools:` field.

### 8. There is no dispatch-time tool restriction

`https://code.claude.com/docs/en/tools-reference#agent-tool-behavior`

Tool resolution comes only from the agent definition (`tools`, `disallowedTools`;
`disallowedTools` wins when both are set). The only documented per-invocation
parameter is `model`.

**This corrects `BUILD-METHOD.md`,** which proposed restricting subagent tools at
dispatch as a bootstrap guardrail. Not possible. What *is* available: session-wide
`permissions.deny` rules, which do apply inside subagents.

---

## Manifest and marketplace specifics

`https://code.claude.com/docs/en/plugins-reference` ·
`https://code.claude.com/docs/en/plugin-marketplaces`

- **`plugin.json` is optional; `name` is its only required field.** Unrecognised
  top-level fields warn; wrong *types* fail the load.
- Add `$schema: https://json.schemastore.org/claude-code-plugin-manifest.json`.
- **Set `version` explicitly** — omit it and the git SHA is used, so every commit
  looks like a new version to users.
- Validate with `claude plugin validate ./plugin [--strict]`.
- `${CLAUDE_PLUGIN_ROOT}` works in `hooks/hooks.json` and is the documented idiom.
  **Quote it** — install paths contain spaces. It is **ephemeral**: it changes on
  plugin update, so never write state there. Use `${CLAUDE_PLUGIN_DATA}`.
- Per-hook `timeout` is in seconds (default 600 for command hooks).
- Marketplace: `.claude-plugin/marketplace.json` at repo root; requires `name`,
  `owner`, `plugins`. Each entry requires only `name` and `source` — a relative
  path when the plugin lives in the same repo.

---

## What this changes in the plan

| Was | Now |
|---|---|
| Six commands + five skills (D-B) | **Skills only**, six with `disable-model-invocation: true` |
| Double-wired gates (DEC-18) | **Single layer** in `hooks/hooks.json`; the shared library and its tests carry more weight, not less |
| `agent_type` present ⇒ subagent | **False.** Must exclude `--agent` main sessions and match plugin-scoped, anchored names |
| `if:` dodged by compound commands | **False.** It fails open on unparseable commands — same conclusion, correct reason |
| Restrict tools at dispatch | **Not possible.** Use `permissions.deny` |

None of this changes the sequencing: the hook runtime is still the foundation, and
finding 2 makes it more delicate than assumed rather than less.
