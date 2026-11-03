'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameServer } = require('../scripts/dev_duel.cjs');

const pagesOrigin = 'https://jooyoungfe.github.io';
const renderOrigin = 'https://neon-parry-test.onrender.com';

function createWithEnv(values) {
  const before = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return createGameServer();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function listen(server, t) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.stop());
  return 'http://127.0.0.1:' + server.address().port;
}

test('Render serves the game and accepts only its own URL and configured Pages origin', async t => {
  const server = createWithEnv({ RENDER: 'true', RENDER_EXTERNAL_URL: renderOrigin, ALLOWED_ORIGINS: pagesOrigin });
  const base = await listen(server, t);
  assert.match(await (await fetch(base + '/')).text(), /Neon Parry/i);
  assert.match(await (await fetch(base + '/config.js')).text(), /apiBaseUrl: window\.location\.origin/);
  for (const origin of [renderOrigin, pagesOrigin]) {
    const response = await fetch(base + '/api/v1/rooms', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Render check' })
    });
    assert.equal(response.status, 201, origin);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.ok((await response.json()).playerToken);
  }
  for (const origin of [renderOrigin + '.evil.example', 'https://other.onrender.com', pagesOrigin + '.evil.example', renderOrigin.replace('https:', 'http:')]) {
    const response = await fetch(base + '/health', { headers: { Origin: origin } });
    assert.equal(response.status, 403, origin);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
});

test('Render URL is ignored outside Render and invalid Render origins fail before listening', async t => {
  const server = createWithEnv({ RENDER: undefined, RENDER_EXTERNAL_URL: renderOrigin, ALLOWED_ORIGINS: pagesOrigin });
  const base = await listen(server, t);
  assert.equal((await fetch(base + '/health', { headers: { Origin: renderOrigin } })).status, 403);
  assert.equal((await fetch(base + '/health', { headers: { Origin: pagesOrigin } })).status, 200);
  for (const value of [undefined, '', 'http://neon.onrender.com', 'https://neon.onrender.com/', 'https://neon.onrender.com/path', 'https://user:password@neon.onrender.com', renderOrigin + ',https://other.onrender.com']) {
    assert.throws(() => createWithEnv({ RENDER: 'true', RENDER_EXTERNAL_URL: value, ALLOWED_ORIGINS: pagesOrigin }), /exact HTTPS origin|exact HTTP\(S\) origins/);
  }
});
