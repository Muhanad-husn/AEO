// The planted-defect cases for the verifier's positive control.
//
// Every case is a pair. One packet carries a known defect; its clean twin carries the
// same claim and the same artifact with that one defect removed and nothing else changed.
// The defective half answers "was it caught". The clean half answers the question a
// detection rate on its own cannot: how often the verifier declines to pass an artifact
// with nothing planted in it. A judge that objects to everything scores 1.00 on defects
// and is worth nothing, and only the twins can tell that apart from judgment.
//
// An anchor names the complaint, never the subject. It must not match any part of the
// packet -- not the claim, not either artifact -- or a report that merely quoted what it
// was given would score as a report that found something. The test file enforces that.
//
// The anchors are the STRICT reading only, and a lower bound. The headline rate is whether
// the artifact was passed at all, on both halves of the pair. A regex over a judge's prose
// undercounts by however much of the language it did not think of, which is a real effect
// and not a small one -- see the runner's header.
//
// The defects live where the verifier's territory is: things a person reads, follows, or
// looks at, and which no test settles. Nothing here could be caught by an assertion. A
// case that could be is a case that belongs in CI instead, and putting it here would
// measure the wrong thing.
//
// `defect` is a note for whoever maintains this file. It is never staged. A judge shown
// what it is supposed to find agrees that it found it, at rates near 1.00, and the number
// that comes back then describes the plumbing rather than the judgment.

/**
 * @typedef {object} Case
 * @property {string} id           Stable identifier, used in filenames and reports.
 * @property {string} claim        What the change is supposed to do for whoever uses it.
 * @property {string} defective    The artifact carrying the planted defect.
 * @property {string} clean        The same artifact with that defect, and only it, removed.
 * @property {string} defect       Human note on what was planted. Never staged.
 * @property {RegExp} anchor       Matches a report that names this particular problem.
 */

/** @type {Case[]} */
export const CASES = [
  {
    id: 'cleanup-refusal-says-nothing',
    claim:
      'When branch cleanup refuses to delete a branch, the operator can act on the ' +
      'message alone: it says why git refused and where the branch is still held.',
    defective: [
      '$ node cleanup.mjs --apply',
      'Scanning 14 local branches against origin...',
      '',
      'DELETED  feat/login-copy',
      'DELETED  fix/timeout-retry',
      'FAILED   release/1.2 (git branch -D refused - left intact)',
      'FAILED   feat/export-csv (git branch -D refused - left intact)',
      'FAILED   feat/audit-log (git branch -D refused - left intact)',
      '',
      '2 deleted, 3 left intact.',
    ].join('\n'),
    clean: [
      '$ node cleanup.mjs --apply',
      'Scanning 14 local branches against origin...',
      '',
      'DELETED  feat/login-copy',
      'DELETED  fix/timeout-retry',
      "FAILED   release/1.2 - git said: \"Cannot delete branch 'release/1.2' checked out at",
      "         '/home/dev/wt/release'\". Remove that worktree first (git worktree list).",
      "FAILED   feat/export-csv - git said: \"Cannot delete branch 'feat/export-csv' checked",
      "         out at '/home/dev/wt/export'\". Remove that worktree first (git worktree list).",
      "FAILED   feat/audit-log - git said: \"the branch is not fully merged\". Merge it or",
      '         re-run with --force to discard the unmerged commits.',
      '',
      '2 deleted, 3 left intact.',
    ].join('\n'),
    defect:
      'The refusal states no cause and does not say which worktree holds the branch, so ' +
      'the operator has to find out with a command nothing in the output suggests.',
    anchor: /\b(no cause|states no|no reason|without a reason|does ?n[o']?t (say|explain|name|state)|no explanation|not explained|unactionable|not actionable|no indication|says only|says nothing|nothing about the (reason|cause))/i,
  },

  {
    id: 'toggle-polarity',
    claim:
      'A reader of the privacy settings screen can tell, without experimenting, what the ' +
      'switch does and which way it is currently set.',
    defective: [
      'PRIVACY SETTINGS  (screen text, as rendered)',
      '',
      '  Disable usage analytics                                    [ ON ]',
      '  Turn this on to keep sending anonymous usage data.',
      '',
      '  Disable crash reports                                      [ OFF ]',
      '  Crash reports help us fix what breaks. Off by default.',
      '',
      '  [ Save ]',
    ].join('\n'),
    clean: [
      'PRIVACY SETTINGS  (screen text, as rendered)',
      '',
      '  Send usage analytics                                       [ ON ]',
      '  When on, anonymous usage data is sent.',
      '',
      '  Send crash reports                                         [ OFF ]',
      '  When on, crash reports are sent. Crash reports help us fix what breaks.',
      '',
      '  [ Save ]',
    ].join('\n'),
    defect:
      'The first row\'s label is negative and its helper text is positive, so ON means ' +
      'analytics are being sent and the label reads as though it means the opposite.',
    anchor: /\b(ambigu|contradict|opposit|polarity|double negative|negativ|confus|unclear|inconsist|mislead)/i,
  },

  {
    id: 'quickstart-undefined-command',
    claim:
      'Someone who has never seen this project can go from a clone to a passing test run ' +
      'using the quickstart alone.',
    defective: [
      '# Quickstart',
      '',
      '1. Clone the repository and change into it.',
      '',
      '       git clone https://example.com/ledger.git',
      '       cd ledger',
      '',
      '2. Install the dependencies.',
      '',
      '       npm install',
      '',
      '3. Set up the sample database.',
      '',
      '       ledgerctl db seed --sample',
      '',
      '4. Run the tests. They should all pass.',
      '',
      '       npm test',
    ].join('\n'),
    clean: [
      '# Quickstart',
      '',
      '1. Clone the repository and change into it.',
      '',
      '       git clone https://example.com/ledger.git',
      '       cd ledger',
      '',
      '2. Install the dependencies. This also puts `ledgerctl` on your PATH.',
      '',
      '       npm install',
      '       npm link',
      '',
      '3. Set up the sample database.',
      '',
      '       ledgerctl db seed --sample',
      '',
      '4. Run the tests. They should all pass.',
      '',
      '       npm test',
    ].join('\n'),
    defect:
      'Step 3 invokes ledgerctl, which nothing installs or puts on the path, so a ' +
      'first-time reader stops at a command not found.',
    anchor: /\b(from nowhere|never (installed|defined|introduced|put on)|not (installed|defined|introduced|on the path)|nothing (installs|defines|puts)|command not found|unavailable|missing install)/i,
  },

  {
    id: 'zero-that-means-unmeasured',
    claim:
      'The audit summary tells the operator how much was actually checked, so a run that ' +
      'checked nothing cannot be mistaken for a clean run.',
    defective: [
      '$ audit --input ./exports/2026-07/',
      'Loading records...',
      'Checked 0 records.',
      'No problems found.',
      'Exit code: 0',
      '',
      '(For reference: ./exports/2026-07/ does not exist on this machine. The July',
      'export was written to ./exports/2026-07-final/.)',
    ].join('\n'),
    clean: [
      '$ audit --input ./exports/2026-07/',
      'Loading records...',
      'Input directory ./exports/2026-07/ does not exist. Nothing was checked.',
      'Exit code: 2',
      '',
      '(For reference: ./exports/2026-07/ does not exist on this machine. The July',
      'export was written to ./exports/2026-07-final/.)',
    ].join('\n'),
    defect:
      'A missing input produces "Checked 0 records / No problems found" and exit 0, so a ' +
      'run that measured nothing reads as clean and is indistinguishable from a run that ' +
      'found nothing wrong.',
    // "silent" and "as a pass" were added after a run in which the verifier found this
    // defect exactly and described it in those words. That is an anchor gap being closed,
    // not a rate being tuned: the report it missed is quoted in the slice log.
    anchor: /\b(misleading|reads? as (a )?(clean|pass)|as a pass|indistinguish|conflat|silent|false (reassurance|confidence|clean)|passes for|looks like a clean)/i,
  },

  {
    id: 'release-note-contradiction',
    claim:
      'A reader of the release note comes away knowing what the new default is and what ' +
      'they have to change.',
    defective: [
      '## 3.0.0',
      '',
      '**Breaking:** `--follow-symlinks` now defaults to **off**. Runs that relied on',
      'symlinks being followed must pass the flag explicitly.',
      '',
      'Example of the new behaviour:',
      '',
      '    $ scan ./data',
      '    config: follow-symlinks=true (default)',
      '    scanned 812 files, 47 through symlinks',
      '',
      'No other flags changed.',
    ].join('\n'),
    clean: [
      '## 3.0.0',
      '',
      '**Breaking:** `--follow-symlinks` now defaults to **off**. Runs that relied on',
      'symlinks being followed must pass the flag explicitly.',
      '',
      'Example of the new behaviour:',
      '',
      '    $ scan ./data',
      '    config: follow-symlinks=false (default)',
      '    scanned 765 files, 0 through symlinks',
      '',
      'No other flags changed.',
    ].join('\n'),
    defect:
      'The prose says the default is now off; the example directly below contradicts it ' +
      'by showing follow-symlinks=true, so the reader cannot tell which is right.',
    anchor: /\b(contradict|inconsist|disagree|conflict|mismatch|opposit)/i,
  },

  {
    id: 'migration-guide-short',
    claim:
      'The migration guide covers every breaking change in the release, so a reader who ' +
      'follows it end to end is not surprised on upgrade.',
    defective: [
      '# Migrating to 3.0',
      '',
      'This guide covers all three breaking changes in 3.0.',
      '',
      '## 1. `--follow-symlinks` defaults to off',
      '',
      'Pass the flag explicitly if you relied on the old behaviour.',
      '',
      '## 2. The `scan.legacyIndex` config key is gone',
      '',
      'Delete it. It has had no effect since 2.4.',
      '',
      '---',
      '',
      'CHANGELOG excerpt, staged for reference:',
      '',
      '    3.0.0',
      '    BREAKING  --follow-symlinks now defaults to off',
      '    BREAKING  scan.legacyIndex removed',
      '    BREAKING  scan --json now emits NDJSON, one object per line',
      '    feat      --exclude accepts globs',
    ].join('\n'),
    clean: [
      '# Migrating to 3.0',
      '',
      'This guide covers all three breaking changes in 3.0.',
      '',
      '## 1. `--follow-symlinks` defaults to off',
      '',
      'Pass the flag explicitly if you relied on the old behaviour.',
      '',
      '## 2. The `scan.legacyIndex` config key is gone',
      '',
      'Delete it. It has had no effect since 2.4.',
      '',
      '## 3. `scan --json` emits NDJSON',
      '',
      'One object per line instead of a single array. Parsers that read the whole',
      'output as one JSON document need updating.',
      '',
      '---',
      '',
      'CHANGELOG excerpt, staged for reference:',
      '',
      '    3.0.0',
      '    BREAKING  --follow-symlinks now defaults to off',
      '    BREAKING  scan.legacyIndex removed',
      '    BREAKING  scan --json now emits NDJSON, one object per line',
      '    feat      --exclude accepts globs',
    ].join('\n'),
    defect:
      'The guide opens by promising all three breaking changes and documents two. The ' +
      'NDJSON change is missing from the guide and appears only in the changelog staged ' +
      'beside it.',
    anchor: /\b(only two|two of the three|documents (only )?two|missing|omit|absent|not covered|undocumented|uncovered|incomplete)/i,
  },
];

/** The two variants every case is run in. */
export const VARIANTS = /** @type {const} */ (['defective', 'clean']);

/**
 * The packet as the verifier receives it: a claim and an artifact, and nothing else.
 *
 * Nothing about the case's own bookkeeping goes in. Not which variant this is, not what
 * was planted, not that anything was planted at all, not what a previous run concluded.
 * The one property this function has to hold is that its output is a function of `claim`
 * and the chosen artifact alone.
 *
 * @param {Case} testCase
 * @param {'defective'|'clean'} variant
 * @returns {string}
 */
export function buildPacket(testCase, variant) {
  const artifact = variant === 'clean' ? testCase.clean : testCase.defective;
  return ['# Verification packet', '', '## The claim', '', testCase.claim, '', '## The artifact', '', artifact, ''].join('\n');
}
