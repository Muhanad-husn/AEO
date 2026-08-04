// Test fixture: a gate file that crashes at module scope, before runGate is entered.
//
// This is the one fail-open the library cannot close, and it exists as a fixture so the
// boundary is pinned by a test instead of assumed away. runGate installs its crash
// handlers when it is called; a syntax error or a bad import in the gate file itself
// happens first, so Node exits 1 and Claude Code treats that as a non-blocking error:
// the tool call proceeds (C-06). preflight()'s script-exists check catches a gate file
// that is missing, not one that is broken.

import { runGate } from '../../../plugin/hooks/lib.mjs';

throw new Error('gate file exploded at module scope');

// Unreachable. Present so the import is not dead and the shape matches a real gate.
await runGate({ name: 'crash-before-gate', run: () => {} });
