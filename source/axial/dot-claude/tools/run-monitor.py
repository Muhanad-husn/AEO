"""Live monitor for a corpus run: who is working, how fast, and is anything hung.

Stage-4 passes run as detached workers for hours (see
plans/phase-a-completion/STAGE-4-EXECUTION.md). This reports them in one view.

Two modes:

    uv run python .claude/tools/run-monitor.py --watch     # human dashboard, refreshes
    uv run python .claude/tools/run-monitor.py --once      # one snapshot, for a Claude session

Hang detection leans on a fact about the pipeline: `tag` and `xref` append one
checkpoint line PER CHUNK, so real progress ticks every few seconds even when a
single source takes 36 minutes. A worker is only called stalled when the
checkpoints stop growing AND the logs stop growing AND its CPU is idle -- three
independent signals, so a merely slow source never trips it.

`extract` is the exception: it checkpoints per SOURCE, so raise --stall-seconds
when monitoring it.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

try:
    import psutil
except ImportError:  # pragma: no cover - degrade, never block a run
    psutil = None

REPO = Path(__file__).resolve().parents[2]

# Per-pass progress sources: (checkpoint glob, granularity note). The glob is
# what ticks while work is happening.
PASS_CHECKPOINTS = {
    "tag": ("data/tags/*.jsonl", "per chunk"),
    "xref": ("data/xref/*.jsonl", "per chunk"),
    "vault-write": ("data/xref/*.jsonl", "per chunk (via xref)"),
    "artifacts": ("data/artifacts/*.jsonl", "per artifact"),
    "extract": ("data/source_meta/*.json", "per SOURCE -- raise --stall-seconds"),
    "envelope": ("data/envelopes/*.json", "per source"),
    "chunk": ("data/chunks/*.jsonl", "per source"),
}

# The one tunable: how long all three liveness signals must be flat before a
# worker is called stalled. Defaults above the slowest measured single source
# (2168 s, the #272 xref rollout) so a legitimately slow book never trips it.
DEFAULT_STALL_SECONDS = 2400


@dataclass
class Worker:
    pid: int
    cmdline: str
    cpu: float = 0.0
    rss_mb: float = 0.0
    elapsed: str = ""
    label: str = ""


@dataclass
class Snapshot:
    pass_name: str
    workers: list[Worker] = field(default_factory=list)
    ledger_rows: int = 0
    ledger_files: int = 0
    checkpoint_lines: int = 0
    checkpoint_files: int = 0
    newest_write_age: float | None = None
    log_bytes: int = 0


def _fmt_elapsed(seconds: float) -> str:
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}"


def _fmt_age(seconds: float | None) -> str:
    if seconds is None:
        return "never"
    if seconds < 90:
        return f"{int(seconds)}s ago"
    return f"{int(seconds // 60)}m ago"


def _is_worker(argv: list[str]) -> bool:
    """True only for a real `axial run <pass>` invocation.

    Substring matching is wrong here: the repo lives at D:\\axial, so EVERY
    absolute path in every process's argv contains "axial" -- an early version
    of this matched `uv` wrappers and the monitor itself, reporting seven
    phantom workers at 0% CPU. A dashboard that invents idle workers would mask
    the exact hang it exists to catch, so match the token, then the subcommand
    immediately after it.
    """
    for i, tok in enumerate(argv[:-1]):
        stem = Path(tok).stem.lower()
        if stem == "axial" and argv[i + 1] == "run":
            return True
    return False


def find_workers() -> list[Worker]:
    """Every live `axial run` process, with CPU sampled over a short window."""
    if psutil is None:
        return []
    own = {os.getpid()}
    found = []
    for proc in psutil.process_iter(["pid", "cmdline", "create_time"]):
        try:
            argv = proc.info["cmdline"] or []
            if proc.info["pid"] in own or not _is_worker(argv):
                continue
            cmd = " ".join(argv)
            proc.cpu_percent(None)  # prime; the real read happens below
            found.append((proc, cmd))
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    # `uv run axial run <pass>` produces a CHAIN of processes that all carry the
    # matching argv -- the uv wrapper, then the axial process itself. Counting
    # every link reports three "workers" per real worker. Keep only the leaves:
    # drop any match that is the parent of another match.
    parents = set()
    for proc, _ in found:
        try:
            ppid = proc.ppid()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        parents.add(ppid)
    found = [(p, c) for p, c in found if p.pid not in parents]

    if not found:
        return []
    time.sleep(0.6)  # sampling window for cpu_percent

    workers = []
    for proc, cmd in found:
        try:
            with proc.oneshot():
                cpu = proc.cpu_percent(None)
                rss = proc.memory_info().rss / (1024 * 1024)
                elapsed = time.time() - proc.create_time()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        label = ""
        for token in cmd.split():
            if "worklist" in token or "ledger" in token:
                label = Path(token).stem
        workers.append(Worker(proc.pid, cmd, cpu, rss, _fmt_elapsed(elapsed), label or "-"))
    return sorted(workers, key=lambda w: w.label)


def _count_lines(path: Path) -> int:
    try:
        with path.open("rb") as handle:
            return sum(1 for _ in handle)
    except OSError:
        return 0


def collect(pass_name: str, run_dir: Path | None) -> Snapshot:
    snap = Snapshot(pass_name=pass_name)
    snap.workers = find_workers()

    for ledger in (REPO / "data" / "run").glob("ledger*.tsv"):
        snap.ledger_files += 1
        rows = _count_lines(ledger)
        snap.ledger_rows += max(0, rows - 1)  # drop the header

    glob_pattern = PASS_CHECKPOINTS.get(pass_name, ("", ""))[0]
    if glob_pattern:
        newest = 0.0
        for cp in REPO.glob(glob_pattern):
            if "candidates" in cp.name:
                continue
            snap.checkpoint_files += 1
            snap.checkpoint_lines += _count_lines(cp) if cp.suffix == ".jsonl" else 1
            try:
                newest = max(newest, cp.stat().st_mtime)
            except OSError:
                pass
        if newest:
            snap.newest_write_age = max(0.0, time.time() - newest)

    if run_dir and run_dir.exists():
        for log in run_dir.glob("*.log"):
            try:
                snap.log_bytes += log.stat().st_size
            except OSError:
                pass
    return snap


def render(snap: Snapshot, prev: Snapshot | None, stall_seconds: int) -> str:
    lines = []
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    note = PASS_CHECKPOINTS.get(snap.pass_name, ("", "?"))[1]
    lines.append(f"axial run monitor | {stamp} | pass={snap.pass_name} ({note})")

    total_cpu = sum(w.cpu for w in snap.workers)
    lines.append(f"{len(snap.workers)} live worker(s) | {total_cpu:.0f}% CPU total")
    lines.append("")

    if snap.workers:
        lines.append(f"  {'PID':>7}  {'WORKER':<22} {'CPU%':>6} {'RSS MB':>8}  ELAPSED")
        for w in snap.workers:
            lines.append(
                f"  {w.pid:>7}  {w.label[:22]:<22} {w.cpu:>6.1f} {w.rss_mb:>8.0f}  {w.elapsed}"
            )
    else:
        lines.append("  (no live `axial run` process found)")
    lines.append("")

    delta_cp = delta_log = None
    if prev is not None:
        delta_cp = snap.checkpoint_lines - prev.checkpoint_lines
        delta_log = snap.log_bytes - prev.log_bytes

    cp = f"checkpoints {snap.checkpoint_lines:,} lines in {snap.checkpoint_files} file(s)"
    if delta_cp is not None:
        cp += f"  (+{delta_cp:,} since last peek)"
    lines.append(f"  {cp}")
    lines.append(f"  ledger      {snap.ledger_rows} row(s) across {snap.ledger_files} file(s)")
    lines.append(f"  last write  {_fmt_age(snap.newest_write_age)}")
    if delta_log is not None:
        lines.append(f"  logs        +{delta_log:,} bytes since last peek")
    lines.append("")

    # Three independent signals must all be flat before calling it stalled.
    idle_cpu = total_cpu < 5.0
    cold_writes = snap.newest_write_age is not None and snap.newest_write_age > stall_seconds
    no_growth = delta_cp is not None and delta_cp == 0 and (delta_log or 0) == 0

    if not snap.workers:
        lines.append("STATUS  IDLE - nothing running")
    elif cold_writes and idle_cpu and (no_growth or prev is None):
        lines.append(
            f"STATUS  *** STALLED *** no checkpoint write for "
            f"{_fmt_age(snap.newest_write_age)}, CPU {total_cpu:.1f}% - investigate"
        )
    elif cold_writes and idle_cpu:
        lines.append("STATUS  SUSPECT - writes cold and CPU idle; confirm on the next peek")
    else:
        lines.append("STATUS  HEALTHY")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pass", dest="pass_name", default="tag", help="pass being monitored")
    ap.add_argument("--run-dir", default=None, help="data/logs/<RUN> directory to size")
    ap.add_argument("--watch", action="store_true", help="refresh continuously")
    ap.add_argument("--once", action="store_true", help="print one snapshot and exit")
    ap.add_argument("--interval", type=int, default=60, help="watch refresh seconds")
    ap.add_argument(
        "--stall-seconds",
        type=int,
        default=DEFAULT_STALL_SECONDS,
        help=(
            "flat-signal seconds before STALLED. Default is above the slowest "
            "measured single source (2168 s); raise it for the extract pass"
        ),
    )
    args = ap.parse_args()

    if psutil is None:
        print("warning: psutil unavailable - CPU/process columns disabled", file=sys.stderr)

    run_dir = Path(args.run_dir) if args.run_dir else None

    if not args.watch or args.once:
        print(render(collect(args.pass_name, run_dir), None, args.stall_seconds))
        return 0

    prev = None
    try:
        while True:
            snap = collect(args.pass_name, run_dir)
            os.system("cls" if os.name == "nt" else "clear")
            print(render(snap, prev, args.stall_seconds))
            print(f"\n(refreshing every {args.interval}s — Ctrl-C to stop)")
            prev = snap
            time.sleep(args.interval)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
