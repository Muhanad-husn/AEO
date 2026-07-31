# 07 — plugin-format (official plugin references)

## Copy summary

- Source: `C:\Users\mou97\.claude\plugins\marketplaces\claude-plugins-official\`
- Destination: `D:\AEO\source\plugin-format\`
- **Files copied: 43**
- Copied: `.claude-plugin/marketplace.json` (as `marketplace.json`), and three
  plugins in full — `example-plugin`, `pr-review-toolkit`, `hookify`.
- Contents copied verbatim. No redactions required.

## Why these three

The target of this project is a plugin, and these are the closest official
references for each part of it.

**`example-plugin`** — the canonical minimal layout: `.claude-plugin/plugin.json`,
`commands/`, `skills/<name>/SKILL.md`, `.mcp.json`, LICENSE, README.

**`pr-review-toolkit`** — the closest structural analogue to our role roster:
a manifest plus `agents/` (six specialist agent files) plus `commands/`. Also
directly relevant to the reviewer design, since its specialists
(`silent-failure-hunter`, `type-design-analyzer`, `code-simplifier`) are candidate
optional lenses for our own reviewer.

**`hookify`** — **the most important reference in this set.** It is the only
official plugin that ships gates, and it settles the open question about the
harness's Windows dependency:

- Hooks are declared in `hooks/hooks.json`, not `settings.json`.
- Scripts resolve through `${CLAUDE_PLUGIN_ROOT}`.
- **It invokes `python3`, not a platform shell.**

That last point is the sanctioned precedent for porting the four PowerShell gates
to a single cross-platform interpreter, rather than maintaining a PowerShell
implementation and a bash port side by side.

`hookify` also demonstrates a `core/` + `matchers/` + `utils/` package layout for
hook logic — the shared-library shape that `source/v1-archive/claude/hooks/lib.ps1`
was reaching for and that the v2 harness lost.

## Note on the manifest schema

All three `plugin.json` files are minimal — `{name, description, author}` only.
Per the current documentation the manifest is itself optional and `name` is its
only required field. See `docs/DOCS-CURRENCY.md` for the fields worth setting
anyway (`$schema`, and an explicit `version`, without which the git SHA is used
and every commit reads as a new release).
