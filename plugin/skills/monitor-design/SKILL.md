---
name: monitor-design
description: Design a job-specific monitoring overlay for one long-running job — a custom progress view, dashboard, or derived reading such as spend so far, pipeline stage, or shards left, computed from that job's run log on top of the generic monitor. Use when asked to build, design, or add monitoring for a particular job, or when units, rate and the stall verdict do not answer what someone needs to know about it. Do not use to check on a run in progress: "is it still working", "how far along is it" and "did it stall" are answered by running the generic run monitor directly.
---

# Monitor design — job-specific overlays

One derived reading, over one job, on top of the generic monitor at
`${CLAUDE_PLUGIN_ROOT}/scripts/run-monitor.mjs`. That monitor is not replaced,
wrapped or forked here. The `monitor-designer` agent carries this role's
charter; dispatch it when the overlay is more than a few lines, and follow this
procedure either way.

Before writing any tool that lives under this harness, read
`${CLAUDE_PLUGIN_ROOT}/skills/monitor-design/references/hook-landmines.md`. It
names two ways a harness-adjacent tool trips the gates it runs under, both
silent.

## Procedure

1. **Ask what the generic monitor already says.** Run it against the job's log
   directory: `node "${CLAUDE_PLUGIN_ROOT}/scripts/run-monitor.mjs" <runlog-dir>
   --once`. It prints progress, rate, elapsed and projected time, failure
   counts, the age of each signal, and one status word. If the question is
   answered there, say so and stop. "No overlay needed" is the common outcome
   and it is a finished job, not a gap.

2. **Confirm the job writes a run log, and instrument it if not.**
   `${CLAUDE_PLUGIN_ROOT}/scripts/runlog.mjs` opens `logs/<date>-<job>/` in the
   project repository, holding `run.jsonl` and `console.log`. A job that writes
   neither has nothing to overlay: add one `record` call per unit of work, at
   the boundary where a unit finishes, and one `close` at the end. While you are
   in the job's start-up path, raise its sentinel with the job's own process id:

       node "${CLAUDE_PLUGIN_ROOT}/scripts/run-sentinel.mjs" start <job> --pid <n>

   `--pid` is optional and defaults to none. Without it the monitor has no
   process to read CPU from, so the third stall signal is permanently
   unavailable, `STALLED` becomes unreachable, and every report degrades to
   `SUSPECT` with that reason printed. Passing the pid is the documented habit;
   a job that wants stall verdicts must do it. The monitor finds the sentinel by
   job name, so nothing needs passing at the monitor's end.

   **The pid must be one the operating system can see**, and getting one right
   depends on where the job starts. Best is not to ask a shell at all: if the job
   is a Node or Python process, have the job itself raise its sentinel with
   `process.pid` or `os.getpid()`. Nothing is translated, and there is no
   question of whether the number names the job or the launcher that started it.
   Failing that:

   | Where the job starts | The pid to record |
   | --- | --- |
   | POSIX shell on Linux or macOS | `--pid $$` |
   | PowerShell | `--pid $PID` |
   | Git Bash or MSYS on Windows | `--pid $(ps -p $$ \| awk 'NR==2 {print $4}')` |

   Under Git Bash, `$$` is the MSYS process id, not the Windows one, and the CPU
   probe resolves Windows process ids only. A sentinel raised with an MSYS `$$`
   therefore records a number nothing on the machine can look up, and a pid that
   cannot be looked up reads as a pid that is gone. **The symptom is a live job
   reported `EXITED`, with a reason saying its pid is gone and the run was never
   closed.** That is a wrongly recorded pid, not a dead job. `ps`'s fourth
   column, `WINPID`, is the number Windows knows the process by, which is what
   the row above extracts. This failure is worse than the missing-pid case above,
   because a missing pid degrades to `SUSPECT` and admits it is guessing, while
   an unresolvable pid produces a confident, wrong claim that the job crashed.

3. **Name the derivation the generic monitor cannot compute.** One sentence,
   about what this job's units mean. If the sentence comes out as progress,
   rate, failures or liveness, the generic monitor already computes it and you
   are back at step 1.

4. **Write the thinnest overlay that computes it.** It reads `run.jsonl`, one
   JSON object per line, six fields per record: `ts`, `job`, `unit`, `status`,
   `duration`, `detail`. Derive from those and leave the envelope alone. Do not
   add a key, do not have the job write a parallel side file, and do not invent
   a second format; whatever the first five fields do not carry belongs in
   `detail` as the job's own text, parsed by the overlay. Print the derived
   reading and let the generic monitor print everything else. Report liveness
   only in the generic monitor's own words (`UNKNOWN`, `DONE`, `EXITED`,
   `MOVING`, `QUIET`, `STALLED`, `SUSPECT`), or not at all. Node built-ins only.

5. **State the stall threshold per job; never bake one in.** How long all three
   signals must be flat before this job is stalled is a fact about the job, and
   it belongs in the command the operator runs: `--stall-seconds <n>`. Unset,
   the monitor reports liveness only and says so on every report. Do not put a
   number in the overlay and do not default one. Record the number you recommend
   and how you arrived at it, in the job's runbook or the overlay's usage line.
   On Linux and macOS `ps` reports CPU time at one-second resolution, so a job
   whose units each cost well under a second of CPU reads flat there while
   working; for a short-unit job on those platforms, set the threshold from
   checkpoint and log movement and do not lean on CPU.

6. **Verify against a real run before handing over.** Read the overlay's output
   beside the generic monitor's, for the same run, on at least two consecutive
   looks. Check three states by hand: a job that never started, an opened run
   with no records yet, and a finished run. The first must read as unknown, not
   as zero; the second is instrumented and at zero, which is a different fact
   from uninstrumented. An overlay that prints a confident number for a run it
   cannot see has reproduced the failure this vocabulary exists to prevent.

## Invariants

- One overlay, one job, one derived reading. Two readings are two overlays, or
  they are the generic monitor and you should stop.
- The generic monitor's status words are the only liveness vocabulary. There is
  no idle.
- Anything the overlay writes lands in the project repository's `logs/` tree,
  never the plugin's own directory ([D12](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)).
- A negative or unreadable signal is reported as unknown, with the reason named.
