// AEO redirect-guard: role subagents never write the harness's own config through a
// shell. PreToolUse hook on Bash and PowerShell.
//
// path-guard fences Edit/Write/MultiEdit/NotebookEdit against a project's own
// `.claude/`, but a role that holds Bash or PowerShell (every builder does, to run
// tests) could step around it with one redirect: `printf '{}' > .claude/settings.json`
// never reached path-guard at all, because path-guard's matcher only ever sees the four
// file tools. Demonstrated live against a real dispatched builder (#116). This gate is
// path-guard's own KNOWN LIMIT closed: same fence, same identity scoping
// (isAnyAeoRole -- the orchestrator and every non-AEO agent pass, C-02), reached from
// the shell surface instead of the file-tool surface. It is wired BEFORE commit-gate in
// hooks.json (a role's most likely reason to touch `.claude/` is a commit, not a test
// run, but the point stands either way): a role confused enough to redirect into the
// harness should be told so before this plugin spends a full test-suite run deciding
// whether to let the surrounding command through.
//
// WHAT COUNTS AS "INSIDE THE HARNESS" IS NOT REDERIVED HERE. Once a target is resolved
// to an absolute path, whether it sits inside a project's `.claude/` -- the V-11
// root-named-.claude case, ordinary containment, and the #113 linked-worktree
// discriminator that must skip only one level's block rather than return out of the
// whole walk -- is lib.mjs's isPathIntoHarness, the same function path-guard calls.
// #113 was a real hole found in an EARLIER version of that walk (a bypass that returned
// out of the whole loop dropped every fence above it); a second, hand-copied version of
// it in this file is exactly how that bug would come back. See lib.mjs's header on that
// function for the long form.
//
// ---------------------------------------------------------------------------------
// DECISION 1 (founder-taken, and the opposite of every other gate's fail-closed
// posture): the fail direction on a target this gate cannot fully resolve.
// ---------------------------------------------------------------------------------
//
//   - A target that resolves (no unexpanded variable, glob or substitution, and either
//     an absolute path or a relative one with a known base directory) into a `.claude/`
//     tree: BLOCK.
//   - A target that cannot be resolved -- it carries `$`, `*`, `?`, `~`, or its base
//     directory is itself unknown because a `cd` earlier in the same command could not
//     be named -- but whose raw, unexpanded text names a literal `.claude` path segment:
//     BLOCK. `> .claude/$X` and `> "$DIR/.claude/out"` are refused this way.
//   - A target that cannot be resolved and whose raw text names no `.claude` segment:
//     ALLOW. `npm test > "$LOG"` passes.
//   - A line the parser cannot read at all (an unterminated quote, a backtick
//     substitution): ALLOW, unless its raw text contains a literal `.claude` segment.
//
// WHY THE OTHER DIRECTION WAS REJECTED. This gate fires on every Bash or PowerShell call
// every AEO role makes -- not once per commit like commit-gate, every call. Blocking
// every unresolvable redirect would refuse a huge share of ordinary work: a builder
// redirecting test output to a path held in a variable, or any line that happens to
// carry a backtick for an unrelated reason. A gate that fires on legitimate work gets
// switched off, which protects nothing. What this leaves open is a target hidden
// entirely behind a variable whose value is never named in the command text -- that is
// evasion, not the role confusion this gate defends against, and the founder accepted
// that trade explicitly rather than accepting a gate nobody could use.
//
// ---------------------------------------------------------------------------------
// DECISION 2: Bash AND PowerShell, both covered.
// ---------------------------------------------------------------------------------
//
// PowerShell was originally scoped out as a documented gap, on the assumption its
// redirect syntax and its cmdlets were a second surface to build. Checked before
// building anything further: lib.mjs's segmenter already reads both shells (SHELL_TOOLS'
// own header states this), and PowerShell's `>`, `>>` and `2>` are the identical syntax
// the segmenter already marks `target: true` -- so bare redirects were never the gap.
// What PowerShell adds beyond that is its cmdlet route, the PowerShell equivalent of
// `tee`/`cp`/`mv`: `Set-Content`, `Add-Content`, `Out-File`, `Tee-Object`, matched
// case-insensitively (PowerShell cmdlet names are), each read for `-Path`, `-FilePath`
// or `-LiteralPath` (as a separate word or as `-Path:value`) and for the positional form
// where the path follows the cmdlet name with no flag at all. That is covered below,
// alongside the Bash tool routes, by the same checkTarget the bare redirects go through.
//
// ---------------------------------------------------------------------------------
// BEYOND BARE REDIRECTS: the write-through-a-tool routes covered, and where this stops.
// ---------------------------------------------------------------------------------
//
// Covered: `tee` (every non-flag word is a destination), `cp` / `mv` / `install` (the
// LAST non-flag word, the ordinary one-destination form), `dd of=`, `sed -i` /
// `sed --in-place` (files following the script, or every non-flag word when `-e`/`-f`
// supplies the script separately), and the four PowerShell cmdlets above. An unbounded
// table of every program that can write a file is exactly the over-engineering tripwire
// this project names, so the line was drawn at the routes a role confused about Edit and
// Write realistically reaches for, not at every program capable of touching a file.
//
// KNOWN LIMIT: arbitrary code execution that can itself write a file --
// `python -c '...'`, `node -e '...'`, a script file handed to an interpreter -- is not
// read for embedded writes. Doing so means parsing an arbitrary second language inside
// this one, which is not a bounded surface and does not belong in a shell-command gate.
//
// KNOWN LIMIT: `cp -t DIR` / `--target-directory=DIR` and `install -D SRC DIR/name`
// name their destination through a flag's value rather than the last positional word;
// this gate reads only the last-positional form.
//
// KNOWN LIMIT: PowerShell's own abbreviated-parameter matching (`-Pat` for `-Path`,
// unambiguous prefixes) is not read; only the full flag spelling is. Comma-separated
// path arrays (`-Path a.txt,b.txt`) are read as one word, not split.
//
// KNOWN LIMIT: a program invoked through an absolute path, a relative path, a shell
// alias or a wrapper script is not recognised -- the program-name match is the bare
// command word (`cp`, not `/bin/cp` or `busybox cp`).
//
// KNOWN LIMIT: one operating directory is resolved for the WHOLE command
// (resolveOperationDir), not per segment. A command that `cd`s twice to two different
// directories before its second write is judged against the first `cd` alone. Every
// other Phase 1 gate that reads a command's directory makes the same simplification
// (commit-gate, block-merge); this gate does not widen it.

import path from 'node:path';

import {
  HARNESS_DIRNAME,
  block,
  commandSegments,
  isAnyAeoRole,
  isPathIntoHarness,
  isShellTool,
  normalizeHookPath,
  operationDirs,
  resolveOperationDir,
  runGate,
} from './lib.mjs';

const FENCE_REASON =
  `role subagents may not write into ${HARNESS_DIRNAME}/ through a shell command - harness config governs the ` +
  'roles, so a role does not edit it. Ask the orchestrator';

// A word carrying one of these was not expanded by this scanner (it does not run a
// shell, D2's own reasoning). `~` is bash home-directory expansion; the other three are
// variable, glob and (already-handled-elsewhere) backtick substitution markers.
const UNRESOLVABLE_MARKER = /[$*?~]/;

/** True when `word` names no filesystem location this gate can resolve on its own. */
function isUnresolvable(word, dir) {
  if (UNRESOLVABLE_MARKER.test(word)) return true;
  const normalized = normalizeHookPath(word);
  if (path.isAbsolute(normalized)) return false;
  return !(typeof dir === 'string' && path.isAbsolute(dir));
}

// A boundary a `.claude` segment can sit behind, on EITHER side, without being resolved:
// a path separator, a quote or backtick a word was wrapped in before this gate stripped
// it, whitespace, or a shell operator character -- everything scanShell itself treats as
// not-part-of-a-word. `.claude-evil` and `prefix.claude-suffix` are not this segment
// (V-12: whole segment, never a substring); a bare `.claude` with nothing after it, or
// one instance among several inside an unparseable whole command line, is.
const HARNESS_TEXT_RE = /(^|[\\/'"` \t;&|()<>])\.claude($|[\\/'"` \t;&|()<>])/;
const HARNESS_TEXT_RE_CI = /(^|[\\/'"` \t;&|()<>])\.claude($|[\\/'"` \t;&|()<>])/i;

/**
 * Whole-segment `.claude` test over raw, unexpanded text -- decision 1's fallback for a
 * target (or a whole command) this gate cannot resolve. Deliberately not
 * lib.mjs's hasHarnessSegment: that function calls path.resolve, which anchors a
 * relative string to THIS process's own cwd and would misreport what the raw text
 * itself says, and normalises only path separators, not the quotes and shell operators
 * that can flank a segment in an unparseable whole command line. This never resolves
 * anything; it only tests for the literal segment, so `$DIR/.claude/out` reads
 * correctly with `$DIR` left exactly as unresolved as it is on the command line.
 */
function rawTextNamesHarness(text) {
  if (typeof text !== 'string') return false;
  return (process.platform === 'win32' ? HARNESS_TEXT_RE_CI : HARNESS_TEXT_RE).test(text);
}

/** `word`, resolved to absolute. Only ever called once isUnresolvable(word, dir) is false. */
function resolveTargetPath(word, dir) {
  const normalized = normalizeHookPath(word);
  if (path.isAbsolute(normalized)) return path.resolve(normalized);
  if (typeof dir === 'string' && path.isAbsolute(dir)) return path.resolve(dir, normalized);
  return path.resolve(normalized); // never reached while isUnresolvable is checked first; kept for parity with path-guard's own fallback
}

// ---------------------------------------------------------------------------
// Write-through-a-tool routes (see header for what is, and is not, covered)
// ---------------------------------------------------------------------------

const UNIX_LAST_ARG_TOOLS = new Set(['cp', 'mv', 'install']);
const PS_PATH_CMDLETS = new Set(['set-content', 'add-content', 'out-file', 'tee-object']);
const PS_PATH_FLAG = /^-(path|filepath|literalpath)(:(.*))?$/i;

const nonFlagWords = (args) => args.filter((a) => a !== '' && !a.startsWith('-'));

/** cp / mv / install SRC... DEST -- the ordinary one-destination form only (see KNOWN LIMIT). */
function lastNonFlag(args) {
  const words = nonFlagWords(args);
  return words.length >= 2 ? [words[words.length - 1]] : [];
}

/** dd if=... of=TARGET */
function ddTargets(args) {
  return args.filter((a) => a.startsWith('of=')).map((a) => a.slice(3)).filter((a) => a !== '');
}

/**
 * sed -i / --in-place [SUFFIX] [-e SCRIPT | -f FILE] FILE...
 * Only fires when an in-place flag is present; sed with no `-i` never writes a file.
 */
function sedInPlaceTargets(args) {
  const hasInPlace = args.some((a) => a === '-i' || /^-i./.test(a) || a === '--in-place' || /^--in-place=/.test(a));
  if (!hasInPlace) return [];
  const hasScriptFlag = args.some(
    (a) => a === '-e' || a === '-f' || /^--expression(=|$)/.test(a) || /^--file(=|$)/.test(a),
  );
  const words = nonFlagWords(args);
  return hasScriptFlag ? words : words.slice(1); // without -e/-f the first non-flag word is the script, not a file
}

/** Set-Content / Add-Content / Out-File / Tee-Object -Path|-FilePath|-LiteralPath, or positional. */
function powershellCmdletTargets(args) {
  const targets = [];
  for (let i = 0; i < args.length; i += 1) {
    const m = PS_PATH_FLAG.exec(args[i]);
    if (!m) continue;
    if (m[3] !== undefined) {
      if (m[3] !== '') targets.push(m[3]);
      continue;
    }
    const next = args[i + 1];
    if (next !== undefined && next !== '' && !next.startsWith('-')) targets.push(next);
  }
  if (targets.length > 0) return targets;
  const first = nonFlagWords(args)[0];
  return first !== undefined ? [first] : [];
}

/** Every write-through-a-tool destination this segment's program names, if any. */
function toolRouteTargets(segment) {
  const program = segment.program;
  if (!program) return [];
  if (program === 'tee') return nonFlagWords(segment.args);
  if (UNIX_LAST_ARG_TOOLS.has(program)) return lastNonFlag(segment.args);
  if (program === 'dd') return ddTargets(segment.args);
  if (program === 'sed') return sedInPlaceTargets(segment.args);
  if (PS_PATH_CMDLETS.has(program.toLowerCase())) return powershellCmdletTargets(segment.args);
  return [];
}

// ---------------------------------------------------------------------------

/** Decision 1, applied to one candidate write target. */
function checkTarget(word, dir) {
  if (typeof word !== 'string' || word === '') return;

  if (isUnresolvable(word, dir)) {
    if (rawTextNamesHarness(word)) {
      block(
        `${FENCE_REASON} (the target \`${word}\` could not be fully resolved -- an unresolved variable, glob or ` +
          `substitution, or an unknown working directory -- but its literal text names a ${HARNESS_DIRNAME}/ path, ` +
          'so it is refused rather than guessed at).',
      );
    }
    return;
  }

  const hit = isPathIntoHarness(resolveTargetPath(word, dir));
  if (hit === null) return;
  if (hit.root === null) block(`${FENCE_REASON} (tried: ${hit.rel}, outside any git worktree).`);
  block(`${FENCE_REASON} (tried: ${hit.rel}).`);
}

function checkCommand(payload, command) {
  const { segments, error } = commandSegments(command);
  if (error !== null) {
    // Decision 1's last bullet: an unparseable line allows unless its raw text itself
    // names a .claude segment.
    if (rawTextNamesHarness(command)) {
      block(
        `${FENCE_REASON} (${error}, so it could not be resolved -- but its raw text names a ${HARNESS_DIRNAME}/ ` +
          'path, so it is refused rather than guessed at).',
      );
    }
    return;
  }

  // One directory for the whole command (see the header's KNOWN LIMIT). `unresolved`
  // covers a `cd` whose own target could not be named -- commandSegments already
  // returned no parse error above, so this is exactly that case, and it makes every
  // RELATIVE target in this command unresolvable too: the base it would resolve
  // against is unknown, not merely unnamed by the target word itself.
  const { dir } = resolveOperationDir(payload);
  const { unresolved } = operationDirs(payload);
  const knownDir = unresolved ? null : dir;

  for (const segment of segments) {
    for (const word of segment.redirects) checkTarget(word, knownDir);
    for (const word of toolRouteTargets(segment)) checkTarget(word, knownDir);
  }
}

await runGate({
  name: 'redirect-guard',
  run: (payload) => {
    if (!isShellTool(payload)) return; // Bash or PowerShell only (C-07), matches hooks.json's own matcher
    if (!isAnyAeoRole(payload)) return; // main session and non-AEO agents pass (C-02), same scoping as path-guard

    const command = typeof payload?.tool_input?.command === 'string' ? payload.tool_input.command : '';
    if (command.trim() === '') return;
    checkCommand(payload, command);
  },
});
