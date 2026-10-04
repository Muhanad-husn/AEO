// What each plugin rule did inside a consumer's window: refusals and warnings per guard
// rule id, and loads per skill and reference. Read from every session file under the
// consumer's project directories, subagent sessions included. block() formats from the
// snapshot alone.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { messageInWindow } from './interventions.mjs';

// One entry per guard rule: its id, whether the plugin still carries it, whether it can
// warn as well as refuse, and the text of its message, current and past wordings both.
// The first entry whose pattern matches a message names its rule, so the text fallback
// sits ahead of the block-merge reasons it repeats. Wordings come from plugin/hooks and
// their git history; a retired rule is printed only when it fired.
export const RULES = [
  // block-merge.mjs. The reasons are unchanged since a0d02e0; the fallback since #168.
  { id: 'block-merge/text-fallback', current: true, match: [/The command could not be parsed, so the text fallback decided\./] },
  { id: 'block-merge/forge-merge', current: true, match: [/^subagents and the forge merge tool never merge\./] },
  { id: 'block-merge/git-merge', current: true, match: [/^subagents never run git merge\./] },
  { id: 'block-merge/branch-delete', current: true, match: [/^subagents never delete branches; cleanup runs on founder approval\./] },
  { id: 'block-merge/remote-branch-delete', current: true, match: [/^subagents never delete remote branches\./] },
  { id: 'block-merge/pr-merge', current: true, match: [/^subagents never merge PRs\./] },
  { id: 'block-merge/api-merge', current: true, match: [/^subagents never merge via the API\./] },
  // block-merge.mjs rules deleted in #122.
  { id: 'block-merge/push-protected', current: false, match: [/^subagents never push to \S+\./] },
  { id: 'block-merge/push-every-ref', current: false, match: [/^`git push [^`]*` pushes every local ref, the protected branch included\./] },
  { id: 'block-merge/forge-write-protected', current: false, match: [/^no direct writes to \S+ through the forge\./] },
  { id: 'block-merge/forge-write-no-branch', current: false, match: [/^a forge write with no `branch` goes to the repository default branch\./] },
  { id: 'block-merge/default-branch-unresolved', current: false, match: [/^this repository does not say what its default branch is/] },
  // lib.mjs: a gate that threw is a refusal too.
  { id: 'gate/could-not-evaluate', current: true, match: [/^the \S+ gate could not evaluate this call/] },
  // path-guard.mjs, wording unchanged since #116; two rules deleted in fb2443c, the module in #259.
  { id: 'path-guard/harness-config', current: false, match: [/^role subagents may not touch \.claude\//] },
  { id: 'path-guard/unresolved-dir', current: false, match: [/^cannot resolve a directory for the target path/] },
  { id: 'path-guard/outside-worktree', current: false, match: [/^target is not inside a git worktree/] },
  // redirect-guard.mjs, wording unchanged since #116; the module deleted in #259.
  { id: 'redirect-guard/unresolved-target', current: false, match: [/^role subagents may not write into \.claude\/ through a shell command[\s\S]*could not be fully resolved/] },
  { id: 'redirect-guard/unparsed-command', current: false, match: [/^role subagents may not write into \.claude\/ through a shell command[\s\S]*so it could not be resolved -- but its raw text/] },
  { id: 'redirect-guard/target', current: false, match: [/^role subagents may not write into \.claude\/ through a shell command/] },
  // sandbox-guard.mjs. Every rule here but write-unrestorable was deleted in #259.
  { id: 'sandbox-guard/live-run', current: false, match: [/^`[\s\S]*?` will not run: /] },
  { id: 'sandbox-guard/live-root-relative', current: false, match: [/^AEO_LIVE_DATA_ROOT is set to [\s\S]*which is not an absolute path, so the sandbox guard/] },
  { id: 'sandbox-guard/seam-relative', current: false, match: [/^AEO_DATA_ROOT is set to [\s\S]*which is not an absolute path\. A relative seam/] },
  { id: 'sandbox-guard/seam-overlap', current: false, match: [/One contains the other, so this run is pointed at production data\./] },
  // The unset seam, refused until #214.
  { id: 'sandbox-guard/seam-unset', current: false, match: [/and sets no AEO_DATA_ROOT, so anything it runs resolves its data through its own defaults/] },
  { id: 'sandbox-guard/run-dir', current: false, match: [/^this command operates in [\s\S]*, inside the production data root /] },
  // The current wording since #237, and the write-tool wording before it.
  { id: 'sandbox-guard/write-unrestorable', current: true, match: [/inside the production data root [\s\S]*, and git cannot restore it: /, /^this \w+ targets [\s\S]*Production data is not reachable from a session\./] },
  { id: 'sandbox-guard/run-names-root', current: false, match: [/A run pointed at production data is refused\./] },
  // Refuses when the line reaches the root, warns when it does not (#237).
  { id: 'sandbox-guard/write-unlocated', current: false, warns: true, match: [/and the guard cannot tell whether that lands inside the production data root/, /the guard cannot tell where [\s\S]* lands, and nothing on the line reaches/] },
  // Warnings since #169; refusals before it.
  { id: 'sandbox-guard/unread-command', current: false, warns: true, match: [/It was allowed on what could be read/, /A command the guard cannot read is a command it cannot clear\./] },
  { id: 'sandbox-guard/unnamed-cd', current: false, warns: true, match: [/changes directory to somewhere the guard cannot name/] },
];

// A refusal as Claude Code records it: the hook's command in brackets, then the reason.
const REFUSAL = /hook error: \[([\s\S]*?)\]: BLOCKED: ([\s\S]*)$/;
// The plugin's own gate. The founder's copy of block-merge under ~/.claude/hooks is not
// the plugin's and is not counted.
const PLUGIN_HOOK = /[\\/]hooks[\\/](gate|block-merge|redirect-guard|path-guard|sandbox-guard)\.mjs/;
const HOME_HOOK = /[\\/]\.claude[\\/]hooks[\\/]/;
const WARNING_PREFIX = 'sandbox-guard: ';
const NAMESPACE = 'aeo:';
const TYPED_COMMAND = /<command-name>\/aeo:([\w-]+)<\/command-name>/;
// A reference in the plugin's source, or in the installed plugin's cache.
const REFERENCE = [
  /(?:^|\/)plugin\/references\/([^/]+)\.md$/,
  /\/plugins\/cache\/[^/]+\/aeo\/[^/]+\/references\/([^/]+)\.md$/,
];

const PLUGIN = fileURLToPath(new URL('../../plugin/', import.meta.url));

// The skills and references the plugin carries now, so one nobody loaded prints a zero.
function pluginNames() {
  const skills = readdirSync(join(PLUGIN, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  // The plugin carries no references/ directory once every reference is deleted.
  const references = (existsSync(join(PLUGIN, 'references')) ? readdirSync(join(PLUGIN, 'references')) : [])
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -3));
  return { skills, references };
}

function ruleFor(reason, rules = RULES) {
  return rules.find((rule) => rule.match.some((re) => re.test(reason))) ?? null;
}

// A warning quotes the command it allowed, so only a rule that warns is matched against it.
const WARNING_RULES = RULES.filter((rule) => rule.warns);

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  return '';
}

function referenceName(filePath) {
  const path = String(filePath ?? '').replace(/\\/g, '/');
  for (const re of REFERENCE) {
    const match = re.exec(path);
    if (match) return match[1];
  }
  return null;
}

function sorted(counts) {
  return Object.fromEntries(Object.keys(counts).sort().map((key) => [key, counts[key]]));
}

// What one record says: refusals, warnings, skill loads and reference loads.
function readRecord(record, totals, bump) {
  const content = record.message?.content;
  if (record.type === 'user' && typeof content === 'string') {
    const typed = TYPED_COMMAND.exec(content);
    if (typed) bump(totals.skills, typed[1]);
  }
  if (record.type === 'attachment' && record.attachment?.type === 'hook_system_message') {
    const text = String(record.attachment.content ?? '');
    if (text.startsWith(WARNING_PREFIX)) {
      const rule = ruleFor(text, WARNING_RULES);
      if (rule) totals.guards[rule.id].warned += 1;
      else totals.unmatched += 1;
    }
  }
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (part?.type === 'tool_result' && part.is_error === true) {
      const refusal = REFUSAL.exec(resultText(part.content));
      if (!refusal || !PLUGIN_HOOK.test(refusal[1]) || HOME_HOOK.test(refusal[1])) continue;
      const rule = ruleFor(refusal[2]);
      if (rule) totals.guards[rule.id].refused += 1;
      else totals.unmatched += 1;
    } else if (part?.type === 'tool_use' && part.name === 'Skill') {
      const skill = String(part.input?.skill ?? '');
      if (skill.startsWith(NAMESPACE)) bump(totals.skills, skill.slice(NAMESPACE.length));
    } else if (part?.type === 'tool_use' && part.name === 'Read') {
      const name = referenceName(part.input?.file_path);
      if (name !== null) bump(totals.references, name);
    }
  }
}

// The derived counts for a set of session files. This is what goes in the snapshot, so
// a replay needs no transcripts. A record seen in an earlier file (a resumed session
// copies its history) is counted once.
export function scanRules(paths, window, names = pluginNames()) {
  const totals = {
    sessions: 0,
    subagentSessions: 0,
    unmatched: 0,
    guards: Object.fromEntries(RULES.map((r) => r.id).sort().map((id) => [id, { refused: 0, warned: 0 }])),
    skills: Object.fromEntries(names.skills.map((name) => [name, 0])),
    references: Object.fromEntries(names.references.map((name) => [name, 0])),
  };
  const bump = (counts, key) => { counts[key] = (counts[key] ?? 0) + 1; };
  const seen = new Set();
  for (const path of [...paths].sort()) {
    let inWindow = false;
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
      if (raw.trim() === '') continue;
      let record;
      try {
        record = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!messageInWindow(record.timestamp, window)) continue;
      inWindow = true;
      if (record.uuid) {
        if (seen.has(record.uuid)) continue;
        seen.add(record.uuid);
      }
      readRecord(record, totals, bump);
    }
    if (!inWindow) continue;
    totals.sessions += 1;
    if (path.split(/[\\/]/).includes('subagents')) totals.subagentSessions += 1;
  }
  totals.skills = sorted(totals.skills);
  totals.references = sorted(totals.references);
  return totals;
}

function sessionFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sessionFiles(path);
    return entry.name.endsWith('.jsonl') ? [path] : [];
  });
}

// The counts for a consumer's sessions inside the window, from every project directory
// whose name starts with the consumer's slug, subagent sessions included. Returns null
// when no directory matches.
export function readRules(slug, window, homeDir = homedir()) {
  const root = join(homeDir, '.claude', 'projects');
  if (!existsSync(root)) return null;
  const matched = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(slug))
    .map((entry) => join(root, entry.name));
  if (matched.length === 0) return null;
  return scanRules(matched.flatMap(sessionFiles), window);
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function sum(values) {
  return values.reduce((total, n) => total + n, 0);
}

// The rules block. A snapshot recorded before this counter existed has no `rules` key
// and prints nothing, so its row reads as it did.
export function block(snapshot) {
  if (snapshot?.rules === undefined) return null;
  const counts = snapshot.rules;
  if (counts === null) return 'rules: no transcripts';
  const byId = new Map(RULES.map((rule) => [rule.id, rule]));
  const guards = Object.entries(counts.guards);
  const header = [
    `${sum(guards.map(([, g]) => g.refused))} refused`,
    `${sum(guards.map(([, g]) => g.warned))} warned`,
    `${counts.unmatched} unmatched`,
    plural(sum(Object.values(counts.skills)), 'skill load'),
    plural(sum(Object.values(counts.references)), 'reference load'),
  ].join(', ');
  const lines = [
    `rules: ${header} (${plural(counts.sessions, 'session')}, ${counts.subagentSessions} subagent)`,
  ];
  for (const [id, g] of guards) {
    const rule = byId.get(id);
    const retired = rule?.current === false;
    if (retired && g.refused === 0 && g.warned === 0) continue;
    const detail = rule?.warns || g.warned > 0 ? `${g.refused} refused, ${g.warned} warned` : `${g.refused} refused`;
    lines.push(`  guard ${id}: ${detail}${retired ? ' (retired)' : ''}`);
  }
  for (const [name, n] of Object.entries(counts.skills)) lines.push(`  skill ${name}: ${n}`);
  for (const [name, n] of Object.entries(counts.references)) lines.push(`  reference ${name}: ${n}`);
  return lines.join('\n');
}
