// The sensorium's services section (#270): the device services a project says it needs,
// read from aeo-services.json at its root, and whether each one answers right now.
//
//   {"services": [{"name": "postgres", "port": 5432},
//                 {"name": "docker", "command": "docker info"}]}
//
// An entry has a name and exactly one check: a `port` (a TCP connect to `host`, default
// 127.0.0.1) or a `command` (up when it exits 0). The hook only reports; starting a
// service is the orchestrator's or the founder's job.
//
// Cost: one TCP connect or one process per declared service, at session start only,
// all started together and each bounded at PROBE_TIMEOUT_MS (5 s). No file, nothing runs.
//
// Nothing is dropped silently. An unreadable file prints one line; a bad entry prints
// its own line, counts as down, and leaves the good entries beside it untouched.

import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const name = '40-services';

const FILE = 'aeo-services.json';
// 5 s, not less: `docker info` alone takes 1.7 to 2.7 s on the founder's machine, so a shorter
// bound reads a running Docker as down. SessionStart allows the whole readout 20 s.
const PROBE_TIMEOUT_MS = 5000;
const DEFAULT_HOST = '127.0.0.1';

/** TCP connect to host:port. Resolves { up, why }; never rejects. */
function probePort(host, port) {
  const what = `${host}:${port}`;
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (up, why) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ up, why });
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('connect', () => done(true, `port ${what}`));
    socket.once('timeout', () => done(false, `port ${what}, timed out`));
    socket.once('error', (err) => done(false, `port ${what}, ${err.code ?? err.message}`));
  });
}

/**
 * Run a command and report whether it exits 0. `shell: true` is deliberate: on Windows
 * a command like `docker info` or `npm --version` is an `.exe` or a `.cmd` shim that
 * only a shell resolves from PATH, and the string is the project's own record in its
 * own repository, so it is run as written. Resolves { up, why }; never rejects.
 */
function probeCommand(command) {
  return new Promise((resolve) => {
    let settled = false;
    let child;
    const done = (up, why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ up, why });
    };
    const timer = setTimeout(() => {
      killTree(child);
      done(false, `command \`${command}\`, timed out`);
    }, PROBE_TIMEOUT_MS);
    try {
      child = spawn(command, { shell: true, stdio: 'ignore', windowsHide: true });
    } catch (err) {
      done(false, `command \`${command}\`, ${err.message}`);
      return;
    }
    child.unref();
    child.once('error', (err) => done(false, `command \`${command}\`, ${err.message}`));
    child.once('exit', (code, signal) => {
      if (code === 0) done(true, `command \`${command}\``);
      else done(false, `command \`${command}\`, exit ${code ?? signal}`);
    });
  });
}

/** Kill the shell and what it started; `child.kill()` alone leaves a Windows grandchild running. */
function killTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref();
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    // The child may already be gone; nothing more to do.
  }
}

/** One entry to one { label, result } where result is the probe's promise or a problem. */
function check(entry, index) {
  const position = `entry ${index + 1}`;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return { label: position, result: { up: false, why: 'not an object' } };
  }
  if (typeof entry.name !== 'string' || entry.name.trim() === '') {
    return { label: position, result: { up: false, why: 'no name' } };
  }
  const label = entry.name;
  const hasPort = entry.port !== undefined;
  const hasCommand = entry.command !== undefined;
  if (hasPort && hasCommand) {
    return { label, result: { up: false, why: 'has both port and command, it needs exactly one' } };
  }
  if (!hasPort && !hasCommand) {
    return { label, result: { up: false, why: 'has neither port nor command, it needs exactly one' } };
  }
  if (hasPort) {
    if (!Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65535) {
      return { label, result: { up: false, why: `port ${JSON.stringify(entry.port)} is not a number from 1 to 65535` } };
    }
    const host = typeof entry.host === 'string' && entry.host !== '' ? entry.host : DEFAULT_HOST;
    return { label, result: probePort(host, entry.port) };
  }
  if (typeof entry.command !== 'string' || entry.command.trim() === '') {
    return { label, result: { up: false, why: 'command is not a non-empty string' } };
  }
  return { label, result: probeCommand(entry.command) };
}

export async function render({ root }) {
  const file = root ? path.join(root, FILE) : null;
  if (!file || !existsSync(file)) return ['services: none declared'];

  let services;
  try {
    ({ services } = JSON.parse(readFileSync(file, 'utf8')));
  } catch (err) {
    return [`services: unreadable (${FILE}, ${err.message})`];
  }
  if (!Array.isArray(services)) {
    return [`services: unreadable (${FILE}, "services" is missing or is not an array)`];
  }

  const checked = services.map(check);
  const results = await Promise.all(checked.map((c) => c.result));
  const down = results.filter((r) => !r.up).length;
  return [
    `services: ${services.length} declared, ${down} down`,
    ...checked.map((c, i) => `  ${c.label}: ${results[i].up ? 'up' : 'down'} (${results[i].why})`),
  ];
}
