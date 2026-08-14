// Tests for plugin/hooks/redirect-guard.mjs.
//
// Run from the repo root:
//   node --test                                    # everything
//   node --test "tests/hooks/*.test.mjs"           # this directory only
//
// Every case spawns the real gate as its own process and asserts a real exit code
// (runGate owns process.exit; there is no in-process shortcut) -- the same discipline
// path-guard.test.mjs uses, for the same reason: this gate's whole job is a fence, and
// the thing worth proving is the actual shipped process's decision, not a function
// standing in for it.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const GATE = path.join(repoRoot, 'plugin', 'hooks', 'redirect-guard.mjs');

// ---------------------------------------------------------------------------
// scratch repos
// ---------------------------------------------------------------------------

const scratch = [];
function tempDir(prefix = 'aeo-p116-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? r.error}`);
  return (r.stdout ?? '').trim();
}

function initRepoAt(dir) {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'aeo-test');
  git(dir, 'config', 'user.email', 'aeo-test@example.invalid');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

function makeRepo() {
  return initRepoAt(tempDir());
}

/**
 * Where every hook child runs, and what it may see of this machine's session (L-03,
 * mirrors path-guard.test.mjs): a directory-less payload must not silently resolve to
 * this repository.
 */
const NEUTRAL_CWD = tempDir('aeo-p116-nowhere-');
const neutralEnv = () => ({ ...process.env, CLAUDE_PROJECT_DIR: '' });

/** Run the real gate in its own process and report exactly what a hook would see. */
function runHook(payload) {
  const r = spawnSync(process.execPath, [GATE], {
    input: payload === undefined ? '' : JSON.stringify(payload),
    encoding: 'utf8',
    cwd: NEUTRAL_CWD,
    env: neutralEnv(),
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const NO_AGENT_TYPE = Symbol('no agent_type');

function shellCall(tool_name, command, { agent_type = 'aeo:builder', cwd, ...extra } = {}) {
  const payload = {
    session_id: 'test-session',
    hook_event_name: 'PreToolUse',
    tool_name,
    tool_input: { command },
    ...extra,
  };
  if (agent_type !== NO_AGENT_TYPE) payload.agent_type = agent_type;
  if (cwd !== undefined) payload.cwd = cwd;
  return payload;
}

const bash = (command, opts) => shellCall('Bash', command, opts);
const pwsh = (command, opts) => shellCall('PowerShell', command, opts);

function assertBlocked(result, pattern) {
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}\n${result.stderr}`);
  assert.match(result.stderr, /^BLOCKED: /m, 'no BLOCKED line on stderr');
  if (pattern) assert.match(result.stderr, pattern, `blocked, but not by the rule under test:\n${result.stderr}`);
}

function assertAllowed(result) {
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
  assert.doesNotMatch(result.stderr, /^BLOCKED: /m, 'blocked when it should have allowed');
}

const FENCE = /role subagents may not write into \.claude\//;

// ---------------------------------------------------------------------------
// The verify line: the hole from #116, closed
// ---------------------------------------------------------------------------

describe('the verify line: a role subagent redirecting into .claude/ through Bash', () => {
  test('is blocked, where Write and Edit already were', () => {
    const repo = makeRepo();
    const r = runHook(bash('printf "probe" > .claude/probe-bash.txt', { cwd: repo }));
    assertBlocked(r, FENCE);
    assert.match(r.stderr, /tried: \.claude\/probe-bash\.txt/);
  });

  test('the same role redirecting into product code is unaffected', () => {
    const repo = makeRepo();
    const r = runHook(bash('printf "probe" > src/probe.txt', { cwd: repo }));
    assertAllowed(r);
  });

  test('PowerShell reaches the same fence (decision 2: not a documented gap)', () => {
    const repo = makeRepo();
    const r = runHook(pwsh('"probe" > .claude/probe-ps.txt', { cwd: repo }));
    assertBlocked(r, FENCE);
  });
});

// ---------------------------------------------------------------------------
// Every redirect form
// ---------------------------------------------------------------------------

describe('redirect forms', () => {
  test('>> (append) is fenced', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('echo x >> .claude/log.txt', { cwd: repo })), FENCE);
  });

  test('2> (stderr) is fenced', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('some-cmd 2> .claude/err.log', { cwd: repo })), FENCE);
  });

  test('&> (all streams) is fenced', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('some-cmd &> .claude/all.log', { cwd: repo })), FENCE);
  });

  test('a numbered fd (3>) is fenced', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('some-cmd 3> .claude/fd3.log', { cwd: repo })), FENCE);
  });

  test('a fd-duplication redirect (2>&1) is not itself a target, and does not block', () => {
    const repo = makeRepo();
    assertAllowed(runHook(bash('echo x 2>&1 > out.txt', { cwd: repo })));
  });

  test('a redirect appearing before the program on the line is still read', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('> .claude/before.log echo hi', { cwd: repo })), FENCE);
  });

  test('a plain redirect naming no harness path is allowed', () => {
    const repo = makeRepo();
    assertAllowed(runHook(bash('npm test > test.log', { cwd: repo })));
  });
});

// ---------------------------------------------------------------------------
// Heredocs (review finding 4): issue #116's own must-handle list names "heredocs
// writing to a redirected target". The `>` target is parsed before the heredoc body is
// even reached, so this resolves through the ordinary RESOLVED branch, not through the
// unparseable-line raw-text fallback -- proven here rather than assumed, especially
// given #119's live finding that this same segmenter can lose a command's `cd` prefix
// on a sufficiently adversarial heredoc body.
// ---------------------------------------------------------------------------

describe('heredocs', () => {
  test('a heredoc redirected into .claude/ is fenced through the RESOLVED branch, not the raw-text fallback', () => {
    // Review finding 6: "blocked" alone does not distinguish the two branches -- the
    // raw-text fallback would ALSO block here, since the raw text names .claude, so a
    // test asserting only the exit code cannot fail for the reason it claims to pin.
    // The two branches emit different messages (checkTarget's "tried: <rel>" only comes
    // from the resolved branch; the fallback says the target could not be resolved), so
    // asserting the resolved branch's own message is what actually tells them apart --
    // the same technique the verify-line test already uses.
    const repo = makeRepo();
    const command = "cat > .claude/x.md <<'EOF'\nhello\nEOF\n";
    const r = runHook(bash(command, { cwd: repo }));
    assertBlocked(r, FENCE);
    assert.match(r.stderr, /tried: \.claude\/x\.md/);
  });

  test('a heredoc redirected to an ordinary path is allowed', () => {
    const repo = makeRepo();
    const command = "cat > out.md <<'EOF'\nhello\nEOF\n";
    assertAllowed(runHook(bash(command, { cwd: repo })));
  });
});

// ---------------------------------------------------------------------------
// cd prefixes
// ---------------------------------------------------------------------------

describe('cd prefixes', () => {
  test('a relative cd resolves the target against it', () => {
    const repo = makeRepo();
    mkdirSync(path.join(repo, 'sub'), { recursive: true });
    const r = runHook(bash('cd sub && printf x > ../.claude/y.txt', { cwd: repo }));
    assertBlocked(r, FENCE);
  });

  test('an absolute cd resolves the target against it', () => {
    const repo = makeRepo();
    const r = runHook(bash(`cd "${repo.replace(/\\/g, '/')}" && printf x > .claude/y.txt`, { cwd: NEUTRAL_CWD }));
    assertBlocked(r, FENCE);
  });

  test('a relative cd to ordinary product code is unaffected', () => {
    const repo = makeRepo();
    mkdirSync(path.join(repo, 'sub'), { recursive: true });
    const r = runHook(bash('cd sub && printf x > y.txt', { cwd: repo }));
    assertAllowed(r);
  });
});

// ---------------------------------------------------------------------------
// Write-through-a-tool routes
// ---------------------------------------------------------------------------

describe('write-through-a-tool routes', () => {
  test('tee is fenced', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('echo hi | tee .claude/x.log', { cwd: repo })), FENCE);
  });

  test('tee to an ordinary path is allowed', () => {
    const repo = makeRepo();
    assertAllowed(runHook(bash('echo hi | tee out.log', { cwd: repo })));
  });

  test('cp is fenced on its destination', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('cp a.txt .claude/b.txt', { cwd: repo })), FENCE);
  });

  test('cp between two ordinary paths is allowed', () => {
    const repo = makeRepo();
    assertAllowed(runHook(bash('cp a.txt b.txt', { cwd: repo })));
  });

  test('mv is fenced on its destination', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('mv a.txt .claude/b.txt', { cwd: repo })), FENCE);
  });

  // Review finding 3: the harness directory named AS the destination itself (no further
  // segment), the most natural spelling of this route. isPathInside(p, p) is true, so
  // this already blocks; nothing pinned it before this test.
  test('cp into the harness directory itself (trailing slash) is fenced', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('cp a.txt .claude/', { cwd: repo })), FENCE);
  });

  test('mv into the harness directory itself (no trailing slash) is fenced', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('mv a.txt .claude', { cwd: repo })), FENCE);
  });

  test('install is fenced on its destination', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('install -m 644 a.txt .claude/b.txt', { cwd: repo })), FENCE);
  });

  test('dd of= is fenced', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('dd if=a.img of=.claude/b.img', { cwd: repo })), FENCE);
  });

  test('dd with no of= naming .claude is allowed (reading, not writing, there)', () => {
    const repo = makeRepo();
    assertAllowed(runHook(bash('dd if=.claude/a.img of=b.img', { cwd: repo })));
  });

  test('sed -i is fenced on the file it edits in place', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('sed -i "s/a/b/" .claude/x.txt', { cwd: repo })), FENCE);
  });

  test('sed with no -i is allowed, even naming a .claude path: it only reads', () => {
    const repo = makeRepo();
    assertAllowed(runHook(bash('sed "s/a/b/" .claude/x.txt', { cwd: repo })));
  });

  describe('PowerShell cmdlets (decision 2), case-insensitive, flag and positional forms', () => {
    test('Set-Content -Path is fenced', () => {
      const repo = makeRepo();
      assertBlocked(runHook(pwsh("Set-Content -Path .claude\\x.txt -Value 'y'", { cwd: repo })), FENCE);
    });

    test('lower-cased set-content -path is fenced the same way (cmdlet names are case-insensitive)', () => {
      const repo = makeRepo();
      assertBlocked(runHook(pwsh("set-content -path .claude\\x.txt -value 'y'", { cwd: repo })), FENCE);
    });

    test('the colon-joined flag form (-Path:value) is read', () => {
      const repo = makeRepo();
      assertBlocked(runHook(pwsh("Set-Content -Path:.claude\\x.txt -Value 'y'", { cwd: repo })), FENCE);
    });

    test('Add-Content -FilePath is fenced', () => {
      const repo = makeRepo();
      assertBlocked(runHook(pwsh("Add-Content -FilePath .claude\\x.txt -Value 'y'", { cwd: repo })), FENCE);
    });

    test('Out-File, positional (no flag), is fenced', () => {
      const repo = makeRepo();
      assertBlocked(runHook(pwsh("'hi' | Out-File .claude\\x.txt", { cwd: repo })), FENCE);
    });

    test('Tee-Object -LiteralPath is fenced', () => {
      const repo = makeRepo();
      assertBlocked(runHook(pwsh('Get-Content x | Tee-Object -LiteralPath .claude\\x.txt', { cwd: repo })), FENCE);
    });

    test('Out-File to an ordinary path is allowed', () => {
      const repo = makeRepo();
      assertAllowed(runHook(pwsh("'hi' | Out-File out.txt", { cwd: repo })));
    });

    test('a bare redirect using the backslash form a PowerShell user actually types is fenced', () => {
      // The verify-line test elsewhere uses a forward slash; PowerShell users write
      // backslashes, and scanShell keeps a backslash before a non-escapable character
      // literal (L-09), so this is a distinct code path worth its own pin.
      const repo = makeRepo();
      assertBlocked(runHook(pwsh('"probe" > .claude\\probe-ps.txt', { cwd: repo })), FENCE);
    });

    test('New-Item -Path is fenced, and joins the positional route (its first positional parameter is Path)', () => {
      const repo = makeRepo();
      assertBlocked(runHook(pwsh('New-Item -ItemType File -Path .claude\\x.txt', { cwd: repo })), FENCE);
      assertBlocked(runHook(pwsh('New-Item .claude\\y.txt -ItemType File', { cwd: repo })), FENCE);
    });

    test('New-Item to an ordinary path is allowed', () => {
      const repo = makeRepo();
      assertAllowed(runHook(pwsh('New-Item -ItemType File -Path out.txt', { cwd: repo })));
    });

    // Review finding 5, a live hole: the positional fallback used to read index 0, but
    // PowerShell binds a named parameter (-ItemType, -Encoding, -Value) ANYWHERE and
    // assigns the leftover positional afterwards. `New-Item -ItemType File <path>` is
    // the form Microsoft's own documentation shows for creating a file, and it, along
    // with the equivalent Set-Content and Out-File shapes, walked straight through
    // before the fix -- these three lines are exactly the ones the review measured as
    // allowed against the pre-fix branch.
    describe('a named parameter before the positional path (review finding 5)', () => {
      test('New-Item -ItemType File <path>, the documented spelling, is fenced', () => {
        const repo = makeRepo();
        assertBlocked(runHook(pwsh('New-Item -ItemType File .claude\\x.txt', { cwd: repo })), FENCE);
      });

      test('Set-Content -Value y <path> is fenced, and -Value\'s own argument is not mistaken for a path', () => {
        const repo = makeRepo();
        assertBlocked(runHook(pwsh("Set-Content -Value y .claude\\x.txt", { cwd: repo })), FENCE);
      });

      test('Out-File -Encoding utf8 <path> is fenced', () => {
        const repo = makeRepo();
        assertBlocked(runHook(pwsh('Out-File -Encoding utf8 .claude\\x.txt', { cwd: repo })), FENCE);
      });

      test('the same three shapes to an ordinary path are allowed, so the fix did not over-block', () => {
        const repo = makeRepo();
        assertAllowed(runHook(pwsh('New-Item -ItemType File out.txt', { cwd: repo })));
        assertAllowed(runHook(pwsh("Set-Content -Value y out.txt", { cwd: repo })));
        assertAllowed(runHook(pwsh('Out-File -Encoding utf8 out.txt', { cwd: repo })));
      });
    });
  });

  // Review finding 1: Copy-Item and Move-Item are the canonical cp/mv cmdlets and were
  // missing entirely, an asymmetry with the Unix table (cp/mv typed in PowerShell were
  // already caught there, since program-name matching does not look at tool_name). They
  // get their OWN route, not PS_PATH_CMDLETS: their positional-0 is the SOURCE, so the
  // flag set's positional fallback would flag the wrong word.
  describe('Copy-Item / Move-Item (review finding 1)', () => {
    test('Copy-Item -Destination is fenced', () => {
      const repo = makeRepo();
      assertBlocked(runHook(pwsh('Copy-Item -Path a.txt -Destination .claude\\b.txt', { cwd: repo })), FENCE);
    });

    test('the colon-joined -Destination:value form is read', () => {
      const repo = makeRepo();
      assertBlocked(runHook(pwsh('Move-Item -Destination:.claude\\b.txt -Path a.txt', { cwd: repo })), FENCE);
    });

    test('the positional SOURCE-then-DESTINATION form is fenced on the destination, not the source', () => {
      const repo = makeRepo();
      assertBlocked(runHook(pwsh('Copy-Item a.txt .claude\\b.txt', { cwd: repo })), FENCE);
      // The mirror image: naming .claude as the SOURCE must not be mistaken for the
      // destination and must not block, proving positional-0 is read as source.
      assertAllowed(runHook(pwsh('Copy-Item .claude\\a.txt out.txt', { cwd: repo })));
    });

    test('Move-Item between two ordinary paths is allowed', () => {
      const repo = makeRepo();
      assertAllowed(runHook(pwsh('Move-Item a.txt b.txt', { cwd: repo })));
    });

    test('lower-cased copy-item is fenced the same way (cmdlet names are case-insensitive)', () => {
      const repo = makeRepo();
      assertBlocked(runHook(pwsh('copy-item a.txt .claude\\b.txt', { cwd: repo })), FENCE);
    });
  });
});

// ---------------------------------------------------------------------------
// Decision 1: the fail direction on an unresolvable target -- every case pinned
// separately, refusals and allows both.
// ---------------------------------------------------------------------------

describe('decision 1: a resolvable target', () => {
  test('resolving into .claude/ is blocked', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('printf x > .claude/y.txt', { cwd: repo })), FENCE);
  });

  test('resolving anywhere else is allowed', () => {
    const repo = makeRepo();
    assertAllowed(runHook(bash('printf x > y.txt', { cwd: repo })));
  });
});

describe('decision 1: an unresolvable target whose raw text names .claude', () => {
  test('an unexpanded variable segment is blocked (> .claude/$X)', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('printf x > .claude/$X', { cwd: repo })), FENCE);
  });

  test('a variable-prefixed quoted path is blocked (> "$DIR/.claude/out")', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('printf x > "$DIR/.claude/out"', { cwd: repo })), FENCE);
  });

  test('a glob segment naming .claude is blocked', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('printf x > .claude/*.txt', { cwd: repo })), FENCE);
  });
});

describe('decision 1: an unresolvable target whose raw text does not name .claude', () => {
  test('a bare variable target is allowed (npm test > "$LOG")', () => {
    const repo = makeRepo();
    assertAllowed(runHook(bash('npm test > "$LOG"', { cwd: repo })));
  });

  test('a glob with no .claude segment is allowed', () => {
    const repo = makeRepo();
    assertAllowed(runHook(bash('printf x > out/*.txt', { cwd: repo })));
  });

  test('a relative target behind an unresolvable cd is allowed when it does not name .claude', () => {
    const repo = makeRepo();
    assertAllowed(runHook(bash('cd $SOMEWHERE && printf x > y.txt', { cwd: repo })));
  });

  test('a relative target behind an unresolvable cd is blocked when it does name .claude', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('cd $SOMEWHERE && printf x > .claude/y.txt', { cwd: repo })), FENCE);
  });
});

describe('decision 1: a line the parser cannot read at all', () => {
  test('a backtick substitution is allowed when its raw text does not name .claude', () => {
    const repo = makeRepo();
    assertAllowed(runHook(bash('echo `date` > out.txt', { cwd: repo })));
  });

  test('a backtick substitution is blocked when its raw text does name .claude', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('echo `date` > .claude/out.txt', { cwd: repo })), FENCE);
  });

  test('an unterminated quote is allowed when its raw text does not name .claude', () => {
    const repo = makeRepo();
    assertAllowed(runHook(bash('echo "unterminated text', { cwd: repo })));
  });

  test('an unterminated quote is blocked when its raw text does name .claude', () => {
    const repo = makeRepo();
    assertBlocked(runHook(bash('echo "unterminated .claude/x text', { cwd: repo })), FENCE);
  });
});

// ---------------------------------------------------------------------------
// #113 through the shell surface: a role's own linked worktree under
// .claude/worktrees/ must still be allowed
// ---------------------------------------------------------------------------

describe('#113 carried through: a linked worktree parked under .claude/worktrees/', () => {
  test('an ordinary project file written by redirect inside the worktree is allowed', () => {
    const project = makeRepo();
    const worktree = path.join(project, '.claude', 'worktrees', 'agent-1');
    mkdirSync(path.dirname(worktree), { recursive: true });
    git(project, 'worktree', 'add', '-q', '-b', 'feat/agent-1', worktree);

    const r = runHook(bash('printf x > plugin/agents/reviewer.md', { cwd: worktree }));
    assertAllowed(r);
  });

  test("the worktree's own .claude/ is still fenced", () => {
    const project = makeRepo();
    const worktree = path.join(project, '.claude', 'worktrees', 'agent-2');
    mkdirSync(path.dirname(worktree), { recursive: true });
    git(project, 'worktree', 'add', '-q', '-b', 'feat/agent-2', worktree);

    const r = runHook(bash('printf x > .claude/settings.json', { cwd: worktree }));
    assertBlocked(r, FENCE);
  });
});

// ---------------------------------------------------------------------------
// Identity (C-02)
// ---------------------------------------------------------------------------

describe('identity', () => {
  for (const role of ['builder', 'reviewer', 'triage']) {
    test(`aeo:${role} is fenced`, () => {
      const repo = makeRepo();
      const r = runHook(bash('printf x > .claude/x.md', { cwd: repo, agent_type: `aeo:${role}` }));
      assertBlocked(r, FENCE);
    });
  }

  const unaffected = [
    ['no agent_type at all, the orchestrator', NO_AGENT_TYPE],
    ["a bare 'builder' from --agent (C-02: not this plugin's role)", 'builder'],
    ["another plugin's builder", 'some-plugin:builder'],
  ];
  for (const [label, agent_type] of unaffected) {
    test(`${label} passes through`, () => {
      const repo = makeRepo();
      const r = runHook(bash('printf x > .claude/x.md', { cwd: repo, agent_type }));
      assertAllowed(r);
    });
  }
});

// ---------------------------------------------------------------------------
// Malformed and empty payloads
// ---------------------------------------------------------------------------

describe('malformed payloads', () => {
  test('an unreadable payload allows and says so', () => {
    for (const raw of ['', '   ', 'not json at all', '[1,2,3]', 'null', '"a string"']) {
      const r = spawnSync(process.execPath, [GATE], { input: raw, encoding: 'utf8', cwd: NEUTRAL_CWD, env: neutralEnv() });
      assert.equal(r.status, 0, `raw ${JSON.stringify(raw)}: expected exit 0`);
      assert.match(r.stderr ?? '', /redirect-guard: (empty|unreadable) hook payload/, `raw ${JSON.stringify(raw)}: silent skip`);
    }
  });

  test('a missing or empty command allows: nothing to read', () => {
    const repo = makeRepo();
    for (const tool_input of [{}, { command: '' }, { command: '   ' }, { command: 42 }, { command: null }]) {
      const payload = { tool_name: 'Bash', tool_input, agent_type: 'aeo:builder', cwd: repo };
      assertAllowed(runHook(payload));
    }
  });

  test('a non-shell tool never reaches this gate, even naming .claude in its input', () => {
    const repo = makeRepo();
    const payload = {
      tool_name: 'Edit',
      tool_input: { file_path: path.join(repo, '.claude', 'x.md'), old_string: 'a', new_string: 'b' },
      agent_type: 'aeo:builder',
    };
    assertAllowed(runHook(payload));
  });
});
