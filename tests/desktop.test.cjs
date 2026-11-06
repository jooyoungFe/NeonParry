const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { createHarness } = require('./game-harness.cjs');

const root = path.resolve(__dirname, '..');
const mainRoot = path.join(root, 'desktop');
const rendererRoot = path.join(root, 'frontend');

async function desktopHarness() {
  const handlers = new Map();
  const protocols = new Map();
  const reads = [];
  const copies = [];
  const windows = [];
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false,
    setName() {},
    setAppUserModelId() {},
    getVersion: () => '1.0.0',
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    quit() {},
  });
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.fullscreen = false;
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: 'app://neon-parry/neon-parry.html' },
        setWindowOpenHandler: handler => { this.openWindow = handler; },
        send: (...args) => { this.lastMessage = args; },
      });
      windows.push(this);
    }
    isDestroyed() { return false; }
    isFullScreen() { return this.fullscreen; }
    setFullScreen(value) { this.fullscreen = value; }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    show() {}
  }
  const defaultSession = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler(handler) { this.requestPermission = handler; },
    setPermissionCheckHandler(handler) { this.checkPermission = handler; },
  });
  const electron = {
    app, BrowserWindow,
    clipboard: { writeText: value => copies.push(value) },
    dialog: { showErrorBox: (_title, message) => assert.fail(message) },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    Menu: { setApplicationMenu() {}, buildFromTemplate: value => value },
    net: { fetch: async url => {
      reads.push(url);
      return new Response('asset contents');
    } },
    protocol: {
      registerSchemesAsPrivileged(value) { this.schemes = value; },
      handle: (name, handler) => protocols.set(name, handler),
    },
    session: { defaultSession },
  };
  vm.runInNewContext(fs.readFileSync(path.join(mainRoot, 'main.cjs'), 'utf8'), {
    require: name => name === 'electron' ? electron : require(name),
    __dirname: mainRoot,
    process: { env: {}, platform: 'darwin' },
    URL, Response, Headers, console, setTimeout, clearTimeout,
  }, { filename: 'main.cjs' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(windows.length, 1);
  const window = windows[0];
  const event = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  return { handlers, protocols, reads, copies, window, event, defaultSession, electron };
}

function preloadHarness() {
  const calls = [];
  const ipc = Object.assign(new EventEmitter(), {
    invoke: (...args) => { calls.push(args); return Promise.resolve(true); },
  });
  let bridge;
  vm.runInNewContext(fs.readFileSync(path.join(mainRoot, 'preload.cjs'), 'utf8'), {
    require: name => {
      assert.equal(name, 'electron');
      return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(name, value) {
        assert.equal(name, 'neonDesktop');
        bridge = value;
      } } };
    },
    process: { platform: 'darwin', argv: ['electron', '--neon-parry-version=1.0.0%20test'] },
  }, { filename: 'preload.cjs' });
  return { bridge, ipc, calls };
}

test('native window loads the local game with an isolated, sandboxed renderer', async () => {
  const { window } = await desktopHarness();
  assert.equal(window.url, 'app://neon-parry/neon-parry.html');
  const preferences = window.options.webPreferences;
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.webSecurity, true);
  assert.equal(preferences.devTools, false);
  assert.equal(preferences.preload, path.join(mainRoot, 'preload.cjs'));
});

test('local app protocol serves game assets with a policy that blocks outside content', async () => {
  const { protocols, reads } = await desktopHarness();
  const serve = protocols.get('app');
  const response = await serve({ url: 'app://neon-parry/neon-parry.html', method: 'GET' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'asset contents');
  assert.equal(reads[0], pathToFileURL(path.join(rendererRoot, 'index.html')).href);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  const policy = response.headers.get('content-security-policy');
  for (const rule of ["default-src 'none'", "script-src 'self'", "connect-src 'none'", "object-src 'none'", "frame-src 'none'"]) {
    assert.ok(policy.split('; ').includes(rule), rule);
  }
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const head = await serve({ url: 'app://neon-parry/js/desktop.js', method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('every local stylesheet, script and icon in the game page resolves to a real served asset', async () => {
  const { protocols, reads } = await desktopHarness();
  const serve = protocols.get('app');
  const html = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');
  const references = [...html.matchAll(/<(?:script|link)\b[^>]*>/gi)]
    .map(([tag]) => tag.match(/\b(?:src|href)=["']([^"']+)["']/i)?.[1])
    .filter(Boolean);
  assert.ok(references.length >= 5, 'Game page should load its stylesheet, scripts and icon');
  for (const reference of references) {
    const url = new URL(reference, 'app://neon-parry/neon-parry.html');
    assert.equal(url.protocol, 'app:', reference);
    assert.equal(url.hostname, 'neon-parry', reference);
    const response = await serve({ url: url.href, method: 'GET' });
    assert.equal(response.status, 200, reference);
    const file = fileURLToPath(reads.at(-1));
    assert.equal(file, path.join(rendererRoot, url.pathname), reference);
    assert.ok(fs.statSync(file).isFile(), reference);
    assert.ok(fs.statSync(file).size > 0, reference);
  }
});

test('local protocol cannot read unrelated files or accept writes', async () => {
  const { protocols, reads } = await desktopHarness();
  const serve = protocols.get('app');
  for (const url of [
    'app://neon-parry/package.json',
    'app://neon-parry/src/main/preload.cjs',
    'app://neon-parry/../package.json',
    'app://neon-parry/%2e%2e/package.json',
    'app://neon-parry/%2f..%2fpackage.json',
    'app://other/neon-parry.html',
    'app://user@neon-parry/neon-parry.html',
    'app://neon-parry:8080/neon-parry.html',
    'https://neon-parry/neon-parry.html',
  ]) {
    assert.equal((await serve({ url, method: 'GET' })).status, 404, url);
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    assert.equal((await serve({ url: 'app://neon-parry/neon-parry.html', method })).status, 405);
  }
  assert.equal(reads.length, 0);
});

test('outside navigation, new windows, downloads and permissions are blocked', async () => {
  const { window, defaultSession } = await desktopHarness();
  assert.equal(window.openWindow({ url: 'https://example.com' }).action, 'deny');
  for (const name of ['will-navigate', 'will-redirect']) {
    let prevented = false;
    window.webContents.emit(name, { preventDefault() { prevented = true; } }, 'https://example.com');
    assert.equal(prevented, true, name);
    prevented = false;
    window.webContents.emit(name, { preventDefault() { prevented = true; } }, 'app://neon-parry/neon-parry.html');
    assert.equal(prevented, false, name);
  }
  let downloaded = false;
  defaultSession.emit('will-download', { preventDefault() { downloaded = true; } });
  assert.equal(downloaded, true);
  assert.equal(defaultSession.checkPermission(), false);
  let granted;
  defaultSession.requestPermission(window.webContents, 'media', value => { granted = value; });
  assert.equal(granted, false);
});

test('fullscreen IPC accepts only the main game frame and boolean state', async () => {
  const { handlers, window, event } = await desktopHarness();
  const get = handlers.get('desktop:get-fullscreen');
  const set = handlers.get('desktop:set-fullscreen');
  const toggle = handlers.get('desktop:toggle-fullscreen');
  assert.equal(get(event()), false);
  assert.equal(set(event(), true), true);
  assert.equal(window.fullscreen, true);
  assert.equal(toggle(event()), false);
  assert.equal(window.fullscreen, false);
  for (const value of [1, 'true', null, {}, undefined]) {
    assert.throws(() => set(event(), value), /boolean/);
  }
  assert.throws(() => get(event(), true), /Invalid desktop command/);
  assert.throws(() => set(event(), true, false), /Invalid desktop command/);
  for (const unsafeEvent of [
    { ...event(), sender: {} },
    { ...event(), senderFrame: { url: 'app://neon-parry/neon-parry.html' } },
    { ...event(), senderFrame: null },
  ]) assert.throws(() => set(unsafeEvent, true), /denied/);
  window.webContents.mainFrame.url = 'https://example.com';
  assert.throws(() => set(event(), true), /denied/);
  assert.equal(window.fullscreen, false);
});

test('clipboard IPC permits the game score text and rejects arbitrary clipboard access', async () => {
  const { handlers, copies, event } = await desktopHarness();
  const copy = handlers.get('desktop:copy-score');
  for (const text of ['Neon Parry · Best: 31 eliminations!', 'Neon Parry · 최고 42회 방어!']) {
    assert.equal(copy(event(), text), true);
  }
  assert.equal(copies.length, 2);
  for (const text of ['arbitrary text', 'Neon Parry · Best: -1 eliminations!', 'x'.repeat(201), null, 42]) {
    assert.throws(() => copy(event(), text), /Invalid score text/);
  }
  assert.throws(() => copy({ ...event(), sender: {} }, 'Neon Parry · Best: 0 eliminations!'), /denied/);
  assert.equal(copies.length, 2);
});

test('preload exposes only game commands and rejects invalid arguments before IPC', async () => {
  const { bridge, calls } = preloadHarness();
  assert.equal(Object.isFrozen(bridge), true);
  assert.equal(bridge.isDesktop, true);
  assert.equal(bridge.version, '1.0.0 test');
  assert.equal(bridge.platform, 'darwin');
  assert.deepEqual(Object.keys(bridge).sort(), ['copyScore', 'getFullscreen', 'isDesktop', 'onFullscreenChanged', 'platform', 'setFullscreen', 'toggleFullscreen', 'version'].sort());
  await assert.rejects(bridge.setFullscreen('yes'), /boolean/);
  await assert.rejects(bridge.copyScore('arbitrary text'), /Invalid score text/);
  assert.equal(calls.length, 0);
  await bridge.getFullscreen();
  await bridge.toggleFullscreen();
  await bridge.setFullscreen(false);
  await bridge.copyScore('Neon Parry · 최고 7회 방어!');
  assert.deepEqual(calls, [
    ['desktop:get-fullscreen'], ['desktop:toggle-fullscreen'],
    ['desktop:set-fullscreen', false], ['desktop:copy-score', 'Neon Parry · 최고 7회 방어!'],
  ]);
});

test('fullscreen subscription filters payloads, hides the IPC event and can unsubscribe', () => {
  const { bridge, ipc } = preloadHarness();
  const changes = [];
  assert.throws(() => bridge.onFullscreenChanged(null), /callback/);
  const unsubscribe = bridge.onFullscreenChanged((...args) => changes.push(args));
  ipc.emit('desktop:fullscreen-changed', { secret: true }, true);
  ipc.emit('desktop:fullscreen-changed', {}, 'true');
  ipc.emit('desktop:fullscreen-changed', {}, false);
  assert.deepEqual(changes, [[true], [false]]);
  unsubscribe();
  ipc.emit('desktop:fullscreen-changed', {}, true);
  assert.deepEqual(changes, [[true], [false]]);
});

function rendererHarness(initialFullscreen = false) {
  class Node {
    constructor() {
      this.classes = new Set();
      this.listeners = new Map();
      this.classList = {
        contains: name => this.classes.has(name),
        toggle: (name, state) => state ? this.classes.add(name) : this.classes.delete(name),
      };
      this.open = false;
    }
    addEventListener(type, listener, options = {}) {
      const listeners = this.listeners.get(type) || [];
      listeners.push({ listener, capture: options.capture === true });
      this.listeners.set(type, listeners);
    }
    dispatch(type, details = {}) {
      let stopped = false;
      const event = {
        target: this,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { stopped = true; },
        ...details,
      };
      for (const { listener } of [...(this.listeners.get(type) || [])].sort((a, b) => b.capture - a.capture)) {
        listener(event);
        if (stopped) break;
      }
      return event;
    }
    closest() { return null; }
  }
  const nodes = Object.fromEntries(['fullscreen', 'game-shell', 'share', 'language', 'help-dialog', 'patch-dialog'].map(id => [id, new Node()]));
  const body = new Node();
  const window = new Node();
  const commands = [];
  let nativeFullscreen = initialFullscreen;
  let notify;
  let browserFullscreenCalls = 0;
  let buttonUpdates = 0;
  let layoutUpdates = 0;
  let korean = false;
  nodes.fullscreen.addEventListener('click', () => browserFullscreenCalls++);
  window.neonDesktop = {
    isDesktop: true,
    getFullscreen: () => Promise.resolve(nativeFullscreen),
    toggleFullscreen: () => {
      commands.push('toggle');
      nativeFullscreen = !nativeFullscreen;
      return Promise.resolve(nativeFullscreen);
    },
    setFullscreen: value => {
      commands.push(value);
      nativeFullscreen = value;
      return Promise.resolve(value);
    },
    onFullscreenChanged: callback => { notify = callback; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(rendererRoot, 'js', 'desktop.js'), 'utf8'), {
    window,
    document: { body, getElementById: id => {
      assert.ok(nodes[id], `Unexpected game control ${id}`);
      return nodes[id];
    } },
    updateFullscreenButton: () => buttonUpdates++,
    fitConsole: () => layoutUpdates++,
    requestAnimationFrame: callback => callback(),
    t: (en, ko) => korean ? ko : en,
  }, { filename: 'desktop.js' });
  return {
    window, nodes, body, commands,
    notify: value => { nativeFullscreen = value; notify(value); },
    setKorean: () => { korean = true; },
    updates: () => ({ buttonUpdates, layoutUpdates, browserFullscreenCalls }),
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('desktop renderer uses native fullscreen and follows OS fullscreen changes', async () => {
  const renderer = rendererHarness();
  const { nodes, body, commands } = renderer;
  await settle();
  assert.equal(nodes['game-shell'].classList.contains('expanded'), false);
  assert.equal(nodes.share.textContent, 'Copy score');
  const event = nodes.fullscreen.dispatch('click');
  await settle();
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(commands, ['toggle']);
  assert.equal(renderer.updates().browserFullscreenCalls, 0);
  assert.equal(nodes['game-shell'].classList.contains('expanded'), true);
  assert.equal(body.classList.contains('expanded'), true);
  renderer.notify(false);
  assert.equal(nodes['game-shell'].classList.contains('expanded'), false);
  assert.equal(body.classList.contains('expanded'), false);
  assert.equal(renderer.updates().buttonUpdates, 3);
  assert.equal(renderer.updates().layoutUpdates, 3);
  renderer.setKorean();
  nodes.language.dispatch('change');
  assert.equal(nodes.share.textContent, '기록 복사');
});

test('Escape leaves native fullscreen while Help and form controls retain their own keys', async () => {
  const renderer = rendererHarness(true);
  const { window, nodes, commands } = renderer;
  await settle();
  nodes['help-dialog'].open = true;
  window.dispatch('keydown', { code: 'Escape' });
  nodes['help-dialog'].open = false;
  window.dispatch('keydown', { code: 'Escape', target: { closest: () => ({}) } });
  window.dispatch('keydown', { code: 'Escape', repeat: true });
  window.dispatch('keydown', { code: 'KeyW' });
  assert.deepEqual(commands, []);
  const event = window.dispatch('keydown', { code: 'Escape' });
  await settle();
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(commands, [false]);
  assert.equal(nodes['game-shell'].classList.contains('expanded'), false);
  window.dispatch('keydown', { code: 'Escape' });
  assert.deepEqual(commands, [false]);
});

test('desktop adapter leaves the browser game alone when no native bridge exists', () => {
  vm.runInNewContext(fs.readFileSync(path.join(rendererRoot, 'js', 'desktop.js'), 'utf8'), {
    window: {},
    get document() { assert.fail('Browser page should not be changed by the desktop adapter'); },
  }, { filename: 'desktop.js' });
});

test('the real game shares scores through native clipboard and pauses the running game', async () => {
  const game = createHarness();
  game.run(`
    launchRun(); best = 42;
    window.copiedScores = [];
    window.neonDesktop = { copyScore: async text => { copiedScores.push(text); return true; } };
    navigator.share = () => { throw new Error('Browser share should not run'); };
    $('share').click();
  `);
  await settle();
  assert.deepEqual(game.plain('copiedScores'), ['Neon Parry · Best: 42 eliminations!']);
  assert.equal(game.run('mode'), 'paused');
  assert.equal(game.element('share-status').textContent, 'Score copied.');
  game.run("language = 'ko'; $('share').click();");
  await settle();
  assert.equal(game.run('copiedScores[1]'), 'Neon Parry · 최고 42회 방어!');
  assert.equal(game.element('share-status').textContent, '기록을 복사했어요.');
});

test('boss-rush score text is accepted by the isolated clipboard bridge',async()=>{
  const {handlers,event,copies}=await desktopHarness();
  await handlers.get('desktop:copy-score')(event(),'Neon Parry · Best: 20 bosses!');
  assert.deepEqual(copies,['Neon Parry · Best: 20 bosses!']);
  const {bridge,calls}=preloadHarness();await bridge.copyScore('Neon Parry · 최고 20회 보스 처치!');
  assert.equal(calls[0][1],'Neon Parry · 최고 20회 보스 처치!');
});

test('renderer styles and scripts use one package version to avoid mixed cached releases',()=>{
  const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
  const html=fs.readFileSync(path.join(rendererRoot,'index.html'),'utf8');
  const refs=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>new URL(m[1],'app://neon-parry/neon-parry.html')).filter(u=>/\.(?:css|js)$/.test(u.pathname));
  assert.deepEqual(refs.map(url=>url.pathname).sort(),[
    '/config.js','/styles.css','/duel.css','/js/game.js','/js/features.js',
    '/js/menu.js','/js/desktop.js','/js/online-client.js','/js/duel-boss.js','/js/duel-engine.js','/js/duel-view.js','/js/duel.js'
  ].sort());
  for(const url of refs)assert.equal(url.searchParams.get('v'),version);
});
