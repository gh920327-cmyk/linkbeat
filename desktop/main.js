// LINKBEAT — PC 실행기
// - 게임은 서울 서버에서 받아오므로 서버가 업데이트되면 다음 실행(또는 F5)부터 자동으로 최신
// - 실행기 프로그램은 GitHub Releases로 자동 업데이트(electron-updater)
// - 호스트 키를 넣은 PC(호스트)에서만 '채보 엔진'이 뒤에서 함께 돌아가며, 승인한 곡의 채보를 만들어 서버에 올림
const { app, BrowserWindow, shell, dialog, session, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Engine } = require('./engine');

const DEFAULT_URL = 'https://linkbeat.43-202-116-151.sslip.io/';

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
// 곡 미리듣기가 클릭 없이도 재생되게
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const userFile = (n) => path.join(app.getPath('userData'), n);
function readJson(n, d) { try { return JSON.parse(fs.readFileSync(userFile(n), 'utf8')); } catch (e) { return d; } }
function writeJson(n, v) { try { fs.writeFileSync(userFile(n), JSON.stringify(v)); } catch (e) { /* 무시 */ } }

// 서버 주소: 환경변수 > server.json(서버를 옮길 때) > 기본값
const GAME_URL = process.env.LB_URL || readJson('server.json', {}).url || DEFAULT_URL;
const GAME_ORIGIN = new URL(GAME_URL).origin;

// 호스트 키는 윈도우 사용자 계정으로 암호화해서 저장 (다른 사람이 파일을 복사해 가도 못 씀)
function loadKey() {
  const d = readJson('host.json', {});
  try {
    if (d.enc && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(d.enc, 'base64'));
  } catch (e) { /* 무시 */ }
  return d.key || '';
}
function saveKey(k) {
  if (!k) { writeJson('host.json', {}); return; }
  if (safeStorage.isEncryptionAvailable()) writeJson('host.json', { enc: safeStorage.encryptString(k).toString('base64') });
  else writeJson('host.json', { key: k });
}

let win = null, splash = null, tries = 0, shown = false;
let hostKey = '';
let engine = null;

function loadState() { return readJson('window.json', { width: 1440, height: 860 }); }
function saveState() {
  if (!win || win.isDestroyed()) return;
  try { writeJson('window.json', { ...win.getNormalBounds(), max: win.isMaximized(), full: win.isFullScreen() }); } catch (e) { /* 무시 */ }
}
function splashMsg(t) {
  if (splash && !splash.isDestroyed()) splash.webContents.executeJavaScript(`window.setMsg&&setMsg(${JSON.stringify(t)})`).catch(() => {});
}
function sendEngine(st) {
  if (win && !win.isDestroyed()) win.webContents.send('lb:engine', st);
}

function engineSrcDir() {
  // 설치된 실행기: resources/engine, 개발 중: 저장소 루트(worker.py 가 있는 곳)
  const packed = path.join(process.resourcesPath || '', 'engine');
  return fs.existsSync(path.join(packed, 'worker.py')) ? packed : path.join(__dirname, '..');
}

function setupEngine() {
  engine = new Engine({ dataDir: path.join(app.getPath('userData'), 'engine'), srcDir: engineSrcDir(), server: GAME_ORIGIN });
  engine.on('status', sendEngine);
  engine.on('import', (st) => sendEngine({ state: 'import', msg: st.msg }));
  if (hostKey) startEngine();
}

async function startEngine() {
  await engine.start(hostKey);
  if (engine.last.state === 'error' && /파이썬이 없어요/.test(engine.last.msg)) askPython();
}

let askedPython = false;
async function askPython() {
  if (askedPython) return;
  askedPython = true;
  const r = await dialog.showMessageBox(win || undefined, {
    type: 'question', buttons: ['자동으로 설치', '설치 페이지 열기', '나중에'], defaultId: 0, cancelId: 2, title: '채보 엔진',
    message: '곡의 채보를 만들려면 파이썬이 필요해요.',
    detail: '"자동으로 설치"를 누르면 윈도우 앱 설치 도구(winget)로 Python 3.12를 설치해요.\n설치가 끝나면 실행기를 다시 켜 주세요. (게임 플레이에는 필요 없어요)',
  });
  if (r.response === 0) {
    const { spawn } = require('child_process');
    try {
      spawn('winget', ['install', '-e', '--id', 'Python.Python.3.12', '--scope', 'user', '--accept-package-agreements', '--accept-source-agreements'],
        { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    } catch (e) { shell.openExternal('https://www.python.org/downloads/'); }
  } else if (r.response === 1) shell.openExternal('https://www.python.org/downloads/');
}

// 게임 화면(서버 주소)에서 온 요청만 받음
function fromGame(e) {
  try { return new URL(e.senderFrame.url).origin === GAME_ORIGIN; } catch (er) { return false; }
}
ipcMain.handle('lb:setHostKey', async (e, k) => {
  if (!fromGame(e)) return false;
  hostKey = String(k || '').trim().slice(0, 200);
  saveKey(hostKey);
  startEngine();
  return true;
});
ipcMain.on('lb:hello', (e) => { if (fromGame(e) && engine) e.sender.send('lb:engine', engine.last); });
ipcMain.handle('lb:import', async (e) => {
  if (!fromGame(e)) throw new Error('허용되지 않은 요청이에요.');
  if (!hostKey) throw new Error('먼저 설정에서 호스트 키를 넣어 주세요.');
  const r = await dialog.showOpenDialog(win, {
    title: '예전 링크비트 폴더(start.bat 이 있던 폴더)를 골라 주세요', properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { msg: '' };
  try {
    const msg = await engine.importDir(r.filePaths[0], hostKey);
    return { msg };
  } catch (er) {
    if (er.code === 'NO_PYTHON') askPython();
    throw new Error(er.message === 'NO_PYTHON' ? '파이썬이 필요해요.' : er.message);
  }
});

function createWindows() {
  const st = loadState();
  const icon = path.join(__dirname, 'icon.png');
  splash = new BrowserWindow({
    width: 520, height: 320, frame: false, resizable: false, show: true, center: true,
    backgroundColor: '#05060d', icon, title: 'LINKBEAT',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'), { query: { v: app.getVersion() } });
  splash.on('closed', () => { splash = null; if (!shown) app.quit(); });   // 연결을 기다리다 시작 창을 닫으면 끝냄

  win = new BrowserWindow({
    width: st.width || 1440, height: st.height || 860, x: st.x, y: st.y,
    minWidth: 960, minHeight: 600, show: false, backgroundColor: '#05060d',
    title: 'LINKBEAT', icon, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, preload: path.join(__dirname, 'preload.js') },
  });
  win.setMenu(null);
  // 게임이 실행기 안에서 돌고 있다는 표시 (웹 화면의 'PC 실행기 받기' 숨김 등)
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/Electron\/\S+\s?/, '') + ` LBDesktop/${app.getVersion()}`);

  // 호스트 키가 있으면 첫 화면에 실어 보냄 (게임 화면이 기억하고 주소창에서 지움)
  const go = () => {
    const u = new URL(GAME_URL);
    if (hostKey) u.searchParams.set('host', hostKey);
    win.loadURL(u.toString()).catch(() => {});
  };
  // 서버에 못 붙으면 크롬 오류 화면이 '불러오기 끝'으로 잡혀 빈 창이 뜨던 문제 → 실패한 시도는 무시하고 다시 시도
  let failed = false;
  win.webContents.on('did-start-navigation', (e, url, inPlace, isMain) => { if (isMain && !inPlace) failed = false; });
  win.webContents.on('did-finish-load', () => {
    if (shown || failed) return;
    try { if (new URL(win.webContents.getURL()).origin !== GAME_ORIGIN) return; } catch (er) { return; }
    shown = true;
    if (splash && !splash.isDestroyed()) { splash.destroy(); splash = null; }
    if (st.max) win.maximize();
    win.show();
    if (st.full) win.setFullScreen(true);
    win.focus();
  });
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || shown || code === -3) return;      // -3: 다음 시도로 넘어가면서 취소된 것
    failed = true;
    tries++;
    splashMsg(tries < 3 ? '서버에 연결하는 중…'
      : tries < 6 ? `서버에 연결하는 중… (${tries}번째 시도) · 인터넷 연결을 확인해 주세요`
        : `서버에 연결할 수 없어요 (${desc || code}). 서버가 켜져 있는지 확인해 주세요. 계속 다시 시도할게요…`);
    setTimeout(go, tries < 6 ? 3000 : 8000);
  });
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F11' || (i.alt && i.key === 'Enter')) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (i.key === 'F5') { win.webContents.reloadIgnoringCache(); e.preventDefault(); }
    else if (i.key === 'F12' && i.control && i.shift) { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  // 외부 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    try { if (new URL(url).origin !== GAME_ORIGIN) { e.preventDefault(); shell.openExternal(url); } } catch (er) { e.preventDefault(); }
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('close', saveState);
  win.on('closed', () => { win = null; });

  session.defaultSession.clearCache().catch(() => {}).finally(go);
}

function setupUpdater() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let asked = false;
  autoUpdater.on('update-downloaded', (info) => {
    if (asked) return;
    asked = true;
    dialog.showMessageBox(win || undefined, {
      type: 'info', buttons: ['지금 재시작', '나중에'], defaultId: 0, cancelId: 1, title: '실행기 업데이트',
      message: `새 실행기 버전 ${info.version}이(가) 준비됐어요.`,
      detail: '지금 재시작하면 바로 적용돼요. "나중에"를 누르면 게임을 끌 때 자동으로 적용돼요.\n기록과 설정은 그대로예요.',
    }).then((r) => { if (r.response === 0) { saveState(); if (engine) engine.stop(); autoUpdater.quitAndInstall(true, true); } });
  });
  autoUpdater.on('error', () => {});
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 4000);
  setInterval(check, 60 * 60 * 1000);
}

app.on('second-instance', () => {
  const w = win && win.isVisible() ? win : splash;
  if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.focus(); }
});
app.whenReady().then(() => {
  hostKey = loadKey();
  createWindows();
  setupEngine();
  setupUpdater();
});
app.on('before-quit', () => { if (engine) engine.stop(); });
app.on('window-all-closed', () => app.quit());
