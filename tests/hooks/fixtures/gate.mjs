// Test fixture: a gate whose behaviour is selected by AEO_FIXTURE_MODE.
//
// runGate owns process exit, so its contract can only be tested by running a real
// gate in a real process and reading the exit code. This is that gate. It lives under
// tests/ and never ships: plugin/hooks/ holds gates and the library and nothing else
// (D1), and the shipped plugin carries no test files.

import { block, runGate } from '../../../plugin/hooks/lib.mjs';

const mode = process.env.AEO_FIXTURE_MODE ?? 'allow';

await runGate({
  name: 'fixture-gate',
  run: async (payload) => {
    switch (mode) {
      case 'allow':
        return;

      case 'block':
        // No `return` in front of block() — proving it does not need one.
        block(`fixture blocked ${payload.tool_name}`);
        // Unreachable. If block() ever stopped throwing, this would allow and the
        // test would catch it.
        return;

      case 'throw':
        throw new Error('fixture exploded');

      case 'swallow':
        // A gate that wraps its own body in try/catch and swallows the block. The
        // latch in block() is what stops this from becoming an open gate.
        try {
          block('fixture blocked, then swallowed');
        } catch {
          /* deliberately ignored */
        }
        return;

      case 'echo':
        // Proves the parsed payload reaches the gate intact.
        block(`saw command: ${payload.tool_input.command}`);
        return;

      default:
        throw new Error(`unknown fixture mode: ${mode}`);
    }
  },
});
