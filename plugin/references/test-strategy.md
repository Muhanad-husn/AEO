# Test Strategy — Detecting & Running Unit + E2E Tests

Cut to the sections that carry a measurement or an incident: the tiers ([D31](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)), the harness-red budget ([D32](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)), and §9, where one project's acceptance test took 4.24 s against a 4.25 s bare import and its suite went from 764 s to 266 s on one flag. The rest of the original was stack tutorial and is gone. L-06 and L-10 in `docs/EVIDENCE.md` are why the tiering below is stated with its cost attached rather than as advice.

The harness is **stack-agnostic**: detect what the project uses, don't assume.

> When you need exact, current syntax for any framework here (a runner's flags, Playwright config keys), check the official documentation rather than relying on memory — versions drift.

---

## 2. Detecting the unit runner

Inspect the repo before assuming. Common signals:

| Stack | Detect via | Typical run command |
|---|---|---|
| Node / TS | `package.json` `scripts.test`, devDeps for `vitest` / `jest` / `mocha`; `node:test` | `npm test`, `npx vitest run`, `npx jest` |
| Python | `pyproject.toml` / `pytest.ini` / `setup.cfg`; `tests/` | `pytest -q` |
| Go | `*_test.go` | `go test ./...` |
| Ruby | `Gemfile` with `rspec`; `spec/` | `bundle exec rspec` |
| Java | `pom.xml` / `build.gradle` | `mvn -q test` / `./gradlew test` |
| .NET | `*.csproj`, `*Tests.csproj` | `dotnet test` |
| Rust | `Cargo.toml` | `cargo test` |
| PHP | `composer.json` with `phpunit` | `vendor/bin/phpunit` |

**Rule:** prefer the script the project already defines (`package.json` `test`, a `Makefile` target) over inventing a command — it encodes the project's intended invocation. If there is **no** unit runner and the project needs one, installing and wiring it is legitimate work for the slice (especially a walking skeleton). Always run a single test file/case during the inner loop for speed; run the **fast tier** before committing.

**Then time one launch, before you record anything.** Detection is not finished when you know the runner's name. Time one bare start of the system under test — `python -c "import <pkg>.cli"`, `node -e "require('./dist')"`, the binary's `--version` — and write the reading into the slice's status log. It takes seconds and it decides the next two paragraphs. §9 says what to do with the number.

**Then record both tiers.** `aeo-tests.json` at the project directory names them ([D10](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md), [D31](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)):

```json
{
  "test": "pytest -m \"not acceptance\"",
  "test_full": "pytest -n auto"
}
```

- **`test`** is the cheap tier. It is run on every green step and before every commit, so it has to stay fast enough that running it is never a decision. Unit tests, and nothing that launches a real process unless launching one is cheap.
- **`test_full`** is the exhaustive tier: everything, acceptance tests included. CI runs it, `safe-pr` cites it, and nothing in the inner loop does.
- **`test_full` is optional and falls back to `test`.** A project with one honest run — a small suite, a walking skeleton — names one key and is right to. Add the second key when the tiers genuinely diverge, not before.
- A mono-repo carries one record per project directory. Two suites in one tier is one command line: `npm test && pytest`.

No local gate runs either command ([D30](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)) — CI's required status check is what enforces the full tier reached green. The record still matters: `sandbox-guard` reads both tiers to recognise this project's suite by name.

If your slice changes the test setup — a new runner, a renamed script, a suite that moves, a tier that splits — update the record in the same slice, alongside the change that moved it. A stale record misleads that recognition rather than blocking anything outright, which is the one-way failure to watch for now that no gate reads it back to you.


## 6. Watching a test fail for the right reason

Never skip the red step. After writing a test, run it and read the failure — then say **which of the two kinds it is** before you touch anything. They look similar on the terminal and they are worth completely different amounts of your time.

| | **Logic red** | **Harness red** |
|---|---|---|
| Looks like | `expected "Password updated" to be visible` | `ModuleNotFoundError`, `FileNotFoundError: fixtures/x.json`, a compile error, a wrong selector, a `TimeoutExpired`, a mock whose shape is wrong, a runner flag the project doesn't have |
| Says | the behaviour is absent or wrong — the signal this test exists to produce | nothing at all about the product |
| Budget | **whatever it takes.** This *is* the work | **a couple of minutes.** Past that it costs more than it can return |

"If you cannot articulate why a test fails, you do not yet understand the requirement" is about a logic red. A harness red is understood immediately and is still worth nothing.

### When the harness budget runs out

Stop debugging the plumbing. Take the cheapest route back to a test that fails for a logic reason:

- **Inline what the fixture was providing.** A literal in the test beats a loader that needs debugging.
- **Drop to a simpler assertion** on the same behaviour, through the same boundary.
- **Delete the test and write a smaller one** that fails for the right reason.

Deleting without replacing is coverage laundering, and it is the one move not available here. The budget covers plumbing. It never covers a behaviour you'd rather not have to make work.

### The second occurrence of a shape is a cause, not an instance

The same harness red twice is a measurement, and what it measures is **one** defect in the suite rather than N in the tests — a fixture layer doing too much, a shared setup coupling tests to each other, a `conftest` with logic in it, a path assembled instead of resolved. Fix that, once.

Chasing the symptom N times is what this section exists to stop, and it is where a day goes. Test plumbing that costs more to debug than the behaviour it covers trips the over-engineering rule about a fix larger than its bug — that tripwire applies to test code too.


## 9. What the suite costs

Outside-in testing is the right discipline and it is not negotiable here. What is negotiable is what one run costs, and that has to be measured rather than absorbed. Three rules that hold everything above, driven by the two projects that discovered them the expensive way.

### 9.1 The launch is often the whole bill

For a CLI, API, or service, every acceptance test starts a process. That start is paid once per test and it does not shrink as the assertions get better. In a Python CLI at its eleventh slice, one acceptance test parsing an eight-document fixture room took 4.24 s — and a bare `python -c "import pipeline.cli"` took 4.25 s. The work under test was free; the import tree was the entire cost. Seventy such tests were 449 s of a 764 s suite.

So take §2's reading seriously:

- **Under about a second.** Nothing to do. Note it and move on.
- **Above about a second.** Install the stack's parallel runner during setup and put it in the recorded command. This is one dependency and one flag, and on the project above it took the full suite from 764 s to 266 s with no test changed.

| Stack | Parallel runner | In the record |
|---|---|---|
| Python / pytest | `pytest-xdist` | `pytest -n auto` |
| Node / vitest | built in | `vitest run --pool=threads` |
| Node / jest | built in | `jest --maxWorkers=50%` |
| Go | built in | `go test -parallel 8 ./...` |
| Rust | `cargo-nextest` | `cargo nextest run` |
| .NET | built in | `dotnet test -- --parallel` |

- **Also worth a look when the reading is high:** what the boundary imports at module scope. A dependency loaded for one subcommand and paid for by every test is a defect in the product, not in the suite.

### 9.2 Fan-out is not free for tests that shell out

`-n auto` is right for CPU-bound unit tests and wrong for tests that launch real subprocesses under a timeout. At full fan-out the workers saturate the cores while the subprocess a 180-second cap is timing gets a fraction of one, and the tier goes non-deterministically red — a project measured the same commit at 16 m 24 s failing one test and 20 m 33 s failing a different pair, every failure a `TimeoutExpired`.

A flaky gate teaches people to re-run rather than read, which is worse than a slow one. Where a project has both populations, the subprocess tests want their own lane at reduced parallelism (`-n 2`, or serial) rather than a raised timeout. Raising the cap moves the flake; it does not remove it.

### 9.3 One expensive setup, several readers

GOOS forbids reaching into internal code. It does not require every test to re-invoke the endpoint.

Where several assertions are about the same **produced artefact** rather than about the invocation itself, one session-scoped run through the real boundary with several tests reading its output is still outside-in — and it removes the cost that mattered. Where an assertion is about **what the invocation did** — the exit code, a flag's effect, a rejected input — it needs its own invocation, and sharing one would be testing nothing.

The secondary gain is correctness: three tests each re-deriving the same answer can disagree with each other, and one shared artefact cannot.

### 9.4 Report the number, don't absorb it

If the fast tier stops being fast — call it thirty seconds, and use judgement — that is a **finding to report in the slice's status log and the PR body**, not a delay to work around. The handbook's rule is to measure rather than speculate; it applies to the harness as much as to the product. A suite that has grown past its tier is a two-line change to the record, made once, instead of a minute paid on every green step for the rest of the project.
