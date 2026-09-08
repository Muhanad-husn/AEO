#!/usr/bin/env node
// Print one consuming project's score row.
//
//   node scripts/score.mjs <dir> --phases 0-5
//   node scripts/score.mjs <dir> --phases 0-5 --snapshot <path>   record, then print
//   node scripts/score.mjs <dir> --phases 0-5 --from <path>       replay, no network
//   node scripts/score.mjs --record <path>                        a consumer scored from a hand-copied record
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as sources from './score/sources.mjs';
import * as consumer from './score/consumer.mjs';
import * as interventions from './score/interventions.mjs';
import * as harness from './score/harness.mjs';
import * as record from './score/record.mjs';

function parseArgv(argv) {
  const options = { dir: null, phases: null, snapshot: null, from: null, record: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--phases') {
      const [from, to] = argv[i += 1].split('-').map(Number);
      options.phases = { from, to };
    } else if (arg === '--snapshot') {
      options.snapshot = argv[i += 1];
    } else if (arg === '--from') {
      options.from = argv[i += 1];
    } else if (arg === '--record') {
      options.record = argv[i += 1];
    } else if (!options.dir) {
      options.dir = arg;
    }
  }
  return options;
}

function main(argv) {
  const options = parseArgv(argv);
  if (!options.record && !options.phases) {
    process.stderr.write('usage: score.mjs <dir> --phases <from>-<to> [--snapshot <path>] [--from <path>]\n');
    process.stderr.write('       score.mjs --record <path>\n');
    return 2;
  }
  let snapshot;
  if (options.record) {
    snapshot = record.load(options.record);
  } else if (options.from) {
    snapshot = sources.load(options.from);
  } else {
    snapshot = sources.read(options.dir, options.phases);
    if (options.snapshot) {
      mkdirSync(dirname(options.snapshot), { recursive: true });
      writeFileSync(options.snapshot, sources.serialise(snapshot));
    }
  }
  const out = [consumer.row(snapshot), interventions.line(snapshot), harness.line(snapshot)];
  process.stdout.write(out.join('\n') + '\n');
  return 0;
}

process.exitCode = main(process.argv.slice(2));
