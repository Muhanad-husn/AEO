# The development-actor cap

**Development actors: 4**

That line is the plugin's only statement of the number. Everything that needs
the value reads it here: the concurrency step in `sprint-start`, the
`plan-actors.mjs` check that step runs, and a founder changing the routine.
Nothing else in the plugin carries a second copy, and a test fails if one
appears.

## It is a founder-set operating parameter, not a tuned constant

The founder's operating routine is four worktrees for four issues. The number
describes how one person supervises concurrent work. It was not measured off
this machine, derived from core count, or tuned against a benchmark, and there
is no experiment that would move it — only a founder deciding to run their
sprint differently.

The distinction is why this file exists rather than a `4` sitting in a lane. A
bare number in a heuristic is over-engineering tripwire 2, and the standard
response to a magic number is to start tuning it. There is nothing here to
tune. To change the cap, change the line above.

## What it governs

| Lane | Cap |
| --- | --- |
| Development actors — implementation, one worktree, branch and PR each | the number above |
| Read-only fan-out — review, research, verification, evidence checks | none; nothing writes |
| Operation workers — bounded mechanical units inside one checkout | sized by the task, no cap; see `worker-dispatch` |

The cap counts development actors dispatched at once out of one sprint
session. It is not a daily budget and it does not carry over. An actor that has
reached its PR and stopped is finished, and its slot is free.

## What the cap is not

It is not a limit on how much the machine can take. Four commit gates running a
test suite at the same time is a real cost, and it is a thing to measure rather
than assume — but if that measurement ever argues for a different number, the
argument goes to the founder, because the parameter is theirs. A lane does not
lower the cap on its own initiative, and it does not raise it because the
backlog looks parallel.
