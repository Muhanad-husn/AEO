// P6.1 (issue #80) — what `new-project` actually emits, not what its prose says.
//
//   node --test tests/skills/new-project-scaffold.test.mjs
//
// D20 says skills are prose and prose gets no tests, and this file honours that: it
// asserts nothing about a sentence in SKILL.md. What it asserts is the scaffolded tree.
// The scaffolder's shape and step order live in a data-only manifest,
// plugin/skills/new-project/assets/scaffold-plan.json, which SKILL.md instructs the agent
// to walk in array order. This test walks the same array, writes the same files, and
// checks what came out. One file feeds both, so the instructions and the test cannot
// drift apart.
//
// Why the write log is the ordering oracle. EN-14 requires `logs/` to exist before any
// product code, and a scaffolder's ordering is its declared step order — there is no
// second artifact to compare against, and filesystem mtimes for back-to-back writes are
// not reliably distinguishable. So this test does two things instead of trusting the
// loop: it records every write as it happens, and, before each product-code write, it
// asks the filesystem whether `logs/` is already there. Move the logs step after the
// product steps in the manifest and both checks fail, which is the guarantee issue #80
// asks for.
//
// The stack under test is Node. It is the only stack the manifest seeds, because node is
// the one toolchain this plugin already requires (D8) and therefore the only toolchain a
// test can assume is installed. Go, Rust and the rest are written by the agent to their
// own conventions and confirmed with hooks/stack.mjs, which is step 4 of Stage 0.
//
// Everything happens under os.tmpdir(). Nothing here touches this repository or the
// testbed (D21).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTestPlan } from '../../plugin/hooks/stack.mjs';

const PLAN_PATH = path.resolve(
  import.meta.dirname,
  '../../plugin/skills/new-project/assets/scaffold-plan.json',
);

/** P6.2 (issue #64): the guard the blank placeholder has to leave inert, unmodified. */
const GUARD_PATH = path.resolve(import.meta.dirname, '../../plugin/hooks/sandbox-guard.mjs');

const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));

/** The directory whose presence EN-14 is about. */
const OBSERVABILITY_DIR = 'logs';

// ---------------------------------------------------------------------------
// scratch space
// ---------------------------------------------------------------------------

const scratch = [];
after(() => {
  for (const dir of scratch) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* the OS reclaims it */
    }
  }
});

function tempDir(prefix = 'aeo-p61-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// The scaffolder, run the way SKILL.md tells the agent to run it
// ---------------------------------------------------------------------------

/** Resolve one step against the chosen stack's seed: its path, and its bytes. */
function materialize(step, seed) {
  if (step.from) {
    const entry = seed[step.from];
    assert.ok(entry, `scaffold-plan.json step declares from="${step.from}", which the seed does not define`);
    return { path: entry.path, content: entry.content };
  }
  if (step.authored) {
    // Authored files carry no content in the manifest and never will — that is the rule
    // keeping prose out of a data file. Standing in for the agent here is honest and
    // deliberate: nothing below asserts anything about what these two files say.
    return { path: step.path, content: `<!-- authored per project, placeholder for ${step.path} -->\n` };
  }
  const extra = step.appendSeed ? (seed[step.appendSeed] ?? '') : '';
  return { path: step.path, content: `${step.content}${extra}` };
}

/**
 * Walk the shipped plan's stage-0 steps in array order and write the tree, exactly as
 * Stage 0 step 3 instructs. Returns the write log and the observability observations
 * made during the walk, both of which the ordering assertions read.
 */
function scaffoldStage0(root, stackId) {
  const seed = plan.seeds[stackId];
  assert.ok(seed, `scaffold-plan.json seeds no "${stackId}" stack`);

  const writeLog = [];
  const productWritesWithoutLogs = [];

  for (const step of plan.steps) {
    if (step.stage !== 0) continue;
    const { path: rel, content } = materialize(step, seed);

    if (step.role === 'product' && !existsSync(path.join(root, OBSERVABILITY_DIR))) {
      // Asked of the filesystem at the moment the product file is about to appear, not
      // inferred afterwards from the loop.
      productWritesWithoutLogs.push(rel);
    }

    const full = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
    writeLog.push({ path: rel, role: step.role });
  }

  return { writeLog, productWritesWithoutLogs };
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`,
  );
  return result.stdout.trim();
}

/** Stage 0 steps 4 through 6: confirm detection, run the suite, one commit on main. */
function world() {
  const root = tempDir();
  const emitted = scaffoldStage0(root, 'node');

  // A throwaway fixture repository, so identity and signing are pinned locally rather
  // than inherited from whatever the machine has configured.
  git(root, ['init', '-b', 'main']);
  git(root, ['add', '-A']);
  git(root, [
    '-c', 'user.name=AEO Test',
    '-c', 'user.email=aeo@example.invalid',
    '-c', 'commit.gpgsign=false',
    'commit', '-m', 'chore: scaffold the project',
  ]);

  const detected = resolveTestPlan({ toplevel: root, files: [] });

  return { root, ...emitted, detected };
}

const scaffolded = world();

// ---------------------------------------------------------------------------
// The manifest itself
// ---------------------------------------------------------------------------

describe('the shipped scaffold plan is data, not a prose template', () => {
  test('every authored step carries no content, and never gains one', () => {
    // The handbook and the README are written per project by the agent. A `content` key
    // appearing on either turns this asset into the generator CLAUDE.md forbids, and it
    // would do so silently, because the scaffold would keep working.
    const authored = plan.steps.filter((s) => s.authored);
    assert.ok(authored.length > 0, 'no authored steps declared — has CLAUDE.md left the plan?');
    for (const step of authored) {
      assert.equal(
        step.content,
        undefined,
        `step "${step.path}" is marked authored but carries content in scaffold-plan.json`,
      );
    }
  });

  test('the handbook is a stage-1 authored step', () => {
    const handbook = plan.steps.find((s) => s.role === 'handbook');
    assert.ok(handbook, 'no handbook step declared');
    assert.equal(handbook.path, 'CLAUDE.md');
    assert.equal(handbook.stage, 1);
    assert.equal(handbook.authored, true);
  });

  test('stage 0 declares product code for the ordering rule to be about', () => {
    // Without at least one product-code step the EN-14 assertion below would pass
    // vacuously, which is the failure mode L-08 keeps naming.
    const productSteps = plan.steps.filter((s) => s.stage === 0 && s.role === 'product');
    assert.ok(productSteps.length > 0, 'stage 0 declares no product-code steps');
  });
});

// ---------------------------------------------------------------------------
// EN-14 — logs/ before any product code
// ---------------------------------------------------------------------------

describe('the emitted tree puts logs/ before any product code (EN-14)', () => {
  test('logs/ was already on disk at every product-code write', () => {
    assert.deepEqual(
      scaffolded.productWritesWithoutLogs,
      [],
      'these product-code files were written while logs/ did not yet exist: ' +
        `${scaffolded.productWritesWithoutLogs.join(', ')}. EN-14 requires logs/ first.`,
    );
  });

  test('the write log records logs/ ahead of every product-code path', () => {
    const logsIndex = scaffolded.writeLog.findIndex((w) => w.path.startsWith(`${OBSERVABILITY_DIR}/`));
    assert.notEqual(logsIndex, -1, `nothing under ${OBSERVABILITY_DIR}/ was written at all`);

    scaffolded.writeLog.forEach((entry, index) => {
      if (entry.role !== 'product') return;
      assert.ok(
        logsIndex < index,
        `${entry.path} (product code, position ${index}) was written before ` +
          `${OBSERVABILITY_DIR}/ (position ${logsIndex})`,
      );
    });
  });

  test('logs/ survives into the committed tree', () => {
    // A .gitkeep that .gitignore swallows leaves an empty directory git never records,
    // so the next clone has no logs/ at all.
    const tracked = git(scaffolded.root, ['ls-files']).split(/\r?\n/);
    assert.ok(
      tracked.some((f) => f.startsWith(`${OBSERVABILITY_DIR}/`)),
      `nothing under ${OBSERVABILITY_DIR}/ is tracked: ${tracked.join(', ')}`,
    );
  });
});

// ---------------------------------------------------------------------------
// The declared shape
// ---------------------------------------------------------------------------

describe('the emitted tree has the declared shape', () => {
  test('every stage-0 path exists on disk', () => {
    for (const entry of scaffolded.writeLog) {
      assert.ok(
        existsSync(path.join(scaffolded.root, ...entry.path.split('/'))),
        `${entry.path} is in the write log but not on disk`,
      );
    }
  });

  test('the stage-1 handbook is not part of stage 0', () => {
    assert.equal(
      existsSync(path.join(scaffolded.root, 'CLAUDE.md')),
      false,
      'CLAUDE.md exists after stage 0; the handbook is stage 1, behind its own checkpoint',
    );
  });

  test('no project config file is emitted (D10)', () => {
    // Detection, no config file. A file the plugin reads per project is the tripwire-2
    // case D10 rejected outright, and it would be easiest to add here.
    const forbidden = ['aeo.config.json', 'aeo.config.js', '.aeorc', '.aeo.json', 'aeo.json'];
    for (const name of forbidden) {
      assert.equal(
        existsSync(path.join(scaffolded.root, name)),
        false,
        `${name} was emitted; D10 says detection, no project config file`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// P6.2 (issue #64) — the sandbox variables are declared blank at scaffold time
// ---------------------------------------------------------------------------
//
// The defect this closes: sandbox-guard.mjs only fires once AEO_LIVE_DATA_ROOT is set,
// and a freshly scaffolded project had no step that set it, so a new install shipped a
// wired guard protecting nothing. The fix writes .claude/settings.json with both
// variables present and blank — visible in a file the founder is already reading,
// rather than an absent variable they would have to know to add. These tests cover the
// file that actually lands on disk, not the intention behind it.

describe('the sandbox variables are declared blank at scaffold time (P6.2, issue #64)', () => {
  const settingsRelPath = '.claude/settings.json';
  const settingsAbsPath = () => path.join(scaffolded.root, ...settingsRelPath.split('/'));

  test('.claude/settings.json was written by the plan and exists on disk', () => {
    assert.ok(
      scaffolded.writeLog.some((w) => w.path === settingsRelPath),
      `${settingsRelPath} is not in the write log; has the scaffold-plan.json step gone missing?`,
    );
    assert.ok(existsSync(settingsAbsPath()), `${settingsRelPath} is in the write log but not on disk`);
  });

  test('it parses as JSON and declares both sandbox variables as an explicit, blank placeholder', () => {
    const parsed = JSON.parse(readFileSync(settingsAbsPath(), 'utf8'));
    assert.deepEqual(
      parsed.env,
      { AEO_LIVE_DATA_ROOT: '', AEO_DATA_ROOT: '' },
      `${settingsRelPath} does not declare AEO_LIVE_DATA_ROOT and AEO_DATA_ROOT as a blank pair`,
    );
  });

  // Not an assumption about sandbox-guard.mjs — the real gate, spawned the way hooks.json
  // wires it, fed exactly the pair the scaffold just wrote. readRoot() in sandbox-guard.mjs
  // treats an empty string the same as an absent variable, so this placeholder must leave
  // the guard exactly as inert as a fresh install with no .claude/settings.json at all,
  // never accidentally armed into refusing everything.
  test('the blank placeholder leaves sandbox-guard inert, the same as no declaration at all', () => {
    const parsed = JSON.parse(readFileSync(settingsAbsPath(), 'utf8'));
    const payload = {
      hook_event_name: 'PreToolUse',
      cwd: scaffolded.root,
      tool_name: 'Bash',
      tool_input: { command: 'echo ok' },
    };
    const childEnv = {
      ...process.env,
      CLAUDE_PROJECT_DIR: '',
      AEO_LIVE_DATA_ROOT: parsed.env.AEO_LIVE_DATA_ROOT,
      AEO_DATA_ROOT: parsed.env.AEO_DATA_ROOT,
    };
    const r = spawnSync(process.execPath, [GUARD_PATH], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      cwd: scaffolded.root,
      env: childEnv,
      windowsHide: true,
    });
    assert.equal(
      r.status,
      0,
      `sandbox-guard blocked an ordinary command with the scaffolded blank placeholder:\n${r.stderr}`,
    );
  });

  test('.claude/settings.json is tracked in the committed tree, unlike settings.local.json', () => {
    const tracked = git(scaffolded.root, ['ls-files']).split(/\r?\n/);
    assert.ok(
      tracked.includes(settingsRelPath),
      `${settingsRelPath} is not tracked in git: ${tracked.join(', ')}`,
    );
  });

  test('.claude/settings.json is written before any product code, same as the rest of EN-14', () => {
    const settingsIndex = scaffolded.writeLog.findIndex((w) => w.path === settingsRelPath);
    assert.notEqual(settingsIndex, -1, `${settingsRelPath} never appeared in the write log`);
    scaffolded.writeLog.forEach((entry, index) => {
      if (entry.role !== 'product') return;
      assert.ok(
        settingsIndex < index,
        `${entry.path} (product code, position ${index}) was written before ` +
          `${settingsRelPath} (position ${settingsIndex})`,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// One commit, on main
// ---------------------------------------------------------------------------

describe('the scaffold lands exactly one commit on main', () => {
  test('one commit', () => {
    const log = git(scaffolded.root, ['log', '--oneline']).split(/\r?\n/).filter(Boolean);
    assert.equal(log.length, 1, `expected one commit, found ${log.length}: ${log.join(' | ')}`);
  });

  test('on main', () => {
    assert.equal(git(scaffolded.root, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
  });

  test('nothing is left uncommitted', () => {
    assert.equal(git(scaffolded.root, ['status', '--porcelain']), '');
  });
});

// ---------------------------------------------------------------------------
// The gate can see the project, and the suite it resolves is green
// ---------------------------------------------------------------------------

describe('the emitted tree is detectable and green', () => {
  test('stack.mjs resolves exactly one test command from the scaffold', () => {
    // Step 4 of Stage 0. If this resolves nothing, the commit gate blocks every commit
    // in the new project and the founder finds out on their first change.
    const { units, missing } = scaffolded.detected;
    assert.deepEqual(missing, [], `stack.mjs found no manifest for: ${missing.join(', ')}`);
    assert.equal(units.length, 1, `expected one resolved unit, got ${units.length}`);
    assert.ok(
      Array.isArray(units[0].command) && units[0].command.length > 0,
      `stack.mjs resolved no command: ${units[0].reason}`,
    );
  });

  test('that command runs green', () => {
    const [program, ...args] = scaffolded.detected.units[0].command;
    const result = spawnSync(program, args, {
      cwd: scaffolded.root,
      encoding: 'utf8',
      windowsHide: true,
      // Windows cannot spawn npm or any other .cmd shim without a shell, the same
      // reasoning commit-gate.mjs records at its own spawn.
      shell: process.platform === 'win32',
    });
    assert.equal(
      result.status,
      0,
      `${[program, ...args].join(' ')} exited ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  });
});
