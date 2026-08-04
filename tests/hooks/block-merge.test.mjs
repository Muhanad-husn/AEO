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

/** Run the real gate in its own process and report exactly what a hook would see. */
function runHook(payload) {
  const r = spawnSync(process.execPath, [gatePath], {
    input: payload === undefined ? '' : JSON.stringify(payload),
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function bash(command, extra = {}) {
  return { tool_name: 'Bash', tool_input: { command }, agent_type: 'aeo:builder', ...extra };
}

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
});

// ---------------------------------------------------------------------------
// push-refspec resolution: the highest-value new work in this slice
// ---------------------------------------------------------------------------

describe('push refspec resolution (D14)', () => {
  test('git push origin HEAD:main is blocked', () => {
    const repo = makeRepo({ branch: 'feat/x', defaultBranch: 'main' });
    const r = runHook(bash('git push origin HEAD:main', { cwd: repo }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /subagents never push to main\./);
  });

  test('git push origin +main is blocked', () => {
    const repo = makeRepo({ branch: 'feat/x', defaultBranch: 'main' });
    const r = runHook(bash('git push origin +main', { cwd: repo }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /subagents never push to main\./);
  });

  test('git push origin feat/main-thing is allowed: not a false positive on the substring', () => {
    const repo = makeRepo({ branch: 'feat/x', defaultBranch: 'main' });
    const r = runHook(bash('git push origin feat/main-thing', { cwd: repo }));
    assert.equal(r.status, 0);
  });

  test('git push origin main is blocked (plain refspec)', () => {
    const repo = makeRepo({ branch: 'feat/x', defaultBranch: 'main' });
    const r = runHook(bash('git push origin main', { cwd: repo }));
    assert.equal(r.status, 2);
  });

  test('a bare git push while sitting on the default branch is blocked', () => {
    const repo = makeRepo({ branch: 'main', defaultBranch: 'main' });
    const r = runHook(bash('git push', { cwd: repo }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /subagents never push to main\./);
  });

  test('a bare git push from a feature branch is allowed', () => {
    const repo = makeRepo({ branch: 'feat/x', defaultBranch: 'main' });
    const r = runHook(bash('git push', { cwd: repo }));
    assert.equal(r.status, 0);
  });

  test('git push origin feat/x is allowed regardless of current branch', () => {
    const repo = makeRepo({ branch: 'main', defaultBranch: 'main' }); // current branch is protected...
    const r = runHook(bash('git push origin feat/x', { cwd: repo })); // ...but the refspec is not
    assert.equal(r.status, 0);
  });

  test('git push origin :main (colon-deletion form) is blocked as a remote deletion', () => {
    const repo = makeRepo({ branch: 'feat/x', defaultBranch: 'main' });
    const r = runHook(bash('git push origin :main', { cwd: repo }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /subagents never delete remote branches\./);
  });

  test('git push origin --delete feat/dead is blocked regardless of branch name', () => {
    const repo = makeRepo({ branch: 'feat/x', defaultBranch: 'main' });
    const r = runHook(bash('git push origin --delete feat/dead', { cwd: repo }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /subagents never delete remote branches\./);
  });
});

describe('push resolution honours the detected default branch (D14)', () => {
  test('a repo whose default branch is master blocks a push to master', () => {
    const repo = makeRepo({ branch: 'feat/x', defaultBranch: 'master' });
    const r = runHook(bash('git push origin master', { cwd: repo }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /subagents never push to master\./);
  });

  test('the same repo does NOT block a push literally named main', () => {
    // main is not this repo's protected branch; only master is.
    const repo = makeRepo({ branch: 'feat/x', defaultBranch: 'master' });
    const r = runHook(bash('git push origin main', { cwd: repo }));
    assert.equal(r.status, 0);
  });

  test('a repo on main still blocks a push to main', () => {
    const repo = makeRepo({ branch: 'feat/x', defaultBranch: 'main' });
    const r = runHook(bash('git push origin main', { cwd: repo }));
    assert.equal(r.status, 2);
  });

  test('a slashed default branch is matched whole, not split on its slash', () => {
    const repo = makeRepo({ branch: 'feat/x', defaultBranch: 'release/stable' });
    const blocked = runHook(bash('git push origin release/stable', { cwd: repo }));
    assert.equal(blocked.status, 2);

    const allowed = runHook(bash('git push origin release/other', { cwd: repo }));
    assert.equal(allowed.status, 0);
  });

  test('a push to main in a repo with NO origin is blocked', () => {
    // The integration defect, on this gate's side. defaultBranch used to read
    // init.defaultBranch from system scope, which on this machine says `master`, so a
    // repo whose real branch is main resolved to master and `git push origin main`
    // was not the protected branch. No config is set here; the fixture is the bare
    // failing case.
    const repo = makeRepo({ branch: 'main' }); // no defaultBranch => no origin/HEAD, no remote
    assert.equal(git(repo, 'remote'), '', 'fixture must have no remote at all');
    const r = runHook(bash('git push origin main', { cwd: repo }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /subagents never push to main\./);
  });

  test('an unresolvable default branch blocks the push and names the remedy', () => {
    const repo = makeRepo({ branch: 'main' });
    git(repo, 'branch', 'master'); // both conventional names present, no remote to break the tie
    const r = runHook(bash('git push origin feat/x', { cwd: repo }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /does not say what its default branch is/);
    assert.match(r.stderr, /git remote set-head origin -a/);
  });

  test('worktree resolution uses the leading cd, not the launch cwd', () => {
    const launch = makeRepo({ branch: 'main' });
    const worktree = makeRepo({ branch: 'feat/other', defaultBranch: 'main' });
    const r = runHook(bash(`cd ${worktree} && git push`, { cwd: launch }));
    assert.equal(r.status, 0, 'the push runs from the worktree, which is not on the default branch');
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
    // agent_type is present here (C-02's exact trap), but it is not one of this
    // plugin's three roles, so isAnyAeoRole is false and the orchestrator's own
    // approved merge path stays open.
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

describe('forge direct-write tools (D14)', () => {
  test('create_or_update_file targeting the default branch is blocked', () => {
    const repo = makeRepo({ branch: 'main', defaultBranch: 'main' });
    const r = runHook({
      tool_name: 'mcp__plugin_github_github__create_or_update_file',
      tool_input: { branch: 'main' },
      cwd: repo,
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no direct writes to main through the forge\./);
  });

  test('create_or_update_file targeting refs/heads/<default> is blocked', () => {
    const repo = makeRepo({ branch: 'main', defaultBranch: 'main' });
    const r = runHook({
      tool_name: 'mcp__plugin_github_github__create_or_update_file',
      tool_input: { branch: 'refs/heads/main' },
      cwd: repo,
    });
    assert.equal(r.status, 2);
  });

  test('create_or_update_file targeting a feature branch is allowed', () => {
    const repo = makeRepo({ branch: 'main', defaultBranch: 'main' });
    const r = runHook({
      tool_name: 'mcp__plugin_github_github__create_or_update_file',
      tool_input: { branch: 'feat/x' },
      cwd: repo,
    });
    assert.equal(r.status, 0);
  });

  test('push_files and delete_file are checked the same way', () => {
    const repo = makeRepo({ branch: 'main', defaultBranch: 'main' });
    for (const action of ['push_files', 'delete_file']) {
      const r = runHook({
        tool_name: `mcp__plugin_github_github__${action}`,
        tool_input: { branch: 'main' },
        cwd: repo,
      });
      assert.equal(r.status, 2, action);
    }
  });

  test('a missing branch field is not enforced: nothing to compare', () => {
    const r = runHook({ tool_name: 'mcp__plugin_github_github__create_or_update_file', tool_input: {} });
    assert.equal(r.status, 0);
  });

  test('an unresolvable default branch blocks the forge write rather than allowing it', () => {
    const repo = makeRepo({ branch: 'main' });
    git(repo, 'branch', 'master'); // no remote, two conventional names: genuinely ambiguous
    const r = runHook({
      tool_name: 'mcp__plugin_github_github__create_or_update_file',
      tool_input: { branch: 'feat/x' },
      cwd: repo,
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /does not say what its default branch is/);
  });

  test('honours a repo default branch other than main', () => {
    const repo = makeRepo({ branch: 'feat/x', defaultBranch: 'trunk' });
    const blocked = runHook({
      tool_name: 'mcp__plugin_github_github__push_files',
      tool_input: { branch: 'trunk' },
      cwd: repo,
    });
    assert.equal(blocked.status, 2);

    const allowed = runHook({
      tool_name: 'mcp__plugin_github_github__push_files',
      tool_input: { branch: 'main' },
      cwd: repo,
    });
    assert.equal(allowed.status, 0);
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
