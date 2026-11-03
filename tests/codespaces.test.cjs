'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createConfig, ensureServer } = require('../scripts/codespaces.cjs');

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

const env = { ...process.env, CODESPACE_NAME: 'test-neon-parry' };

test('Codespaces starts once, accepts its exact origins, and reuses the verified process', async t => {
  const reservation = http.createServer();
  const port = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neon-codespaces-test-'));
  let pid;
  t.after(async () => {
    if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} }
    await fs.rm(stateDir, { recursive: true, force: true });
  });
  const options = { env: { ...env, HOST: '127.0.0.2', PORT: '1', ALLOWED_ORIGINS: '*' }, port, stateDir };
  const [first, second] = await Promise.all([ensureServer(options), ensureServer(options)]);
  pid = first.pid;
  assert.equal(first.pid, second.pid);
  assert.deepEqual([first.reused, second.reused].sort(), [false, true]);
  const base = 'http://127.0.0.1:' + port;
  for (const origin of ['https://jooyoungfe.github.io', first.publicUrl, 'http://localhost:' + port, base]) {
    const response = await fetch(base + '/api/v1/rooms', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Codespaces' })
    });
    assert.equal(response.status, 201, origin);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.ok((await response.json()).playerToken);
  }
  for (const origin of ['https://attacker.example', first.publicUrl + '.evil.example', 'https://jooyoungfe.github.io.evil.example']) {
    assert.equal((await fetch(base + '/health', { headers: { Origin: origin } })).status, 403, origin);
  }
  const config = await fetch(base + '/config.js');
  assert.match(await config.text(), /apiBaseUrl: window\.location\.origin/);
  // A state or log file never becomes a frontend URL.
  assert.equal((await fetch(base + '/server.json')).status, 404);
  assert.equal((await fetch(base + '/server.log')).status, 404);
  assert.equal((await ensureServer(options)).pid, pid);
});

test('an occupied, unverified port is left running and is never replaced', async t => {
  const server = http.createServer((req, res) => { res.end('another application'); });
  const port = await listen(server);
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neon-codespaces-occupied-'));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(stateDir, { recursive: true, force: true });
  });
  await assert.rejects(ensureServer({ env, port, stateDir }), /already in use.*no process was stopped/);
  assert.equal(await (await fetch('http://127.0.0.1:' + port)).text(), 'another application');
  assert.equal(server.listening, true);
});

test('a stale state file cannot authorize reuse of an unrelated server', async t => {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'ok', apiVersion: 1, storage: 'memory' })); });
  const port = await listen(server);
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neon-codespaces-stale-'));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(stateDir, { recursive: true, force: true });
  });
  const options = { env, port, stateDir };
  await fs.writeFile(path.join(stateDir, 'server.json'), JSON.stringify({ pid: process.pid, fingerprint: createConfig(options).fingerprint }));
  await assert.rejects(ensureServer(options), /unverified or outdated server/);
  assert.equal(server.listening, true);
});

test('the forwarding domain is validated and environment overrides cannot widen CORS', () => {
  const config = createConfig({ env: { ...env, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'preview.app.github.dev', ALLOWED_ORIGINS: '*' } });
  assert.equal(config.publicUrl, 'https://test-neon-parry-8080.preview.app.github.dev');
  assert.equal(config.env.ALLOWED_ORIGINS, 'https://jooyoungfe.github.io,https://test-neon-parry-8080.preview.app.github.dev');
  assert.throws(() => createConfig({ env: { ...env, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev/path' } }), /Invalid Codespaces/);
  assert.throws(() => createConfig({ env: { ...env, CODESPACE_NAME: '' } }), /inside a GitHub Codespace/);
});
