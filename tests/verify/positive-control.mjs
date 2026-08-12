#!/usr/bin/env node
// The verifier's positive control.
//
// WHAT THIS MEASURES. Whether the charter in plugin/agents/verifier.md catches defects it
// was not told were there. It plants six, runs each one beside a clean twin of the same
// packet, and repeats the whole set. The output is a small set of rates and the spread of
// each across runs -- never one number from one run.
//
// WHY THE CLEAN TWINS. A judge that objects to everything catches every planted defect and
// is worth nothing. A detection rate alone cannot tell that apart from judgment. The twin
// rate is the floor the detection rate has to be read against, and the gap between them is
// the whole measurement.
//
// WHY THE HEADLINE RATE IS "DID NOT PASS IT" AND NOT A KEYWORD MATCH. The first version of
// this scored a catch as "flagged, and a regex for this defect's complaint matched". It
// undercounted badly. Reports that found the planted defect exactly, at confidence 90 plus,
// scored as misses because they wrote "'refused' is the event, not a reason" where the
// matcher wanted "no reason given". A vocabulary list is not a semantics check, and a
// number produced by one describes the list. The strict reading is still computed and
// printed as `named`, as a lower bound and labelled as one, because it is useful for
// spotting a case where the verifier flagged something else entirely. The headline pair is
// the flag rate on defective packets against the flag rate on their twins.
//
// SO READ THE REPORTS. The rates say whether the shape holds. Whether a catch is the
// planted defect or a lucky objection is settled by reading, and one full run should be
// read by hand before any number from here is quoted.
//
// WHY MORE THAN ONE RUN. An identical generative pass reproduces its own result well short
// of always. One run is a sample of size one and reporting it as a rate is the mistake this
// file exists to avoid. `--runs` defaults to 3 and the summary prints the range, never a
// single number.
//
// THERE IS NO PASS THRESHOLD HERE, DELIBERATELY. This command reports; a person reads it.
// A number baked in as a bar would be a constant tuned to whichever run happened to be in
// front of whoever wrote it, and it would turn a probabilistic judgment into a gate. The
// deterministic half of this control -- that the scoring is right, that the cases are
// well-formed, that no packet leaks its own answer -- lives in positive-control.test.mjs
// and runs in the fast tier with no model call at all.
//
// HOW THE MODEL IS INVOKED. `claude --print --safe-mode --tools ""`, from a working
// directory outside this repository, with the charter body as the system prompt and the
// packet as the only user message. Safe mode drops this project's own CLAUDE.md, skills,
// plugins and hooks, so the run measures the charter rather than the room it was run in.
// Tools are off and the packet is inlined instead of staged, which is the one place this
// control departs from a real dispatch: it exercises the charter's judgment, not the hook
// that seals the real verifier off from the repository. That hook has its own tests.
//
// Usage:
//   node tests/verify/positive-control.mjs [--runs N] [--model alias] [--out DIR]
//                                          [--concurrency N] [--case ID]

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { CASES, VARIANTS, buildPacket } from './cases.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const CHARTER_PATH = path.join(repoRoot, 'plugin', 'agents', 'verifier.md');

/** The four words the charter requires, longest first so DONE_WITH_CONCERNS wins. */
const STATUS_RE = /\b(DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED|DONE)\b/g;

/**
 * The status the report ends on.
 *
 * The last occurrence, not the first: a report may quote the four words while explaining
 * what it is about to do, and the verdict is what it settles on.
 *
 * @param {string} text
 * @returns {'DONE'|'DONE_WITH_CONCERNS'|'BLOCKED'|'NEEDS_CONTEXT'|'UNPARSED'}
 */
export function parseStatus(text) {
  const matches = [...String(text ?? '').matchAll(STATUS_RE)];
  return matches.length === 0 ? 'UNPARSED' : /** @type {any} */ (matches[matches.length - 1][1]);
}

/**
 * Score one report against one case, by the same rule for both variants.
 *
 * Two independent readings, computed the same way for both variants. `flagged` is whether
 * the artifact was passed at all. `hit` additionally requires the anchor, so it is the
 * stricter reading: objecting to something else entirely is not a hit, and neither is
 * naming the right subject while concluding the artifact is fine.
 *
 * The function is not told which variant produced the text. Which rate a result lands in
 * is decided later, from the variant recorded beside it.
 *
 * @param {string} text
 * @param {import('./cases.mjs').Case} testCase
 */
export function scoreReport(text, testCase) {
  const status = parseStatus(text);
  const flagged = status === 'DONE_WITH_CONCERNS' || status === 'BLOCKED' || status === 'NEEDS_CONTEXT';
  const anchored = testCase.anchor.test(String(text ?? ''));
  return { status, flagged, anchored, hit: flagged && anchored };
}

/**
 * Fold per-packet results into per-run rates and the range across runs.
 *
 * Three rates, because they answer three different questions and no one of them is
 * readable alone:
 *
 *   detection  flagged, on a defective packet. Did the verifier decline to pass an
 *              artifact with a defect in it.
 *   floor      flagged, on the clean twin. Would it have declined anyway. This is what
 *              stops detection from being read as skill when it is only reflex. It counts
 *              any objection, including a real one about something else, so a twin that is
 *              clean of the planted defect but not of everything raises it.
 *   same       flagged AND the anchor matched, on the clean twin. The same objection made
 *   complaint  where it no longer applies. Narrower and sharper than the floor.
 *   named      flagged AND the anchor matched, on a defective packet. A stricter reading
 *              that also asks whether the report used words the matcher recognises for
 *              this defect. It is a LOWER BOUND on detection and nothing more: a correct
 *              finding phrased outside the anchor's vocabulary scores as a miss here,
 *              which has been observed. Never read it as an upper bound on judgment.
 *
 * @param {Array<{run: number, caseId: string, variant: string, hit: boolean, flagged: boolean, status: string}>} results
 */
export function summarise(results) {
  const runs = [...new Set(results.map((r) => r.run))].sort((a, b) => a - b);
  const tally = (rows, predicate) => ({ hits: rows.filter(predicate).length, of: rows.length });

  const perRun = runs.map((run) => {
    const inRun = results.filter((r) => r.run === run);
    const defective = inRun.filter((r) => r.variant === 'defective');
    const clean = inRun.filter((r) => r.variant === 'clean');
    return {
      run,
      detection: tally(defective, (r) => r.flagged),
      floor: tally(clean, (r) => r.flagged),
      named: tally(defective, (r) => r.hit),
      sameComplaint: tally(clean, (r) => r.hit),
      unparsed: inRun.filter((r) => r.status === 'UNPARSED').length,
    };
  });

  const range = (pick) => {
    const values = perRun.map((r) => (pick(r).of === 0 ? 0 : pick(r).hits / pick(r).of));
    return values.length === 0 ? { min: 0, max: 0 } : { min: Math.min(...values), max: Math.max(...values) };
  };

  const perCase = CASES.map((c) => {
    const rows = results.filter((r) => r.caseId === c.id);
    const defective = rows.filter((r) => r.variant === 'defective');
    return {
      id: c.id,
      detection: tally(defective, (r) => r.flagged),
      named: tally(defective, (r) => r.hit),
      floor: tally(rows.filter((r) => r.variant === 'clean'), (r) => r.flagged),
      sameComplaint: tally(rows.filter((r) => r.variant === 'clean'), (r) => r.hit),
    };
  });

  return {
    perRun,
    perCase,
    detectionRange: range((r) => r.detection),
    floorRange: range((r) => r.floor),
    namedRange: range((r) => r.named),
    sameComplaintRange: range((r) => r.sameComplaint),
  };
}

/** The charter body, frontmatter removed. That body is the system prompt under test. */
export function charterBody(text) {
  return String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

/**
 * The one instruction added to every packet, identical for all of them.
 *
 * Two sentences, each closing a harness artifact rather than shaping a verdict.
 *
 * The charter tells the verifier its one call is a Read of the staged packet. Here the
 * packet is inlined and tools are off, so some runs opened with a Read attempt and ended
 * there, producing no report at all. Saying there are no tools removes that.
 *
 * The charter already asks for exactly one of the four status words. Under a bare system
 * prompt a report often ends on a heading instead, and a scorer that cannot find a verdict
 * reads every run as a miss -- a number describing the parser rather than the judge.
 *
 * Neither sentence says anything about this case, this variant, or what a right answer
 * would look like, and the text is byte-identical across every dispatch, so it cannot tilt
 * one packet against another. It does not say the packet is complete: an insufficient
 * packet has to stay reportable, or NEEDS_CONTEXT stops meaning anything.
 */
export const RESPONSE_FORMAT =
  'You have no tools in this session, so work from the text above alone. ' +
  'End your report with a final line containing exactly one of: DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT.';

/** What is actually sent: the packet, then the format line. */
export function composePrompt(packet) {
  return `${packet}\n---\n\n${RESPONSE_FORMAT}\n`;
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { runs: 3, model: 'opus', out: null, concurrency: 6, caseId: null };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=');
    const value = inline ?? argv[i + 1];
    const consume = () => {
      if (inline === undefined) i += 1;
      return value;
    };
    if (flag === '--runs') opts.runs = Number(consume());
    else if (flag === '--model') opts.model = consume();
    else if (flag === '--out') opts.out = consume();
    else if (flag === '--concurrency') opts.concurrency = Number(consume());
    else if (flag === '--case') opts.caseId = consume();
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!Number.isInteger(opts.runs) || opts.runs < 1) throw new Error('--runs must be a positive integer');
  if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1) throw new Error('--concurrency must be a positive integer');
  return opts;
}

function askVerifier({ systemPrompt, packet, model, cwd }) {
  return new Promise((resolve) => {
    const child = spawn(
      'claude',
      ['--print', '--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--tools', '', '--model', model, '--system-prompt', systemPrompt],
      { cwd },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (err) => resolve({ text: '', error: err.message }));
    child.on('close', (code) => resolve({ text: stdout, error: code === 0 ? null : `exit ${code}: ${stderr.trim().slice(0, 400)}` }));
    child.stdin.end(packet);
  });
}

/** Run `jobs` with at most `limit` in flight. Order of results follows `jobs`. */
async function pooled(jobs, limit, worker) {
  const out = new Array(jobs.length);
  let next = 0;
  const runOne = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= jobs.length) return;
      out[index] = await worker(jobs[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, runOne));
  return out;
}

const pct = (hits, of) => (of === 0 ? '  n/a' : `${String(Math.round((hits / of) * 100)).padStart(3, ' ')}%`);

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cases = opts.caseId ? CASES.filter((c) => c.id === opts.caseId) : CASES;
  if (cases.length === 0) throw new Error(`no case with id ${opts.caseId}`);

  const systemPrompt = charterBody(readFileSync(CHARTER_PATH, 'utf8'));
  const outDir = opts.out ? path.resolve(opts.out) : path.join(os.tmpdir(), `aeo-verifier-control-${Date.now()}`);
  mkdirSync(outDir, { recursive: true });
  // Outside the repository, so nothing the session might notice about this project can
  // reach the run even by accident.
  const workDir = path.join(outDir, 'cwd');
  mkdirSync(workDir, { recursive: true });

  const jobs = [];
  for (let run = 1; run <= opts.runs; run += 1) {
    for (const testCase of cases) {
      for (const variant of VARIANTS) jobs.push({ run, testCase, variant });
    }
  }

  console.log(`verifier positive control: ${cases.length} cases x ${VARIANTS.length} variants x ${opts.runs} runs = ${jobs.length} dispatches`);
  console.log(`model ${opts.model}, concurrency ${opts.concurrency}, reports in ${outDir}\n`);

  let done = 0;
  const results = await pooled(jobs, opts.concurrency, async ({ run, testCase, variant }) => {
    const packet = composePrompt(buildPacket(testCase, variant));
    const { text, error } = await askVerifier({ systemPrompt, packet, model: opts.model, cwd: workDir });
    const name = `run${run}-${testCase.id}-${variant}`;
    writeFileSync(path.join(outDir, `${name}.md`), error ? `ERROR: ${error}\n\n${text}` : text, 'utf8');
    const scored = scoreReport(text, testCase);
    done += 1;
    process.stdout.write(`  [${String(done).padStart(2, ' ')}/${jobs.length}] ${name}: ${error ? `ERROR ${error}` : `${scored.status}${scored.hit ? ' HIT' : ''}`}\n`);
    return { run, caseId: testCase.id, variant, ...scored, error };
  });

  const failed = results.filter((r) => r.error);
  const summary = summarise(results);

  console.log('\nper run');
  console.log('  run   defective: not passed / named   clean twin: not passed / same complaint   no verdict');
  for (const r of summary.perRun) {
    console.log(
      `  ${String(r.run).padStart(3, ' ')}        ${r.detection.hits}/${r.detection.of}  ${r.named.hits}/${r.named.of}` +
        `                      ${r.floor.hits}/${r.floor.of}  ${r.sameComplaint.hits}/${r.sameComplaint.of}                  ${r.unparsed}`,
    );
  }
  // An unparsed report is counted as a miss on both sides. Printed on its own so a run in
  // which the parser stopped working cannot pass for a run in which the judge found
  // nothing.
  const unparsed = results.filter((r) => r.status === 'UNPARSED').length;
  if (unparsed > 0) console.log(`\n${unparsed} report(s) ended on no verdict and were counted as misses, never as clean passes.`);

  console.log('\nper case (all runs pooled)');
  for (const c of summary.perCase) {
    console.log(
      `  ${c.id.padEnd(30, ' ')} defective ${c.detection.hits}/${c.detection.of} named ${c.named.hits}/${c.named.of}` +
        `   clean twin ${c.floor.hits}/${c.floor.of} same complaint ${c.sameComplaint.hits}/${c.sameComplaint.of}`,
    );
  }

  const asRange = (r) => (r.min === r.max ? `${Math.round(r.min * 100)}%` : `${Math.round(r.min * 100)}% to ${Math.round(r.max * 100)}%`);
  console.log(`\nacross ${summary.perRun.length} runs`);
  console.log(`  defective packet not passed:  ${asRange(summary.detectionRange)}`);
  console.log(`  clean twin not passed:        ${asRange(summary.floorRange)}   <- the floor`);
  console.log(`  defect named in matched words:${asRange(summary.namedRange).padStart(11, ' ')}   <- a lower bound, see the header`);
  console.log(`  same complaint on the twin:   ${asRange(summary.sameComplaintRange)}   <- the sharper floor: the same objection where it no longer applies`);
  if (failed.length > 0) console.log(`\n${failed.length} dispatch(es) failed and are counted as misses; see the reports in ${outDir}`);
  console.log('\nNo threshold is applied. Read the ranges together, and read the reports.');

  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ opts, results, summary }, null, 2), 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
