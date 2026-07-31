"""Live operator dashboard for whatever Axial is currently running.

Read-only. Never writes to data/. Safe to run alongside any pipeline job.

    uv run python .claude/tools/axial-watch.py              # auto-pick newest run
    uv run python .claude/tools/axial-watch.py <log-dir>    # watch a specific run
    uv run python .claude/tools/axial-watch.py --interval 2

Reads each run's console.log incrementally (remembers a byte offset), so a
50MB log costs one scan at startup and only the new bytes thereafter.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from collections import Counter, deque
from dataclasses import dataclass, field
from pathlib import Path

LOGS = Path("data/logs")
ESC = "\033["
DIM, BOLD, RESET = f"{ESC}2m", f"{ESC}1m", f"{ESC}0m"
RED, GRN, YEL, CYN, MAG = (f"{ESC}31m", f"{ESC}32m", f"{ESC}33m", f"{ESC}36m", f"{ESC}35m")

RE_SWEEP = re.compile(
    r"^sweep: (\S+) draw (\d+) (starting|OK|FAIL|SKIP)(?: \(([\d.]+)s\))?(?:: (.*))?"
)
RE_GATE = re.compile(r"^sweep: (\S+) gate '([^']+)' (?:scoring (\d+) draw|done, passed=(\w+))")
RE_TURN = re.compile(r"^retrieve: turn (\d+)/(\d+) (?:starting|called '([^']+)', (\d+) result)")
RE_INTERROGATE = re.compile(
    r"^interrogate: (starting for brief case='(.*)'|done, disposition=(\S+))"
)
RE_SYNTH = re.compile(
    r"^synthesize: (?:starting, lens='([^']*)', (\d+) evidence|done, (\d+) claim)"
)
RE_REPAIR = re.compile(r"^synthesize: repaired truncated grounds ref_id")
RE_RESP = re.compile(
    r"llm_call_response pass=(\S+) model=(\S+) outcome=(\S+)(?: status=(\S+))?"
    r"(?: elapsed=([\d.]+)s)?(?: finish_reason=(\S+))?(?:.*total_tokens=(\d+))?"
)
RE_RETRY = re.compile(r"llm_retry pass=(\S+) attempt=(\S+) trigger=(\S+)")

PRICE = {  # $/1k tokens, mirrors llm.PRICE_TABLE_USD_PER_1K (blended in/out)
    "deepseek/deepseek-v4-pro": 0.00065,
    "deepseek/deepseek-v4-flash": 0.00015,
    "z-ai/glm-5.2": 0.0016,
}


@dataclass
class State:
    ok: dict[str, float] = field(default_factory=dict)
    fail: dict[str, str] = field(default_factory=dict)
    started: list[str] = field(default_factory=list)
    gates: dict[str, dict[str, str]] = field(default_factory=dict)
    turn: tuple[int, int] | None = None
    last_tool: tuple[str, int] | None = None
    tool_counts: Counter = field(default_factory=Counter)
    results_total: int = 0
    case: str = ""
    disposition: str = ""
    lens: str = ""
    evidence: int = 0
    claims: list[int] = field(default_factory=list)
    repairs: int = 0
    calls: deque = field(default_factory=lambda: deque(maxlen=4000))
    tokens_by_model: Counter = field(default_factory=Counter)
    errors: Counter = field(default_factory=Counter)
    retries: int = 0
    events: deque = field(default_factory=lambda: deque(maxlen=8))


def feed(st: State, line: str, now: float) -> None:
    line = line.rstrip("\n")
    # One console.log carries every launch, so a relaunch must retire the
    # previous launch's in-flight entries -- otherwise briefs killed mid-run
    # linger forever and inflate the running count.
    if line.startswith("===== SWEEP START"):
        st.started.clear()
        st.turn = st.last_tool = None
        return
    if m := RE_SWEEP.match(line):
        brief, _draw, status, secs, reason = m.groups()
        if status == "starting":
            if brief not in st.started:
                st.started.append(brief)
            st.turn = st.last_tool = None
        elif status == "OK":
            st.ok[brief] = float(secs or 0)
            st.fail.pop(brief, None)  # a later success retires an earlier failure
            if brief in st.started:
                st.started.remove(brief)
            st.events.append((now, f"{GRN}OK{RESET}   {brief} {float(secs or 0) / 60:.1f}m"))
        elif status == "FAIL":
            st.fail[brief] = (reason or "")[:150]
            st.ok.pop(brief, None)
            if brief in st.started:
                st.started.remove(brief)
            st.events.append((now, f"{RED}FAIL{RESET} {brief} {(reason or '')[:70]}"))
        elif status == "SKIP" and brief in st.started:
            st.started.remove(brief)
        return
    if m := RE_GATE.match(line):
        brief, gate, _scoring, passed = m.groups()
        if passed is not None:
            st.gates.setdefault(brief, {})[gate] = passed
            col = GRN if passed == "True" else RED
            st.events.append((now, f"{col}gate{RESET} {brief} {gate}={passed}"))
        return
    if m := RE_TURN.match(line):
        cur, tot, tool, n = m.groups()
        st.turn = (int(cur), int(tot))
        if tool:
            st.last_tool = (tool, int(n))
            st.tool_counts[tool] += 1
            st.results_total += int(n)
        return
    if m := RE_INTERROGATE.match(line):
        if m.group(2) is not None:
            st.case = m.group(2)
        if m.group(3):
            st.disposition = m.group(3)
        return
    if m := RE_SYNTH.match(line):
        lens, evid, claims = m.groups()
        if lens is not None:
            st.lens, st.evidence = lens, int(evid)
        if claims:
            st.claims.append(int(claims))
        return
    if RE_REPAIR.match(line):
        st.repairs += 1
        st.events.append((now, f"{YEL}repair{RESET} truncated ref_id resolved"))
        return
    if m := RE_RETRY.search(line):
        st.retries += 1
        return
    if m := RE_RESP.search(line):
        _pass, model, outcome, status, elapsed, _fin, toks = m.groups()
        st.calls.append((now, model, float(elapsed or 0)))
        if toks:
            st.tokens_by_model[model] += int(toks)
        if outcome != "received" or (status and status != "200"):
            st.errors[f"{outcome}/{status}"] += 1


def human(sec: float) -> str:
    if sec < 90:
        return f"{sec:.0f}s"
    if sec < 5400:
        return f"{sec / 60:.1f}m"
    return f"{sec / 3600:.1f}h"


def bar(done: int, total: int, width: int = 28) -> str:
    if total <= 0:
        return ""
    filled = int(width * done / total)
    return f"[{'#' * filled}{'.' * (width - filled)}] {done}/{total}"


def procs() -> list[str]:
    try:
        out = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -like '*axial*\\.venv\\*'} "
                "| ForEach-Object { $_.Name }",
            ],
            capture_output=True,
            text=True,
            timeout=8,
        ).stdout
        c = Counter(x.strip() for x in out.splitlines() if x.strip())
        return [f"{v}x {k}" for k, v in c.most_common()]
    except Exception:
        return []


def discover() -> list[Path]:
    if not LOGS.is_dir():
        return []
    dirs = [p for p in LOGS.iterdir() if p.is_dir() and (p / "console.log").is_file()]
    return sorted(dirs, key=lambda p: (p / "console.log").stat().st_mtime, reverse=True)


def main() -> int:
    argv = sys.argv[1:]
    interval = 3.0
    args: list[str] = []
    i = 0
    while i < len(argv):
        if argv[i] == "--interval" and i + 1 < len(argv):
            interval = float(argv[i + 1])
            i += 2
            continue
        if argv[i].startswith("--"):
            i += 1
            continue
        args.append(argv[i])
        i += 1

    if args:
        run = Path(args[0])
    else:
        found = discover()
        if not found:
            print("no run directories with a console.log under data/logs/")
            return 1
        run = found[0]

    log = run / "console.log"
    st = State()
    offset = 0
    proc_lines: list[str] = []
    tick = 0

    print(f"watching {run} — Ctrl-C to stop", file=sys.stderr)
    try:
        while True:
            size = log.stat().st_size if log.is_file() else 0
            if size < offset:  # truncated/rotated
                offset, st = 0, State()
            if size > offset:
                first_pass = tick == 0
                with open(log, "r", encoding="utf-8", errors="replace") as fh:
                    fh.seek(offset)
                    chunk = fh.read()
                    offset = fh.tell()
                # The startup pass replays the whole backlog in one go. Stamping
                # those historical calls with the wall clock would put thousands
                # of old calls inside the 60s window and report a throughput
                # figure that never happened. Backdate them out of the window;
                # only calls seen live count toward calls/min.
                now = time.time() - 86400 if first_pass else time.time()
                for line in chunk.splitlines():
                    feed(st, line, now)

            if tick % 5 == 0:
                proc_lines = procs()
            tick += 1

            now = time.time()
            recent = [c for c in st.calls if now - c[0] < 60]
            lat = sum(c[2] for c in recent) / len(recent) if recent else 0.0
            spend = sum((t / 1000.0) * PRICE.get(m, 0.0) for m, t in st.tokens_by_model.items())
            done, failed = len(st.ok), len(st.fail)
            inflight = [b for b in st.started if b not in st.ok and b not in st.fail]
            mean = sum(st.ok.values()) / len(st.ok) if st.ok else 0.0

            out = [f"{ESC}H{ESC}2J"]
            A = out.append
            A(
                f"{BOLD}AXIAL WATCH{RESET}  {run.name}   {time.strftime('%H:%M:%S')}   "
                f"{DIM}refresh {interval:g}s{RESET}"
            )
            A("")
            total = 30
            A(
                f"  {BOLD}briefs{RESET}   {bar(done, total)}   "
                f"{GRN}{done} ok{RESET}  {RED}{failed} fail{RESET}  {CYN}{len(inflight)} running{RESET}"
            )
            if mean:
                left = max(0, total - done - failed)
                workers = max(1, len(inflight))
                A(
                    f"           mean {human(mean)}/brief   est. remaining "
                    f"{human(left * mean / workers)}"
                )
            A("")
            A(f"  {BOLD}in flight{RESET}")
            if inflight:
                for b in inflight[-4:]:
                    A(f"    {CYN}{b}{RESET}  case={st.case[:34]!r} disp={st.disposition or '-'}")
                t = f"turn {st.turn[0]}/{st.turn[1]}" if st.turn else "-"
                tool = f"{st.last_tool[0]} -> {st.last_tool[1]} results" if st.last_tool else "-"
                A(f"    retrieve {t}   last: {tool}")
                # Run-wide, NOT per-brief: `retrieve:` lines carry no brief
                # name, and with concurrent workers the log interleaves, so
                # per-brief attribution is not recoverable. Labelled honestly
                # rather than presented as something it isn't.
                A(
                    f"    retrieval results (run total): {BOLD}{st.results_total:,}{RESET}"
                    f"   last lens={st.lens or '-'}  evidence={st.evidence:,}"
                )
            else:
                A(f"    {DIM}(none){RESET}")
            A("")
            A(
                f"  {BOLD}llm{RESET}      {len(recent)} calls/min   mean {lat:.1f}s   "
                f"tokens {sum(st.tokens_by_model.values()):,}   ~${spend:.2f}"
            )
            for m, t in st.tokens_by_model.most_common(3):
                A(f"           {DIM}{m:34s}{RESET} {t:>10,} tok")
            if st.errors or st.retries:
                errs = " ".join(f"{k}={v}" for k, v in st.errors.most_common(3))
                A(f"           {RED}errors{RESET} {errs}   {YEL}retries {st.retries}{RESET}")
            if st.tool_counts:
                A(
                    f"           {DIM}tools{RESET} "
                    + "  ".join(f"{k}={v}" for k, v in st.tool_counts.most_common(4))
                )
            if st.repairs:
                A(f"           {YEL}ref_id repairs {st.repairs}{RESET}")
            A("")
            if st.claims:
                A(
                    f"  {BOLD}claims{RESET}   per brief: {st.claims[-8:]}   "
                    f"mean {sum(st.claims) / len(st.claims):.1f}"
                )
            gates_done = sum(len(v) for v in st.gates.values())
            gfail = sum(1 for v in st.gates.values() for p in v.values() if p != "True")
            if gates_done:
                A(
                    f"  {BOLD}gates{RESET}    scored {gates_done}   "
                    f"{RED if gfail else GRN}{gfail} failing{RESET}"
                )
            A("")
            A(
                f"  {BOLD}processes{RESET} "
                + ("  ".join(proc_lines) if proc_lines else f"{DIM}none{RESET}")
            )
            A("")
            A(f"  {BOLD}recent{RESET}")
            for _ts, ev in list(st.events)[-6:]:
                A(f"    {ev}")
            if failed:
                A("")
                A(f"  {RED}{BOLD}failures{RESET}")
                for b, why in list(st.fail.items())[-3:]:
                    A(f"    {RED}{b}{RESET} {why[:96]}")
            sys.stdout.write("\n".join(out) + "\n")
            sys.stdout.flush()
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nstopped.")
        return 0


if __name__ == "__main__":
    os.system("")  # enable ANSI on Windows consoles
    # Corpus titles carry en-dashes and non-Latin names (Malešević, Üngör);
    # the legacy console codepage mangles them into replacement chars.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(main())
