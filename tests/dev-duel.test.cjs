'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameServer } = require('../scripts/dev_duel.cjs');

test('duel development URL serves the game, same-origin API and only frontend assets', async t => {
  const server = createGameServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.stop());
  const base = 'http://127.0.0.1:' + server.address().port;
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(await home.text(), /Neon Parry/i);

  const config = await fetch(base + '/config.js');
  assert.match(config.headers.get('content-type'), /javascript/);
  assert.match(await config.text(), /apiBaseUrl: window\.location\.origin/);
  const engine = await fetch(base + '/js/duel-engine.js');
  assert.equal(engine.status, 200);
  assert.match(engine.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base + '/health')).status, 200);
  const room = await fetch(base + '/api/v1/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Local' })
  });
  assert.equal(room.status, 201);
  assert.ok((await room.json()).playerToken);

  for (const pathname of ['/backend/server.cjs', '/package.json', '/.env', '/js/..%2f..%2fbackend/server.cjs']) {
    assert.equal((await fetch(base + pathname)).status, 404, pathname);
  }
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/styles.css', { method: 'HEAD' })).status, 200);
});

test('combined server accepts the configured public origin and gracefully ends battle streams', async t => {
  const origin = 'https://game.example.com';
  const server = createGameServer({ origins: new Set([origin]) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.stop());
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (route, data, token) => {
    const response = await fetch(base + route, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(data)
    });
    assert.ok(response.ok, route);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    return response.json();
  };
  assert.equal((await fetch(base + '/health', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  const host = await post('/api/v1/rooms', { name: 'Host' });
  const code = host.room.code;
  const guest = await post('/api/v1/rooms/' + code + '/join', { name: 'Guest' });
  await post('/api/v1/rooms/' + code + '/ready', { ready: true }, host.playerToken);
  await post('/api/v1/rooms/' + code + '/ready', { ready: true }, guest.playerToken);
  const stream = await fetch(base + '/api/v1/rooms/' + code + '/battle', {
    headers: { Origin: origin, Authorization: 'Bearer ' + host.playerToken }
  });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: state/);
  await server.stop({ timeoutMs: 500 });
  let closed = false;
  for (let read = 0; read < 10; read++) {
    if ((await reader.read()).done) { closed = true; break; }
  }
  assert.equal(closed, true, 'Graceful shutdown should end the SSE response');
  assert.equal(server.listening, false);
});
