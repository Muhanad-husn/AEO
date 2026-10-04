# 08: The session opens on the device services the project needs

Issue: [#270](https://github.com/Muhanad-husn/AEO/issues/270)

## Goal

A project lists the services it needs running on the device in `aeo-services.json` at its root, for example `{"services": [{"name": "postgres", "port": 5432}, {"name": "ollama", "port": 11434}, {"name": "docker", "command": "docker info"}]}`. Each entry has a name and exactly one check: a `port` (a TCP connect to `host`, default 127.0.0.1) or a `command` (up when it exits 0). A new sensorium section, `plugin/hooks/sensorium/40-services.mjs`, prints them in the session-start readout: `services: none declared` with no file; otherwise `services: <n> declared, <k> down`, then one indented line per service, `<name>: up (<what was checked>)` or `<name>: down (<why>)`. An unreadable file or entry prints one line naming it, never dropped. Every probe has a 5000 ms timeout and they run together, so the section adds at most about 5 seconds to session start and nothing to any tool call. The bound is 5 seconds, not 1.5, because `docker info` took 1.7 to 2.7 seconds on the founder's machine even when it failed.

build/SKILL.md gains one sentence: before building or fixing, the orchestrator reads the `services:` lines, and a declared service that is down is started or named to the founder before any work that needs it.

new-project/SKILL.md gains one sentence: when the PRD names a service the project runs against, the scaffold writes `aeo-services.json`.

plugin.json reads 0.6.0, the one release of this phase that diligence-reader installs; 07 pins installs to the v0.6.0 tag.

## Acceptance criterion

Given a temporary repository, when `renderSensorium(root)` runs, then with no `aeo-services.json` it prints `services: none declared`; with entries for a port a local test server listens on, a closed port, `node -e "process.exit(0)"` and `node -e "process.exit(3)"`, it prints `services: 4 declared, 2 down` and one up or down line per entry naming what was checked; a command that never exits prints down (timed out) and the section returns within 6 seconds; a malformed file and an entry with both or neither of port and command each print a line naming the problem. A `docker info` style command resolves on Windows. plugin.json reads 0.6.0.

## Mechanism

Node only, no model call, no new hook process: the existing session-start hook loads the section by its filename. Behavioural tests first, committed red; Sonnet builds, following the 30-runs section as precedent.

## Files

```aeo-independence
slice: 08-services
depends-on: 04-prose
edits: plugin/hooks/sensorium/40-services.mjs
edits: tests/hooks/sensorium-services.test.mjs
edits: scripts/test-area.mjs
edits: package.json
edits: plugin/skills/build/SKILL.md
edits: plugin/skills/new-project/SKILL.md
edits: plugin/.claude-plugin/plugin.json
```

## Out of scope

Starting a service from the hook (the hook only reports); inferring services from docker-compose or .env files (a guess is not a record); any per-tool-call check.

## Why

The founder asked on 2026-10-04 that the orchestrator check third-party services on the device (Docker, Postgres, Ollama and the like) before it starts building or fixing.
