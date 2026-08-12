#!/usr/bin/env node
/**
 * collect-evidence.mjs — gather test evidence into a committed evidence folder and render a
 * Markdown evidence block for a TDD-harness pull request.
 *
 * Two modalities — the harness builds web and non-web apps:
 *   • web     — Playwright artifacts: screenshots + recordings/report.
 *   • generic — terminal transcripts (test-run output + a real endpoint invocation) embedded
 *               as fenced code blocks. No browser required.
 *
 * The modality is auto-detected (Playwright artifacts present → web; otherwise transcripts → generic)
 * and can be forced with --type web|cli|api|service|generic.
 *
 * PRIVATE vs PUBLIC repos:
 *   Inline image embeds (`![](raw.githubusercontent.com/...)`) only render on PUBLIC repos —
 *   raw.githubusercontent 404s for private repos and GitHub won't proxy them. So:
 *     • public  → screenshots embedded inline.
 *     • private → screenshots shown as clickable blob links (render in GitHub's file viewer for
 *                 signed-in reviewers) plus a note; the CI artifact still has the originals.
 *   Visibility is auto-detected via `gh repo view --json isPrivate`; override with --public/--private.
 *
 * TWO-PHASE USE (so embedded URLs point at the commit that actually contains the evidence):
 *   The collector pins URLs to the CURRENT commit. Run it in two phases around the evidence commit:
 *     1) --copy-only : copy artifacts into docs/tdd-evidence/, scan for secrets. No body written.
 *        (then `git add` + commit the evidence)
 *     2) --body-only : regenerate the PR body from the committed evidence, pinned to the new HEAD.
 *   Running with neither flag does copy+body in one shot (back-compat; URLs will pin to the
 *   pre-evidence commit, so prefer the two-phase flow when embedding web screenshots).
 *
 * Cross-platform (Windows/macOS/Linux). Requires Node 18+ and a git repo.
 *
 * Usage (web, two-phase):
 *   node collect-evidence.mjs --feature <slug> --slice <NN-slug> \
 *        --report-dir <dir>/playwright-report --results-dir <dir>/test-results --copy-only
 *   # commit the evidence, then:
 *   node collect-evidence.mjs --feature <slug> --slice <NN-slug> --body-only \
 *        --template path/to/pr-body-template.md --out PR_BODY.md
 *
 * Usage (non-web, two-phase):
 *   node collect-evidence.mjs --feature <slug> --slice <NN-slug> --type cli \
 *        --transcript test-run.txt --transcript cli-demo.txt --copy-only
 *   # commit the evidence, then:
 *   node collect-evidence.mjs --feature <slug> --slice <NN-slug> --type cli --body-only \
 *        --template path/to/pr-body-template.md --out PR_BODY.md
 *
 * Safety:
 *   - RAW traces (*.zip) and HAR captures (*.har) are dropped from the committed evidence by
 *     default (they routinely carry auth tokens / cookies). Opt in with --include-traces.
 *   - Copied text artifacts (transcripts included) are scanned for likely secrets; a match prints
 *     a loud "SECRETS SUSPECTED" report (file + pattern only, never the value) so the human reviews
 *     BEFORE committing.
 *   - Anything resolving inside the declared production data root (AEO_LIVE_DATA_ROOT) is REFUSED,
 *     not warned about, with no override flag. See "The production data refusal" below.
 *   - --out is never silently clobbered: if the target exists, output goes to <name>.generated.md
 *     unless --force is given.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { isPathInside, normalizeHookPath, realpathDeep } from '../../../hooks/lib.mjs';
import { LIVE_DATA_ROOT_ENV } from '../../../hooks/sandbox-guard.mjs';

function parseArgs(argv) {
  const args = {};
  const add = (key, value) => {
    if (key in args) args[key] = [].concat(args[key], value); // repeated flag → array
    else args[key] = value;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { add(key, true); }
      else { add(key, next); i++; }
    }
  }
  return args;
}

/** Coerce a possibly-repeated flag value into a list of string values. */
function asList(v) {
  if (v === undefined) return [];
  return [].concat(v).filter((x) => typeof x === 'string');
}

/** Map a free-form --type onto 'web' | 'generic'. Unknown / non-browser kinds → 'generic'. */
function normalizeType(t) {
  if (!t || t === true) return null;
  const s = String(t).toLowerCase();
  return ['web', 'browser', 'playwright', 'e2e', 'ui'].includes(s) ? 'web' : 'generic';
}

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}

/** Parse owner/repo from a github.com remote URL (https or ssh). Returns null otherwise. */
function parseRepo(remoteUrl) {
  if (!remoteUrl) return null;
  const m = remoteUrl.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/** Ask gh whether the repo is private. Returns null if gh/visibility is unavailable. */
function detectPrivate(repo) {
  if (!repo) return null;
  const out = sh(`gh repo view ${repo.owner}/${repo.repo} --json isPrivate -q .isPrivate`);
  if (out === 'true') return true;
  if (out === 'false') return false;
  return null; // gh missing / not authed / unknown
}

/** Recursively list files under dir (absolute paths). */
function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** OS path -> forward-slash repo-relative path (for URLs and display). */
function toRepoUrlPath(absPath, repoRoot) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

// High-signal secret patterns. Specific enough to limit false positives on report boilerplate.
const SECRET_PATTERNS = [
  ['Authorization: Bearer', /authorization\s*:\s*bearer\s+\S+/i],
  ['Set-Cookie header', /\bset-cookie\s*:/i],
  ['Cookie header with value', /\bcookie\s*:\s*[^\s;]+=/i],
  ['Bearer token', /\bbearer\s+[A-Za-z0-9._\-]{20,}/i],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ['Assigned credential', /\b(api[_-]?key|secret|password|passwd|access[_-]?token)\b\s*[=:]\s*['"]?[A-Za-z0-9._\-]{8,}/i],
];

const TEXT_EXT = /\.(json|har|txt|log|xml|md|yaml|yml|csv|html?)$/i;
const TRANSCRIPT_EXT = /\.(txt|log|json|md|csv)$/i;

function scanForSecrets(files) {
  const hits = [];
  for (const f of files) {
    if (!TEXT_EXT.test(f)) continue;
    let stat;
    try { stat = fs.statSync(f); } catch { continue; }
    if (stat.size > 2 * 1024 * 1024) continue; // skip very large bundles
    let content;
    try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const [name, re] of SECRET_PATTERNS) {
      if (re.test(content)) hits.push({ file: f, pattern: name });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// The production data refusal (EN-16)
// ---------------------------------------------------------------------------
//
// Everything this script touches is one commit away from being published: evidence is
// copied into the repository, committed, pushed, and embedded in a pull request body.
// P1.5's sandbox guard stops a session reaching production data. This stops production
// data leaving by the other end of the same pipeline, and both read ONE declaration of
// where that data is — L-03's environment-variable seam, AEO_LIVE_DATA_ROOT — so the two
// can never disagree about what they are protecting.
//
// REFUSE, NEVER WARN, AND NO OVERRIDE FLAG (L-05). A warning here is advice printed
// beside data that has already been copied, and advice is what cost 19,000 documents.
//
// Paths are compared RESOLVED, through symlinks, junctions and `..`, because a link into
// production data defeats a string comparison and defeats the guarantee with it.

const NO_OVERRIDE =
  'There is no override flag. That is deliberate (L-05): an override is what you reach for at 2am.';

function refuse(lines) {
  console.error('\n============ PRODUCTION DATA IN EVIDENCE — REFUSED ============');
  for (const line of lines) console.error(line);
  console.error(NO_OVERRIDE);
  console.error('==============================================================\n');
  process.exit(1);
}

/**
 * The declared production data root, fully resolved, or null when none is declared.
 *
 * UNSET IS A LOUD SKIP. It is not a refusal and it is not silence. A project with no
 * production data directory declares nothing, which is the normal and correct state for
 * most repositories; refusing every run there would make the collector unusable and get
 * it deleted, and a guard that is deleted protects nothing. Skipping quietly is the
 * fail-open case this check exists to prevent, so the skip is announced on stderr and
 * again in the summary, where the operator and the safe-pr skill both read. That is the
 * same answer P1.5's guard and sandbox-session already give for the same variable, so all
 * three behave alike.
 *
 * SET BUT NOT ABSOLUTE IS A REFUSAL. That is a misconfiguration rather than an absence:
 * a relative root resolves against whatever directory this process happens to run in, so
 * the check would be comparing against a place nobody named.
 */
function productionDataRoot(env = process.env) {
  const raw = typeof env[LIVE_DATA_ROOT_ENV] === 'string' ? env[LIVE_DATA_ROOT_ENV].trim() : '';
  if (raw === '') {
    console.warn(
      `WARN: ${LIVE_DATA_ROOT_ENV} is unset, so this project declares no production data root and the ` +
      'production-data check DID NOT RUN — only the secret scan is protecting this evidence. Declare the ' +
      'production data root to make the check real.');
    return null;
  }
  const declared = normalizeHookPath(raw);
  if (!path.isAbsolute(declared)) {
    refuse([
      `${LIVE_DATA_ROOT_ENV} is ${JSON.stringify(raw)}, which is not an absolute path.`,
      'A relative root resolves against whatever directory this process happens to run in, so the collector',
      'cannot tell whether an evidence path sits inside production data. Set it to an absolute path, or unset',
      'it if this project has no production data.',
    ]);
  }
  return realpathDeep(declared);
}

/**
 * Refuse every candidate resolving inside the production data root.
 *
 * Called on the sources before the copy and on the evidence folder after it, and both
 * calls carry their own weight. Before: copying out of production data is already the
 * read L-03 exists to stop. After: `fs.cpSync` copies a symlink AS a symlink, `walk`
 * reports it as an ordinary file, and the body phase then reads through it — so a link is
 * how production content reaches a pull request without a byte of it being copied.
 */
function refuseProductionPaths(candidates, liveRoot, what) {
  if (liveRoot === null) return;
  for (const candidate of candidates) {
    const resolved = realpathDeep(path.resolve(candidate));
    if (!isPathInside(liveRoot, resolved)) continue;
    refuse([
      // Printed raw, not JSON-quoted: on Windows every separator doubles and the reader
      // is a person deciding what to delete.
      `${what}: ${candidate}`,
      `resolves to: ${resolved}`,
      `which is inside the production data root ${liveRoot} (${LIVE_DATA_ROOT_ENV}).`,
      'Evidence is committed, pushed and embedded in a pull request body, so a path resolving into production',
      'data is one commit away from publishing it. Collect evidence produced by a sandboxed run instead.',
    ]);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const feature = args.feature;
  const slice = args.slice;
  if (!feature || !slice || feature === true || slice === true) {
    console.error('ERROR: --feature <slug> and --slice <NN-slug> are required.');
    process.exit(1);
  }

  const reportDir = (typeof args['report-dir'] === 'string' && args['report-dir']) || 'playwright-report';
  const resultsDir = (typeof args['results-dir'] === 'string' && args['results-dir']) || 'test-results';
  const maxShots = parseInt(args['max-screenshots'] || '12', 10);
  const maxTranscriptLines = parseInt(args['max-transcript-lines'] || '200', 10);
  const includeTraces = !!args['include-traces'];
  const force = !!args.force;
  const copyOnly = !!args['copy-only'];
  const bodyOnly = !!args['body-only'];
  let outFile = (typeof args.out === 'string' && args.out) || 'PR_BODY.md';

  if (copyOnly && bodyOnly) {
    console.error('ERROR: --copy-only and --body-only are mutually exclusive.');
    process.exit(1);
  }

  // Read before anything is copied or created: a root that is set but unusable stops the
  // run here rather than after the collector has already touched the filesystem.
  const liveRoot = productionDataRoot();

  const explicitType = normalizeType(args.type);
  const transcriptInputs = asList(args.transcript).map(t => (path.isAbsolute(t) ? t : path.join(process.cwd(), t)));
  const transcriptDir = typeof args['transcript-dir'] === 'string' ? args['transcript-dir'] : null;
  const transcriptDirAbs = transcriptDir && (path.isAbsolute(transcriptDir) ? transcriptDir : path.join(process.cwd(), transcriptDir));

  const repoRoot = sh('git rev-parse --show-toplevel') || process.cwd();
  const branch = sh('git rev-parse --abbrev-ref HEAD');
  const sha = sh('git rev-parse HEAD');
  const ref = sha || branch; // pin URLs to the commit so they survive branch deletion
  const remote = sh('git remote get-url origin');
  const repo = parseRepo(remote);

  // Visibility: explicit override wins, else ask gh, else assume public (inline embeds, today's default).
  const isPrivate = args.private ? true : args.public ? false : (detectPrivate(repo) === true);

  if (!branch || branch === 'HEAD') {
    console.warn('WARN: detached HEAD or no branch — checkout the feature branch before collecting evidence.');
  }
  if (!repo) {
    if (remote) console.warn('WARN: origin is not a github.com remote (GitHub Enterprise hosts are not auto-detected) — links will use repo-relative paths and may not render in the PR.');
    else console.warn('WARN: no origin remote — links will use repo-relative paths until the branch is pushed to GitHub.');
  }

  const destRel = path.join('docs', 'tdd-evidence', feature, slice);
  const destAbs = path.join(repoRoot, destRel);
  refuseProductionPaths([destAbs], liveRoot, 'evidence folder');

  // Decide modality (uses the resolved report/results dirs). Read-only — safe before the
  // folder exists, since a fresh run's destAbs is not there yet and existsSync just says so.
  const reportAbs = path.isAbsolute(reportDir) ? reportDir : path.join(repoRoot, reportDir);
  const resultsAbs = path.isAbsolute(resultsDir) ? resultsDir : path.join(repoRoot, resultsDir);
  const sourceHasPw = fs.existsSync(reportAbs) || fs.existsSync(resultsAbs);
  const destHasPw = fs.existsSync(path.join(destAbs, 'playwright-report')) || fs.existsSync(path.join(destAbs, 'test-results'));
  const hasPwArtifacts = sourceHasPw || destHasPw;
  const type = explicitType
    || (hasPwArtifacts ? 'web' : ((transcriptInputs.length || transcriptDir || hasTopLevelTranscripts(destAbs)) ? 'generic' : 'web'));

  // Every source the copy would read, each tree's entries included: a source directory
  // outside production data can still hold a link into it. Checked BEFORE the evidence
  // folder is created: a refusal that has to undo its own mkdir is a refusal with a
  // partial-failure mode, so the check comes first and the folder is never touched on a
  // refused run.
  if (!bodyOnly) {
    const sources = [];
    for (const srcAbs of [reportAbs, resultsAbs]) if (fs.existsSync(srcAbs)) sources.push(srcAbs, ...walk(srcAbs));
    sources.push(...transcriptInputs);
    if (transcriptDirAbs) sources.push(transcriptDirAbs, ...walk(transcriptDirAbs));
    refuseProductionPaths(sources, liveRoot, 'evidence source');
  }

  fs.mkdirSync(destAbs, { recursive: true });

  // ---- COPY PHASE (skipped in --body-only) ----
  if (!bodyOnly) {
    const copied = [];
    for (const [srcAbs, name] of [[reportAbs, 'playwright-report'], [resultsAbs, 'test-results']]) {
      if (fs.existsSync(srcAbs)) {
        fs.cpSync(srcAbs, path.join(destAbs, name), { recursive: true });
        copied.push(name);
      }
    }
    if (type === 'web' && copied.length === 0 && !destHasPw) {
      console.warn(`WARN: neither "${reportDir}" nor "${resultsDir}" exist. Run the Playwright suite first (or pass --type cli/api with --transcript for a non-web slice).`);
    }

    // Copy transcripts (non-web evidence, or extra command output for a web slice).
    const addTranscript = (srcAbs) => {
      if (!fs.existsSync(srcAbs)) { console.warn(`WARN: transcript not found, skipping: ${srcAbs}`); return; }
      if (fs.statSync(srcAbs).isDirectory()) return;
      const dst = path.join(destAbs, path.basename(srcAbs));
      if (path.resolve(srcAbs) !== path.resolve(dst)) fs.cpSync(srcAbs, dst);
    };
    for (const t of transcriptInputs) addTranscript(t);
    if (transcriptDirAbs) {
      for (const f of walk(transcriptDirAbs)) addTranscript(f);
    }

    // Drop raw traces (.zip) and HAR captures (.har) from the committed copy unless asked to keep them.
    if (!includeTraces) {
      for (const f of walk(destAbs)) {
        if (/\.(zip|har)$/i.test(f)) { fs.rmSync(f, { force: true }); }
      }
    }
  }

  // ---- CLASSIFY (always, from the committed evidence folder) ----
  const files = walk(destAbs);
  const screenshots = files.filter(f => /\.(png|jpe?g)$/i.test(f)).sort();
  const videos = files.filter(f => /\.(webm|mp4)$/i.test(f)).sort();
  const isTrace = f => /\.zip$/i.test(f) && /(^|[\\/])trace[^\\/]*\.zip$/i.test(f);
  const traces = files.filter(isTrace).sort();
  const reportIndex = files.find(f => /playwright-report[\\/].*index\.html$/i.test(f));
  // Transcripts = top-level text files in the evidence folder (that's where the copy phase puts them).
  const transcriptFiles = topLevelTranscripts(destAbs);
  const droppedSensitive = files.filter(f => /\.(zip|har)$/i.test(f) && !isTrace(f)).length; // informational only

  refuseProductionPaths(files, liveRoot, 'evidence file');
  const secretHits = scanForSecrets(files);

  const rawUrl = (rel) => repo && ref ? `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${ref}/${rel}` : rel;
  const blobUrl = (rel) => repo && ref ? `https://github.com/${repo.owner}/${repo.repo}/blob/${ref}/${rel}` : rel;

  // ---- BODY PHASE (skipped in --copy-only) ----
  if (!copyOnly) {
    const lines = [];

    if (type === 'web') {
      lines.push('### Visual evidence', '');
      if (screenshots.length === 0) {
        lines.push("_No screenshots found. Add `await page.screenshot(...)` at the decisive assertion, or set `screenshot: 'on'` in playwright.config._");
      } else if (isPrivate) {
        lines.push('> ℹ️ This repo is **private**, so inline image previews don\'t render in the PR (raw.githubusercontent requires public access). The screenshots are committed — click to open them in GitHub\'s file viewer (signed in), and they\'re also in the e2e CI artifact.', '');
        for (const s of screenshots.slice(0, maxShots)) {
          lines.push(`- 📷 [${path.basename(s)}](${blobUrl(toRepoUrlPath(s, repoRoot))})`);
        }
        lines.push('');
      } else {
        for (const s of screenshots.slice(0, maxShots)) {
          const rel = toRepoUrlPath(s, repoRoot);
          const label = path.basename(s);
          lines.push(`**${label}**`, '', `![${label}](${rawUrl(rel)})`, '');
        }
      }
      if (screenshots.length > maxShots) {
        lines.push(`_…and ${screenshots.length - maxShots} more screenshot(s) in \`${destRel.split(path.sep).join('/')}/\`._`, '');
      }

      lines.push('### Recordings', '');
      if (videos.length) {
        lines.push('_Click to download and view the recording of the run:_', '');
        for (const v of videos) lines.push(`- [${path.basename(v)}](${blobUrl(toRepoUrlPath(v, repoRoot))})`);
        lines.push('');
      } else {
        lines.push('> ⚠️ **No recording was captured.** A web slice requires a video of the passing acceptance run. Set `video: \'on\'`, re-run the e2e suite, and re-collect.', '');
      }

      lines.push('### Reports & traces', '');
      if (reportIndex) {
        const rel = toRepoUrlPath(reportIndex, repoRoot);
        lines.push(`- Playwright HTML report: [\`${rel}\`](${blobUrl(rel)}) (also uploaded as a CI artifact — open locally with \`npx playwright show-report\`).`);
      }
      for (const t of traces) {
        const rel = toRepoUrlPath(t, repoRoot);
        lines.push(`- Trace: [${path.basename(t)}](${blobUrl(rel)}) — open with \`npx playwright show-trace <file>\`.`);
      }
      lines.push('');
    }

    // Transcripts — primary evidence for non-web slices; supplementary for web.
    if (transcriptFiles.length) {
      lines.push('### Test output (transcripts)', '');
      for (const tf of transcriptFiles) {
        const rel = toRepoUrlPath(tf, repoRoot);
        const label = path.basename(tf);
        let content = '';
        try { content = fs.readFileSync(tf, 'utf8'); } catch { /* unreadable */ }
        const allLines = content.replace(/\s+$/, '').split(/\r?\n/);
        const shown = allLines.slice(0, maxTranscriptLines);
        const truncated = allLines.length > maxTranscriptLines;
        const fence = content.includes('```') ? '~~~' : '```';
        const lang = /\.json$/i.test(tf) ? 'json' : '';
        lines.push(`**${label}**`, '');
        lines.push(fence + lang, ...shown, fence, '');
        if (truncated) lines.push(`_…truncated to ${maxTranscriptLines} lines; full transcript (${allLines.length} lines): [\`${rel}\`](${blobUrl(rel)})._`, '');
        else lines.push(`Full transcript: [\`${rel}\`](${blobUrl(rel)})`, '');
      }
    } else if (type !== 'web') {
      lines.push('### Test output (transcripts)', '');
      lines.push('> ⚠️ **No transcript captured.** For a non-web slice, capture the test-run output AND a real endpoint invocation to files and pass them with `--transcript <file>` (repeatable).', '');
    }

    lines.push(`_All evidence committed under \`${destRel.split(path.sep).join('/')}/\`._`, '');

    const block = lines.join('\n');

    const template = typeof args.template === 'string' ? args.template : null;
    if (template && fs.existsSync(template)) {
      let body = fs.readFileSync(template, 'utf8');
      body = body.includes('<!-- EVIDENCE -->') ? body.replace('<!-- EVIDENCE -->', block) : body + '\n\n' + block;
      if (fs.existsSync(outFile) && !force) {
        outFile = outFile.replace(/\.md$/i, '') + '.generated.md';
        console.warn(`WARN: target PR body already exists — wrote to ${outFile} instead (use --force to overwrite).`);
      }
      fs.writeFileSync(outFile, body, 'utf8');
      console.log(`Wrote PR body with evidence to ${outFile}`);
    } else if (args.out) {
      if (fs.existsSync(outFile) && !force) {
        outFile = outFile.replace(/\.md$/i, '') + '.generated.md';
        console.warn(`WARN: target already exists — wrote evidence block to ${outFile} instead (use --force to overwrite).`);
      }
      fs.writeFileSync(outFile, block, 'utf8');
      console.log(`Wrote evidence block to ${outFile}`);
    }

    console.log('\n----- EVIDENCE BLOCK -----\n');
    console.log(block);
  }

  // Loud secret report — the safe-pr skill keys off the "SECRETS SUSPECTED" token.
  if (secretHits.length) {
    console.log('\n==================== SECRETS SUSPECTED ====================');
    console.log('Review and redact these BEFORE committing — committed history is hard to un-publish:');
    for (const h of secretHits) console.log(`  ! ${h.pattern}  in  ${toRepoUrlPath(h.file, repoRoot)}`);
    console.log('==========================================================');
  }

  console.log('\n----- SUMMARY -----');
  console.log(`phase           : ${copyOnly ? 'copy-only' : bodyOnly ? 'body-only' : 'copy+body (single-shot)'}`);
  console.log(`modality        : ${type}${explicitType ? ' (forced)' : ' (auto-detected)'}`);
  console.log(`repo visibility : ${isPrivate ? 'private (screenshots shown as blob links)' : 'public (screenshots embedded inline)'}`);
  console.log(`evidence folder : ${destRel.split(path.sep).join('/')}/`);
  if (type === 'web') {
    console.log(`screenshots     : ${screenshots.length}`);
    console.log(`recordings      : ${videos.length}${videos.length ? '' : '  <-- WARNING: a web slice requires a recording of the acceptance run'}`);
    console.log(`traces          : ${traces.length}${includeTraces ? '' : ' (raw traces/HAR omitted; --include-traces to keep)'}`);
  }
  console.log(`transcripts     : ${transcriptFiles.length}${type !== 'web' && transcriptFiles.length === 0 ? '  <-- WARNING: a non-web slice needs at least one transcript' : ''}`);
  console.log(`secrets         : ${secretHits.length ? secretHits.length + ' SUSPECTED — see report above' : 'none detected (still skim the evidence)'}`);
  console.log(`production data : ${liveRoot ? `nothing resolves inside ${liveRoot}` : `NOT CHECKED — ${LIVE_DATA_ROOT_ENV} is unset (see the warning above)`}`);
  console.log(`commit          : ${sha ? sha.slice(0, 12) : '(unknown)'}`);
  console.log(`repo            : ${repo ? repo.owner + '/' + repo.repo : '(no github.com remote)'}`);
  if (copyOnly) {
    console.log('next            : git add the evidence folder, commit it, then re-run with --body-only to pin URLs to that commit.');
  }
  if (!repo || !branch || branch === 'HEAD') {
    console.log('note            : push the feature branch to GitHub so committed-file URLs resolve.');
  }
}

/** Top-level (depth-1) text files in the evidence folder — these are the copied transcripts. */
function topLevelTranscripts(destAbs) {
  if (!fs.existsSync(destAbs)) return [];
  return fs.readdirSync(destAbs, { withFileTypes: true })
    .filter(e => e.isFile() && TRANSCRIPT_EXT.test(e.name))
    .map(e => path.join(destAbs, e.name))
    .sort();
}

function hasTopLevelTranscripts(destAbs) {
  return topLevelTranscripts(destAbs).length > 0;
}

main();
