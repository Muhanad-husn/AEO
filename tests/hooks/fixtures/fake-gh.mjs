// Test double for `gh`, run through session-status.mjs's AEO_GH_COMMAND /
// AEO_GH_PREFIX_ARGS seam (see session-status.mjs's comment on that seam, and L-03's
// pattern: in-process mocking cannot reach a subprocess CLI child). Tests point
// AEO_GH_COMMAND at `node` and AEO_GH_PREFIX_ARGS at this file's path, which spawns a
// real, directly-executable binary on every platform -- including Windows, where a
// `.cmd` shim is not directly executable without a shell, unlike the real `gh.exe`.
//
// Behaviour is picked by AEO_FAKE_GH_MODE, the same convention fixtures/gate.mjs and
// fixtures/reporter.mjs use for AEO_FIXTURE_MODE.

const mode = process.env.AEO_FAKE_GH_MODE || 'empty';
const args = process.argv.slice(2);

if (mode === 'error') {
  process.stderr.write('gh: authentication required, run `gh auth login`\n');
  process.exit(1);
} else if (mode === 'hang') {
  setInterval(() => {}, 1000); // never resolves on its own; the caller's timeout kills it
} else if (mode === 'huge') {
  // Exceeds session-status.mjs's maxBuffer (200,000 bytes); never valid JSON either way.
  process.stdout.write('['.padEnd(1_000_000, 'x'));
} else if (mode === 'garbage') {
  process.stdout.write('not json');
} else if (mode === 'silent') {
  // Exit 0, print nothing. The real `gh --json` always prints at least `[]`, so this is
  // what a wrapper shim or a version that answered differently looks like.
} else if (mode === 'object') {
  // Valid JSON, wrong shape. `{"message":"Not Found"}` is what a gh that resolved no
  // repository prints, and it parses cleanly.
  process.stdout.write(JSON.stringify({ message: 'Not Found', documentation_url: 'https://example.invalid' }));
} else if (mode === 'overflow') {
  // Exactly as many items as were asked for, so the hook's `limit + 1` request comes
  // back full and the renderer can see the list was cut.
  const limit = Number(args[args.indexOf('--limit') + 1]);
  const kind = args[0] === 'issue' ? 'issue' : 'pr';
  const items = Array.from({ length: limit }, (_, i) => ({ number: i + 1, title: `fixture ${kind} ${i + 1}` }));
  process.stdout.write(JSON.stringify(items));
} else if (mode === 'items') {
  if (args[0] === 'issue') {
    process.stdout.write(JSON.stringify([{ number: 1, title: 'fixture issue', labels: [{ name: 'bug' }] }]));
  } else if (args.includes('merged')) {
    process.stdout.write(JSON.stringify([{ number: 3, title: 'fixture merged pr', mergedAt: '2026-08-01T00:00:00Z' }]));
  } else {
    process.stdout.write(JSON.stringify([{ number: 2, title: 'fixture open pr', isDraft: true }]));
  }
} else {
  process.stdout.write('[]');
}
