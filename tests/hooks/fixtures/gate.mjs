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

      // The non-Error throw modes below exist because the exit-code invariant was
      // once asserted only over modes that threw a real Error, so the assertion was
      // made over an input set that excluded the values that broke it. That is the
      // L-08 shape: a count-based or coverage-shaped check is not a coverage check.
      // `throw null` and a bare reject each made `err.message` raise a TypeError
      // inside runGate's catch handler, which nothing caught, so Node exited 1 and
      // the gate failed open (C-06).

      case 'throw-null':
        throw null;

      case 'reject-bare':
        // No reason attached. This is the shape a spawn wrapper rejection takes.
        return Promise.reject();

      case 'throw-string':
        // Exits 2 either way, but the reason has to survive as more than `undefined`.
        throw 'fixture threw a bare string';

      case 'throw-symbol':
        throw Symbol('fixture symbol');

      case 'throw-hostile':
        // Reading `.message` throws, so a naive describe would throw inside the catch.
        throw {
          get message() {
            throw new Error('hostile getter');
          },
        };

      case 'floating-rejection':
        // Never awaited, so runGate's try/catch cannot see it. Without a process-level
        // handler Node reports an unhandled rejection and exits 1: another open gate.
        Promise.reject(new Error('fixture floating rejection'));
        await new Promise((resolve) => setTimeout(resolve, 30));
        return;

      case 'timer-throw':
        // Thrown from a callback, outside every stack runGate can wrap.
        setTimeout(() => {
          throw new Error('fixture timer exploded');
        }, 5);
        await new Promise((resolve) => setTimeout(resolve, 40));
        return;

      case 'swallow':
        // A gate that wraps its own body in try/catch and swallows the block. The
        // latch in block() is what stops this from becoming an open gate.
        try {
          block('fixture blocked, then swallowed');
        } catch {
          /* deliberately ignored */
        }
        return;

      case 'self-exit':
        // A contract violation, kept as a fixture so the boundary is pinned rather
        // than assumed. Contract 1 says a gate never calls process.exit; nothing in
        // the library can stop one that does.
        process.exit(7);
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
