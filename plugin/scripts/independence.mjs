#!/usr/bin/env node
// Decide whether a set of slices can be built at the same time — four actors, four
// worktrees — without two of them landing on the same file.
//
// WHY THIS EXISTS, AND WHY IT IS CODE. Two issues were once dispatched concurrently after
// being verified as touching no common files. Both created the same new module and its two
// test files, with incompatible content, and the merge was reconciled by hand (L-04 in
// docs/EVIDENCE.md). The check that cleared them — "no shared files, no dependency" — was
// not wrong about the files that existed. It asked about the wrong set. Neither slice's new
// module was on disk yet, so nothing was shared, and the answer was a confident, false
// "safe". Disjointness has to be asserted over PLANNED NEW PATHS, not only edited ones.
//
// That question has an oracle: two path sets either intersect or they do not. So this is
// code with tests rather than agent judgment. A model asked "do these two slices collide?"
// is exactly the check that already failed.
//
//   node independence.mjs <slice-source> <slice-source> [<slice-source> ...]
//
// A slice source is a slice plan file or an issue body saved to disk, each carrying one
// declaration block. The usual shape, from the planner about to dispatch four actors:
//
//   gh issue view 13 --json body -q .body > /tmp/13.md
//   gh issue view 14 --json body -q .body > /tmp/14.md
//   node independence.mjs /tmp/13.md /tmp/14.md
//
// THE DECLARATION FORMAT. This comment and the parser below it are the format's only
// normative definition; P5.2 wires the two planning surfaces to emit it, and nothing
// paraphrases it. A fenced code block, exactly one per source:
//
//   ```aeo-independence
//   slice: 13
//   edits: package.json
//   creates: plugin/scripts/independence.mjs
//   creates: tests/scripts/independence.test.mjs
//   depends-on: 12
//   ```
//
// Every line is `key: value`, one value per line, repeating the key for each further value.
// Four keys and no others: `slice` exactly once, `edits`, `creates` and `depends-on` any
// number of times including none. Blank lines are ignored; nothing else is. Paths are
// repository-relative with forward slashes. A dependency names another slice's id.
//
// Repeating the key rather than indenting a list is what keeps the block immune to how a
// markdown renderer, an issue editor or a copy-paste treats leading whitespace: every line
// is trimmed before it is read, so indentation carries no meaning and cannot be lost. It
// also stays readable in a GitHub issue body with no decoder, which was the other
// requirement.
//
// FAIL CLOSED, EVERYWHERE. A slice that declares nothing is not trivially disjoint from
// everything — it is undeclared, and the answer is *not parallel-safe, because slice NN
// declares no paths*. The same applies to a source with no block at all, a block with two
// `slice:` lines, an unknown key (a typo'd `create:` must never silently drop a path), a
// placeholder like `none` where a path belongs, and a comma-separated list where the format
// wants one value per line. Each of those is a way for a real path to go unseen, and an
// unseen path is how a false "safe" is produced. Silence never reads as safety.
//
// WHAT COUNTS AS A COLLISION. Exact equality of the normalised path, or one path being a
// proper ancestor of the other. There is no glob matching, no similarity score, no ignore
// list and no threshold. The ancestor rule is not a heuristic either: a path cannot be a
// file in one slice and a directory in another, so `plugin/scripts` against
// `plugin/scripts/independence.mjs` is always a genuine conflict, never a near miss. That
// is the only sense in which directory containment is supported — a declared directory is
// compared as the path it is, and it catches files declared beneath it.
//
// Comparison is case-insensitive on every platform. A repo-relative path differing only in
// case names one file on Windows and on macOS, which is where this runs; calling `src/Foo.js`
// and `src/foo.js` distinct would be the L-04 failure in miniature. The cost is a false
// collision in a repository that deliberately keeps two files differing only by case, and a
// false collision is the reversible error direction (L-07): it splits work that could have
// run together, where the other direction corrupts a merge.
//
// DEPENDENCIES. A declared `depends-on` naming another slice in the set fails that pair —
// the dependent cannot start until the other lands, so they are sequential by definition. A
// `depends-on` naming a slice outside the set is left alone: this answers "are these N
// parallel-safe against each other", not "is each one ready to start".
//
// STREAMS AND EXIT. The verdict is a result, not an error, so it goes to stdout and the exit
// code carries it: 0 parallel-safe, 1 not. stderr is reserved for "I could not run at all" —
// bad arguments, an unreadable file. Both the safe and the unsafe report echo every path the
// check actually parsed, because a count is not a coverage check and the way to confirm this
// saw what you meant is to read back the names (L-08).
//
// ONE KNOWN EDGE. The scan is line-oriented and does not track nested fences, so a file that
// *demonstrates* the format also declares it. That direction is safe: two blocks in one
// source is a hard failure, not a quiet pass.

import { readFileSync } from 'node:fs';

const FENCE_OPEN = '```aeo-independence';
const FENCE_CLOSE = '```';
const KEYS = new Set(['slice', 'edits', 'creates', 'depends-on']);

// Values that look like content but mean "I did not fill this in". Accepting one as a path
// would let a slice declare something, satisfy the declared-nothing check, and still collide
// with nobody. Rejecting them can only ever turn a "safe" into a failure, never the reverse.
const PLACEHOLDERS = new Set(['none', 'n/a', 'tbd', 'todo', '-']);

const KIND_WIDTH = 13;

const USAGE = `usage:
  independence <slice-source> <slice-source> [<slice-source> ...]

Each source is a slice plan or an issue body carrying one declaration block:

  \`\`\`aeo-independence
  slice: 13
  edits: package.json
  creates: plugin/scripts/independence.mjs
  creates: tests/scripts/independence.test.mjs
  depends-on: 12
  \`\`\`

One value per line; repeat the key for further values. Exit 0 when the set is
parallel-safe, 1 when it is not.`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Slice ids are compared as written, minus a leading `#` so `#13` and `13` are one slice. */
function sliceId(value) {
  return value.startsWith('#') ? value.slice(1).trim() : value;
}

/**
 * A repository-relative path in one canonical spelling, or `{ error }` explaining the
 * refusal. Backslashes become forward slashes, `.` and empty segments are dropped, and a
 * trailing slash is not a distinction. Absolute paths and `..` are refused rather than
 * resolved: this compares declarations, and it has no repository root to resolve them
 * against.
 */
function normalisePath(value) {
  const slashed = value.replace(/\\/g, '/');
  if (slashed.startsWith('/')) return { error: `${JSON.stringify(value)} is absolute; declare paths relative to the repository root` };
  if (/^[A-Za-z]:/.test(slashed)) return { error: `${JSON.stringify(value)} is absolute; declare paths relative to the repository root` };
  const segments = slashed.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.includes('..')) return { error: `${JSON.stringify(value)} escapes the repository root with ".."` };
  if (segments.length === 0) return { error: `${JSON.stringify(value)} is not a path` };
  return { path: segments.join('/') };
}

/**
 * Every `aeo-independence` block in a source, as arrays of trimmed lines, plus whether the
 * last one was left unterminated. An unterminated block means the author's text was
 * truncated, and truncation is how a path goes missing, so it is reported rather than
 * tolerated.
 */
function extractBlocks(text) {
  const blocks = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (current === null) {
      if (line === FENCE_OPEN) current = [];
    } else if (line === FENCE_CLOSE) {
      blocks.push(current);
      current = null;
    } else {
      current.push(line);
    }
  }
  const unterminated = current !== null;
  if (unterminated) blocks.push(current);
  return { blocks, unterminated };
}

/** Parse one block's lines onto `decl`, appending anything unusable to `decl.problems`. */
function parseBlock(lines, decl) {
  const problem = (text) => decl.problems.push({ kind: 'malformed', text: `slice source ${decl.file}: ${text}` });
  let sliceLines = 0;

  for (const line of lines) {
    if (line === '') continue;

    const split = line.indexOf(':');
    if (split === -1) {
      problem(`${JSON.stringify(line)} is not \`key: value\``);
      continue;
    }
    const key = line.slice(0, split).trim().toLowerCase();
    const value = line.slice(split + 1).trim();

    if (!KEYS.has(key)) {
      problem(`unknown key ${JSON.stringify(key)}; the format has slice, edits, creates and depends-on`);
      continue;
    }
    if (value === '') {
      problem(`\`${key}:\` carries no value; omit the line rather than leaving it blank`);
      continue;
    }
    if (value.includes(',')) {
      problem(`\`${key}: ${value}\` looks like a list; the format takes one value per line, repeating the key`);
      continue;
    }
    if (PLACEHOLDERS.has(value.toLowerCase())) {
      problem(`\`${key}: ${value}\` is a placeholder, not a value; omit the line instead`);
      continue;
    }

    if (key === 'slice') {
      sliceLines += 1;
      const id = sliceId(value);
      if (id === '') problem(`\`slice: ${value}\` is not an id`);
      else if (/\s/.test(id)) problem(`slice id ${JSON.stringify(id)} contains whitespace; ids are single tokens so depends-on can name them`);
      else decl.slice = id;
      continue;
    }

    if (key === 'depends-on') {
      const id = sliceId(value);
      if (id === '') problem(`\`depends-on: ${value}\` is not an id`);
      else if (!decl.dependsOn.includes(id)) decl.dependsOn.push(id);
      continue;
    }

    const { path: normalised, error } = normalisePath(value);
    if (error !== undefined) problem(error);
    else if (!decl[key].includes(normalised)) decl[key].push(normalised);
  }

  if (sliceLines > 1) problem(`${sliceLines} \`slice:\` lines; a source declares exactly one slice`);
  if (sliceLines === 0) problem('the block has no `slice:` line, so its paths cannot be attributed');
}

/** Read one source into a declaration. Never throws on content — it reports instead. */
function readDeclaration(file, index) {
  const decl = { file, index, slice: null, edits: [], creates: [], dependsOn: [], problems: [] };

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    fail(`cannot read ${file} (${err?.message ?? err})`);
  }

  const { blocks, unterminated } = extractBlocks(text);
  if (blocks.length === 0) {
    decl.problems.push({
      kind: 'undeclared',
      text: `${file} carries no \`aeo-independence\` block, so it declares nothing. A slice that declares nothing is undeclared, not disjoint.`,
    });
    return decl;
  }
  if (blocks.length > 1) {
    decl.problems.push({
      kind: 'malformed',
      text: `${file} carries ${blocks.length} \`aeo-independence\` blocks; a source declares exactly one.`,
    });
  }
  if (unterminated) {
    decl.problems.push({
      kind: 'malformed',
      text: `${file}'s \`aeo-independence\` block is never closed, so its declaration may be truncated.`,
    });
  }

  for (const block of blocks) parseBlock(block, decl);

  const named = decl.slice === null ? file : `slice ${decl.slice}`;
  if (decl.edits.length + decl.creates.length === 0) {
    decl.problems.push({
      kind: 'undeclared',
      text: `${named} declares no paths (${file}). A slice that declares nothing is undeclared, not disjoint.`,
    });
  }
  for (const p of decl.edits) {
    if (decl.creates.includes(p)) {
      decl.problems.push({ kind: 'malformed', text: `${named} both edits and creates ${p}; it cannot be doing both.` });
    }
  }
  if (decl.slice !== null && decl.dependsOn.includes(decl.slice)) {
    decl.problems.push({ kind: 'malformed', text: `${named} depends on itself.` });
  }
  return decl;
}

const VERB = { edits: 'edits', creates: 'creates' };
const PLURAL_VERB = { edits: 'edit', creates: 'create' };
const PAST = { edits: 'edited', creates: 'created' };

function collisionKind(a, b) {
  if (a.list === b.list) return a.list === 'edits' ? 'edit-edit' : 'create-create';
  return 'edit-create';
}

/** `a` is the ancestor when `contains` is true, otherwise the two name the same path. */
function collisionText(a, b, contains) {
  if (contains) {
    return `slice ${a.decl.slice} ${VERB[a.list]} ${a.path}, which contains ${b.path} ${PAST[b.list]} by slice ${b.decl.slice}`;
  }
  if (a.list === b.list) {
    return `slices ${a.decl.slice} and ${b.decl.slice} both ${PLURAL_VERB[a.list]} ${a.path}`;
  }
  return `slice ${a.decl.slice} edits ${a.path}, which slice ${b.decl.slice} creates`;
}

function collisionFinding(x, y, contains) {
  // Ancestor first when one contains the other, otherwise the editor first, so a pair reads
  // the same way every run.
  let [a, b] = [x, y];
  if (!contains && a.list !== b.list && a.list !== 'edits') [a, b] = [b, a];
  if (!contains && a.list === b.list && a.decl.index > b.decl.index) [a, b] = [b, a];
  return {
    kind: collisionKind(a, b),
    a: Math.min(a.decl.index, b.decl.index),
    b: Math.max(a.decl.index, b.decl.index),
    text: collisionText(a, b, contains),
  };
}

/** Every proper ancestor of a normalised path, shallowest first. */
function ancestors(key) {
  const parts = key.split('/');
  const out = [];
  for (let i = 1; i < parts.length; i += 1) out.push(parts.slice(0, i).join('/'));
  return out;
}

function collisions(decls) {
  const index = new Map();
  for (const decl of decls) {
    for (const list of ['edits', 'creates']) {
      for (const p of decl[list]) {
        const key = p.toLowerCase();
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ decl, list, path: p });
      }
    }
  }

  const found = [];
  for (const [key, entries] of index) {
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        if (entries[i].decl !== entries[j].decl) found.push(collisionFinding(entries[i], entries[j], false));
      }
    }
    for (const parent of ancestors(key)) {
      for (const outer of index.get(parent) ?? []) {
        for (const inner of entries) {
          if (outer.decl !== inner.decl) found.push(collisionFinding(outer, inner, true));
        }
      }
    }
  }
  return found;
}

function dependencies(decls) {
  const byId = new Map(decls.filter((d) => d.slice !== null).map((d) => [d.slice, d]));
  const found = [];
  for (const decl of decls) {
    for (const id of decl.dependsOn) {
      const other = byId.get(id);
      if (other === undefined || other === decl) continue;
      found.push({
        kind: 'dependency',
        a: Math.min(decl.index, other.index),
        b: Math.max(decl.index, other.index),
        text: `slice ${decl.slice} depends on slice ${other.slice}, so they are sequential, not parallel`,
      });
    }
  }
  return found;
}

/** Read back every path the check parsed. A count is not a coverage check (L-08). */
function echo(decls) {
  const lines = [];
  for (const decl of decls) {
    lines.push(`slice ${decl.slice ?? '(unnamed)'} — ${decl.file}`);
    for (const p of decl.edits) lines.push(`  edits      ${p}`);
    for (const p of decl.creates) lines.push(`  creates    ${p}`);
    for (const id of decl.dependsOn) lines.push(`  depends-on ${id}`);
    if (decl.edits.length + decl.creates.length === 0) lines.push('  (no paths declared)');
  }
  return lines;
}

const sources = process.argv.slice(2);
if (sources.length < 2) {
  fail(`independence compares two or more slices; it was given ${sources.length}.\n${USAGE}`);
}

const declarations = sources.map(readDeclaration);

const seen = new Map();
for (const decl of declarations) {
  if (decl.slice === null) continue;
  const first = seen.get(decl.slice);
  if (first !== undefined) fail(`${first.file} and ${decl.file} both declare slice ${decl.slice}; a collision could not be attributed to either.`);
  seen.set(decl.slice, decl);
}

const findings = [
  ...declarations.flatMap((decl) => decl.problems.map((p) => ({ ...p, a: decl.index, b: decl.index }))),
  ...collisions(declarations),
  ...dependencies(declarations),
].sort((x, y) => x.a - y.a || x.b - y.b || x.kind.localeCompare(y.kind) || x.text.localeCompare(y.text));

const declared = declarations.reduce((n, d) => n + d.edits.length + d.creates.length, 0);

if (findings.length === 0) {
  process.stdout.write(
    `parallel-safe — ${declarations.length} slices, ${declared} declared paths, no collisions and no dependency between them.\n\n` +
      `${echo(declarations).join('\n')}\n`,
  );
} else {
  const rendered = findings.map((f) => `  ${f.kind.padEnd(KIND_WIDTH)} ${f.text}`).join('\n');
  process.stdout.write(
    `NOT parallel-safe — ${findings.length} finding${findings.length === 1 ? '' : 's'}.\n\n${rendered}\n\ndeclared:\n${echo(declarations).join('\n')}\n`,
  );
  process.exit(1);
}
