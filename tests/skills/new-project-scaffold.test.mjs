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
// own conventions — manifest, first test, and the aeo-tests.json recording how to run it —
// and confirmed with hooks/stack.mjs, which is step 4 of Stage 0.
//
// Everything happens under os.tmpdir(). Nothing here touches this repository or the
// testbed (D21).

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { HEADER_LINE, parseCommitments } from '../../plugin/hooks/commitments.mjs';
import { resolveTestPlan } from '../../plugin/hooks/stack.mjs';
import { parseStatusTable } from '../../plugin/hooks/status-table.mjs';

const PLAN_PATH = path.resolve(
  import.meta.dirname,
  '../../plugin/skills/new-project/assets/scaffold-plan.json',
);

/** P6.2 (issue #64): the guard the blank placeholder has to leave inert, unmodified. */
const GUARD_PATH = path.resolve(import.meta.dirname, '../../plugin/hooks/sandbox-guard.mjs');

/** issue #199: the answer sets and the bodies this test stands in for the agent with. */
const ANSWERS_PATH = path.resolve(import.meta.dirname, '../fixtures/new-project/oracle-answers.json');

const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
const CASES = JSON.parse(readFileSync(ANSWERS_PATH, 'utf8')).cases;

/** session-status.mjs, run below against a scaffolded project the way a session would. */
const SESSION_STATUS_PATH = path.resolve(import.meta.dirname, '../../plugin/hooks/session-status.mjs');

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

/**
 * Whether a step applies under an answer set (issue #199). A step with no `when` always
 * applies; a step with one applies only when every key's answer is in its list. This is
 * the whole of the condition mechanism, and it is deliberately that small: the plan
 * declares which files a project gets, and the answers decide, with no expression
 * language to learn or to get wrong.
 */
function stepApplies(step, answers) {
  if (!step.when) return true;
  return Object.entries(step.when).every(([key, values]) => values.includes(answers[key]));
}

/** Resolve one step against the chosen stack's seed: its path, and its bytes. */
function materialize(step, seed, authoredBodies) {
  if (step.from) {
    const entry = seed[step.from];
    assert.ok(entry, `scaffold-plan.json step declares from="${step.from}", which the seed does not define`);
    return { path: entry.path, content: entry.content };
  }
  if (step.authored) {
    // Authored files carry no content in the manifest and never will — that is the rule
    // keeping prose out of a data file. The agent writes them per project; this test
    // stands in for the agent with a body from tests/fixtures/new-project/
    // oracle-answers.json, which is where the words live so that the shipped plan stays
    // data. Nothing below asserts a sentence: what is asserted is the marker each step's
    // `requires` declares, which is what a sensorium reader matches on.
    const body = authoredBodies[step.path];
    assert.ok(
      body !== undefined,
      `the answer fixture supplies no body for authored step "${step.path}"`,
    );
    return { path: step.path, content: body };
  }
  const extra = step.appendSeed ? (seed[step.appendSeed] ?? '') : '';
  return { path: step.path, content: `${step.content}${extra}` };
}

/**
 * Step 3's opening rule (issue #124), run before the plan's `steps` array is walked at
 * all: file the founder's own Markdown documents — a PRD, a spec, a research note — out
 * of the project root and into `founderDocs.destination`, skipping the fixed exclude
 * list. Returns what moved and what could not move because the destination already held
 * a file of that name, which is what the Stage-0 report names as a conflict rather than
 * silently overwriting.
 */
function discoverFounderDocs(root, founderPlan) {
  const rule = founderPlan.founderDocs;
  assert.ok(rule, 'scaffold-plan.json declares no founderDocs rule');
  const exclude = new Set(rule.excludeAtRoot.map((n) => n.toLowerCase()));
  const destDir = path.join(root, ...rule.destination.split('/'));

  const moved = [];
  const conflicts = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.md')) continue;
    if (exclude.has(entry.name.toLowerCase())) continue;

    const from = path.join(root, entry.name);
    const to = path.join(destDir, entry.name);

    if (existsSync(to)) {
      conflicts.push({ path: entry.name, reason: `${rule.destination}/${entry.name} already exists` });
      continue;
    }

    mkdirSync(destDir, { recursive: true });
    renameSync(from, to);
    moved.push({ from: entry.name, to: `${rule.destination}/${entry.name}` });
  }

  return { moved, conflicts };
}

/**
 * Walk the shipped plan's stage-0 steps in array order and write the tree, exactly as
 * Stage 0 step 3 instructs. Returns the write log and the observability observations
 * made during the walk, both of which the ordering assertions read.
 */
function scaffoldStage0(root, stackId, answers = CASES['founder-as-reader-no-money'].answers, authoredBodies = CASES['founder-as-reader-no-money'].authored) {
  const seed = plan.seeds[stackId];
  assert.ok(seed, `scaffold-plan.json seeds no "${stackId}" stack`);

  const founderDocs = discoverFounderDocs(root, plan);

  const writeLog = [];
  const productWritesWithoutLogs = [];
  const skipped = [];

  for (const step of plan.steps) {
    if (step.stage !== 0) continue;
    if (!stepApplies(step, answers)) {
      skipped.push(step.path ?? `from=${step.from}`);
      continue;
    }
    const { path: rel, content } = materialize(step, seed, authoredBodies);

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

  return { writeLog, productWritesWithoutLogs, founderDocs, skipped };
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
function world(caseName = 'founder-as-reader-no-money', prefix = 'aeo-p61-') {
  const root = tempDir(prefix);
  const answerCase = CASES[caseName];
  assert.ok(answerCase, `the answer fixture declares no case "${caseName}"`);
  const emitted = scaffoldStage0(root, 'node', answerCase.answers, answerCase.authored);

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

  return { root, ...emitted, detected, answers: answerCase.answers };
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

  test('the only file this plugin reads per project is the test record (D10)', () => {
    // A general per-project config file is the tripwire-2 case D10 rejected outright, and
    // it would be easiest to add here. The record is the one exception D29 argued for,
    // and it is bounded by holding exactly one key.
    const forbidden = ['aeo.config.json', 'aeo.config.js', '.aeorc', '.aeo.json', 'aeo.json'];
    for (const name of forbidden) {
      assert.equal(
        existsSync(path.join(scaffolded.root, name)),
        false,
        `${name} was emitted; D10 ships a recorded test command, not a project config file`,
      );
    }
    const record = JSON.parse(readFileSync(path.join(scaffolded.root, 'aeo-tests.json'), 'utf8'));
    assert.deepEqual(
      Object.keys(record),
      ['test'],
      'aeo-tests.json carries a key beyond the recorded command; that is the config file D10 refuses',
    );
  });
});

// ---------------------------------------------------------------------------
// issue #124 — the founder's own documents are filed under docs/, before the first commit
// ---------------------------------------------------------------------------
//
// Triage's correction to the issue as filed: new-project never read a founder's PRD and
// "left it where it found it" — Stage 0 step 2 only ever branches on empty-directory vs.
// existing-project, and nothing scanned the root at all, which is why a PRD dropped there
// survived untouched. This is the feature that scan never was, not a bug fix to one that
// existed. Checkpoint 6's live run only ever exercised the empty-directory case, which is
// why nobody noticed.
//
// Seeds a temp root with founder-written documents before scaffoldStage0 runs, the way a
// founder actually encounters this: they write a PRD, then start the skill.

function seedFile(root, rel, content) {
  const full = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

/** Same shape as world(), but the root already holds founder documents before step 3 runs. */
function worldWithFounderDocs(rootFiles, preExistingDocsFiles = []) {
  const root = tempDir('aeo-124-');

  for (const [rel, content] of Object.entries(preExistingDocsFiles)) {
    seedFile(root, `docs/${rel}`, content);
  }
  for (const [rel, content] of Object.entries(rootFiles)) {
    seedFile(root, rel, content);
  }

  const emitted = scaffoldStage0(root, 'node');

  git(root, ['init', '-b', 'main']);
  git(root, ['add', '-A']);
  git(root, [
    '-c', 'user.name=AEO Test',
    '-c', 'user.email=aeo@example.invalid',
    '-c', 'commit.gpgsign=false',
    'commit', '-m', 'chore: scaffold the project',
  ]);

  return { root, ...emitted };
}

describe('founder documents already in the root move under docs/ before the first commit', () => {
  test('a PRD and a research note move to docs/, keeping their content', () => {
    const w = worldWithFounderDocs({
      'PRD.md': '# Product Requirements\n',
      'research-notes.md': '# Notes\n',
    });

    assert.deepEqual(
      w.founderDocs.conflicts,
      [],
      `unexpected conflicts: ${JSON.stringify(w.founderDocs.conflicts)}`,
    );
    assert.deepEqual(
      w.founderDocs.moved.map((m) => m.to).sort(),
      ['docs/PRD.md', 'docs/research-notes.md'],
    );

    for (const name of ['PRD.md', 'research-notes.md']) {
      assert.equal(existsSync(path.join(w.root, name)), false, `${name} still sits at the root`);
      assert.ok(existsSync(path.join(w.root, 'docs', name)), `docs/${name} was not created`);
    }
    assert.equal(
      readFileSync(path.join(w.root, 'docs', 'PRD.md'), 'utf8'),
      '# Product Requirements\n',
      'the moved PRD lost or changed its content',
    );

    const tracked = git(w.root, ['ls-files']).split(/\r?\n/);
    assert.ok(tracked.includes('docs/PRD.md'), 'docs/PRD.md is not in the first commit');
    assert.ok(tracked.includes('docs/research-notes.md'), 'docs/research-notes.md is not in the first commit');
    assert.ok(!tracked.includes('PRD.md'), 'PRD.md is still tracked at the root');

    // Before the commit, not after: nothing at the root path ever appears in the tree
    // this repository's history holds, so there is no confusing move-after-the-fact.
    const rootHistory = git(w.root, ['log', '--follow', '--name-only', '--pretty=format:', '--', 'PRD.md']);
    assert.equal(rootHistory, '', 'PRD.md appears in history at the root; the move happened after the commit');
  });

  test('README.md, CLAUDE.md, and the tooling-reserved root names are left alone', () => {
    const w = worldWithFounderDocs({
      'LICENSE.md': '# MIT\n',
      'CONTRIBUTING.md': '# Contributing\n',
    });

    assert.deepEqual(w.founderDocs.moved, [], 'an excluded root name was moved');
    assert.ok(existsSync(path.join(w.root, 'LICENSE.md')), 'LICENSE.md was moved off the root');
    assert.ok(existsSync(path.join(w.root, 'CONTRIBUTING.md')), 'CONTRIBUTING.md was moved off the root');
    assert.equal(existsSync(path.join(w.root, 'docs', 'LICENSE.md')), false);
    assert.equal(existsSync(path.join(w.root, 'docs', 'CONTRIBUTING.md')), false);
  });

  test('a non-Markdown file at the root is left where it is', () => {
    const w = worldWithFounderDocs({ 'diagram.png': 'not really a png, just bytes\n' });

    assert.deepEqual(w.founderDocs.moved, []);
    assert.ok(existsSync(path.join(w.root, 'diagram.png')), 'a non-Markdown founder file was moved');
  });

  test('a name collision with an existing docs/ file is left at the root and reported, not overwritten', () => {
    const w = worldWithFounderDocs(
      { 'PRD.md': 'the founder’s new draft\n' },
      { 'PRD.md': 'an existing docs/PRD.md this project already had\n' },
    );

    assert.equal(w.founderDocs.moved.length, 0, 'the colliding file should not have been moved');
    assert.equal(w.founderDocs.conflicts.length, 1, 'the collision was not reported');
    assert.equal(w.founderDocs.conflicts[0].path, 'PRD.md');

    assert.equal(
      readFileSync(path.join(w.root, 'PRD.md'), 'utf8'),
      'the founder’s new draft\n',
      'the founder’s file at the root should be untouched',
    );
    assert.equal(
      readFileSync(path.join(w.root, 'docs', 'PRD.md'), 'utf8'),
      'an existing docs/PRD.md this project already had\n',
      'the pre-existing docs/PRD.md was overwritten instead of being left alone',
    );
  });

  test('a scaffold with no founder documents at all reports nothing moved and no conflicts', () => {
    // scaffolded is the plain empty-directory world already built above; asserting on it
    // here is what proves the new rule is a no-op for the ordinary case, not just quiet
    // when nobody looked.
    assert.deepEqual(scaffolded.founderDocs, { moved: [], conflicts: [] });
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
  // treats an empty string as an explicit disarm, so this placeholder must leave the guard
  // inert. That is NOT the same state as no .claude/settings.json at all: a blank value in
  // the file beats an exported AEO_LIVE_DATA_ROOT, where an absent key falls back to it (D33).
  // Same outcome as an absent key here, for a different reason: the scaffold exports nothing.
  test('the blank placeholder leaves sandbox-guard inert', () => {
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

describe('the emitted tree records a test command, and that command is green', () => {
  test('stack.mjs resolves exactly one recorded command from the scaffold', () => {
    // Step 4 of Stage 0. If this resolves nothing, sandbox-guard cannot recognise the
    // new project's suite, and the founder finds out during their first live job.
    const { units, missing } = scaffolded.detected;
    assert.deepEqual(missing, [], `stack.mjs found no aeo-tests.json for: ${missing.join(', ')}`);
    assert.equal(units.length, 1, `expected one resolved unit, got ${units.length}`);
    assert.equal(
      typeof units[0].command === 'string' && units[0].command.length > 0,
      true,
      `stack.mjs resolved no command: ${units[0].reason}`,
    );
    assert.equal(units[0].root, scaffolded.root, 'the record resolves somewhere other than the project root');
  });

  test('that command runs green', () => {
    const command = scaffolded.detected.units[0].command;
    const result = spawnSync(command, [], {
      cwd: scaffolded.root,
      encoding: 'utf8',
      windowsHide: true,
      // The recorded command is a command line, so it goes through a shell.
      shell: true,
    });
    assert.equal(
      result.status,
      0,
      `${command} exited ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  });
});

// ---------------------------------------------------------------------------
// issue #199 — the oracle answer, the four files it writes, and what the
// sensorium reads back out of the scaffolded project
// ---------------------------------------------------------------------------
//
// The scaffold is where the goal enters the project (PLAN.md section 3). Before this
// slice a scaffolded repository had no status table, no kill line, no ledger and no
// commitment file, so its first session start printed "none declared" on every line the
// sensorium exists to fill. These tests walk the plan with each of the two answer sets
// the acceptance criterion names and then run the real hook against the tree, because
// the tree is only half the claim: what matters is that the readers in plugin/hooks/
// find what the scaffold left them.
//
// `scaffolded` above is already the founder-as-reader, no-money case, so the ordering,
// shape, commit and sandbox assertions earlier in this file all run over a tree that
// carries the four files too.

/** The four files, and the reader in plugin/hooks/ that each one exists for. */
const ORACLE_FILES = ['RULES.md', 'PLAN.md', 'LEDGER.md', 'COMMITMENTS.md'];

const withCeiling = world('founder-as-reader-with-ceiling', 'aeo-199-');

/**
 * session-status.mjs run against a scaffolded project the way a session start runs it.
 * gh is pointed at a command that does not exist, so the live repo sections report
 * "could not tell" rather than reaching the network; the sensorium block does not touch
 * gh at all and is what these tests read.
 */
function sessionStatus(root) {
  const env = { ...process.env };
  env.CLAUDE_PROJECT_DIR = '';
  env.CLAUDE_PLUGIN_ROOT = path.resolve(import.meta.dirname, '../../plugin');
  env.AEO_GH_COMMAND = 'aeo-gh-that-does-not-exist';
  delete env.AEO_GH_PREFIX_ARGS;
  delete env.AEO_LIVE_DATA_ROOT;
  delete env.AEO_DATA_ROOT;

  const r = spawnSync(process.execPath, [SESSION_STATUS_PATH], {
    input: '',
    encoding: 'utf8',
    cwd: root,
    env,
    windowsHide: true,
  });
  assert.notEqual(r.stdout, '', `session-status.mjs produced no stdout (exited ${r.status}): ${r.stderr}`);
  return r.stdout.split(/\r?\n/);
}

/**
 * The sensorium block's own lines, from the first `score:` line to the end of the
 * unbroken run of sensorium lines after it. The gate-health section prints first (D8
 * outranks the consumer's number), so "begins with" in the acceptance criterion is about
 * this block, which is the same reading tests/skills/status-render-smoke.test.mjs
 * already takes for the other caller.
 */
function sensoriumBlock(lines) {
  const start = lines.findIndex((line) => line.startsWith('score:'));
  assert.notEqual(start, -1, `no score: line in session-status output:\n${lines.join('\n')}`);
  const end = lines.indexOf('', start);
  return lines.slice(start, end === -1 ? undefined : end);
}

describe('the scaffold writes the files the sensorium reads (issue #199)', () => {
  test('RULES.md holds a line starting with the Kill line label', () => {
    const rules = readFileSync(path.join(scaffolded.root, 'RULES.md'), 'utf8').split(/\r?\n/);
    assert.ok(
      rules.some((line) => line.trimStart().startsWith('**Kill line.**')),
      'RULES.md has no **Kill line.** item, so the sensorium prints "bar: none declared"',
    );
  });

  test('PLAN.md holds a status table under a Status heading with Phase, State and Score', () => {
    const table = parseStatusTable(readFileSync(path.join(scaffolded.root, 'PLAN.md'), 'utf8'));
    assert.ok(table, 'PLAN.md has no table under a Status heading whose header starts with Phase');
    const headers = table.headers.map((h) => h.toLowerCase());
    for (const column of ['phase', 'state', 'score']) {
      assert.ok(headers.includes(column), `the status table has no ${column} column: ${table.headers.join(' | ')}`);
    }
    assert.ok(table.rows.length > 0, 'the status table has no rows, so there are no phases to score');
  });

  test('COMMITMENTS.md exists with the phase 0 decision 4 header and no rows yet', () => {
    const markdown = readFileSync(path.join(scaffolded.root, 'COMMITMENTS.md'), 'utf8');
    assert.ok(markdown.includes(HEADER_LINE), `COMMITMENTS.md does not carry ${HEADER_LINE}`);
    assert.deepEqual(parseCommitments(markdown), [], 'a freshly scaffolded commitment ledger already has rows');
  });

  test('LEDGER.md is not written when the founder answers that money does not move', () => {
    assert.equal(scaffolded.answers.money, 'no');
    assert.equal(
      existsSync(path.join(scaffolded.root, 'LEDGER.md')),
      false,
      'LEDGER.md was written for a project whose answers say no money moves; the when condition did nothing',
    );
    assert.ok(
      scaffolded.skipped.includes('LEDGER.md'),
      `the walk did not report skipping LEDGER.md: ${scaffolded.skipped.join(', ')}`,
    );
  });

  test('every required marker a step declares is in the file that was written', () => {
    // The plan declares markers rather than bodies, so this is the one check that keeps
    // an authored file honest without pinning a sentence (D20).
    const declared = plan.steps.filter((s) => s.stage === 0 && Array.isArray(s.requires));
    assert.ok(declared.length > 0, 'no step declares requires markers, so this check measures nothing');
    for (const step of declared) {
      if (!scaffolded.writeLog.some((w) => w.path === step.path)) continue;
      const body = readFileSync(path.join(scaffolded.root, ...step.path.split('/')), 'utf8');
      for (const marker of step.requires) {
        assert.ok(body.includes(marker), `${step.path} does not carry its required marker ${JSON.stringify(marker)}`);
      }
    }
  });

  test('all four files land in the one commit on main', () => {
    const tracked = git(scaffolded.root, ['ls-files']).split(/\r?\n/);
    for (const name of ['RULES.md', 'PLAN.md', 'COMMITMENTS.md']) {
      assert.ok(tracked.includes(name), `${name} is not in the first commit: ${tracked.join(', ')}`);
    }
    assert.ok(!tracked.includes('LEDGER.md'), 'LEDGER.md is tracked in a project whose answers say no money moves');
    assert.equal(git(scaffolded.root, ['log', '--oneline']).split(/\r?\n/).filter(Boolean).length, 1);
    assert.equal(git(scaffolded.root, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
  });
});

describe('the sensorium reads the scaffolded project, not "none declared" (issue #199)', () => {
  const lines = sessionStatus(scaffolded.root);
  const block = sensoriumBlock(lines);

  test('the block begins with the score, counted out of the scaffolded phases', () => {
    assert.match(
      block[0],
      /^score: 0 of \d+ phases done$/,
      `the sensorium's first line is "${block[0]}", not a score out of the scaffolded phases`,
    );
  });

  test('the bar is the kill line’s own sentence', () => {
    const bar = block.find((line) => line.startsWith('bar:'));
    assert.ok(bar, `no bar: line in the sensorium block:\n${block.join('\n')}`);

    // Read out of the file the scaffold wrote, so this pins the mechanism rather than a
    // sentence: change the fixture's kill line and this still holds.
    const rules = readFileSync(path.join(scaffolded.root, 'RULES.md'), 'utf8');
    const after = rules.slice(rules.indexOf('**Kill line.**') + '**Kill line.**'.length);
    const paragraph = after.split(/\r?\n[ \t]*\r?\n/)[0].replace(/\s+/g, ' ').trim();
    const sentence = /^(.*?[.!?])(\s|$)/.exec(paragraph)[1];
    assert.equal(bar, `bar: ${sentence}`);
  });

  test('the commitment ledger is present and empty, so the newest row is none declared', () => {
    assert.ok(
      block.includes('commitment: none declared'),
      `the sensorium does not print "commitment: none declared":\n${block.join('\n')}`,
    );
  });

  test('dollars stay none declared while the answers say no money moves', () => {
    assert.ok(
      block.includes('dollars: none declared'),
      `the sensorium reports dollars for a project with no LEDGER.md:\n${block.join('\n')}`,
    );
  });
});

describe('a money answer of yes writes the ledger and the sensorium reads it (issue #199)', () => {
  test('LEDGER.md exists and its first line carries the declared ceiling', () => {
    const first = readFileSync(path.join(withCeiling.root, 'LEDGER.md'), 'utf8').split(/\r?\n/)[0];
    assert.ok(
      first.includes(`Ceiling $${withCeiling.answers.ceiling}`),
      `LEDGER.md's first line is "${first}", which does not carry Ceiling $${withCeiling.answers.ceiling}`,
    );
  });

  test('the sensorium prints nothing spent against that ceiling', () => {
    const block = sensoriumBlock(sessionStatus(withCeiling.root));
    const dollars = block.find((line) => line.startsWith('dollars:'));
    assert.ok(dollars, `no dollars: line in the sensorium block:\n${block.join('\n')}`);
    // Two decimals is 20-dollars.mjs's shipped rendering (phase 2) and is not this
    // slice's to change; what is asserted is zero spent of the declared ceiling.
    assert.match(dollars, /^dollars: 0(\.00)? of 50\b/, `the sensorium printed "${dollars}"`);
  });

  test('the ledger lands in the one commit on main', () => {
    const tracked = git(withCeiling.root, ['ls-files']).split(/\r?\n/);
    assert.ok(tracked.includes('LEDGER.md'), `LEDGER.md is not in the first commit: ${tracked.join(', ')}`);
    assert.equal(git(withCeiling.root, ['log', '--oneline']).split(/\r?\n/).filter(Boolean).length, 1);
    assert.equal(git(withCeiling.root, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
  });
});
