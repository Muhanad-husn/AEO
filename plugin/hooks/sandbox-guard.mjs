// AEO sandbox guard: a session cannot write, move or delete production data that git
// cannot put back.
//
// PreToolUse on Bash, PowerShell and the tools that write a file directly, through
// gate.mjs. It decides from stdin rather than from an `if:` filter, because `if:` fails
// open on an unparseable command and is never the security boundary (C-04).
//
// THE ONE RULE (#237). The project declares where production data is, in
// AEO_LIVE_DATA_ROOT. The guard refuses a write, move or delete under that root that git
// cannot restore: a file git does not track, one with uncommitted changes, or a directory
// or glob reaching either. What it judges as a write: a file tool's target, a shell
// redirect, the paths a program on the WRITES list changes, and the working tree a git
// command discards. A root git cannot read at all is refused, since nothing there can be
// put back. Everything else passes, whatever paths it names.
//
// THE LINE. A tracked file with no uncommitted change can be put back with git, so
// overwriting or deleting it is allowed; the founder can undo it. A file git does not
// hold, or an edit git has not seen, cannot, so touching it is refused.
//
// What it does not judge: a path it cannot name (an unset variable, a relative path after
// a `cd` it could not resolve), a command it cannot parse, and what a program off the
// WRITES list does with the paths it is given. Those pass.
//
// There is no override flag and the absence of one is the point (L-05): an override is
// what you reach for at 2am. It applies to every identity, the orchestrator included.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { block, commandSegments, isPathInside, normalizeHookPath, operationDirs, realpathDeep as realise, runGate, toolFilePath } from './lib.mjs';
import { worktreeAnchor } from './sentinel.mjs';

/** The project's declaration of where production data is. Absolute, or the guard is silent. */
export const LIVE_DATA_ROOT_ENV = 'AEO_LIVE_DATA_ROOT';

const NO_OVERRIDE =
  'There is no override flag. That is deliberate (L-05): an override is what you reach for at 2am.';

/**
 * The tools that name their target in the payload, which hooks.json lists beside the
 * shells. Read is not here (#167): hooks.json fires nothing on a read tool. Glob and Grep
 * name a pattern rather than a file.
 */
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// ---------------------------------------------------------------------------
// What each command does to the root (#237)
// ---------------------------------------------------------------------------

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
 * True when a `git` command changes no working-tree file (#234): it reads the tree, or
 * writes only git's own store (the index, the objects, a ref). Such a command is not a
 * discard, so `git restore --staged <path>` is not judged as one. With `-c` it is not
 * one, because `core.pager` and `core.fsmonitor` run a program.
 */
function gitIndexOp(segment) {
  if (programName(segment.program) !== 'git') return false;
  const args = segment.args;
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-C' || args[i] === '--git-dir' || args[i] === '--work-tree') i += 2;
    else if (GIT_QUIET_GLOBALS.has(args[i]) || /^--(?:git-dir|work-tree)=/.test(args[i])) i += 1;
    else return false;
  }
  return GIT_INDEX_OPS.has(args[i]) && gitIndexOnly(args[i], args.slice(i + 1));
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
 * With `-c`, `--git-dir` or `--work-tree` it is not read as a discard.
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
 * What one command does to the root: `write` (changes the paths writeTargets names),
 * `discard` (a git command gitDiscards reads), or `other`. Every kind still has its
 * redirects judged.
 */
function kindOf(segment) {
  if (segment.program === null || gitIndexOp(segment)) return { kind: 'other' };
  const discard = gitDiscards(segment);
  if (discard !== null) return { kind: 'discard', discard };
  return { kind: WRITES.has(programName(segment.program)) ? 'write' : 'other' };
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
  const makesDirectory = name === 'mkdir' || name === 'md' || ((name === 'new-item' || name === 'ni') && args.some((a) => /^(?:directory|dir)$/i.test(a)));
  return positional.map((word) => ({ word, newDirectory: makesDirectory }));
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
 * the index. An untracked or ignored file, an uncommitted edit, or a root git cannot read
 * at all, and it cannot. A file that does not exist yet loses nothing, so it is allowed when
 * it would join tracked content (newFileBesideTracked). `newFileOk` is false for a new
 * directory (`mkdir`), which stays refused.
 */
function cannotRestore(target, root, newFileOk = true) {
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
    if (tracked.stdout === '') {
      if (newFileOk && !existsSync(subject) && newFileBesideTracked(subject, cwd)) return null;
      return 'git does not track it';
    }
  }
  return null;
}

/**
 * Whether a path that does not exist yet would join tracked content: git is readable
 * there, git does not ignore the path, and its parent directory exists and already holds a
 * tracked file of its own. Nothing is lost by creating it, and it can then be committed.
 */
function newFileBesideTracked(target, cwd) {
  const parent = path.dirname(target);
  if (!isDirectory(parent)) return false;
  const ignored = spawnSync('git', ['-C', cwd, 'check-ignore', '-q', '--', target.replace(/\\/g, '/')], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (ignored.error || ignored.status !== 1) return false; // 0 is ignored, anything else is an error
  const listed = spawnSync('git', ['-C', parent, 'ls-files', '-z', '--', '.'], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.error || listed.status !== 0) return false;
  return listed.stdout.split(String.fromCharCode(0)).some((entry) => entry !== '' && !/[\\/]/.test(entry));
}

// ---------------------------------------------------------------------------
// The root
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
 * AEO_DATA_ROOT is never read here, or anywhere in this guard.
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
 * worktree has its own copy of a tracked settings file (#133). Spawn-free: this runs on
 * every call.
 */
export function settingsDeclarationDir(payload, env, cwd = process.cwd) {
  const fromPayload = typeof payload?.cwd === 'string' ? payload.cwd.trim() : '';
  const fromEnv = typeof env?.CLAUDE_PROJECT_DIR === 'string' ? env.CLAUDE_PROJECT_DIR.trim() : '';
  const base = fromPayload || fromEnv || cwd();
  return worktreeAnchor(normalizeHookPath(base));
}

/**
 * Where production data is. The declaration comes from `<dir>/.claude/settings.json`,
 * re-read on every call, and from `env` only when the file says nothing (#133). With no
 * `dir` this is a pure function of what it is handed. `root` is null when the value is
 * unset, blank or not absolute.
 *
 * @returns {{live: {set: boolean, raw: string, root: string|null}}}
 */
export function resolveRoots({ env = process.env, platform = process.platform, dir = null } = {}) {
  const declared = readLiveDeclarationFromFile(dir);
  return { live: readRoot(declared !== undefined ? declared : env?.[LIVE_DATA_ROOT_ENV], platform) };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * @param {object} payload
 * @param {{env?: object, cwd?: () => string}} [host] What the hook process would read for
 *   itself: its environment and its working directory. The hook passes nothing; the tests
 *   pass their own, so a case is decided in-process exactly as the spawned hook decides it.
 */
export function sandboxGuard(payload, { env = process.env, cwd = process.cwd } = {}) {
  const command = typeof payload?.tool_input?.command === 'string' ? payload.tool_input.command : '';
  const tool = typeof payload?.tool_name === 'string' ? payload.tool_name : '';

  // Without an absolute production data root the project has told the guard nothing to
  // protect.
  const { live } = resolveRoots({ env, dir: settingsDeclarationDir(payload, env, cwd) });
  if (live.root === null) return;

  const walk = operationDirs(payload, { env, cwd });
  const dirs = walk.dirs.filter((d) => path.isAbsolute(d));
  const liveReal = realise(live.root);
  const inside = (p) => isPathInside(liveReal, realise(p));
  const locate = (word, dir) => {
    const p = normalizeHookPath(word);
    return path.isAbsolute(p) ? p : dir ? path.resolve(dir, p) : null;
  };
  const loops = new Map();

  const refuseChange = (what, word, target, why) =>
    block(
      `${what} ${JSON.stringify(word)}, which resolves to ${target}, inside the production data root ` +
        `${live.root}, and git cannot restore it: ${why}. Only a file git tracks, with no uncommitted change, ` +
        `may be written, moved or deleted there. ${NO_OVERRIDE}`,
    );

  // A write, move or delete is refused only where git cannot put back what it changes. One
  // whose location cannot be named (a variable the session does not define, or a relative
  // path after a `cd` the guard could not name) is not judged.
  const judgeWrite = (word, dir, into = [], what = 'this command changes', newDirectory = false) => {
    const located = (expand(word, env, loops) ?? [null]).map((e) => (e === null ? null : locate(e, dir)));
    if (located.includes(null)) return;
    for (const p of located) {
      const targets = into.length > 0 && isDirectory(p) ? into.map((src) => path.join(p, path.basename(normalizeHookPath(src)))) : [p];
      for (const target of targets) {
        const why = cannotRestore(realise(target), liveReal, !newDirectory);
        if (why !== null) refuseChange(what, word, realise(target), why);
      }
    }
  };

  // A git command that discards working-tree content with no pathspec reaches its whole
  // repository, and so the root when the repository holds it.
  const judgeRepository = (dir) => {
    if (dir === null) return;
    const top = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true });
    if (top.error || top.status !== 0) {
      if (inside(dir)) refuseChange('this command changes', dir, realise(dir), 'git cannot read a repository there');
      return;
    }
    const root = realise(top.stdout.trim());
    const why = cannotRestore(root, liveReal);
    if (why !== null) refuseChange('this command changes the whole working tree of', root, root, why);
  };

  // A write tool names one target.
  if (FILE_TOOLS.has(tool)) {
    const target = toolFilePath(payload);
    if (target !== null) judgeWrite(target, dirs[0] ?? null, [], `this ${tool} targets`);
    return;
  }

  // A command the guard could not parse is not judged.
  if (walk.parseError !== null) return;

  // Each command on the line, by what it does: its redirects, the targets of a writing
  // program, and what a discarding git command reaches.
  const { segments } = commandSegments(command);
  const segmentDir = (i) => (typeof walk.segmentDirs[i] === 'string' && path.isAbsolute(walk.segmentDirs[i]) ? walk.segmentDirs[i] : null);
  segments.forEach((s, i) => {
    const dir = segmentDir(i);
    const { kind, discard } = kindOf(s);
    if (s.program === 'for' && s.args[1] === 'in' && s.args.slice(2).every((w) => !/[$`]/.test(w))) {
      loops.set(s.args[0], s.args.slice(2));
    }
    const targets = kind === 'write' ? writeTargets(programName(s.program), s.args) : [];
    for (const { word, into, newDirectory } of [...s.writes.map((word) => ({ word })), ...targets]) {
      judgeWrite(word, dir, into, undefined, newDirectory);
    }
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

// Importing this file must not run the gate, so session-status and the tests can use its
// exports without spawning it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runGate({ name: 'sandbox-guard', run: sandboxGuard });
}
