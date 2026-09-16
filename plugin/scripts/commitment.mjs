#!/usr/bin/env node
// The commitment ledger's writer (#184).
//
//   node commitment.mjs record "<recommendation>" [--root <dir>]
//   node commitment.mjs mark executed|partial|not   [--root <dir>]
//
// `record` appends one row to COMMITMENTS.md at <root> (default: the process's own
// cwd), creating the file with its header when absent. `mark` fills the Executed cell
// of the newest row whose cell is blank and exits 2, leaving the file untouched, when
// there is no such row -- the file does not exist, or every row already carries a
// word. The model runs this by hand from a session; no hook calls it
// (plans/phase-2/04-commitment.md, Out of scope: judging executed or not is the
// model's call, not this script's).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  FILE_NAME, HEADER_LINE, SEPARATOR_LINE, WORDS, escapeCell, parseCommitments, todayLocalDate,
} from '../hooks/commitments.mjs';

const USAGE = `usage:
  commitment record "<recommendation>" [--root <dir>]
  commitment mark executed|partial|not [--root <dir>]`;

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const value = argv[i + 1];
  if (value === undefined) fail(`--${name} needs a value\n${USAGE}`);
  return value;
}

function ledgerPath(root) {
  return path.join(root, FILE_NAME);
}

function record(root, text) {
  if (!text || !text.trim()) fail(`record needs a recommendation\n${USAGE}`);
  const file = ledgerPath(root);
  const row = `| ${todayLocalDate()} | ${escapeCell(text)} |  |`;
  if (existsSync(file)) {
    const current = readFileSync(file, 'utf8');
    const body = current.endsWith('\n') ? current : `${current}\n`;
    writeFileSync(file, `${body}${row}\n`, 'utf8');
  } else {
    writeFileSync(file, `# Commitments\n\n${HEADER_LINE}\n${SEPARATOR_LINE}\n${row}\n`, 'utf8');
  }
}

// Fills the Executed cell of the newest (bottom-most) row whose cell is blank,
// rewriting only that one row's third cell -- every other line of the file, including
// that row's own Date and Recommendation cells, is carried through byte for byte.
function mark(root, word) {
  if (!WORDS.includes(word)) fail(`mark needs one of executed, partial, not\n${USAGE}`);
  const file = ledgerPath(root);
  if (!existsSync(file)) fail(`${file} does not exist. Run \`commitment record\` first.`, 2);
  const markdown = readFileSync(file, 'utf8');
  const rows = parseCommitments(markdown);
  const target = [...rows].reverse().find((row) => row.word === '');
  if (!target) fail('every row already carries a word; nothing to mark.', 2);
  const lines = markdown.split(/\r?\n/);
  const cells = lines[target.line].replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
  cells[2] = ` ${word} `;
  lines[target.line] = `|${cells.join('|')}|`;
  writeFileSync(file, lines.join('\n'), 'utf8');
}

const [action, ...rest] = process.argv.slice(2);
const root = flag(rest, 'root') ?? process.cwd();
const positional = rest[0];

if (action === 'record') {
  record(root, positional);
} else if (action === 'mark') {
  mark(root, positional);
} else {
  fail(USAGE);
}
