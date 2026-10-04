// Tests for plugin/hooks/sensorium/40-services.mjs (#270): the sensorium's services
// section, printing which device services a project's aeo-services.json declares and
// whether each answers.
//
// Two layers, cheapest first: render({ root }) directly against a scratch root, then
// renderSensorium(root), which the acceptance criterion is stated in terms of.

import net from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { render, name } from '../../plugin/hooks/sensorium/40-services.mjs';
import { renderSensorium } from '../../plugin/hooks/sensorium.mjs';

const scratch = [];
function tempRoot() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aeo-services-'));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function declare(root, content) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  writeFileSync(path.join(root, 'aeo-services.json'), text);
}

/** A TCP server on an ephemeral port; resolves with its port and a close function. */
function listen() {
  return new Promise((resolve) => {
    const server = net.createServer((s) => s.destroy());
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/** A port that was open a moment ago and is now closed. */
async function closedPort() {
  const s = await listen();
  await s.close();
  return s.port;
}

// Quoted so the command works whatever PATH holds and whatever the shell does with spaces.
const NODE = `"${process.execPath}"`;
const exit0 = `${NODE} -e "process.exit(0)"`;
const exit3 = `${NODE} -e "process.exit(3)"`;
const hang = `${NODE} -e "setTimeout(()=>{},10000)"`;

describe('40-services.mjs, render({ root })', () => {
  test('exports its section name', () => {
    assert.equal(name, '40-services');
  });

  test('no file: "services: none declared"', async () => {
    assert.deepEqual(await render({ root: tempRoot() }), ['services: none declared']);
  });

  test('no root: "services: none declared"', async () => {
    assert.deepEqual(await render({ root: null }), ['services: none declared']);
  });

  test('a port that answers is up, a closed port is down, each naming the check', async () => {
    const root = tempRoot();
    const server = await listen();
    const closed = await closedPort();
    declare(root, { services: [{ name: 'db', port: server.port }, { name: 'cache', port: closed }] });
    const lines = await render({ root });
    await server.close();
    assert.equal(lines[0], 'services: 2 declared, 1 down');
    assert.match(lines[1], new RegExp(`^  db: up \\(.*127\\.0\\.0\\.1:${server.port}.*\\)$`));
    assert.match(lines[2], new RegExp(`^  cache: down \\(.*127\\.0\\.0\\.1:${closed}.*\\)$`));
  });

  test('a declared host is used for the port check and named in the line', async () => {
    const root = tempRoot();
    const server = await listen();
    declare(root, { services: [{ name: 'db', port: server.port, host: 'localhost' }] });
    const lines = await render({ root });
    await server.close();
    assert.match(lines[1], new RegExp(`db: up \\(.*localhost:${server.port}`));
  });

  test('a command that exits 0 is up; one that exits 3 is down with the exit code', async () => {
    const root = tempRoot();
    declare(root, { services: [{ name: 'good', command: exit0 }, { name: 'bad', command: exit3 }] });
    const lines = await render({ root });
    assert.equal(lines[0], 'services: 2 declared, 1 down');
    assert.match(lines[1], /^  good: up \(/);
    assert.match(lines[2], /^  bad: down \(.*exit 3.*\)$/);
  });

  test('a command that never exits is down (timed out) and the section returns within 2 s', async () => {
    const root = tempRoot();
    declare(root, { services: [{ name: 'stuck', command: hang }] });
    const start = Date.now();
    const lines = await render({ root });
    assert.ok(Date.now() - start < 2000, `took ${Date.now() - start} ms`);
    assert.equal(lines[0], 'services: 1 declared, 1 down');
    assert.match(lines[1], /^  stuck: down \(.*timed out.*\)$/);
  });

  test('probes run together: two hanging commands cost one timeout, not two', async () => {
    const root = tempRoot();
    declare(root, { services: [{ name: 'a', command: hang }, { name: 'b', command: hang }] });
    const start = Date.now();
    await render({ root });
    assert.ok(Date.now() - start < 2000, `took ${Date.now() - start} ms`);
  });

  test('a malformed file prints one line naming the problem', async () => {
    const root = tempRoot();
    declare(root, '{ not json');
    const lines = await render({ root });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^services: unreadable \(aeo-services\.json/);
  });

  test('a file whose services is missing or not an array prints one line naming it', async () => {
    for (const body of [{}, { services: 'postgres' }, []]) {
      const root = tempRoot();
      declare(root, body);
      const lines = await render({ root });
      assert.equal(lines.length, 1);
      assert.match(lines[0], /^services: unreadable \(.*services.*array/);
    }
  });

  test('an entry with both port and command is named, counted down, and hides no other entry', async () => {
    const root = tempRoot();
    const server = await listen();
    declare(root, { services: [{ name: 'both', port: 1, command: exit0 }, { name: 'ok', port: server.port }] });
    const lines = await render({ root });
    await server.close();
    assert.equal(lines[0], 'services: 2 declared, 1 down');
    assert.match(lines[1], /^  both: down \(.*both.*port.*command.*\)$/);
    assert.match(lines[2], /^  ok: up/);
  });

  test('an entry with neither port nor command is named and counted down', async () => {
    const root = tempRoot();
    declare(root, { services: [{ name: 'empty' }] });
    const lines = await render({ root });
    assert.equal(lines[0], 'services: 1 declared, 1 down');
    assert.match(lines[1], /^  empty: down \(.*neither.*port.*command.*\)$/);
  });

  test('an entry without a name, or that is not an object, prints a line naming its position', async () => {
    const root = tempRoot();
    declare(root, { services: [{ port: 5432 }, 'ollama'] });
    const lines = await render({ root });
    assert.equal(lines[0], 'services: 2 declared, 2 down');
    assert.match(lines[1], /^  entry 1: down \(.*no name.*\)$/);
    assert.match(lines[2], /^  entry 2: down \(.*not an object.*\)$/);
  });

  test('an invalid port value is down with the problem named', async () => {
    const root = tempRoot();
    declare(root, { services: [{ name: 'x', port: 'abc' }] });
    const lines = await render({ root });
    assert.match(lines[1], /^  x: down \(.*port.*\)$/);
  });
});

describe('renderSensorium(root) with the services section', () => {
  test('the acceptance scenario: four entries, two down, one line each', async () => {
    const root = tempRoot();
    const server = await listen();
    const closed = await closedPort();
    declare(root, {
      services: [
        { name: 'up-port', port: server.port },
        { name: 'down-port', port: closed },
        { name: 'ok-cmd', command: exit0 },
        { name: 'bad-cmd', command: exit3 },
      ],
    });
    const lines = await renderSensorium(root);
    await server.close();
    const at = lines.indexOf('services: 4 declared, 2 down');
    assert.ok(at >= 0, lines.join('\n'));
    assert.match(lines[at + 1], /up-port: up/);
    assert.match(lines[at + 2], /down-port: down/);
    assert.match(lines[at + 3], /ok-cmd: up/);
    assert.match(lines[at + 4], /bad-cmd: down/);
  });

  test('no file: the block carries "services: none declared"', async () => {
    const lines = await renderSensorium(tempRoot());
    assert.ok(lines.includes('services: none declared'));
  });

  test('a docker-info style command (a PATH shim, not a bare exe) resolves', async () => {
    // `npm` is a .cmd shim on Windows, the same kind of file `docker` can be.
    const root = tempRoot();
    declare(root, { services: [{ name: 'shim', command: 'npm --version' }] });
    const lines = await render({ root });
    assert.match(lines[1], /^  shim: up/);
  });
});

describe('plugin.json', () => {
  test('reads 0.6.0', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../plugin/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
    assert.equal(manifest.version, '0.6.0');
  });
});
