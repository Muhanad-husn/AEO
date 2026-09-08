# Harness cost fixture

Stands in for a home directory and a consuming project so `scripts/score/harness.mjs`
can be measured without touching the real machine.

`home/` stands in for `<os.homedir()>/.claude`: `settings.json`, `CLAUDE.md` (40 lines),
and `plugins/` (`installed_plugins.json` plus one cached plugin, `demo`, under
`plugins/cache/demo`). `demo` carries one `hooks/hooks.json` (one node hook matched to
`Bash`, one matcher-less node hook that matches every counted tool), two 30-line agent
files, and three skills, each contributing one session-start line (its description).

`consumer/` stands in for the project being measured: a 71-line `CLAUDE.md`, a
`.claude/settings.json` that enables `demo@demo-marketplace`, a `pyproject.toml` (so
`.py` is the counted extension), 200 lines of source under `src/` and 150 lines of tests
under `tests/`. It is not a git repository, so `measure` falls back to walking the tree.

Expected processes: bash 3 node (home's hook plus demo's two), grep 1, read 1, task 1
(all three from demo's matcher-less hook). Expected session start: 40 + 71 + 30 + 30 + 3
= 174 lines. Expected tests: 150 / 200 = 0.75.

`installed_plugins.json`'s `installPath` ("plugins/cache/demo") is relative to the
fixture's `home/` directory, i.e. to `pluginRoot`'s parent — the same convention
`measure` uses to resolve a relative `installPath` in production.
