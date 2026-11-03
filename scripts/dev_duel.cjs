'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createServer, parseOrigins } = require('../backend/server.cjs');

const frontend = path.resolve(__dirname, '../frontend');
const types = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'], ['.ico', 'image/x-icon'], ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.woff2', 'font/woff2']
]);

// Only real frontend assets enter this map; URL paths never become filesystem paths.
function frontendFiles(directory = frontend, prefix = '') {
  const files = new Map();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const url = prefix + '/' + entry.name;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of frontendFiles(filename, url)) files.set(key, value);
    } else if (entry.isFile() && types.has(path.extname(entry.name))) {
      files.set(url, { filename, type: types.get(path.extname(entry.name)) });
    }
  }
  return files;
}

function createGameServer({ port = 8000, ...backendOptions } = {}) {
  const origins = parseOrigins(process.env.ALLOWED_ORIGINS);
  if (process.env.RENDER === 'true') {
    const externalUrl = process.env.RENDER_EXTERNAL_URL;
    if (!externalUrl || !externalUrl.startsWith('https://') || externalUrl.includes(',')) {
      throw Error('RENDER_EXTERNAL_URL must be one exact HTTPS origin.');
    }
    for (const origin of parseOrigins(externalUrl)) origins.add(origin);
  }
  origins.add('http://localhost:' + port);
  origins.add('http://127.0.0.1:' + port);
  const server = createServer({ origins, ...backendOptions });
  const apiListeners = server.listeners('request');
  const assets = frontendFiles();
  const responses = new Set();
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    responses.add(res);
    res.once('close', () => responses.delete(res));
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400); res.end('Invalid URL'); return; }
    if (pathname === '/health' || pathname === '/api/v1' || pathname.startsWith('/api/v1/')) {
      for (const listener of apiListeners) listener.call(server, req, res);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
    }
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (pathname === '/config.js') {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : 'window.NEON_CONFIG = Object.freeze({ apiBaseUrl: window.location.origin });\n');
      return;
    }
    const asset = assets.get(pathname === '/' ? '/index.html' : pathname);
    if (!asset) { res.writeHead(404, headers); res.end('Not found'); return; }
    fs.readFile(asset.filename, (error, data) => {
      if (error) { res.writeHead(404, headers); res.end('Not found'); return; }
      res.writeHead(200, { ...headers, 'Content-Type': asset.type, 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
  // End long-lived SSE responses before waiting for the HTTP server to close.
  // In-flight ordinary requests get a short grace period; the process never hangs.
  let stopping;
  server.stop = ({ timeoutMs = 5000 } = {}) => {
    if (stopping) return stopping;
    stopping = new Promise((resolve, reject) => {
      const timer = setTimeout(() => server.closeAllConnections(), timeoutMs);
      timer.unref();
      server.close(error => { clearTimeout(timer); error ? reject(error) : resolve(); });
      for (const res of responses) {
        if (String(res.getHeader('Content-Type') || '').startsWith('text/event-stream')) res.end();
      }
      server.closeIdleConnections();
    });
    return stopping;
  };
  return server;
}

function startServer({ defaultPort = 8000, defaultHost = '127.0.0.1' } = {}) {
  const port = Number(process.env.PORT || defaultPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT.');
  const host = process.env.HOST || defaultHost;
  const server = createGameServer({ port });
  server.on('error', error => { console.error('Neon Parry server: ' + error.message); process.exitCode = 1; });
  server.listen(port, host, () => {
    const address = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    console.log(`Neon Parry game + API: http://${address.includes(':') ? '[' + address + ']' : address}:${port}`);
  });
  const signals = ['SIGINT', 'SIGTERM'];
  const stop = () => server.stop().catch(() => { process.exitCode = 1; });
  for (const signal of signals) process.on(signal, stop);
  server.once('close', () => { for (const signal of signals) process.off(signal, stop); });
  return server;
}

if (require.main === module) startServer();
module.exports = { createGameServer, createDevServer: createGameServer, startServer };
