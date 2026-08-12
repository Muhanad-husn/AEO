// Tests for evals/grade-plugin.mjs — the P2.M acceptance grader.
//
// D20 says skills are prose and prose gets no unit tests. evals/grade-plugin.mjs is not
// prose, it is executable code that decides pass/fail against real files, so it keeps
// coverage the same way plugin/hooks/ and plugin/skills/*/scripts/ do.
//
// docs/EVIDENCE.md L-10: "a test without a positive control pins plumbing, not
// judgment." Every group below has both directions — a synthetic tree built to satisfy
// every rule, proven to pass whole (the grader does not cry wolf), and a mutation of
// exactly one fact, proven to fail exactly the expectation that names it and nothing
// else. A grader shown only a passing tree has never been shown to fail; these fixtures
// are built fresh per test rather than reused, so a mutation in one test cannot leak into
// another.
//
// All in-process: gradePlugin() is called directly against a temp-directory fixture, no
// subprocess spawned. That is why this file sits in the fast tier (D17).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { gradePlugin } from '../../evals/grade-plugin.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// Scratch space
// ---------------------------------------------------------------------------

const scratch = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aeo-p2m-grader-'));
  scratch.push(dir);
  return dir;
}

function write(root, relPath, content) {
  const full = path.join(root, ...relPath.split('/'));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

// ---------------------------------------------------------------------------
// The golden fixture: a plugin root that satisfies every rule the grader checks.
// Real skill names are reused (the seven lanes plus seven real description-triggered skills)
// so the fixture reads like a miniature, honest plugin rather than an arbitrary shape.
// ---------------------------------------------------------------------------

const LANES = ['sprint-plan', 'sprint-start', 'fix', 'review', 'triage', 'status', 'verify'];
const OTHER_SKILLS = ['red-green-refactor', 'tdd-plan', 'tdd-ci', 'safe-pr', 'safe-cleanup', 'monitor-design', 'worker-dispatch'];
const ALL_SKILLS = [...LANES, ...OTHER_SKILLS];

function skillFrontmatter(name, { lane }) {
  const lines = ['---', `name: ${name}`, `description: Fixture description for ${name}, long enough to be non-empty.`];
  if (lane) lines.push('disable-model-invocation: true');
  lines.push('---', '', `# ${name}`, '', 'Fixture body.', '');
  return lines.join('\n');
}

function agentFrontmatter({ name, tools, model, extra = '', body = '' }) {
  const lines = ['---', `name: ${name}`, `description: Fixture ${name} agent.`, `tools: ${tools}`, `model: ${model}`];
  if (extra) lines.push(extra);
  lines.push('---', '', `# ${name}`, '');
  if (body) lines.push(body, '');
  return lines.join('\n');
}

/** Build a fresh, fully-passing plugin root and return its path. */
function makeGoldenPluginRoot() {
  const root = tempDir();

  write(root, '.claude-plugin/plugin.json', JSON.stringify({
    $schema: 'https://json.schemastore.org/claude-code-plugin-manifest.json',
    name: 'fixture',
    version: '0.0.1',
  }, null, 2));

  for (const name of ALL_SKILLS) {
    write(root, `skills/${name}/SKILL.md`, skillFrontmatter(name, { lane: LANES.includes(name) }));
  }
  // One skill carries a ${CLAUDE_PLUGIN_ROOT} reference to a file that genuinely exists,
  // so the path-resolution check has something real to verify rather than only ever
  // seeing the vacuous "nothing to check" case.
  write(root, 'skills/tdd-plan/references/guide.md', '# guide\n');
  write(
    root,
    'skills/tdd-plan/SKILL.md',
    skillFrontmatter('tdd-plan', { lane: false }).replace(
      'Fixture body.',
      'See `${CLAUDE_PLUGIN_ROOT}/skills/tdd-plan/references/guide.md` for detail.',
    ),
  );

  write(root, 'agents/builder.md', agentFrontmatter({ name: 'builder', tools: 'Read, Grep, Glob, Edit, Write, Bash', model: 'sonnet' }));
  write(root, 'agents/reviewer.md', agentFrontmatter({ name: 'reviewer', tools: 'Read', model: 'opus' }));
  write(root, 'agents/triage.md', agentFrontmatter({ name: 'triage', tools: 'Read, Grep, Glob, Bash', model: 'haiku' }));
  write(root, 'agents/verifier.md', agentFrontmatter({ name: 'verifier', tools: 'Read', model: 'opus' }));
  // The fourth agent carries a ${CLAUDE_PLUGIN_ROOT} reference to a script that exists in
  // this fixture, so the path-resolution scan is exercised non-vacuously over an AGENT file
  // and not only over a skill directory. The real monitor-designer charter points at the
  // generic monitor the same way, which is what made that gap load-bearing.
  write(root, 'scripts/run-monitor.mjs', '// stub monitor\n');
  write(root, 'agents/monitor-designer.md', agentFrontmatter({
    name: 'monitor-designer',
    tools: 'Read, Grep, Glob, Edit, Write, Bash',
    model: 'sonnet',
    body: 'Builds on `${CLAUDE_PLUGIN_ROOT}/scripts/run-monitor.mjs`.',
  }));

  write(root, 'hooks/fake-gate.mjs', '// stub gate\n');
  write(root, 'hooks/hooks.json', JSON.stringify({
    description: 'fixture',
    hooks: {
      PreToolUse: [
        {
          matcher: '^(Bash|PowerShell)$',
          hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/fake-gate.mjs'] }],
        },
      ],
    },
  }, null, 2));

  return root;
}

/** The named expectation's `passed` flag, or throws if no expectation matches the substring. */
function passedFor(report, textSubstring) {
  const matches = report.expectations.filter((e) => e.text.includes(textSubstring));
  assert.ok(matches.length > 0, `no expectation text contains ${JSON.stringify(textSubstring)}`);
  return matches;
}

function failingTexts(report) {
  return report.expectations.filter((e) => !e.passed).map((e) => e.text);
}

// ---------------------------------------------------------------------------
// The positive control: the golden tree passes everything
// ---------------------------------------------------------------------------

describe('positive control: a fully-conforming plugin root', () => {
  test('every expectation passes', () => {
    const report = gradePlugin(makeGoldenPluginRoot());
    assert.deepEqual(failingTexts(report), []);
    assert.equal(report.summary.failed, 0);
    assert.ok(report.summary.total > 0);
  });

  test('the envelope has the shape the old grader emitted: { expectations: [{text, passed, evidence}] }', () => {
    const report = gradePlugin(makeGoldenPluginRoot());
    assert.ok(Array.isArray(report.expectations));
    assert.ok(report.expectations.length > 0);
    for (const e of report.expectations) {
      assert.equal(typeof e.text, 'string');
      assert.equal(typeof e.passed, 'boolean');
      assert.equal(typeof e.evidence, 'string');
    }
  });

  test('an mcp__ tool in an agent\'s tools: is not flagged as dropped (C-07)', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'agents/builder.md', agentFrontmatter({
      name: 'builder',
      tools: 'Read, Grep, Glob, Edit, Write, Bash, mcp__github__create_pull_request',
      model: 'sonnet',
    }));
    const report = gradePlugin(root);
    const [check] = passedFor(report, "agents/builder.md's tools:");
    assert.equal(check.passed, true, check.evidence);
  });
});

// ---------------------------------------------------------------------------
// plugin.json (C-09)
// ---------------------------------------------------------------------------

describe('plugin.json (C-09)', () => {
  test('missing plugin.json fails existence and cascades to name/version/$schema', () => {
    const root = makeGoldenPluginRoot();
    rmSync(path.join(root, '.claude-plugin', 'plugin.json'));
    const report = gradePlugin(root);
    assert.equal(passedFor(report, 'exists and parses as JSON')[0].passed, false);
    assert.equal(passedFor(report, 'declares a non-empty "name"')[0].passed, false);
    assert.equal(passedFor(report, 'declares an explicit, non-empty "version"')[0].passed, false);
    assert.equal(passedFor(report, 'declares "$schema"')[0].passed, false);
  });

  test('invalid JSON fails the parse check', () => {
    const root = makeGoldenPluginRoot();
    write(root, '.claude-plugin/plugin.json', '{ not json');
    const report = gradePlugin(root);
    assert.equal(passedFor(report, 'exists and parses as JSON')[0].passed, false);
  });

  test('missing version fails only the version check', () => {
    const root = makeGoldenPluginRoot();
    write(root, '.claude-plugin/plugin.json', JSON.stringify({
      $schema: 'https://json.schemastore.org/claude-code-plugin-manifest.json',
      name: 'fixture',
    }));
    const report = gradePlugin(root);
    assert.equal(passedFor(report, 'declares an explicit, non-empty "version"')[0].passed, false);
    assert.equal(passedFor(report, 'declares "$schema"')[0].passed, true);
    assert.equal(passedFor(report, 'declares a non-empty "name"')[0].passed, true);
  });

  test('missing $schema fails only the $schema check', () => {
    const root = makeGoldenPluginRoot();
    write(root, '.claude-plugin/plugin.json', JSON.stringify({ name: 'fixture', version: '0.0.1' }));
    const report = gradePlugin(root);
    assert.equal(passedFor(report, 'declares "$schema"')[0].passed, false);
    assert.equal(passedFor(report, 'declares an explicit, non-empty "version"')[0].passed, true);
  });
});

// ---------------------------------------------------------------------------
// Inventory: fourteen skills, five agents, no commands/
// ---------------------------------------------------------------------------

describe('inventory', () => {
  test('one skill short fails the skill-count expectation', () => {
    const root = makeGoldenPluginRoot();
    rmSync(path.join(root, 'skills', 'safe-cleanup'), { recursive: true, force: true });
    const report = gradePlugin(root);
    const check = passedFor(report, 'ships exactly 14 skills')[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /found 13/);
  });

  test('one agent short fails the agent-count expectation', () => {
    const root = makeGoldenPluginRoot();
    rmSync(path.join(root, 'agents', 'triage.md'));
    const report = gradePlugin(root);
    const check = passedFor(report, 'ships exactly 5 agents')[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /found 4/);
  });

  test('a commands/ directory fails the no-commands expectation (C-03 / D9)', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'commands/deploy.md', '# deploy\n');
    const report = gradePlugin(root);
    assert.equal(passedFor(report, 'ships no commands/ directory')[0].passed, false);
  });
});

// ---------------------------------------------------------------------------
// Per-skill: SKILL.md frontmatter and the six-lane split
// ---------------------------------------------------------------------------

describe('skill frontmatter', () => {
  test('a skill missing its description fails only that skill\'s name/description check', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'skills/fix/SKILL.md', '---\nname: fix\n---\n\nno description field\n');
    const report = gradePlugin(root);
    assert.equal(passedFor(report, 'skills/fix/SKILL.md declares')[0].passed, false);
    assert.equal(passedFor(report, 'skills/status/SKILL.md declares')[0].passed, true);
  });

  test('a lane skill missing disable-model-invocation: true fails the lane check (planted defect A)', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'skills/triage/SKILL.md', skillFrontmatter('triage', { lane: false }));
    const report = gradePlugin(root);
    const check = passedFor(report, 'skills/triage is an operator lane')[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /absent/);
  });

  test('a non-lane skill wrongly carrying disable-model-invocation: true fails the lane check (planted defect C)', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'skills/safe-pr/SKILL.md', skillFrontmatter('safe-pr', { lane: true }));
    const report = gradePlugin(root);
    const check = passedFor(report, 'skills/safe-pr is not an operator lane')[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /true/);
  });
});

// ---------------------------------------------------------------------------
// The frontmatter block parses as YAML (issue #52)
//
// The grader used to read frontmatter with a line regex that never established the block
// parsed. It reported `name="monitor-design", description=569 chars` for a file that loads
// with zero fields, and scored that tree whole. A silent gap says nothing; that printed a
// confident wrong number.
//
// Every malformation asserted below was confirmed against `claude plugin validate
// --strict` before it was written down, and every legal case below was confirmed to pass
// the same validator. That cross-check is a measurement, not a test: this file spawns no
// subprocess, which is what keeps it in the fast tier (D17). The cost is that nothing here
// re-derives the rule from the real parser, so a future YAML rule this list does not model
// is a gap, not a failure.
// ---------------------------------------------------------------------------

describe('frontmatter parses as YAML (issue #52)', () => {
  const brokenSkill = (name, descriptionLine) => ['---', `name: ${name}`, descriptionLine, '---', '', `# ${name}`, ''].join('\n');

  test('the golden tree passes a parse check for every skill and every agent', () => {
    const report = gradePlugin(makeGoldenPluginRoot());
    const checks = passedFor(report, 'frontmatter parses as YAML');
    assert.equal(checks.length, ALL_SKILLS.length + 5, 'one per skill and per agent');
    for (const c of checks) assert.equal(c.passed, true, `${c.text}: ${c.evidence}`);
  });

  // P15 in P7.2's positive control, and the live defect of issue #48: an unquoted ": "
  // reopens the parser in mapping context and the whole block fails.
  test('an unquoted ": " in a description fails the parse check and names the file', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'skills/monitor-design/SKILL.md', brokenSkill(
      'monitor-design',
      'description: Do not use to check on a run in progress: "is it still working" is the generic monitor.',
    ));
    const report = gradePlugin(root);
    const check = passedFor(report, 'skills/monitor-design/SKILL.md frontmatter parses as YAML')[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /monitor-design[\\/]SKILL\.md/);
    assert.match(check.evidence, /frontmatter did not parse/);
    assert.match(check.evidence, /": "/);
    // Every other skill is untouched.
    assert.equal(passedFor(report, 'skills/fix/SKILL.md frontmatter parses as YAML')[0].passed, true);
  });

  // P16: YAML forbids the tab character for indentation outright.
  test('a description continued on a tab-indented line fails the parse check', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'skills/monitor-design/SKILL.md', brokenSkill(
      'monitor-design',
      'description: A description that continues\n\tonto a tab-indented line.',
    ));
    const report = gradePlugin(root);
    const check = passedFor(report, 'skills/monitor-design/SKILL.md frontmatter parses as YAML')[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /tab/);
  });

  test('a value opening a quote it never closes fails the parse check', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'skills/safe-pr/SKILL.md', brokenSkill('safe-pr', 'description: "A description that never closes its quote.'));
    const report = gradePlugin(root);
    const check = passedFor(report, 'skills/safe-pr/SKILL.md frontmatter parses as YAML')[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /quote/);
  });

  test('a value ending in a bare ":" fails the parse check', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'skills/tdd-ci/SKILL.md', brokenSkill('tdd-ci', 'description: A description that ends with a colon:'));
    const report = gradePlugin(root);
    const check = passedFor(report, 'skills/tdd-ci/SKILL.md frontmatter parses as YAML')[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /dangling mapping key/);
  });

  // The point of the issue. A block that does not parse loads with no fields, so the
  // grader must not go on to report the text of a field that will not exist.
  test('a block that does not parse reports no field facts, and no character count', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'skills/monitor-design/SKILL.md', brokenSkill(
      'monitor-design',
      'description: Do not use to check on a run in progress: "is it still working".',
    ));
    const report = gradePlugin(root);
    const declares = passedFor(report, 'skills/monitor-design/SKILL.md declares')[0];
    assert.equal(declares.passed, false, 'a name the runtime never loads is not a declared name');
    assert.doesNotMatch(declares.evidence, /chars/);
    assert.match(declares.evidence, /did not parse/);
  });

  test('an agent whose block does not parse fails its parse check and its tools and model checks', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'agents/builder.md', [
      '---',
      'name: builder',
      'description: Takes work from issue to PR: test-first.',
      'tools: Read, Grep, Glob, Edit, Write, Bash',
      'model: sonnet',
      '---',
      '',
      '# builder',
      '',
    ].join('\n'));
    const report = gradePlugin(root);
    assert.equal(passedFor(report, 'agents/builder.md frontmatter parses as YAML')[0].passed, false);
    assert.equal(passedFor(report, "agents/builder.md's tools:")[0].passed, false);
    assert.equal(passedFor(report, 'agents/builder.md pins its model to an alias')[0].passed, false);
    assert.equal(passedFor(report, 'agents/reviewer.md frontmatter parses as YAML')[0].passed, true);
  });

  // The other direction, and the one that decides whether this check can be trusted: legal
  // YAML must not be reported as broken. All three of these pass the real validator.
  describe('legal YAML is not flagged', () => {
    test('a value folded onto a space-indented line parses', () => {
      const root = makeGoldenPluginRoot();
      write(root, 'skills/tdd-plan/SKILL.md', brokenSkill(
        'tdd-plan',
        'description: A description that continues\n  onto a space-indented line.',
      ));
      const check = passedFor(gradePlugin(root), 'skills/tdd-plan/SKILL.md frontmatter parses as YAML')[0];
      assert.equal(check.passed, true, check.evidence);
    });

    test('a nested mapping under a key parses (this is how the C-01 plant is written)', () => {
      const root = makeGoldenPluginRoot();
      write(root, 'agents/builder.md', agentFrontmatter({
        name: 'builder',
        tools: 'Read, Grep, Glob, Edit, Write, Bash',
        model: 'sonnet',
        extra: 'hooks:\n  PreToolUse: []',
      }));
      const report = gradePlugin(root);
      assert.equal(passedFor(report, 'agents/builder.md frontmatter parses as YAML')[0].passed, true);
      // And the nested block is still seen as a `hooks:` key, so C-01 still fires.
      assert.equal(passedFor(report, 'agents/builder.md carries none of hooks:')[0].passed, false);
    });

    test('a tab inside a value, rather than at the start of a line, parses', () => {
      const root = makeGoldenPluginRoot();
      write(root, 'skills/review/SKILL.md', brokenSkill('review', 'description: A description with a\ttab inside the value.'));
      const check = passedFor(gradePlugin(root), 'skills/review/SKILL.md frontmatter parses as YAML')[0];
      assert.equal(check.passed, true, check.evidence);
    });

    test('a ": " inside a quoted value parses, and the count excludes the quotes', () => {
      const root = makeGoldenPluginRoot();
      const inner = 'Do not use to check on a run in progress: is it still working.';
      write(root, 'skills/monitor-design/SKILL.md', brokenSkill('monitor-design', `description: "${inner}"`));
      const report = gradePlugin(root);
      assert.equal(passedFor(report, 'skills/monitor-design/SKILL.md frontmatter parses as YAML')[0].passed, true);
      assert.match(passedFor(report, 'skills/monitor-design/SKILL.md declares')[0].evidence, new RegExp(`description=${inner.length} chars`));
    });
  });

  // Not a parse failure — it parses, and silently truncates. The grader has to report the
  // value YAML yields, not the text on the page, or it is back to a confident wrong number.
  test('an unquoted "#" comment parses, and the reported length is the truncated value', () => {
    const root = makeGoldenPluginRoot();
    const kept = 'A description that stops here.';
    write(root, 'skills/safe-cleanup/SKILL.md', brokenSkill('safe-cleanup', `description: ${kept} # and this is a comment YAML drops.`));
    const report = gradePlugin(root);
    assert.equal(passedFor(report, 'skills/safe-cleanup/SKILL.md frontmatter parses as YAML')[0].passed, true);
    assert.match(passedFor(report, 'skills/safe-cleanup/SKILL.md declares')[0].evidence, new RegExp(`description=${kept.length} chars`));
  });
});

// ---------------------------------------------------------------------------
// Per-agent: C-01 frontmatter, C-07 tool survival, EN-9 model alias, role structure
// ---------------------------------------------------------------------------

describe('agent frontmatter (C-01, C-07, EN-9)', () => {
  test('an agent carrying hooks: frontmatter fails the C-01 check (planted defect B)', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'agents/builder.md', agentFrontmatter({
      name: 'builder',
      tools: 'Read, Grep, Glob, Edit, Write, Bash',
      model: 'sonnet',
      extra: 'hooks:\n  PreToolUse: []',
    }));
    const report = gradePlugin(root);
    const check = passedFor(report, 'agents/builder.md carries none of hooks:')[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /hooks/);
  });

  test('an agent carrying mcpServers: or permissionMode: also fails the C-01 check', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'agents/triage.md', agentFrontmatter({
      name: 'triage',
      tools: 'Read, Grep, Glob, Bash',
      model: 'haiku',
      extra: 'permissionMode: bypassPermissions',
    }));
    const report = gradePlugin(root);
    const check = passedFor(report, 'agents/triage.md carries none of hooks:')[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /permissionMode/);
  });

  test('a tool outside the background-survival list fails the C-07 check (planted defect)', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'agents/builder.md', agentFrontmatter({
      name: 'builder',
      tools: 'Read, Grep, Glob, Edit, Write, Bash, Task',
      model: 'sonnet',
    }));
    const report = gradePlugin(root);
    const check = passedFor(report, "agents/builder.md's tools:")[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /Task/);
  });

  test('a raw model id instead of an alias fails the EN-9 check', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'agents/reviewer.md', agentFrontmatter({ name: 'reviewer', tools: 'Read', model: 'claude-opus-4-20250514' }));
    const report = gradePlugin(root);
    assert.equal(passedFor(report, 'agents/reviewer.md pins its model to an alias')[0].passed, false);
  });

  test('verifier holding more than Read fails its isolation check', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'agents/verifier.md', agentFrontmatter({ name: 'verifier', tools: 'Read, Bash', model: 'opus' }));
    const report = gradePlugin(root);
    assert.equal(passedFor(report, 'agents/verifier.md tools: frontmatter is exactly Read')[0].passed, false);
    assert.equal(passedFor(report, 'agents/reviewer.md tools: frontmatter is exactly Read')[0].passed, true);
  });

  test('reviewer holding more than Read fails the L-01 isolation check', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'agents/reviewer.md', agentFrontmatter({ name: 'reviewer', tools: 'Read, Grep', model: 'opus' }));
    const report = gradePlugin(root);
    assert.equal(passedFor(report, 'agents/reviewer.md tools: frontmatter is exactly Read')[0].passed, false);
  });

  test('triage holding a write-capable tool fails the triage-is-read-only check', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'agents/triage.md', agentFrontmatter({ name: 'triage', tools: 'Read, Grep, Glob, Bash, Edit', model: 'haiku' }));
    const report = gradePlugin(root);
    assert.equal(passedFor(report, 'agents/triage.md tools: frontmatter carries no write-capable tool')[0].passed, false);
  });

  test('builder and reviewer on the same model tier fails the tier-above check', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'agents/reviewer.md', agentFrontmatter({ name: 'reviewer', tools: 'Read', model: 'sonnet' }));
    const report = gradePlugin(root);
    assert.equal(passedFor(report, 'the reviewer sits a model tier above the builder')[0].passed, false);
  });
});

// ---------------------------------------------------------------------------
// hooks/hooks.json
// ---------------------------------------------------------------------------

describe('hooks.json', () => {
  test('missing hooks.json fails the parse check', () => {
    const root = makeGoldenPluginRoot();
    rmSync(path.join(root, 'hooks', 'hooks.json'));
    const report = gradePlugin(root);
    assert.equal(passedFor(report, 'hooks/hooks.json exists and parses')[0].passed, false);
  });

  test('a hooks.json entry naming a script that is not on disk fails that script\'s check', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'hooks/hooks.json', JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: '^(Bash|PowerShell)$',
            hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/does-not-exist.mjs'] }],
          },
        ],
      },
    }));
    const report = gradePlugin(root);
    const check = passedFor(report, "hooks.json's reference to hooks/does-not-exist.mjs exists on disk")[0];
    assert.equal(check.passed, false);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting scans: Axial references (V-09), decision-id resolution, CLAUDE_PLUGIN_ROOT
// paths
// ---------------------------------------------------------------------------

describe('cross-cutting text scans', () => {
  test('a skill referencing the Axial product fails the V-09 check for that skill only', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'skills/tdd-ci/SKILL.md', skillFrontmatter('tdd-ci', { lane: false }).replace(
      'Fixture body.',
      'Run it with `uv run pytest` as Axial does.',
    ));
    const report = gradePlugin(root);
    const check = passedFor(report, 'no file under skills/tdd-ci references the Axial source product')[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /uv run/);
    // Untouched skills are unaffected.
    assert.equal(passedFor(report, 'no file under skills/fix references the Axial source product')[0].passed, true);
  });

  test('a skill\'s SKILL.md (.md) citing an id the plugin ships no entry for fails that skill\'s check', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'skills/status/SKILL.md', skillFrontmatter('status', { lane: true }).replace(
      'Fixture body.',
      'No port source (EN-7, D5 in docs/DECISIONS.md).',
    ));
    const report = gradePlugin(root);
    const check = passedFor(report, 'cited in Markdown under skills/status resolves')[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /EN-7/);
    assert.match(check.evidence, /D5/);
  });

  // The rule is scoped to .md by file KIND, not by directory: a Markdown instruction is
  // read by an installed session with no docs/ tree, a .mjs comment is source read by
  // whoever maintains the script. Both directions, on the same identifier, so the
  // distinction is pinned rather than assumed.
  describe('the decision-id rule is scoped to Markdown, not to a directory', () => {
    test('a .md file citing an unshipped D17 fails the check', () => {
      const root = makeGoldenPluginRoot();
      write(root, 'skills/fix/SKILL.md', skillFrontmatter('fix', { lane: true }).replace(
        'Fixture body.',
        'See D17 in docs/DECISIONS.md.',
      ));
      const report = gradePlugin(root);
      const check = passedFor(report, 'cited in Markdown under skills/fix resolves')[0];
      assert.equal(check.passed, false);
      assert.match(check.evidence, /D17/);
    });

    test('a .mjs file citing D17 passes — it is source for a maintainer, not an installer-facing instruction', () => {
      const root = makeGoldenPluginRoot();
      write(root, 'skills/safe-cleanup/scripts/note.mjs', '// D17: the fix landed here, stated for whoever reads this comment next.\n');
      const report = gradePlugin(root);
      const check = passedFor(report, 'cited in Markdown under skills/safe-cleanup resolves')[0];
      assert.equal(check.passed, true, check.evidence);
    });
  });

  // The shipped decisions file, and the two directions that make it worth having. An id
  // that resolves is a citation an installed session can follow; an id that resolves to
  // nothing is the dangling reference the original prohibition existed to stop, and it
  // still fails. The third case is the file's own bound: an entry nothing cites is how a
  // curated subset turns back into a copy of the whole decision log.
  describe('citations resolve against the shipped decisions file', () => {
    const shipped = (...entries) => entries.map((e) => `## ${e}\n\nThe rule, and the reason it exists.\n`).join('\n');

    test('a cited id that resolves to a shipped entry passes', () => {
      const root = makeGoldenPluginRoot();
      write(root, 'DECISIONS.md', shipped('D17 — Two test tiers'));
      write(root, 'skills/fix/SKILL.md', skillFrontmatter('fix', { lane: true }).replace(
        'Fixture body.',
        'The fast tier is the commit gate\'s (D17).',
      ));
      const report = gradePlugin(root);
      assert.equal(passedFor(report, 'cited in Markdown under skills/fix resolves')[0].passed, true);
      assert.equal(passedFor(report, 'every entry in DECISIONS.md is cited')[0].passed, true);
    });

    test('a cited id with no shipped entry still fails, even when the file exists', () => {
      const root = makeGoldenPluginRoot();
      write(root, 'DECISIONS.md', shipped('D17 — Two test tiers'));
      write(root, 'skills/fix/SKILL.md', skillFrontmatter('fix', { lane: true }).replace(
        'Fixture body.',
        'The fast tier is the commit gate\'s (D17).\n\nThe branch point is cited (D24).',
      ));
      const report = gradePlugin(root);
      const check = passedFor(report, 'cited in Markdown under skills/fix resolves')[0];
      assert.equal(check.passed, false);
      assert.match(check.evidence, /D24/);
      // The resolvable one is not reported alongside it.
      assert.doesNotMatch(check.evidence, /D17/);
    });

    test('an entry no shipped file cites fails the reverse check', () => {
      const root = makeGoldenPluginRoot();
      write(root, 'DECISIONS.md', shipped('D17 — Two test tiers', 'D11 — Concurrency lanes'));
      write(root, 'skills/fix/SKILL.md', skillFrontmatter('fix', { lane: true }).replace(
        'Fixture body.',
        'The fast tier is the commit gate\'s (D17).',
      ));
      const report = gradePlugin(root);
      const check = passedFor(report, 'every entry in DECISIONS.md is cited')[0];
      assert.equal(check.passed, false);
      assert.match(check.evidence, /D11/);
      assert.doesNotMatch(check.evidence, /D17/);
    });
  });

  test('a ${CLAUDE_PLUGIN_ROOT} reference to a file that does not exist fails the path check (planted defect D)', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'skills/tdd-plan/SKILL.md', skillFrontmatter('tdd-plan', { lane: false }).replace(
      'Fixture body.',
      'See `${CLAUDE_PLUGIN_ROOT}/skills/tdd-plan/references/does-not-exist.md`.',
    ));
    const report = gradePlugin(root);
    const check = passedFor(report, 'every ${CLAUDE_PLUGIN_ROOT} path referenced under skills/tdd-plan resolves')[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /does-not-exist\.md/);
  });

  // The same scan runs over agent files, and until a charter carried a real
  // ${CLAUDE_PLUGIN_ROOT} reference every agent's path check passed vacuously, so a broken
  // reference in a charter was pinned by nothing. monitor-designer.md points at the generic
  // monitor, so it is now a live check and gets both directions.
  test('a ${CLAUDE_PLUGIN_ROOT} reference to a missing file in an AGENT charter fails that agent\'s path check', () => {
    const root = makeGoldenPluginRoot();
    write(root, 'agents/monitor-designer.md', agentFrontmatter({
      name: 'monitor-designer',
      tools: 'Read, Grep, Glob, Edit, Write, Bash',
      model: 'sonnet',
      body: 'Builds on `${CLAUDE_PLUGIN_ROOT}/scripts/does-not-exist.mjs`.',
    }));
    const report = gradePlugin(root);
    const check = passedFor(report, 'every ${CLAUDE_PLUGIN_ROOT} path referenced under agents/monitor-designer.md resolves')[0];
    assert.equal(check.passed, false);
    assert.match(check.evidence, /does-not-exist\.mjs/);
    // The other charters are untouched and still pass, vacuously.
    assert.equal(passedFor(report, 'every ${CLAUDE_PLUGIN_ROOT} path referenced under agents/builder.md resolves')[0].passed, true);
  });

  test('a skill with no ${CLAUDE_PLUGIN_ROOT} reference passes vacuously, distinguishably from "verified"', () => {
    const root = makeGoldenPluginRoot();
    const report = gradePlugin(root);
    const check = passedFor(report, 'every ${CLAUDE_PLUGIN_ROOT} path referenced under skills/fix resolves')[0];
    assert.equal(check.passed, true);
    assert.match(check.evidence, /nothing to check/);
  });
});

// ---------------------------------------------------------------------------
// Against the real plugin/ tree in this repo
// ---------------------------------------------------------------------------

describe('against this repo\'s real plugin/ tree', () => {
  test('inventory and hooks.json wiring hold', () => {
    const report = gradePlugin(path.join(repoRoot, 'plugin'));
    assert.equal(passedFor(report, 'ships exactly 14 skills')[0].passed, true);
    assert.equal(passedFor(report, 'ships exactly 5 agents')[0].passed, true);
    assert.equal(passedFor(report, 'hooks/hooks.json exists and parses')[0].passed, true);
  });

  // Issue #48 shipped a SKILL.md whose frontmatter did not parse and the grader scored it
  // green for three phases. This is the direction that check faces in production.
  test('every shipped skill and agent frontmatter block parses', () => {
    const report = gradePlugin(path.join(repoRoot, 'plugin'));
    const checks = passedFor(report, 'frontmatter parses as YAML');
    assert.equal(checks.length, 19, '14 skills plus 5 agents');
    for (const c of checks) assert.equal(c.passed, true, `${c.text}: ${c.evidence}`);
  });

  // A locked regression pin (see docs/EVIDENCE.md L-08's "a gate one ordinary run from
  // crying wolf is not a ceiling"). The first P2.M run found two dangling-decision-id
  // citations: skills/status/SKILL.md cited EN-7 and D5 (fixed -- restated without the
  // identifiers, same substance), and skills/safe-cleanup/scripts/classify-branches.mjs
  // cited L-08 and L-05 in .mjs comments (not a defect -- the rule is scoped to Markdown
  // by file kind, since a .mjs comment is source for a maintainer, not an installed
  // session's instruction). The run against the real tree should be clean. If this test
  // ever goes red, read why before "fixing" it -- it may mean a real defect, not a stale
  // pin.
  test('the run against the real plugin/ tree is clean', () => {
    const report = gradePlugin(path.join(repoRoot, 'plugin'));
    assert.deepEqual(failingTexts(report), []);
    assert.equal(report.summary.failed, 0);
  });
});
