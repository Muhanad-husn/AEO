// Tests for plugin/hooks/block-merge.mjs.
//
// Run from the repo root: `node --test` (everything) or
// `node --test "tests/hooks/*.test.mjs"` (this directory only). Not
// `node --test tests/hooks/`; see lib.test.mjs's header for why.
//
// This gate's decisions are only observable as a real exit code from a real process
// (runGate owns process.exit), so every case here spawns plugin/hooks/block-merge.mjs
// directly rather than importing its functions. That is the actual shipped gate, not a
// fixture standing in for it.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

const gatePath = path.join(import.meta.dirname, '..', '..', 'plugin', 'hooks', 'block-merge.mjs');

// ---------------------------------------------------------------------------
// scratch repos
// ---------------------------------------------------------------------------

const scratch = [];
function tempDir(prefix = 'aeo-p12-') {
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

/** A throwaway repo with one real commit, optionally with origin/HEAD set (D14). */
function makeRepo({ branch = 'main', defaultBranch = null } = {}) {
  const dir = tempDir();
  git(dir, 'init', '-q', '-b', branch);
  git(dir, 'config', 'user.name', 'aeo-test');
  git(dir, 'config', 'user.email', 'aeo-test@example.invalid');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  if (defaultBranch) git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${defaultBranch}`);
  return dir;
}

/**
 * Where every hook child runs, and what it may see of this machine's session.
 *
 * L-03. resolveOperationDir falls back to CLAUDE_PROJECT_DIR and then to the hook
 * process's own cwd. A child spawned with neither pinned inherits the runner's cwd,
 * which is THIS repository, so a payload that names no directory silently points the
 * gate at the tree the suite is running in. Both are pinned to a directory the test
 * created and owns, so the fallback can only ever resolve to scratch.
 */
const NEUTRAL_CWD = tempDir('aeo-p12-nowhere-');
const neutralEnv = () => ({ ...process.env, CLAUDE_PROJECT_DIR: '' });

/** Run the real gate in its own process and report exactly what a hook would see. */
function runHook(payload) {
  const r = spawnSync(process.execPath, [gatePath], {
    input: payload === undefined ? '' : JSON.stringify(payload),
    encoding: 'utf8',
    cwd: NEUTRAL_CWD,
    env: neutralEnv(),
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function bash(command, extra = {}) {
  return { tool_name: 'Bash', tool_input: { command }, agent_type: 'aeo:builder', ...extra };
}

// C-07: PowerShell is a first-class tool that survives the background-subagent filter,
// and this gate decided on the literal string 'Bash'. A role that holds it could run
// `git merge` past a gate whose whole product is that it cannot. Latent rather than live
// while no role declares the tool, which is exactly the kind of gap that opens the day
// someone edits a `tools:` line for an unrelated reason.
function pwsh(command, extra = {}) {
  return { tool_name: 'PowerShell', tool_input: { command }, agent_type: 'aeo:builder', ...extra };
}

describe('PowerShell is gated on the same terms as Bash (C-07)', () => {
  for (const command of [
    'git merge feat/x',
    'git -C sub merge feat/x',
    'git branch -D feat/x',
    'git push origin --delete feat/dead',
    'gh pr merge 12',
  ]) {
    test(`${command} is blocked for a role`, () => {
      const r = runHook(pwsh(command));
      assert.equal(r.status, 2, `expected a block, got ${r.status}: ${r.stderr}`);
    });
  }

  test('a read-only git call still passes, so the widening did not over-block', () => {
    const r = runHook(pwsh('git merge-base HEAD main'));
    assert.equal(r.status, 0, `merge-base is read-only and must pass: ${r.stderr}`);
  });

  test('the orchestrator keeps its approved path on PowerShell too', () => {
    const r = runHook({ tool_name: 'PowerShell', tool_input: { command: 'git merge feat/x' } });
    assert.equal(r.status, 0, 'the main session merges on founder approval; this gate never blocks it');
  });
});

// ---------------------------------------------------------------------------
// git merge (V-02)
// ---------------------------------------------------------------------------

describe('git merge (V-02)', () => {
  test('git merge-base is allowed: it is read-only', () => {
    const r = runHook(bash('git merge-base main HEAD'));
    assert.equal(r.status, 0);
  });

  test('git merge is blocked', () => {
    const r = runHook(bash('git merge feat/x'));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /BLOCKED: subagents never run git merge\./);
    assert.match(r.stderr, /Prepare the PR; the main session merges after founder approval\./);
  });

  test('git -C <dir> merge is blocked: the case the skill version missed', () => {
    const r = runHook(bash('git -C /repo/worktree merge feat/x'));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /subagents never run git merge\./);
  });

  test('a merge behind cd && is still blocked', () => {
    const r = runHook(bash('cd /repo && git merge feat/x'));
    assert.equal(r.status, 2);
  });
});

// ---------------------------------------------------------------------------
// gh: merge via the CLI
// ---------------------------------------------------------------------------

describe('gh merge commands', () => {
  test('gh pr merge is blocked', () => {
    const r = runHook(bash('gh pr merge 42 --squash'));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /subagents never merge PRs\./);
  });

  test('gh api .../merge is blocked', () => {
    const r = runHook(bash('gh api repos/o/r/pulls/42/merge -X PUT'));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /subagents never merge via the API\./);
  });

  test('a read-only gh api call is not blocked', () => {
    const r = runHook(bash('gh api repos/o/r/pulls/42'));
    assert.equal(r.status, 0);
  });

  test('gh pr view is not blocked', () => {
    const r = runHook(bash('gh pr view 42'));
    assert.equal(r.status, 0);
  });
});

// ---------------------------------------------------------------------------
// branch deletion
// ---------------------------------------------------------------------------

describe('local branch deletion', () => {
  for (const flag of ['-d', '-D', '--delete']) {
    test(`git branch ${flag} is blocked`, () => {
      const r = runHook(bash(`git branch ${flag} feat/dead`));
      assert.equal(r.status, 2);
      assert.match(r.stderr, /subagents never delete branches/);
    });
  }

  test('git branch --list is not blocked', () => {
    const r = runHook(bash('git branch --list'));
    assert.equal(r.status, 0);
  });

  test('a deletion in the SECOND git branch of a chain is still blocked', () => {
    const r = runHook(bash('git branch --list && git branch -d feat/dead'));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /subagents never delete branches/);
  });

  // The flag test used to run against the whole command string, gated only on the
  // command containing a `git branch` somewhere, so any -d/-D/--delete anywhere blocked,
  // including one belonging to a different program. An over-block is not a hole, but it
  // teaches a builder that the gate is unreliable, which has its own cost.
  test('ls -d after git branch --show-current is not a branch deletion', () => {
    const r = runHook(bash('git branch --show-current && ls -d */'));
    assert.equal(r.status, 0, r.stderr);
  });

  test('sort -d after git branch -a is not a branch deletion', () => {
    const r = runHook(bash('git branch -a && sort -d file.txt'));
    assert.equal(r.status, 0, r.stderr);
  });
});

// ---------------------------------------------------------------------------
// remote branch deletion, every spelling (D30)
// ---------------------------------------------------------------------------
//
// This section used to also resolve a push's destination refspec against the
// repository's default branch (`git push origin main` and its variants) and refuse
// `git push --all`/`--mirror`. Both are gone: GitHub's branch protection refuses that
// push server-side once it reaches the remote, so the local re-derivation bought
// nothing the server does not already refuse, and it was the source of issue #121 — a
// wrong answer from resolving the wrong worktree directory. What is left, remote
// branch deletion, needs no directory resolved to judge it.

describe('push refspec resolution: remote branch deletion (D30)', () => {
  test('git push origin :main (colon-deletion form) is blocked as a remote deletion', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash('git push origin :main', { cwd: repo }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /subagents never delete remote branches\./);
  });

  test('git push origin --delete feat/dead is blocked regardless of branch name', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash('git push origin --delete feat/dead', { cwd: repo }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /subagents never delete remote branches\./);
  });

  test('an ordinary push naming the default branch is no longer this gate\'s business', () => {
    // GitHub's branch protection refuses this at the remote; the local gate no longer
    // re-derives that check (D30).
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash('git push origin main', { cwd: repo }));
    assert.equal(r.status, 0, r.stderr);
  });

  test('git push --all and --mirror are no longer this gate\'s business either', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    for (const flag of ['--all', '--mirror']) {
      const r = runHook(bash(`git push ${flag} origin`, { cwd: repo }));
      assert.equal(r.status, 0, r.stderr);
    }
  });
});

// ---------------------------------------------------------------------------
// every git invocation, not the first: the Checkpoint 1 bypass round
// ---------------------------------------------------------------------------
//
// The gate used to find one `git push` per command through a regex whose argument
// capture stopped at the first `;`, `&` or `|`. Everything after the first separator
// was invisible, so a protected push hidden behind a harmless one passed. What is left
// to judge, after D30, is remote branch deletion; the destination-refspec cases this
// section used to cover are gone along with that rule.

describe('a chained remote branch deletion is judged, not only the first push (confirmed bypass)', () => {
  test('&& chaining: the second push is judged', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash('git push origin feat/x && git push origin --delete feat/dead', { cwd: repo }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /subagents never delete remote branches\./);
  });

  test('; chaining: the second push is judged', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash('git push origin feat/x; git push origin --delete feat/dead', { cwd: repo }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /subagents never delete remote branches\./);
  });

  test('| chaining: the piped push is judged', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash('git push origin feat/x || git push origin --delete feat/dead', { cwd: repo }));
    assert.equal(r.status, 2, r.stderr);
  });

  // Position is varied deliberately: the defect hid anything after the first
  // invocation.
  test('the THIRD push in a chain is judged, not only the second', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash('git push origin a; git push origin b; git push origin :feat/dead', { cwd: repo }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /subagents never delete remote branches\./);
  });

  test('a chained colon-deletion is judged', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash('git push origin feat/x && git push origin :feat/dead', { cwd: repo }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /subagents never delete remote branches\./);
  });

  test('a chained git -C <dir> push is judged: the option prefix survives the chain', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash(`git push origin feat/x && git -C ${repo} push origin --delete feat/dead`, { cwd: repo }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /subagents never delete remote branches\./);
  });

  test('a chain of genuinely harmless pushes is still allowed', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash('git push origin feat/a && git push origin feat/b', { cwd: repo }));
    assert.equal(r.status, 0, r.stderr);
  });
});

describe('git push -d, the short form of --delete (confirmed bypass)', () => {
  test('-d after the remote is blocked', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash('git push origin -d feat/dead', { cwd: repo }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /subagents never delete remote branches\./);
  });

  test('-d before the remote is blocked', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash('git push -d origin feat/dead', { cwd: repo }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /subagents never delete remote branches\./);
  });

  test('a short flag that is not -d is not a deletion', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash('git push -u origin feat/x', { cwd: repo }));
    assert.equal(r.status, 0, r.stderr);
  });
});

describe('a shell-quoted colon-deletion refspec is unwrapped (confirmed bypass)', () => {
  test('git push origin ":main" is blocked as a remote deletion', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash('git push origin ":main"', { cwd: repo }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /subagents never delete remote branches\./);
  });

  test('a quoted, non-deleting refspec is still allowed', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    const r = runHook(bash('git push origin "feat/main-thing"', { cwd: repo }));
    assert.equal(r.status, 0, r.stderr);
  });
});

// ---------------------------------------------------------------------------
// identity (C-02, F5)
// ---------------------------------------------------------------------------

describe('identity policy (F5)', () => {
  test('the orchestrator (no agent_type) is not enforced against', () => {
    const r = runHook({ tool_name: 'Bash', tool_input: { command: 'git merge feat/x' } });
    assert.equal(r.status, 0);
  });

  test('a main session run with --agent, under a non-aeo identity, is not enforced against', () => {
    // agent_type is present here (C-02's exact trap), but it does not match any of
    // this plugin's `aeo:<role>` identities, so isAnyAeoRole is false and the
    // orchestrator's own approved merge path stays open.
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'git merge feat/x' },
      agent_type: 'general-purpose',
    });
    assert.equal(r.status, 0);
  });

  test('aeo:builder is enforced against', () => {
    const r = runHook(bash('git merge feat/x', { agent_type: 'aeo:builder' }));
    assert.equal(r.status, 2);
  });

  test('aeo:reviewer and aeo:triage are enforced against too', () => {
    for (const role of ['reviewer', 'triage']) {
      const r = runHook(bash('git merge feat/x', { agent_type: `aeo:${role}` }));
      assert.equal(r.status, 2, role);
    }
  });

  test(
    "a foreign plugin's namespaced subagent is NOT enforced against, " +
      'this pins the narrow policy (isAnyAeoRole), not a broader one',
    () => {
      const r = runHook(bash('git merge feat/x', { agent_type: 'other-plugin:builder' }));
      assert.equal(r.status, 0);
    },
  );

  test('the bare frontmatter name never fires, same as the library contract', () => {
    const r = runHook(bash('git merge feat/x', { agent_type: 'builder' }));
    assert.equal(r.status, 0);
  });
});

// ---------------------------------------------------------------------------
// the forge arm: blocked for everyone, including the orchestrator (D14)
// ---------------------------------------------------------------------------

describe('forge merge tool (D14)', () => {
  test('a merge action is blocked with no agent_type at all: the orchestrator included', () => {
    const r = runHook({ tool_name: 'mcp__plugin_github_github__merge_pull_request', tool_input: {} });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /subagents and the forge merge tool never merge\./);
  });

  test('a different server namespace still matches: the pattern is namespace-agnostic', () => {
    const r = runHook({ tool_name: 'mcp__acme_github_enterprise__merge_pull_request', tool_input: {} });
    assert.equal(r.status, 2);
  });

  test('merge as the leading verb is blocked even under a different action name', () => {
    const r = runHook({ tool_name: 'mcp__plugin_github_github__merge_branch', tool_input: {} });
    assert.equal(r.status, 2);
  });

  test('merge appearing anywhere other than the leading verb is not blocked', () => {
    // unmerge_branch: "merge" is a substring, not the whole leading word (V-12's rule).
    // get_merge_status: "merge" is a whole word, but not the leading verb, the shape
    // a real read-only status check would take, and the case a plain word-boundary
    // match (rather than a leading-verb anchor) would have wrongly blocked.
    for (const name of ['unmerge_branch', 'get_merge_status']) {
      const r = runHook({ tool_name: `mcp__plugin_github_github__${name}`, tool_input: {} });
      assert.equal(r.status, 0, name);
    }
  });

  test('every mcp__plugin_github_github__* tool actually installed in this environment passes untouched', () => {
    // A snapshot of this environment's real tool list (2026-08-04), none of which are
    // a merge or a direct-write action. Sanity-checks D14's namespace-agnostic pattern
    // against real names rather than only invented ones.
    const realTools = [
      'add_comment_to_pending_review',
      'add_issue_comment',
      'add_reply_to_pull_request_comment',
      'create_branch',
      'create_pull_request',
      'get_commit',
      'issue_read',
      'issue_write',
      'list_pull_requests',
      'pull_request_read',
      'pull_request_review_write',
      'request_copilot_review',
      'search_pull_requests',
      'update_pull_request',
      'update_pull_request_branch',
    ];
    for (const name of realTools) {
      const r = runHook({ tool_name: `mcp__plugin_github_github__${name}`, tool_input: {} });
      assert.equal(r.status, 0, name);
    }
  });
});

// D30: the forge direct-write check (create_or_update_file/push_files/delete_file
// targeting the default branch) is deleted. GitHub's contents API refuses that write
// server-side once branch protection is on, the same as it refuses the equivalent git
// push, so the local re-derivation is gone along with the push-refspec check above.
// These are the sanity checks that the write actions pass through untouched now,
// including the shape that used to be the sharpest case: an omitted `branch`.
describe('forge direct-write tools are no longer this gate\'s business (D30)', () => {
  test('create_or_update_file targeting the default branch is no longer blocked here', () => {
    const repo = makeRepo({ branch: 'main', defaultBranch: 'main' });
    const r = runHook({
      tool_name: 'mcp__plugin_github_github__create_or_update_file',
      tool_input: { branch: 'main' },
      cwd: repo,
    });
    assert.equal(r.status, 0, r.stderr);
  });

  test('an omitted branch is no longer blocked here either', () => {
    const r = runHook({ tool_name: 'mcp__plugin_github_github__create_or_update_file', tool_input: {} });
    assert.equal(r.status, 0, r.stderr);
  });

  test('push_files and delete_file pass through the same way', () => {
    for (const action of ['push_files', 'delete_file']) {
      const r = runHook({ tool_name: `mcp__plugin_github_github__${action}`, tool_input: {} });
      assert.equal(r.status, 0, action);
    }
  });
});

// ---------------------------------------------------------------------------
// malformed and empty payloads: library-defined behaviour
// ---------------------------------------------------------------------------

describe('malformed and empty payloads (library-defined)', () => {
  test('an empty payload allows, and says so', () => {
    const r = runHook(undefined);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /empty hook payload/);
  });

  test('a non-Bash, non-forge tool is untouched', () => {
    const r = runHook({ tool_name: 'Read', tool_input: { file_path: '/x' }, agent_type: 'aeo:builder' });
    assert.equal(r.status, 0);
  });

  test('a Bash call with no tool_input.command does not throw', () => {
    const r = runHook({ tool_name: 'Bash', agent_type: 'aeo:builder' });
    assert.equal(r.status, 0);
  });

  test('a forge tool name that does not match the namespace pattern is untouched', () => {
    const r = runHook({ tool_name: 'mcp__some_other_service__merge_thing', tool_input: {} });
    assert.equal(r.status, 0);
  });
});
