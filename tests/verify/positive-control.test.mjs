// The deterministic half of the verifier's positive control.
//
// The control itself makes model calls and reports a range; this file makes none and
// asserts what has an oracle. Three things, and they are the three ways a control of this
// kind is quietly worthless:
//
//   1. The scorer is wrong, so the numbers describe the matcher rather than the judge.
//   2. A case is malformed -- an anchor that can never fire, a twin identical to the
//      defective artifact -- so a rate is computed over packets that measure nothing.
//   3. A packet leaks its own answer, so the run measures plumbing. A judge shown what it
//      is meant to find agrees that it found it.
//
// All in-process, no subprocess, no network. That is why it sits in the fast tier.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { CASES, VARIANTS, buildPacket } from './cases.mjs';
import { RESPONSE_FORMAT, charterBody, composePrompt, parseStatus, scoreReport, summarise } from './positive-control.mjs';

const CLEAN_REPORT = 'Nothing to report. The artifact does what the claim says.\n\nDONE';

// ---------------------------------------------------------------------------
// The case inventory
// ---------------------------------------------------------------------------

describe('the planted cases', () => {
  test('there is more than one, and their ids are unique', () => {
    assert.ok(CASES.length >= 2, `expected several cases, found ${CASES.length}`);
    assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length);
  });

  test('every case carries a claim, both artifacts, a note and an anchor', () => {
    for (const c of CASES) {
      for (const field of ['id', 'claim', 'defective', 'clean', 'defect']) {
        assert.equal(typeof c[field], 'string', `${c.id}: ${field} is not a string`);
        assert.notEqual(c[field].trim(), '', `${c.id}: ${field} is empty`);
      }
      assert.ok(c.anchor instanceof RegExp, `${c.id}: anchor is not a RegExp`);
    }
  });

  test('each clean twin genuinely differs from its defective artifact', () => {
    for (const c of CASES) assert.notEqual(c.defective, c.clean, `${c.id}: the twin is identical`);
  });
});

// ---------------------------------------------------------------------------
// The anchors
// ---------------------------------------------------------------------------

describe('the anchors', () => {
  test("each one fires on a report that names its case's defect", () => {
    // The note is the plainest description of the planted defect there is. An anchor that
    // cannot match it cannot match a verifier that found the same thing, and a case whose
    // anchor never fires contributes a permanent zero nobody would read as a bug.
    for (const c of CASES) {
      assert.ok(c.anchor.test(c.defect), `${c.id}: anchor ${c.anchor} does not match its own defect note`);
    }
  });

  test('none of them fires on a report that found nothing', () => {
    for (const c of CASES) {
      assert.equal(c.anchor.test(CLEAN_REPORT), false, `${c.id}: anchor ${c.anchor} fires on an empty-handed report`);
    }
  });

  test('none of them fires on any part of the packet it will be scored against', () => {
    // An anchor naming the subject rather than the complaint matches a report that did
    // nothing but quote what it was handed. It would then score as a report that found
    // something, on both the defective packet and its twin.
    for (const c of CASES) {
      for (const variant of VARIANTS) {
        const packet = buildPacket(c, variant);
        assert.equal(c.anchor.test(packet), false, `${c.id}/${variant}: anchor ${c.anchor} matches the packet itself`);
      }
    }
  });

  test('an anchor with the global flag would carry state between calls, so none has it', () => {
    // A /g regex advances lastIndex across .test() calls, so the same report would score
    // differently depending on what was scored before it.
    for (const c of CASES) assert.equal(c.anchor.global, false, `${c.id}: anchor is global`);
  });
});

// ---------------------------------------------------------------------------
// The packet leaks nothing
// ---------------------------------------------------------------------------

describe('the packet', () => {
  test('is built from the claim and one artifact, and nothing else', () => {
    for (const c of CASES) {
      for (const variant of VARIANTS) {
        const packet = buildPacket(c, variant);
        const artifact = variant === 'clean' ? c.clean : c.defective;
        assert.ok(packet.includes(c.claim), `${c.id}/${variant}: claim missing`);
        assert.ok(packet.includes(artifact), `${c.id}/${variant}: artifact missing`);
        // Everything the packet contains beyond its two inputs and the two headings.
        const residue = packet.replace(c.claim, '').replace(artifact, '');
        assert.equal(residue.replace(/[#\s]/g, ''), 'VerificationpacketTheclaimTheartifact', `${c.id}/${variant}: packet carries something else`);
      }
    }
  });

  test('never names the variant, the planting, or a verdict', () => {
    const leaks = [/\bplant/i, /\bdefect/i, /\bclean twin/i, /\bexpected\b/i, /\bverdict\b/i, /\bDONE\b/, /\bBLOCKED\b/, /\bNEEDS_CONTEXT\b/];
    for (const c of CASES) {
      for (const variant of VARIANTS) {
        const packet = buildPacket(c, variant);
        for (const leak of leaks) {
          assert.equal(leak.test(packet), false, `${c.id}/${variant}: packet matches ${leak}`);
        }
      }
    }
  });

  test('never carries the maintainer note describing what was planted', () => {
    for (const c of CASES) {
      for (const variant of VARIANTS) {
        assert.equal(buildPacket(c, variant).includes(c.defect), false, `${c.id}/${variant}: the defect note reached the packet`);
      }
    }
  });

  test('the two variants of a case produce different packets', () => {
    for (const c of CASES) assert.notEqual(buildPacket(c, 'defective'), buildPacket(c, 'clean'));
  });
});

// ---------------------------------------------------------------------------
// What is actually sent
// ---------------------------------------------------------------------------

describe('the prompt', () => {
  test('is the packet followed by the format line, and nothing more', () => {
    for (const c of CASES) {
      for (const variant of VARIANTS) {
        const packet = buildPacket(c, variant);
        const prompt = composePrompt(packet);
        assert.ok(prompt.startsWith(packet), `${c.id}/${variant}: the packet is not sent intact`);
        assert.equal(prompt.slice(packet.length).replace(/[-\s]/g, ''), RESPONSE_FORMAT.replace(/\s/g, ''));
      }
    }
  });

  test('the format line is byte-identical for every packet, so it cannot tilt one against another', () => {
    const tails = new Set();
    for (const c of CASES) {
      for (const variant of VARIANTS) {
        const packet = buildPacket(c, variant);
        tails.add(composePrompt(packet).slice(packet.length));
      }
    }
    assert.equal(tails.size, 1, 'the appended instruction varies between packets');
  });

  test('the format line names the four statuses and nothing about any case', () => {
    for (const status of ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT']) {
      assert.ok(RESPONSE_FORMAT.includes(status), `the format line omits ${status}`);
    }
    for (const c of CASES) {
      assert.equal(c.anchor.test(RESPONSE_FORMAT), false, `the format line matches ${c.id}'s anchor`);
      assert.equal(RESPONSE_FORMAT.includes(c.id), false, `the format line names ${c.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// parseStatus
// ---------------------------------------------------------------------------

describe('parseStatus', () => {
  test('reads the four statuses', () => {
    assert.equal(parseStatus('...\n\nDONE'), 'DONE');
    assert.equal(parseStatus('...\n\nBLOCKED'), 'BLOCKED');
    assert.equal(parseStatus('...\n\nNEEDS_CONTEXT'), 'NEEDS_CONTEXT');
    assert.equal(parseStatus('...\n\nDONE_WITH_CONCERNS'), 'DONE_WITH_CONCERNS');
  });

  test('DONE_WITH_CONCERNS is not read as a DONE that happens to have a suffix', () => {
    assert.equal(parseStatus('Status: DONE_WITH_CONCERNS'), 'DONE_WITH_CONCERNS');
  });

  test('takes the verdict the report settles on, not one it quoted on the way', () => {
    assert.equal(parseStatus('I will report DONE unless something is wrong.\n\nBLOCKED'), 'BLOCKED');
  });

  test('a report with no status word is UNPARSED, never a silent DONE', () => {
    assert.equal(parseStatus('the packet was unreadable'), 'UNPARSED');
    assert.equal(parseStatus(''), 'UNPARSED');
    assert.equal(parseStatus(undefined), 'UNPARSED');
  });
});

// ---------------------------------------------------------------------------
// scoreReport
// ---------------------------------------------------------------------------

describe('scoreReport', () => {
  const testCase = CASES[0];

  test('a hit needs both a flagged verdict and the right subject', () => {
    const found = scoreReport('The failure line states no cause.\n\nDONE_WITH_CONCERNS', testCase);
    assert.equal(found.hit, true);
    assert.equal(found.flagged, true);
    assert.equal(found.anchored, true);
  });

  test('naming the subject while concluding all is well is not a hit', () => {
    const scored = scoreReport('It could be argued the line states no cause, but it reads fine.\n\nDONE', testCase);
    assert.equal(scored.anchored, true);
    assert.equal(scored.flagged, false);
    assert.equal(scored.hit, false);
  });

  test('objecting to something else entirely is not a hit', () => {
    const scored = scoreReport('The transcript is hard to read at this width.\n\nDONE_WITH_CONCERNS', testCase);
    assert.equal(scored.flagged, true);
    assert.equal(scored.anchored, false);
    assert.equal(scored.hit, false);
  });

  test('NEEDS_CONTEXT counts as flagged, since it is a refusal to pass the artifact', () => {
    assert.equal(scoreReport('The message says nothing about the failure.\n\nNEEDS_CONTEXT', testCase).flagged, true);
  });

  test('an unparseable or empty report is a miss, not a pass', () => {
    const scored = scoreReport('', testCase);
    assert.equal(scored.status, 'UNPARSED');
    assert.equal(scored.hit, false);
  });

  test('the scorer cannot tell which variant produced a report', () => {
    // scoreReport takes text and a case, never a variant. Which of the two numbers a
    // result lands in is decided in summarise, from the variant recorded beside it, so
    // there is no path by which knowing the answer could change the score.
    const text = 'The message states no cause for the refusal.\n\nDONE_WITH_CONCERNS';
    assert.deepEqual(scoreReport(text, testCase), scoreReport(text, testCase));
    assert.equal(scoreReport.length, 2, 'scoreReport takes a third argument, which could only be the answer');
  });
});

// ---------------------------------------------------------------------------
// summarise
// ---------------------------------------------------------------------------

describe('summarise', () => {
  const row = (run, variant, counted) => ({
    run,
    caseId: CASES[0].id,
    variant,
    hit: counted,
    flagged: counted,
    status: counted ? 'DONE_WITH_CONCERNS' : 'DONE',
  });

  test('reports a range across runs rather than one pooled number', () => {
    const s = summarise([
      row(1, 'defective', true),
      row(1, 'clean', false),
      row(2, 'defective', false),
      row(2, 'clean', false),
    ]);
    assert.equal(s.perRun.length, 2);
    assert.deepEqual(s.detectionRange, { min: 0, max: 1 });
    assert.deepEqual(s.floorRange, { min: 0, max: 0 });
  });

  test('a range whose ends agree is still a range over more than one run', () => {
    const s = summarise([row(1, 'defective', true), row(2, 'defective', true)]);
    assert.deepEqual(s.detectionRange, { min: 1, max: 1 });
    assert.equal(s.perRun.length, 2);
  });

  test('per-case counts pool the runs, so a case that never fires is visible', () => {
    const s = summarise([row(1, 'defective', false), row(2, 'defective', false)]);
    const first = s.perCase.find((c) => c.id === CASES[0].id);
    assert.deepEqual(first.detection, { hits: 0, of: 2 });
    assert.deepEqual(first.named, { hits: 0, of: 2 });
  });

  test('both headline rates count the same thing: an artifact that was not passed', () => {
    // Detection and the floor are the same rule on different packets. That is what makes
    // the gap between them mean something; scoring the two sides differently would make
    // the floor a floor for a number it was not measured against.
    const flagged = (variant) => ({ run: 1, caseId: CASES[0].id, variant, hit: false, flagged: true, status: 'BLOCKED' });
    const s = summarise([flagged('clean'), flagged('defective')]);
    assert.deepEqual(s.perRun[0].floor, { hits: 1, of: 1 });
    assert.deepEqual(s.perRun[0].detection, { hits: 1, of: 1 });
  });

  test('the strict reading is separate, and needs the matching complaint', () => {
    const flaggedElsewhere = { run: 1, caseId: CASES[0].id, variant: 'defective', hit: false, flagged: true, status: 'BLOCKED' };
    const s = summarise([flaggedElsewhere]);
    assert.deepEqual(s.perRun[0].named, { hits: 0, of: 1 });
    assert.deepEqual(s.perRun[0].detection, { hits: 1, of: 1 });
  });

  test('an unparsed report is not counted as an artifact that was passed', () => {
    const unparsed = { run: 1, caseId: CASES[0].id, variant: 'defective', hit: false, flagged: false, status: 'UNPARSED' };
    const s = summarise([unparsed]);
    assert.equal(s.perRun[0].unparsed, 1);
    assert.deepEqual(s.perRun[0].detection, { hits: 0, of: 1 });
  });

  test('every case appears in the per-case table even with no results at all', () => {
    assert.equal(summarise([]).perCase.length, CASES.length);
  });
});

// ---------------------------------------------------------------------------
// The charter under test
// ---------------------------------------------------------------------------

describe('charterBody', () => {
  test('strips the frontmatter and keeps the prose', () => {
    const body = charterBody('---\nname: verifier\ntools: Read\n---\n\n# Verifier\n\nYou are shown a claim.\n');
    assert.equal(body.startsWith('# Verifier'), true);
    assert.equal(body.includes('tools: Read'), false);
  });

  test('a body with no frontmatter is returned intact', () => {
    assert.equal(charterBody('# Verifier\n\nbody\n'), '# Verifier\n\nbody');
  });
});
