// AEO review-jail: the gate that makes reviewer independence a seal.
//
// WHY THIS EXISTS (L-01). Reviewer independence was specified as a dispatch
// convention: "the reviewer never sees the builder's report". Production learned
// that this is not a seal and wrote the correction into a hook header:
//
//   An agent holding file tools reads the repo whatever it is told, so "we asked
//   it not to" is not a seal.
//
// A reviewer holding Read, Grep and Glob can go and read the builder's branch, its
// commit messages and the PR body. So the seal is a hook, not a sentence in a prompt.
//
// WHY DENY BY DEFAULT, AND NOT A BLOCKLIST. For the reviewer role every tool is
// blocked except one narrow allowance. The polarity is the whole design. A tool added
// to Claude Code tomorrow, an MCP server the founder installs next week, a Task call
// that spawns an unjailed helper: each is denied without anyone editing this file. A
// blocklist of known-dangerous tools would fail open on exactly those, and it would
// fail open silently, which for this gate is the worst outcome available. Its entire
// product is a guarantee about what an agent could not see. A jail that quietly stops
// matching still advertises independence it is no longer providing.
//
// THE ONE ALLOWANCE: a Read of a file under the staged packet directory, which lives
// in the OS temp scratchpad, outside the repo entirely (D12 forbids the plugin root,
// which is ephemeral). Outside the repo is load-bearing. A packet staged inside the
// repo is reachable by an ordinary repo read, and the jail would buy nothing.
//
// WHAT THIS COSTS, AND WHO PAYS IT. A jailed reviewer cannot run the tests it is
// reviewing, cannot grep for a second occurrence of a pattern, cannot open the file
// around a diff hunk, and cannot check any number it is told. So the packet must carry
// evidence rather than pointers, and the party that assembles it must not be the party
// under review. That constraint belongs to the dispatch, not to this file, but it is
// created here and it is stated here so the next reader does not have to infer it.
//
// The gate never blocks anyone else. isAeoRole is anchored because agent_type is not a
// subagent flag (C-02): a main session launched with --agent carries it too, and a
// plugin subagent reports the namespaced `aeo:reviewer`, never a bare `reviewer`.
//
// Nothing in this file is exported and nothing should import it. The gate runs on load,
// so an import would read stdin and exit. Its tests run it as a process, which is also
// the only level at which the thing being asserted, an exit code, is real.

import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { block, isAeoRole, isPathInside, normalizeHookPath, runGate } from './lib.mjs';

/** The role this gate jails. Anchored by isAeoRole to `aeo:reviewer` exactly. */
const JAILED_ROLE = 'reviewer';

/** The only tool a jailed reviewer may call. Exact, case-sensitive. */
const ALLOWED_TOOL = 'Read';

/**
 * The seam that names the packet directory. Absolute paths only.
 *
 * A hook inherits Claude Code's environment, which is fixed at launch, so this cannot
 * be varied per dispatch. It exists so an operator whose temp directory is unusual, and
 * the test battery, can point the jail somewhere else. The convention below is what
 * actually runs.
 */
const PACKET_DIR_ENV = 'AEO_REVIEW_PACKET_DIR';

/** The convention: `<os temp>/aeo-review-packets`. Computable by stager and gate alike. */
const DEFAULT_PACKET_DIRNAME = 'aeo-review-packets';

/**
 * Where the packet lives.
 *
 * Unset is the normal case and resolves to the convention, so there is no state in
 * which this gate has no directory to compare against and reasons its way to "allow".
 * A relative value is a misconfiguration rather than a location: resolving it would
 * resolve against the hook's own working directory, which is not a place anyone staged
 * anything. It returns null, and null denies every tool including Read. That is loud,
 * it costs one review, and it is the only direction a jail is allowed to fail.
 *
 * @returns {{root: string|null, source: 'env'|'convention'|'invalid'}}
 */
function resolvePacketRoot({ env = process.env, tmpdir = os.tmpdir, platform = process.platform } = {}) {
  const raw = typeof env?.[PACKET_DIR_ENV] === 'string' ? env[PACKET_DIR_ENV].trim() : '';
  if (raw === '') return { root: path.join(tmpdir(), DEFAULT_PACKET_DIRNAME), source: 'convention' };
  const normalised = normalizeHookPath(raw, { platform });
  if (!path.isAbsolute(normalised)) return { root: null, source: 'invalid' };
  return { root: normalised, source: 'env' };
}

/**
 * An absolute path with every symlink and alias on it resolved.
 *
 * isPathInside compares strings. It does not call realpath, and two names for one
 * directory therefore never compare equal. That is not theoretical: os.tmpdir() on
 * macOS returns `/var/folders/…`, which is a symlink to `/private/var/folders/…`, and a
 * Windows TEMP can arrive as an 8.3 short name. Comparing one form against the other
 * makes every staged Read look like an escape, or worse, makes an escape look staged.
 * Both sides go through here before they are compared.
 *
 * The loop handles a path that does not exist yet by realpath-ing the deepest ancestor
 * that does and re-appending the rest. A staged file the reviewer names before it is
 * written still resolves to the right place.
 */
function realise(p) {
  let current = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      return path.join(realpathSync.native(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

const CHARTER = (root) =>
  `You are the AEO reviewer and you are sealed off from the repository by design (L-01), ` +
  `so that your verdict is about the evidence you were given rather than about the branch ` +
  `you went and read. The only call available to you is Read of a file under ${root}. ` +
  `If the packet does not contain what you need to judge the claim, say exactly that in ` +
  `your verdict. An insufficient packet is a finding, not something to work around.`;

await runGate({
  name: 'review-jail',
  run: (payload) => {
    if (!isAeoRole(payload, JAILED_ROLE)) return;

    // Compared exactly, never trimmed or lowercased. Trimming would let ` Read ` through,
    // and every normalisation applied here is a widening of the one hole this gate has.
    const allowed = payload?.tool_name === ALLOWED_TOOL;
    const tool =
      typeof payload?.tool_name === 'string' && payload.tool_name.trim() !== ''
        ? JSON.stringify(payload.tool_name)
        : '(unnamed tool)';

    const { root, source } = resolvePacketRoot();
    if (root === null) {
      block(
        `${PACKET_DIR_ENV} is set to a relative path, which names no staged location, so ` +
          `the review-jail cannot tell a staged read from an escape and blocks everything, ` +
          `${tool} included. Set it to an absolute path outside the repository, or unset it ` +
          `to use the default. ${CHARTER('the packet directory')}`,
      );
    }

    if (!allowed) {
      block(`${tool} is not available to the reviewer role. ${CHARTER(root)}`);
    }

    const requested = payload?.tool_input?.file_path;
    if (typeof requested !== 'string' || requested.trim() === '') {
      block(`Read without a readable file_path. ${CHARTER(root)}`);
    }

    const named = normalizeHookPath(requested.trim());
    let target = named;
    if (!path.isAbsolute(target)) {
      const base = typeof payload?.cwd === 'string' ? normalizeHookPath(payload.cwd.trim()) : '';
      if (!base || !path.isAbsolute(base)) {
        block(
          `Read of the relative path ${named}, which the review-jail cannot resolve to a ` +
            `location, so it cannot tell whether it is staged. Name the file by its ` +
            `absolute path. ${CHARTER(root)}`,
        );
      }
      target = path.resolve(base, target);
    }

    if (!isPathInside(realise(root), realise(target))) {
      block(
        `Read of ${named}, which is outside the staged review packet` +
          `${source === 'convention' ? '' : ` (${PACKET_DIR_ENV})`}. ${CHARTER(root)}`,
      );
    }
  },
});
