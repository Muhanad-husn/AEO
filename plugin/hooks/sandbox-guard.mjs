// AEO sandbox guard: a session cannot change production data that git cannot put back,
// cannot run code against production data, and cannot run the project's suite over a
// live long job.
//
// PreToolUse on Bash, PowerShell and the tools that write a file directly. It decides
// from stdin rather than from an `if:` filter, because `if:` fails open on an
// unparseable command and is never the security boundary (C-04).
//
// WHY THIS EXISTS. Three incidents, all invisible in CI because CI has no data directory
// (L-03): tests that wrote 79 run directories into the operator's live logs, six test
// call-sites that silently read a live 49,674-entry index through a default directory,
// and a fixture that snapshotted a shared state directory, which addressed collision and
// not reach. Plus L-02: four external kills of a live four-hour pipeline, traced to a
// concurrent session running the suite over it. Rule 1 guards that.
//
// THE ONE JOB (#237). The project declares where production data is. The guard refuses:
//   - a write, move or delete under that root that git cannot restore: a file git does
//     not track, one with uncommitted changes, or a directory or glob reaching either;
//   - a run against the root: code whose arguments, inputs or working directory are
//     under it, whatever git holds, because code can reach anything it is pointed at;
//   - a seam (AEO_DATA_ROOT) that is relative or overlaps the root;
//   - the declared suite while a live-run sentinel is up.
// Everything else passes, whatever paths it names. Phase 4 on Axial refused five pieces
// of legitimate work (#214, #216, #218, #234, #236), each a command that named the root
// and could not lose data git does not hold, and PLAN.md's kill line says a layer that
// refuses legitimate work is removed. It fails closed where the effect cannot be decided:
// a write whose location it cannot name, or under a root git cannot read, is refused. A
// command it cannot parse is judged as a run on the paths its tokens name and the
// directory it starts in, and otherwise allowed with a warning (#169).
//
// THE LINE. A tracked file with no uncommitted change can be put back with git, so
// overwriting or deleting it is allowed; the founder can undo it. A file git does not
// hold, or an edit git has not seen, cannot, so touching it is refused. A command that
// only reads (a short, fixed list of programs that cannot write or run code) may name the
// root freely, but when it pipes into anything that is not also on that list, its
// arguments are judged as a run's, because the next program acts on what it printed.
//
// There is no override flag and the absence of one is the point (L-05): an override is
// what you reach for at 2am. It applies to every identity, the orchestrator included.
//
// THE TWO VARIABLES. AEO_LIVE_DATA_ROOT is the project's declaration of where production
// data is, read from `.claude/settings.json` on every call and from the environment only
// when the file says nothing (#133). AEO_DATA_ROOT is the seam, where this process tree
// reads and writes data; it is an environment variable because that is the only seam that
// survives a process boundary, and a set seam is refused when it is relative or overlaps
// the root. An unset seam is not refused (#214).

import { existsSync, readFileSync, statSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { block, commandSegments, isPathInside, normalizeHookPath, operationDirs, realpathDeep as realise, runGate, toolFilePath, warn } from './lib.mjs';
import { projectAnchor, runInProgress, worktreeAnchor } from './sentinel.mjs';
import { resolveTestPlan } from './stack.mjs';

/** The project's declaration of where production data is. Absolute, or the guard blocks. */
export const LIVE_DATA_ROOT_ENV = 'AEO_LIVE_DATA_ROOT';

/** The seam. Where this process tree resolves its data. Inherited by every child. */
export const DATA_ROOT_ENV = 'AEO_DATA_ROOT';

const NO_OVERRIDE =
  'There is no override flag. That is deliberate (L-05): an override is what you reach for at 2am.';

/**
 * The tools that name their target in the payload, which hooks.json lists beside the
 * shells. Read is not here (#167): hooks.json fires nothing on a read tool. Glob and Grep
 * name a pattern rather than a file.
 */
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function writeNote(message) {
  try {
    writeSync(2, `${message}\n`);
  } catch {
    // Losing the note must not change the decision. runGate owns the exit.
  }
}

/** True when either path contains the other, once both are resolved through their links. */
function overlaps(a, b) {
  const ra = realise(a);
  const rb = realise(b);
  return isPathInside(ra, rb) || isPathInside(rb, ra);
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

// A token is a run of non-space characters with quoted spans allowed inside it, so
// `--data-dir="D:/corpus one"` is one token rather than two. Used where the command could
// not be segmented, and by the sentinel rule.
const TOKEN = /(?:"[^"]*"|'[^']*'|[^\s"']+)+/g;

/** The command split into tokens, with quotes removed. */
export function shellTokens(command) {
  if (typeof command !== 'string' || command === '') return [];
  return (command.match(TOKEN) ?? []).map((t) => t.replace(/["']/g, ''));
}

const URL_LIKE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/**
 * The tokens that could name a filesystem location.
 *
 * `NAME=value` and `--flag=value` both contribute their right-hand side, which is where
 * a data directory is usually passed. A token with no separator in it is a word rather
 * than a path and is skipped; a bare `corpus` is not a claim about a location.
 *
 * A comma separates the items of a PowerShell argument list (#227), so each item is judged
 * on its own: `"data/x",` names `data/x`, and `"a","<live>/y"` names both.
 */
export function pathCandidates(tokens) {
  const out = new Set();
  for (const raw of tokens) {
    const eq = raw.indexOf('=');
    for (const item of (eq > 0 ? raw.slice(eq + 1) : raw).split(',')) {
      const t = item.trim();
      if (t === '' || URL_LIKE.test(t)) continue;
      if (!/[\\/]/.test(t)) continue;
      out.add(t);
    }
  }
  return [...out];
}

/**
 * Interpreters generic enough that their own name carries no identity: what they run is
 * named by the argument after them (#136). A fixed set, because no shape tells `go test
 * pkg/...` from `bash scripts/check.sh`. `cmd`, `powershell` and `pwsh` are absent: their
 * own flags (`/c`, `-File`) are path-shaped and would be reduced in place of the script.
 */
const GENERIC_INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'node', 'python', 'python3', 'ruby', 'perl']);

/**
 * `tokens[i]`, reduced to its basename when it is path-shaped and a generic interpreter
 * appears earlier in the same command, skipping over any flags in between (#136). Shared
 * by both sides of the match: the declared command's own tokens, when deciding what
 * identifies the suite, and the invoked command's tokens, when recognising that identity
 * again. `bash scripts/check.sh` reduces to `['bash', 'check.sh']` on either side, and
 * `node --experimental-vm-modules node_modules/.bin/jest` reduces to `['node', 'jest']`,
 * the flag between interpreter and script skipped on both sides the same way.
 */
function reduceInterpreterScript(tokens, i) {
  const t = tokens[i];
  if (!/[\\/]/.test(t)) return t;
  let j = i - 1;
  while (j >= 0 && tokens[j].startsWith('-')) j -= 1;
  return j >= 0 && GENERIC_INTERPRETERS.has(tokens[j]) ? path.basename(t) : t;
}

/**
 * The declared command reduced to the tokens worth matching on.
 *
 * A flag never identifies the suite and is dropped outright: `pytest -k x` is the same
 * invocation as bare `pytest`. So does a glob argument: `rm -rf build/*.log` names no
 * particular file.
 *
 * A path-shaped token is kept, reduced to its basename, ONLY when it is a generic
 * interpreter's own script argument, found by walking back over flags
 * (reduceInterpreterScript): `bash ./scripts/check.sh` becomes `['bash', 'check.sh']`.
 * Any other path-shaped token is a target the suite runs over and is dropped, so a bare
 * `pytest` still matches `pytest tests/unit/test_api.py`. Keeping every path token broke
 * that (#136); dropping every one made `bash scripts/check.sh` match any `bash <x>`,
 * including a supervisor's own `stop` during a run (#134).
 *
 * When nothing survives, the first kept token keeps its basename, so `vendor/bin/phpunit
 * tests/` reduces to `['phpunit']` (#136).
 */
function significantTokens(command) {
  const wanted = [];
  for (let i = 0; i < command.length; i += 1) {
    const t = command[i];
    if (t.startsWith('-') || t.includes('*')) continue;
    if (/[\\/]/.test(t)) {
      const reduced = reduceInterpreterScript(command, i);
      if (reduced !== t) wanted.push(reduced);
      continue;
    }
    wanted.push(t);
  }
  if (wanted.length > 0) return wanted;
  const kept = command.filter((t) => !t.startsWith('-') && !t.includes('*'));
  return kept.length > 0 ? [path.basename(kept[0])] : [];
}

function isOrderedSubsequence(tokens, wanted) {
  let i = 0;
  for (const t of tokens) {
    if (t === wanted[i]) i += 1;
    if (i === wanted.length) return true;
  }
  return false;
}

/**
 * The declared test command this Bash command invokes, or null.
 *
 * Two forms match, both whole-token (V-12). The full declared sequence in order, which
 * catches `npm test`, `uv run pytest` and `bash scripts/check.sh`. Or its final program
 * token IN PROGRAM POSITION, which catches a bare `pytest -k x` in a project whose
 * declared command wraps it, `cd sub && pytest` with it, and a script run directly as
 * `./scripts/check.sh`, whose basename is the program.
 *
 * The first form reduces the invoked tokens the way significantTokens reduces the
 * declared ones (#136), and no further: reducing every path token made `git add
 * tools/pytest` match a declared `pytest`. The second form takes the program position
 * only: anywhere in the command, the literal `test` refused `grep -r test .` and `mkdir
 * test` during a live run.
 *
 * Known misses, accepted: `node --test` against a declared `npm test` (what npm expands
 * to is not this function's to guess, and nothing downstream catches it since D30); `sh
 * scripts/check.sh` against a declared `bash scripts/check.sh` (#134); and `uv run
 * <script>`, which collapses to `['uv', 'run']` and so matches any `uv run` (#136).
 */
export function invokesDeclaredSuite(command, declared) {
  const rawTokens = shellTokens(command);
  const tokens = rawTokens.map((t, i) => reduceInterpreterScript(rawTokens, i));
  const programs = commandSegments(command).segments.map((s) =>
    s.program === null ? null : /[\\/]/.test(s.program) ? path.basename(s.program) : s.program,
  );
  for (const candidate of declared) {
    const wanted = significantTokens(candidate);
    if (wanted.length === 0) continue;
    if (isOrderedSubsequence(tokens, wanted) || programs.includes(wanted[wanted.length - 1])) {
      return candidate.join(' ');
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// What each command does to the root (#237)
// ---------------------------------------------------------------------------

/**
 * Programs that cannot write a file or run code, whatever arguments they get (#216). What
 * they name, they read, so their arguments are not judged. None of them has a flag that
 * writes: `sort -o` and `uniq in out` would, and neither is here. Compared in lower case,
 * so PowerShell's own names match.
 */
const READS = new Set([
  'ls', 'dir', 'du', 'stat', 'wc', 'cat', 'head', 'tail', 'sha256sum', 'sha1sum', 'md5sum', 'grep', 'egrep', 'fgrep',
  'diff', 'cmp', 'file', 'tree', 'echo', 'printf', 'pwd', 'true', 'false', 'test', 'basename', 'dirname', 'realpath',
  'readlink', 'get-content', 'gc', 'get-childitem', 'gci', 'get-item', 'gi', 'test-path', 'get-filehash',
  'select-string', 'sls', 'write-output', 'write-host', 'measure-object', 'resolve-path',
]);

/** The `find` primaries that delete, run a program, or write a file. */
const FIND_ACTIONS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls']);

/** The `gh` arguments that write a local file. Without one, `gh` talks to GitHub only (#214). */
const GH_WRITES = /^(?:download|clone|--dir|-D|--output|-O)(?:=|$)/;

/** Programs that write, move or delete the paths they are given (writeTargets reads which). */
const COPIES = new Set(['cp', 'install', 'copy-item', 'cpi', 'copy']);
const MOVES = new Set(['mv', 'move-item', 'mi', 'move', 'rename-item', 'ren', 'rni']);
const WRITES = new Set([
  ...COPIES, ...MOVES, 'rm', 'rmdir', 'mkdir', 'touch', 'tee', 'ln', 'truncate', 'chmod', 'chown', 'unlink', 'shred',
  'dd', 'robocopy', 'remove-item', 'ri', 'del', 'erase', 'rd', 'new-item', 'ni', 'md', 'set-content', 'sc',
  'add-content', 'ac', 'out-file', 'clear-content', 'clc',
]);

/** PowerShell parameters whose value is not a path. Any unambiguous prefix names one. */
const PS_VALUES = ['value', 'encoding', 'itemtype', 'filter', 'include', 'exclude', 'stream', 'credential'];

/** robocopy options that name a file it writes or reads options from. */
const ROBOCOPY_FILES = /^\/(?:(?:UNI)?LOG\+?|SAVE|JOB):/i;

/**
 * The `git` subcommands that change no file in the working tree (#234). They read it, or
 * write git's own store: the index, the objects, a ref. `stash`, `restore`, `reset` and
 * `rm` qualify only in the forms gitIndexOnly accepts.
 */
const GIT_INDEX_OPS = new Set(['add', 'commit', 'status', 'diff', 'log', 'show', 'blame', 'ls-files', 'stash', 'restore', 'reset', 'rm']);

/** The only options `restore`, `reset` and `rm` may carry and still leave the working tree alone. */
const GIT_RESTORE_INDEX = new Set(['--staged', '-S', '-q', '--quiet', '--']);
const GIT_RESET_INDEX = new Set(['--soft', '--mixed', '-N', '-q', '--quiet', '--']);
const GIT_RM_INDEX = new Set(['--cached', '-r', '-f', '-rf', '-fr', '--force', '-n', '--dry-run', '-q', '--quiet', '--ignore-unmatch', '--']);

/** Global options that change nothing `git` runs. `-c` is not one: `core.fsmonitor` runs a program. */
const GIT_QUIET_GLOBALS = new Set(['--no-pager', '-P', '--no-optional-locks', '--literal-pathspecs']);

/** `git diff` options that write or run a program, matched by any prefix git accepts. */
const GIT_DIFF_UNSAFE = ['output', 'ext-diff', 'textconv'];

/**
 * The name a program is known by, in lower case: its basename with `.exe` dropped, so
 * `/usr/bin/ls` and `du.exe` are `ls` and `du`. A relative path such as `./ls` is a file
 * in the project, not the system program, and gets no name.
 */
function programName(program) {
  if (/[\\/]/.test(program) && !path.isAbsolute(normalizeHookPath(program))) return null;
  return program.split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
}

/**
 * True when `git <sub> <rest>` changes no file in the working tree. `restore` without
 * `--staged` writes the files; `reset --hard`, `--merge` and `--keep` write them, and git
 * takes `--ha` for `--hard`, so an option off the list is refused rather than parsed; `rm`
 * without `--cached` deletes them. `stash` qualifies as `list` and `show` only.
 */
function gitIndexOnly(sub, rest) {
  const unsafe = rest.some((a) => {
    const name = a.startsWith('--') ? a.slice(2).split('=')[0] : '';
    return name !== '' && GIT_DIFF_UNSAFE.some((o) => o.startsWith(name));
  });
  if (unsafe) return false;
  const options = rest.filter((a) => a.startsWith('-'));
  if (sub === 'stash') return rest[0] === 'list' || rest[0] === 'show';
  if (sub === 'restore') return options.every((o) => GIT_RESTORE_INDEX.has(o)) && options.some((o) => o === '--staged' || o === '-S');
  if (sub === 'reset') return options.every((o) => GIT_RESET_INDEX.has(o));
  if (sub === 'rm') return options.every((o) => GIT_RM_INDEX.has(o)) && options.includes('--cached');
  return true;
}

/**
 * For a `git` command that changes no working-tree file (#234), the `--git-dir` and
 * `--work-tree` values, which are still judged, since `--git-dir=<live>/x` writes objects
 * there. `null` for any other command. A `-C` value is the directory the command runs in
 * and is resolved by the walk; `-c` is refused because `core.pager` and `core.fsmonitor`
 * run a program.
 */
function gitIndexOp(segment) {
  if (programName(segment.program) !== 'git') return null;
  const args = segment.args;
  const judged = [];
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-C') i += 2;
    else if (args[i] === '--git-dir' || args[i] === '--work-tree') {
      judged.push(args[i + 1] ?? '');
      i += 2;
    } else if (GIT_QUIET_GLOBALS.has(args[i]) || /^--(?:git-dir|work-tree)=/.test(args[i])) {
      if (!GIT_QUIET_GLOBALS.has(args[i])) judged.push(args[i]);
      i += 1;
    } else return null;
  }
  return GIT_INDEX_OPS.has(args[i]) && gitIndexOnly(args[i], args.slice(i + 1)) ? judged : null;
}

/** A `reset` option that discards working-tree content, by any prefix git accepts. */
const discardsOnReset = (o) => /^--[a-z]{2,}$/.test(o) && ['hard', 'merge', 'keep'].some((f) => f.startsWith(o.slice(2)));

/**
 * For a `git` command that discards working-tree content git may not hold, what it
 * reaches: `{ paths }`, the pathspecs it is limited to, or no paths for the whole
 * repository; `{ ambiguous, force }` for `checkout <one word>`, which is a branch or a
 * path depending on what is on disk. `null` for any other command. These are `clean`
 * (except a dry run), `reset --hard`, `--merge` and `--keep`, `checkout` and `restore` of
 * paths, a forced `checkout` or `switch`, and `stash` bare, `push` or `save`. A `checkout`
 * or `switch` that is not forced refuses to overwrite local changes, so it is not here.
 * With `-c`, `--git-dir` or `--work-tree` the command stays a run.
 */
function gitDiscards(segment) {
  if (programName(segment.program) !== 'git') return null;
  const args = segment.args;
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-C') i += 2;
    else if (GIT_QUIET_GLOBALS.has(args[i])) i += 1;
    else return null;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  const dash = rest.indexOf('--');
  const after = dash === -1 ? [] : rest.slice(dash + 1);
  const before = dash === -1 ? rest : rest.slice(0, dash);
  const options = before.filter((a) => a.startsWith('-'));
  const words = before.filter((a, k) => !a.startsWith('-') && !['-s', '--source', '-b', '-B'].includes(before[k - 1]));
  const force = options.some((o) => ['-f', '--force', '--discard-changes'].includes(o));
  if (sub === 'clean') return options.some((o) => o === '-n' || o === '--dry-run') ? null : { paths: [...words, ...after] };
  if (sub === 'reset') return options.some(discardsOnReset) ? { paths: after } : null;
  if (sub === 'stash') {
    if (words[0] !== undefined && !['push', 'save'].includes(words[0])) return null;
    return { paths: [...(words[0] === 'push' ? words.slice(1) : []), ...after] };
  }
  if (sub === 'restore') return words.length + after.length > 0 ? { paths: [...words, ...after] } : null;
  if (sub === 'switch') return force ? { paths: [] } : null;
  if (sub !== 'checkout') return null;
  if (after.length > 0 || words.length >= 2) return { paths: [...words.slice(1), ...after] };
  if (words.length === 1) return { ambiguous: words[0], force };
  return force ? { paths: [] } : null;
}

/**
 * What one command does to the root: `read` (reads, or writes only git's store), `write`
 * (changes the paths writeTargets names), `discard` (a git command gitDiscards reads), or
 * `run` (anything else, whose arguments and directory are judged). `judged` is what a read
 * still has judged as a run's words.
 */
function kindOf(segment) {
  if (segment.program === null || segment.program === 'cd' || segment.program === 'pushd') return { kind: 'read', judged: [] };
  const git = gitIndexOp(segment);
  if (git !== null) return { kind: 'read', judged: git };
  const discard = gitDiscards(segment);
  if (discard !== null) return { kind: 'discard', judged: [], discard };
  const name = programName(segment.program);
  const args = segment.args;
  if (
    READS.has(name) ||
    (name === 'find' && !args.some((a) => FIND_ACTIONS.has(a))) ||
    (name === 'gh' && !args.some((a) => GH_WRITES.test(a)))
  ) {
    return { kind: 'read', judged: [] };
  }
  return { kind: WRITES.has(name) ? 'write' : 'run', judged: [] };
}

/**
 * The words a writing program changes. `into` marks a destination: when it is an existing
 * directory, what changes is the file each source lands on inside it. A copy's sources are
 * read and are not here; a move's are, since they are deleted. Flags are skipped, and so is
 * the value of a PowerShell parameter on PS_VALUES.
 */
function writeTargets(name, args) {
  if (name === 'dd') return args.filter((a) => a.startsWith('of=')).map((a) => ({ word: a.slice(3) }));
  if (name === 'robocopy') {
    const option = (a) => /^\/[A-Za-z]+(?:[:+].*)?$/.test(a);
    const [src, dst] = args.filter((a) => !option(a));
    const flags = args.filter(option).map((a) => a.toUpperCase());
    const out = args.filter((a) => ROBOCOPY_FILES.test(a)).map((a) => ({ word: a.slice(a.indexOf(':') + 1) }));
    if (flags.includes('/L')) return out;
    if (dst !== undefined) out.push({ word: dst });
    if (src !== undefined && (flags.includes('/MOV') || flags.includes('/MOVE'))) out.push({ word: src });
    return out;
  }
  const positional = [];
  let dest = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (a === '-t' || a.startsWith('--target-directory=')) {
      dest = a === '-t' ? args[++i] : a.slice(a.indexOf('=') + 1);
      continue;
    }
    const ps = /^-([A-Za-z][A-Za-z-]+)(?::(.*))?$/.exec(a);
    if (ps !== null) {
      const param = ps[1].toLowerCase();
      if ('destination'.startsWith(param)) dest = ps[2] ?? args[++i];
      else if (PS_VALUES.some((v) => v.startsWith(param))) i += ps[2] === undefined ? 1 : 0;
      else if (ps[2] !== undefined) positional.push(ps[2]);
      continue;
    }
    if (!a.startsWith('-')) positional.push(a);
  }
  if (COPIES.has(name) || MOVES.has(name)) {
    if (dest === null && positional.length >= 2) dest = positional.pop();
    const moved = MOVES.has(name) ? positional.map((word) => ({ word })) : [];
    return dest === null || dest === undefined ? moved : [...moved, { word: dest, into: positional }];
  }
  if (name === 'chmod' || name === 'chown') positional.shift();
  return positional.map((word) => ({ word }));
}

/** The head of `$(cat <<EOF`, with the delimiter bare or quoted and nothing after it on the line. */
const CAT_HEREDOC = /\$\(cat[ \t]+<<(-?)[ \t]*(?:'(\w+)'|"(\w+)"|(\w+))[ \t]*\n/g;

/**
 * The command with every `$(cat <<EOF ... EOF)` taken out (#234). That substitution runs
 * only `cat`, and what it yields is the heredoc body: message text, the way a Claude Code
 * session writes `git commit -m "$(cat <<'EOF' ... EOF)"`. It is taken out only when the
 * delimiter line is followed by nothing but the closing parenthesis. A bare delimiter
 * lets the shell expand the body, so a body with `$(` or a backtick in it stays.
 */
function withoutLiteralMessages(command) {
  let out = '';
  let from = 0;
  CAT_HEREDOC.lastIndex = 0;
  for (let m; (m = CAT_HEREDOC.exec(command)) !== null; ) {
    const [head, dash, single, double, bare] = m;
    const delimiter = single ?? double ?? bare;
    const lines = command.slice(m.index + head.length).split('\n');
    const end = lines.findIndex((l) => (dash ? l.replace(/^\t+/, '') : l) === delimiter);
    if (end === -1) continue;
    const body = lines.slice(0, end).join('\n');
    if (bare !== undefined && /\$\(|`/.test(body)) continue;
    const after = lines.slice(end + 1).join('\n');
    const close = /^\s*\)/.exec(after);
    if (close === null) continue;
    out += command.slice(from, m.index);
    from = command.length - after.length + close[0].length;
    CAT_HEREDOC.lastIndex = from;
  }
  return out + command.slice(from);
}

/**
 * True when the command runs a command the parser did not open: a `$(`, a process
 * substitution, or a backtick, which inside double quotes reads as one word. Every
 * command on such a line is judged as a run. A `$(cat <<EOF ... EOF)` does not count.
 */
function runsHiddenCommand(command) {
  return /\$\(|[<>]\(|`/.test(withoutLiteralMessages(command));
}

/**
 * Every value `word` can take, with a leading `~` and each `$NAME`, `${NAME}` or
 * `$env:NAME` read from the session environment, or from `loops`: the literal words of a
 * `for NAME in ...` earlier on the line. Null when a variable is in neither, since it then
 * names a location the guard cannot know.
 */
function expand(word, env, loops) {
  const home = typeof env?.HOME === 'string' ? env.HOME : env?.USERPROFILE;
  if (/^~(?=$|[\\/])/.test(word)) {
    if (typeof home !== 'string') return null;
    word = home + word.slice(1);
  }
  const m = /\$(?:env:(\w+)|\{(\w+)\}|(\w+))/i.exec(word);
  if (m === null) return [word];
  const name = m[1] ?? m[2] ?? m[3];
  const values = typeof env?.[name] === 'string' ? [env[name]] : loops.get(name);
  const tails = values === undefined ? null : expand(word.slice(m.index + m[0].length), env, new Map(loops));
  if (tails === null) return null;
  return values.flatMap((v) => tails.map((t) => word.slice(0, m.index) + v + t));
}

function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Why git cannot put back what a change to `target` would lose, or null when it can, or
 * when the target does not reach the root. It reaches the root when it lies inside it,
 * contains it (`rm -rf .` from the checkout), or is a glob whose fixed directory does
 * either and whose next part matches the way down to the root.
 *
 * Git can put a target back when every file it reaches is tracked and has no change git
 * has not recorded: `git status --ignored` lists nothing for it, and a single file is in
 * the index. An untracked or ignored file, an uncommitted edit, a new file, or a root git
 * cannot read at all, and it cannot.
 */
function cannotRestore(target, root) {
  const parts = target.split(/[\\/]/);
  const firstGlob = parts.findIndex((p) => /[*?[]/.test(p));
  const fixed = firstGlob === -1 ? target : parts.slice(0, firstGlob).join('/');
  let subject = target;
  if (!isPathInside(root, fixed)) {
    if (!isPathInside(fixed, root)) return null;
    if (firstGlob !== -1) {
      const next = path.relative(fixed, root).split(/[\\/]/)[0];
      const pattern = parts[firstGlob].replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
      if (!new RegExp(`^${pattern}$`, process.platform === 'win32' ? 'i' : '').test(next)) return null;
    }
    subject = root;
  }
  let cwd = subject === root || firstGlob === -1 ? subject : fixed;
  while (!isDirectory(cwd) && path.dirname(cwd) !== cwd) cwd = path.dirname(cwd);
  const git = (...args) =>
    spawnSync('git', ['-C', cwd, ...args, '--', subject.replace(/\\/g, '/')], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
  const status = git('status', '--porcelain', '-z', '--ignored');
  if (status.error || status.status !== 0) return 'git cannot read a repository there';
  const fields = status.stdout.split('\0');
  for (let i = 0; i < fields.length; i += 1) {
    const f = fields[i];
    if (f.length < 3) continue;
    if (f[0] === 'R' || f[0] === 'C') i += 1; // a rename's second field is its old path
    if (f.startsWith('??') || f.startsWith('!!')) return 'git does not track it, or a file it reaches';
    if (f[1] !== ' ') return 'it has changes git has not recorded';
  }
  if (firstGlob === -1 && subject === target && !isDirectory(subject)) {
    const tracked = git('ls-files', '-z');
    if (tracked.error || tracked.status !== 0) return 'git cannot read a repository there';
    if (tracked.stdout === '') return 'git does not track it';
  }
  return null;
}

// ---------------------------------------------------------------------------
// The two roots
// ---------------------------------------------------------------------------

function readRoot(value, platform) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '') return { set: false, raw: '', root: null };
  const normalised = normalizeHookPath(raw, { platform });
  // Absoluteness is judged for the platform named, not the one this process runs on.
  // Reading it from the host made the `platform` argument true for normalisation and a
  // lie for the test that follows it: `D:/production` is not absolute to path.posix, so
  // every declared root went null and the guard resolved nothing.
  const p = platform === 'win32' ? path.win32 : path.posix;
  return { set: true, raw, root: p.isAbsolute(normalised) ? normalised : null };
}

/**
 * The AEO_LIVE_DATA_ROOT declaration read straight from `<dir>/.claude/settings.json`'s
 * `env` object, re-read on every call (#133). `undefined` when the file makes no
 * statement at all -- missing, unreadable, not valid JSON, or the key simply absent --
 * which is resolveRoots' signal to fall back to the environment exactly as it did before
 * this existed. A string is returned whenever the key IS present as a string, blank
 * included: AEO's own scaffold ships the key blank, and a blank value there already means
 * "declared, and declared as nothing" -- inert, not "keep looking elsewhere."
 *
 * AEO_DATA_ROOT is never read here. It has to reach a subprocess, so it stays an
 * environment variable, read exactly where it always was.
 */
function readLiveDeclarationFromFile(dir) {
  if (typeof dir !== 'string' || dir === '') return undefined;
  let raw;
  try {
    raw = readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
  } catch {
    return undefined; // no file, or unreadable: nothing this hook can act on
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined; // malformed: the same treatment as no file, not a block of its own
  }
  const value = parsed?.env?.[LIVE_DATA_ROOT_ENV];
  return typeof value === 'string' ? value : undefined;
}

/**
 * The directory whose .claude/settings.json holds this session's declaration.
 *
 * `payload.cwd` first: CLAUDE_PROJECT_DIR is fixed at launch and wrong for a worktree
 * session (V-02). worktreeAnchor resolves a linked worktree to itself, because each
 * worktree has its own copy of a tracked settings file (#133); the sentinel, by contrast,
 * is shared across worktrees (projectAnchor). Spawn-free: this runs on every call.
 */
export function settingsDeclarationDir(payload, env, cwd = process.cwd) {
  const fromPayload = typeof payload?.cwd === 'string' ? payload.cwd.trim() : '';
  const fromEnv = typeof env?.CLAUDE_PROJECT_DIR === 'string' ? env.CLAUDE_PROJECT_DIR.trim() : '';
  const base = fromPayload || fromEnv || cwd();
  return worktreeAnchor(normalizeHookPath(base));
}

/**
 * Where production data is, and where the data of EACH command on this line will resolve.
 *
 * The declaration comes from `<dir>/.claude/settings.json`, re-read on every call, and
 * from `env` only when the file says nothing (#133). With no `dir` this is a pure
 * function of what it is handed.
 *
 * ONE SEAM PER COMMAND. A prefix assignment binds to the one command it prefixes, so
 * `AEO_DATA_ROOT=<sandbox> npm run build && npm test` gives `npm test` the inherited seam.
 * Only an assignment in leading position counts, the last one winning: reading it from
 * any token let `echo 'AEO_DATA_ROOT=<safe>' >> .claude/settings.json && npm test` pass
 * while the child ran with the old seam. A segment that runs no program contributes none;
 * a line with no segments gets the session's seam. An unset seam is not refused (#214).
 *
 * @returns {{live: object, seams: Array<{data: object, dataSource: string}>}}
 */
export function resolveRoots({ command = '', env = process.env, platform = process.platform, dir = null } = {}) {
  const declared = readLiveDeclarationFromFile(dir);
  const live = readRoot(declared !== undefined ? declared : env?.[LIVE_DATA_ROOT_ENV], platform);
  const inherited = env?.[DATA_ROOT_ENV];

  const seams = [];
  const seen = new Set();
  const record = (value, source) => {
    const key = `${source} ${value ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    seams.push({ data: readRoot(value, platform), dataSource: source });
  };

  for (const segment of commandSegments(command).segments) {
    if (segment.program === null) continue;
    const assigned = segment.assignments.filter((a) => a.startsWith(`${DATA_ROOT_ENV}=`)).pop();
    if (assigned === undefined) record(inherited, 'session environment');
    else record(assigned.slice(DATA_ROOT_ENV.length + 1), 'the command');
  }
  if (seams.length === 0) record(inherited, 'session environment');

  return { live, seams };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** The two ways a seam that is set can be wrong. Blocks; returns when it is fine. */
function checkSeam(live, data, dataSource) {
  if (!data.set) return;

  if (data.root === null) {
    block(
      `${DATA_ROOT_ENV} is set to ${JSON.stringify(data.raw)} in ${dataSource}, which is not an absolute ` +
        `path. A relative seam resolves against whatever working directory the child happens to have, so ` +
        `the guard cannot tell whether it lands in production data at ${live.root}. Set it to an absolute ` +
        `path. ${NO_OVERRIDE}`,
    );
  }

  if (overlaps(live.root, data.root)) {
    block(
      `${DATA_ROOT_ENV} is ${data.root} (from ${dataSource}) and production data is at ${live.root}. ` +
        `One contains the other, so this run is pointed at production data. Three incidents came from ` +
        `exactly this (L-03), and none of them were visible in CI, because CI has no data directory. ` +
        `Point ${DATA_ROOT_ENV} at a directory that neither contains nor sits inside ${live.root}. ${NO_OVERRIDE}`,
    );
  }
}

/**
 * @param {object} payload
 * @param {{env?: object, cwd?: () => string, note?: (message: string) => void}} [host] What
 *   the hook process would read for itself: its environment, its working directory, and
 *   stderr for a note. The hook passes nothing; the tests pass their own, so a case is
 *   decided in-process exactly as the spawned hook decides it.
 */
export function sandboxGuard(payload, { env = process.env, cwd = process.cwd, note = writeNote } = {}) {
  const command = typeof payload?.tool_input?.command === 'string' ? payload.tool_input.command : '';
  const tool = typeof payload?.tool_name === 'string' ? payload.tool_name : '';
  const fileTool = FILE_TOOLS.has(tool);

  const walk = operationDirs(payload, { env, cwd });
  const dirs = walk.dirs.filter((d) => path.isAbsolute(d));

  // 1. A live long job (L-02). Read first and cheaply: one readdir, and nothing else until
  //    a sentinel is present. Every directory any command on the line runs in counts, since
  //    `cd elsewhere && npm test` still burns this machine. A file tool invokes nothing.
  if (!fileTool) {
    const anchors = [...new Set(dirs.map(projectAnchor).filter((a) => a !== null))];
    for (const anchor of anchors) {
      const { reason, notes } = runInProgress(anchor);
      for (const line of notes) note(`sandbox-guard: ${line}`);
      if (reason === null) continue;
      // Both declared tiers are the project's suite (D31).
      const declared = resolveTestPlan({ toplevel: anchor, files: [] })
        .units.flatMap((u) => [u.command, u.full])
        .filter((c) => typeof c === 'string')
        .map((c) => shellTokens(c));
      const invoked = invokesDeclaredSuite(command, declared);
      if (invoked !== null) block(`\`${invoked}\` will not run: ${reason}\n${NO_OVERRIDE}`);
    }
  }

  // 2. Everything below needs a declared production data root; without one the project has
  //    told the guard nothing to protect.
  const { live, seams } = resolveRoots({ command, env, dir: settingsDeclarationDir(payload, env, cwd) });
  if (!live.set) return;
  if (live.root === null) {
    block(
      `${LIVE_DATA_ROOT_ENV} is set to ${JSON.stringify(live.raw)}, which is not an absolute path, so the ` +
        `sandbox guard cannot tell production data from a sandbox and refuses every call. Set it to the ` +
        `absolute path of the production data directory, or unset it. ${NO_OVERRIDE}`,
    );
  }
  const liveReal = realise(live.root);
  const inside = (p) => isPathInside(liveReal, realise(p));
  const locate = (word, dir) => {
    const p = normalizeHookPath(word);
    return path.isAbsolute(p) ? p : dir ? path.resolve(dir, p) : null;
  };
  const operatesIn = (dir) =>
    block(
      `this command operates in ${realise(dir)}, inside the production data root ${live.root}. Every ` +
        `relative path it names resolves there, so a run from inside production data is refused. Run it ` +
        `from outside ${live.root}. ${NO_OVERRIDE}`,
    );

  // A run is refused on every path-shaped word that resolves inside the root, tracked or
  // not: code can reach whatever it is pointed at. A relative word with no directory to
  // resolve against (after a `cd` the guard could not name) names no location it can test.
  const judgeRun = (words, dir) => {
    for (const word of pathCandidates(words)) {
      const p = locate(word, dir);
      if (p === null || !inside(p)) continue;
      block(
        `this command names ${JSON.stringify(word)}, which resolves to ${realise(p)}, inside the production ` +
          `data root ${live.root}. A run pointed at production data is refused. ${NO_OVERRIDE}`,
      );
    }
  };

  const { segments } = commandSegments(command);
  const segmentDir = (i) => (typeof walk.segmentDirs[i] === 'string' && path.isAbsolute(walk.segmentDirs[i]) ? walk.segmentDirs[i] : null);
  // Whether anything on the line could reach the root: a directory it runs in, or a path
  // it names, including the value of an assignment.
  const lineReaches = () =>
    dirs.some(inside) ||
    segments.some((s, i) => pathCandidates(s.tokens).some((w) => {
      const p = locate(w, segmentDir(i));
      return p !== null && inside(p);
    }));
  const loops = new Map();

  const refuseChange = (what, word, target, why) =>
    block(
      `${what} ${JSON.stringify(word)}, which resolves to ${target}, inside the production data root ` +
        `${live.root}, and git cannot restore it: ${why}. Only a file git tracks, with no uncommitted change, ` +
        `may be written, moved or deleted there. ${NO_OVERRIDE}`,
    );

  // A write, move or delete is refused only where git cannot put back what it changes. One
  // whose location cannot be named (a variable the session does not define, or a relative
  // path after a `cd` the guard could not name) is refused when the line could reach the
  // root, and otherwise allowed with a warning.
  const judgeWrite = (word, dir, into = [], what = 'this command changes') => {
    const located = (expand(word, env, loops) ?? [null]).map((e) => (e === null ? null : locate(e, dir)));
    if (located.includes(null)) {
      if (lineReaches()) {
        block(
          `${what} ${JSON.stringify(word)}, and the guard cannot tell whether that lands inside the production ` +
            `data root ${live.root}, which this line reaches. Give the path literally. ${NO_OVERRIDE}`,
        );
      }
      warn(
        `sandbox-guard: \`${command}\` changes ${JSON.stringify(word)}; the guard cannot tell where ${JSON.stringify(word)} ` +
          `lands, and nothing on the line reaches the production data root ${live.root}, so it was allowed. Give ` +
          `the path literally to get the full judgement.`,
      );
      return;
    }
    for (const p of located) {
      const targets = into.length > 0 && isDirectory(p) ? into.map((src) => path.join(p, path.basename(normalizeHookPath(src)))) : [p];
      for (const target of targets) {
        const why = cannotRestore(realise(target), liveReal);
        if (why !== null) refuseChange(what, word, realise(target), why);
      }
    }
  };

  // A git command that discards working-tree content with no pathspec reaches its whole
  // repository, and so the root when the repository holds it.
  const judgeRepository = (dir) => {
    if (dir === null) return judgeWrite('.', null);
    const top = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true });
    if (top.error || top.status !== 0) {
      if (inside(dir)) refuseChange('this command changes', dir, realise(dir), 'git cannot read a repository there');
      return;
    }
    const root = realise(top.stdout.trim());
    const why = cannotRestore(root, liveReal);
    if (why !== null) refuseChange('this command changes the whole working tree of', root, root, why);
  };

  // 3. A write tool names one target. It spawns no child, so the seam is not its concern.
  if (fileTool) {
    const target = toolFilePath(payload);
    if (target !== null) judgeWrite(target, dirs[0] ?? null, [], `this ${tool} targets`);
    return;
  }

  // 4. A command the guard could not read, or a `cd` whose target it could not name, is
  //    judged on what it could read (#169), and the session is told which piece it was not.
  if (walk.parseError !== null) {
    warn(
      `sandbox-guard: \`${command}\` ${walk.parseError}, and this session declares production data at ` +
        `${live.root}. It was allowed on what could be read: the paths its tokens name, resolved against ` +
        `${dirs[0] ?? 'nothing'}, the directory it runs in, the seam, and the live-run rule. Reach hidden ` +
        `inside the part that could not be read was not judged. Split it into commands that can be read one ` +
        `at a time to get the full judgement.`,
    );
  } else if (walk.unresolved) {
    warn(
      `sandbox-guard: \`${command}\` changes directory to somewhere the guard cannot name (an expansion, a ` +
        `glob, a bare \`cd\`, or \`cd -\`), and this session declares production data at ${live.root}. A run ` +
        `after it was judged on the absolute paths it names, and a write after it with a relative target on ` +
        `whether the line reaches the root. Give the directory literally to get the full judgement.`,
    );
  }

  // 5. The seam each command inherits (L-03). An unset seam is not refused (#214).
  for (const { data, dataSource } of seams) checkSeam(live, data, dataSource);

  // 6. With no parse, every token is judged as a run's, against where the call starts.
  if (walk.parseError !== null) {
    if (dirs[0] && inside(dirs[0])) operatesIn(dirs[0]);
    judgeRun(shellTokens(command), dirs[0] ?? null);
    return;
  }

  // 7. Each command on the line, by what it does. A line that runs a command the parser
  //    did not open is judged as runs throughout, including the words inside that command.
  //    A read or a write whose output is piped into anything but a read is judged as a
  //    run, because the next program acts on what it printed: `find <root> | xargs rm`.
  const hidden = runsHiddenCommand(command);
  if (hidden) judgeRun(command.split(/[\s"'`;|&()]+/), dirs[0] ?? null);
  const kinds = segments.map((s) => (hidden ? { kind: 'run', judged: [] } : kindOf(s)));
  const receiver = (j) => segments.findIndex((s, k) => k > j && s.tokens.length > 0);
  const feedsRun = (i) =>
    segments.some((s, j) => j >= i && s.followedBy === '|' && receiver(j) !== -1 && kinds[receiver(j)].kind !== 'read');
  segments.forEach((s, i) => {
    const dir = segmentDir(i);
    const { kind, judged, discard } = kinds[i];
    if (s.program === 'for' && s.args[1] === 'in' && s.args.slice(2).every((w) => !/[$`]/.test(w))) {
      loops.set(s.args[0], s.args.slice(2));
    }
    if (kind === 'run' || feedsRun(i)) {
      // After a `cd` the guard could not name, a run is held to every directory the walk
      // did resolve: `cd $X && python run.py` from inside the root may still run there.
      const held = dir !== null ? [dir] : dirs;
      const there = held.find((d) => inside(d));
      if (s.tokens.length > 0 && there !== undefined) operatesIn(there);
      judgeRun(s.tokens, dir);
      return;
    }
    // The program itself and a leading assignment are judged on every command:
    // `<root>/bin/ls` runs what production data holds, and so does `PATH=<root>/bin ls`.
    judgeRun([...(s.program !== null && /[\\/]/.test(s.program) ? [s.program] : []), ...s.assignments, ...judged], dir);
    const targets = kind === 'write' ? writeTargets(programName(s.program), s.args) : [];
    for (const { word, into } of [...s.writes.map((word) => ({ word })), ...targets]) judgeWrite(word, dir, into);
    if (kind !== 'discard') return;
    let { paths } = discard;
    if (discard.ambiguous !== undefined) {
      const p = locate(discard.ambiguous, dir);
      const isPath = discard.ambiguous === '.' || (p !== null && existsSync(p));
      paths = isPath ? [discard.ambiguous] : discard.force ? [] : null;
    }
    if (paths === null) return;
    if (paths.length === 0) judgeRepository(dir);
    for (const word of paths) judgeWrite(word, dir);
  });
}

// Importing this file must not run the gate, so the sentinel writer and the tests can
// use its exports without spawning it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runGate({ name: 'sandbox-guard', run: sandboxGuard });
}
