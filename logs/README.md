# Run logs

The convention for where this repo's own job runs record themselves —
never the plugin's. State lives in the project repo, not under
`${CLAUDE_PLUGIN_ROOT}` (D12 in `docs/DECISIONS.md`), because the plugin
root is ephemeral and changes on every update.

## Layout

One directory per job:

```
logs/<YYYY-MM-DD>-<job>/
```

`<YYYY-MM-DD>` is the date the job started; `<job>` is a short slug for
what ran (a slice name, a phase, an eval pass). Example:
`logs/2026-07-31-p0.1-skeleton/`.

## What goes in each directory

Not built yet. EN-14 in `docs/DECISIONS.md` designs and builds the record
format in Phase 3: `run.jsonl`, `console.log`, `summary.md`, and a fixed
record envelope (`ts`, `job`, `unit`, `status`, `duration`, `detail`) that
every job writes to the same shape.

Phase 0 establishes only the location and the naming, ahead of that
format landing. Until Phase 3, a job directory holds whatever plain notes
its own slice needed — `summary.md` at minimum.
