'use strict';

const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ORIGIN = 'app://neon-parry';
const START_URL = `${APP_ORIGIN}/neon-parry.html`;
const RENDERER_ROOT = path.resolve(__dirname, '../frontend');
const IS_DEV = !app.isPackaged && process.env.NEON_DEV === 'true';
const SMOKE_TEST = process.env.NEON_SMOKE_TEST === '1';
if (SMOKE_TEST) {
  const fs = require('node:fs');
  const temporaryProfile = path.join(app.getPath('temp'), `neon-parry-smoke-${process.pid}`);
  fs.mkdirSync(temporaryProfile, { recursive: true });
  app.setPath('userData', temporaryProfile);
  app.setPath('sessionData', temporaryProfile);
}
const ASSETS = new Map([
  ['/neon-parry.html', ['index.html', 'text/html; charset=utf-8']],
  ['/config.js', ['config.js', 'text/javascript; charset=utf-8']],
  ['/js/online-client.js', ['js/online-client.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/duel.css', ['duel.css', 'text/css; charset=utf-8']],
  ['/js/game.js', ['js/game.js', 'text/javascript; charset=utf-8']],
  ['/js/features.js', ['js/features.js', 'text/javascript; charset=utf-8']],
  ['/js/menu.js', ['js/menu.js', 'text/javascript; charset=utf-8']],
  ['/js/duel-boss.js', ['js/duel-boss.js', 'text/javascript; charset=utf-8']],
  ['/js/duel-engine.js', ['js/duel-engine.js', 'text/javascript; charset=utf-8']],
  ['/js/duel-view.js', ['js/duel-view.js', 'text/javascript; charset=utf-8']],
  ['/js/duel.js', ['js/duel.js', 'text/javascript; charset=utf-8']],
  ['/js/desktop.js', ['js/desktop.js', 'text/javascript; charset=utf-8']],
  ['/assets/icon-512.png', ['assets/icon-512.png', 'image/png']],
]);
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

app.setName('Neon Parry');
app.setAppUserModelId('io.qqock2e.neonparry');

let mainWindow = null;
let failed = false;
let smokeTimer;

function isGamePage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'app:' && url.hostname === 'neon-parry' && !url.port &&
      !url.username && !url.password && url.pathname === '/neon-parry.html';
  } catch {
    return false;
  }
}

function assertTrustedSender(event, args, expectedCount) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents ||
      !event.senderFrame || event.senderFrame !== mainWindow.webContents.mainFrame ||
      !isGamePage(event.senderFrame.url)) {
    throw new Error('Desktop access denied.');
  }
  if (args.length !== expectedCount) throw new TypeError('Invalid desktop command.');
}

function reportFailure(error) {
  if (failed) return;
  failed = true;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Neon Parry] ${message}`);
  if (SMOKE_TEST) {
    clearTimeout(smokeTimer);
    app.exit(1);
    return;
  }
  dialog.showErrorBox('Neon Parry', `게임을 열 수 없습니다.\n\n${message}`);
  app.quit();
}

async function serveAsset(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (url.protocol !== 'app:' || url.hostname !== 'neon-parry' || url.port || url.username || url.password) {
    return new Response('Not found', { status: 404 });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const asset = ASSETS.get(url.pathname);
  if (!asset) return new Response('Not found', { status: 404 });
  const [relativePath, contentType] = asset;
  try {
    const response = await net.fetch(pathToFileURL(path.join(RENDERER_ROOT, relativePath)).toString());
    if (!response.ok) return new Response('Not found', { status: 404 });
    const headers = new Headers(response.headers);
    headers.set('Content-Type', contentType);
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    headers.set('Cache-Control', 'no-cache');
    return new Response(request.method === 'HEAD' ? null : response.body, { status: 200, headers });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function setApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const view = [{ role: 'togglefullscreen', label: '전체 화면' }];
  if (IS_DEV) view.push({ role: 'reload' }, { role: 'toggleDevTools' });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Neon Parry', submenu: [{ role: 'about', label: 'Neon Parry 정보' }, { type: 'separator' }, { role: 'hide', label: '가리기' }, { role: 'hideOthers', label: '다른 앱 가리기' }, { type: 'separator' }, { role: 'quit', label: 'Neon Parry 종료' }] },
    { label: '편집', submenu: [{ role: 'copy', label: '복사' }, { role: 'selectAll', label: '전체 선택' }] },
    { label: '보기', submenu: view },
    { label: '윈도우', submenu: [{ role: 'minimize', label: '최소화' }, { role: 'front', label: '모두 앞으로 가져오기' }] },
  ]));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1040,
    height: 820,
    minWidth: 640,
    minHeight: 560,
    title: 'Neon Parry',
    backgroundColor: '#111314',
    icon: path.join(RENDERER_ROOT, 'assets', 'icon-512.png'),
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: IS_DEV,
      spellcheck: false,
      additionalArguments: [`--neon-parry-version=${encodeURIComponent(app.getVersion())}`],
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isGamePage(url)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!isGamePage(url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) reportFailure(new Error(`${description} (${code})`));
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') reportFailure(new Error(`Renderer: ${details.reason}`));
  });
  window.webContents.on('preload-error', (_event, _preloadPath, error) => reportFailure(error));
  const notifyFullscreen = () => {
    if (!window.isDestroyed()) window.webContents.send('desktop:fullscreen-changed', window.isFullScreen());
  };
  window.on('enter-full-screen', notifyFullscreen);
  window.on('leave-full-screen', notifyFullscreen);
  window.once('ready-to-show', () => {
    if (!SMOKE_TEST) window.show();
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  if (SMOKE_TEST) {
    let rendererError = false;
    window.webContents.on('console-message', details => {
      if (details.level === 'error') {
        rendererError = true;
        console.error(`[Neon Parry renderer] ${details.message}`);
      }
    });
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        clearTimeout(smokeTimer);
        if (failed) return;
        console.log(JSON.stringify({ app: app.getName(), version: app.getVersion(), url: window.webContents.getURL(), loaded: true, rendererError }));
        app.exit(rendererError ? 1 : 0);
      }, 1500);
    });
    smokeTimer = setTimeout(() => reportFailure(new Error('Desktop smoke test timed out.')), 20000);
  }
  window.loadURL(START_URL).catch(reportFailure);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    protocol.handle('app', serveAsset);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on('will-download', event => event.preventDefault());
    ipcMain.handle('desktop:get-fullscreen', (event, ...args) => {
      assertTrustedSender(event, args, 0);
      return mainWindow.isFullScreen();
    });
    ipcMain.handle('desktop:toggle-fullscreen', (event, ...args) => {
      assertTrustedSender(event, args, 0);
      const next = !mainWindow.isFullScreen();
      mainWindow.setFullScreen(next);
      return next;
    });
    ipcMain.handle('desktop:set-fullscreen', (event, ...args) => {
      assertTrustedSender(event, args, 1);
      if (typeof args[0] !== 'boolean') throw new TypeError('Fullscreen must be a boolean.');
      mainWindow.setFullScreen(args[0]);
      return args[0];
    });
    ipcMain.handle('desktop:copy-score', (event, ...args) => {
      assertTrustedSender(event, args, 1);
      const text = args[0];
      if (typeof text !== 'string' || text.length > 200 ||
          !/^Neon Parry · (?:Best: \d+ (?:eliminations|bosses)!|최고 \d+회 (?:방어|보스 처치)!)$/.test(text)) {
        throw new TypeError('Invalid score text.');
      }
      clipboard.writeText(text);
      return true;
    });
    setApplicationMenu();
    createWindow();
    app.on('activate', () => {
      if (!mainWindow) createWindow();
      else mainWindow.show();
    });
  }).catch(reportFailure);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
