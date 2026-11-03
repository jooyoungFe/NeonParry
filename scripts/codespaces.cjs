'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function createConfig({ env = process.env, root = DEFAULT_ROOT, port = 8080, stateDir } = {}) {
  const name = env.CODESPACE_NAME;
  const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw Error('Run this script inside a GitHub Codespace.');
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(domain)) throw Error('Invalid Codespaces port forwarding domain.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid server port.');
  root = path.resolve(root);
  const publicUrl = `https://${name}-${port}.${domain}`;
  const origins = ['https://jooyoungfe.github.io', publicUrl];
  const source = ['scripts/serve.cjs', 'scripts/dev_duel.cjs', 'backend/server.cjs', 'backend/rooms.cjs', 'backend/matchmaking.cjs', 'frontend/index.html']
    .map(filename => fs.readFileSync(path.join(root, filename)));
  const fingerprint = hash(Buffer.concat([Buffer.from(JSON.stringify({ root, port, origins })), ...source]));
  return {
    root, port, publicUrl, origins, fingerprint,
    stateDir: stateDir || path.join(os.tmpdir(), 'neon-parry-codespaces-' + hash(root).slice(0, 16)),
    env: { ...env, HOST: '0.0.0.0', PORT: String(port), ALLOWED_ORIGINS: origins.join(',') }
  };
}

function isListening(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(500, () => finish(true));
    socket.once('connect', () => finish(true));
    socket.once('error', error => finish(error.code !== 'ECONNREFUSED'));
  });
}

async function verifyServer(config, state) {
  if (!state || state.fingerprint !== config.fingerprint || !Number.isInteger(state.pid) || state.pid < 1) return false;
  try {
    process.kill(state.pid, 0);
    const base = 'http://127.0.0.1:' + config.port;
    for (const origin of config.origins) {
      const response = await fetch(base + '/health', { headers: { Origin: origin }, signal: AbortSignal.timeout(1000) });
      if (!response.ok || response.headers.get('access-control-allow-origin') !== origin) return false;
      const health = await response.json();
      if (health.status !== 'ok' || health.apiVersion !== 1 || health.storage !== 'memory') return false;
    }
    const home = await fetch(base + '/', { signal: AbortSignal.timeout(1000) });
    if (!home.ok || hash(Buffer.from(await home.arrayBuffer())) !== hash(fs.readFileSync(path.join(config.root, 'frontend/index.html')))) return false;
    const response = await fetch(base + '/config.js', { signal: AbortSignal.timeout(1000) });
    return response.ok && (await response.text()).includes('apiBaseUrl: window.location.origin');
  } catch {
    return false;
  }
}

async function readState(filename) {
  try { return JSON.parse(await fsp.readFile(filename, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function acquireLock(directory) {
  const lock = path.join(directory, 'start.lock');
  // A second invocation waits for the first startup rather than spawning twice.
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const handle = await fsp.open(lock, 'wx', 0o600);
      await handle.close();
      return () => fsp.unlink(lock);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await delay(100);
    }
  }
  throw Error(`Another startup is in progress. If it was interrupted, inspect and remove ${lock}.`);
}

async function ensureServer(options = {}) {
  const config = createConfig(options);
  await fsp.mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  const release = await acquireLock(config.stateDir);
  const stateFile = path.join(config.stateDir, 'server.json');
  const logFile = path.join(config.stateDir, 'server.log');
  try {
    const state = await readState(stateFile);
    if (await isListening(config.port)) {
      if (await verifyServer(config, state)) return { ...config, pid: state.pid, logFile, reused: true };
      throw Error(`Port ${config.port} is already in use by an unverified or outdated server. Inspect it and stop it manually before retrying; no process was stopped.`);
    }

    const output = await fsp.open(logFile, 'a', 0o600);
    let child;
    try {
      child = spawn(process.execPath, [path.join(config.root, 'scripts/serve.cjs')], {
        cwd: config.root, env: config.env, detached: true, stdio: ['ignore', output.fd, output.fd]
      });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    } finally {
      await output.close();
    }
    child.unref();
    const nextState = { pid: child.pid, fingerprint: config.fingerprint };
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await verifyServer(config, nextState)) {
        await fsp.writeFile(stateFile, JSON.stringify(nextState) + '\n', { mode: 0o600 });
        return { ...config, pid: child.pid, logFile, reused: false };
      }
      if (child.exitCode !== null || child.signalCode !== null) break;
      await delay(100);
    }
    // Only the process created by this invocation is eligible for cleanup.
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    throw Error('Neon Parry did not start. Check ' + logFile);
  } finally {
    await release();
  }
}

if (require.main === module) {
  ensureServer().then(result => {
    console.log(`Neon Parry ${result.reused ? 'already running' : 'started'} (PID ${result.pid}).`);
    console.log('Game + duel API: ' + result.publicUrl);
    console.log('Logs: ' + result.logFile);
    console.log('To share the URL, set port 8080 visibility to Public in the Codespaces Ports tab.');
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { createConfig, ensureServer };
