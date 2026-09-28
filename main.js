'use strict';

const { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, session, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const CHARACTER_PATH = path.join(__dirname, 'assets', 'character.png');
const BUBBLE_WIDTH = 210;
const TOP_ZONE = 156;

const DEFAULT_CONFIG = {
  loginUrl: 'https://www.trae.cn/',
  pointsUrl: 'https://www.trae.cn/dashboard#usage',
  pointsSelector: 'span[data-testid="user-entitlement-total-balance"]',
  sessionSave: 'electron-session',
  refreshIntervalMs: 10000,
  decreaseAlertMs: 5000,
  increaseGreenEnabled: true,
  increaseAlertMs: 4000,
  imageScale: 0.35,
  trimTransparentMargin: true,
  windowPosition: null
};

let mainWindow = null;
let loginWindow = null;
let fetcherWindow = null;
let settingsWindow = null;
let config = Object.assign({}, DEFAULT_CONFIG);
let refreshTimer = null;
let loginWatchTimer = null;
let savePositionTimer = null;
let fetchInFlight = false;
let lastPoints = null;
let everSucceeded = false;
let widgetSize = { width: 0, height: 0 };
let widgetPos = { x: 0, y: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* ---------------- 配置 ---------------- */

function getConfigPath() {
  return app.isPackaged ? path.join(app.getPath('userData'), 'config.json') : path.join(__dirname, 'config.json');
}

function sanitizeConfig(input) {
  const out = {};
  if (typeof input.loginUrl === 'string' && /^https?:\/\//.test(input.loginUrl)) out.loginUrl = input.loginUrl;
  if (typeof input.pointsUrl === 'string' && /^https?:\/\//.test(input.pointsUrl)) out.pointsUrl = input.pointsUrl;
  if (typeof input.pointsSelector === 'string' && input.pointsSelector.trim()) out.pointsSelector = input.pointsSelector.trim();
  if (isNum(input.refreshIntervalMs)) out.refreshIntervalMs = clamp(Math.round(input.refreshIntervalMs), 5000, 60000);
  if (isNum(input.decreaseAlertMs)) out.decreaseAlertMs = clamp(Math.round(input.decreaseAlertMs), 1000, 60000);
  if (isNum(input.increaseAlertMs)) out.increaseAlertMs = clamp(Math.round(input.increaseAlertMs), 1000, 60000);
  if (typeof input.increaseGreenEnabled === 'boolean') out.increaseGreenEnabled = input.increaseGreenEnabled;
  if (isNum(input.imageScale)) out.imageScale = clamp(input.imageScale, 0.2, 2);
  if (typeof input.trimTransparentMargin === 'boolean') out.trimTransparentMargin = input.trimTransparentMargin;
  if (Array.isArray(input.windowPosition) && input.windowPosition.length === 2 && input.windowPosition.every(isNum)) {
    out.windowPosition = input.windowPosition.map(Math.round);
  }
  return out;
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    return Object.assign({}, DEFAULT_CONFIG, sanitizeConfig(JSON.parse(raw)));
  } catch (e) {
    return Object.assign({}, DEFAULT_CONFIG);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('[config] 保存失败:', e.message);
  }
}

/* ---------------- 人物图片 ---------------- */

function getImageInfo() {
  const img = nativeImage.createFromPath(CHARACTER_PATH);
  const size = img.getSize();
  if (!size.width || !size.height) return null;
  let bbox = { x: 0, y: 0, width: size.width, height: size.height };
  if (config.trimTransparentMargin !== false) {
    try {
      const buf = img.toBitmap();
      const w = size.width;
      const h = size.height;
      if (buf && buf.length >= w * h * 4) {
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
          const row = y * w * 4;
          for (let x = 0; x < w; x++) {
            if (buf[row + x * 4 + 3] > 8) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX >= minX && maxY >= minY) {
          bbox = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
        }
      }
    } catch (e) {
      console.error('[image] 透明边距检测失败:', e.message);
    }
  }
  const scale = clamp(isNum(config.imageScale) ? config.imageScale : 1, 0.2, 2);
  return { natural: size, bbox, scale };
}

/* ---------------- 悬浮窗 ---------------- */

function applySavedPosition(win, pos, w, h) {
  try {
    const [x, y] = pos;
    const display = screen.getDisplayMatching({ x, y, width: w, height: h });
    const wa = display.workArea;
    const nx = clamp(x, wa.x - w + 120, wa.x + wa.width - 120);
    const ny = clamp(y, wa.y, wa.y + wa.height - 120);
    win.setPosition(Math.round(nx), Math.round(ny));
  } catch (e) {}
}

function computeWidgetSize() {
  const info = getImageInfo();
  if (!info) {
    console.error('[main] 找不到人物图片:', CHARACTER_PATH);
    return { info: null, width: BUBBLE_WIDTH + 40, height: 380 + TOP_ZONE };
  }
  const width = Math.max(Math.round(info.bbox.width * info.scale), BUBBLE_WIDTH + 40);
  const height = Math.round(info.bbox.height * info.scale) + TOP_ZONE;
  return { info, width, height };
}

function createMainWindow() {
  const { width, height } = computeWidgetSize();
  widgetSize = { width, height };

  mainWindow = new BrowserWindow({
    width,
    height,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (Array.isArray(config.windowPosition)) {
    applySavedPosition(mainWindow, config.windowPosition, width, height);
  }
  // 虚拟坐标：拖动与位置保存一律以此为准（位置读回安全，尺寸读回会触发膨胀，见 window-move）
  const [px, py] = mainWindow.getPosition();
  widgetPos = { x: px, y: py };
  mainWindow.on('closed', () => { mainWindow = null; });
}

/* 改变悬浮窗尺寸（设置滑块用）：显式携带新尺寸，窗口中心保持不动 */
function resizeWidgetWindow(newW, newH) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const newX = Math.round(widgetPos.x + (widgetSize.width - newW) / 2);
  const newY = Math.round(widgetPos.y + (widgetSize.height - newH) / 2);
  mainWindow.setBounds({ x: newX, y: newY, width: newW, height: newH });
  widgetPos = { x: newX, y: newY };
  widgetSize = { width: newW, height: newH };
}

function scheduleSavePosition(delay = 800) {
  clearTimeout(savePositionTimer);
  savePositionTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      config.windowPosition = [Math.round(widgetPos.x), Math.round(widgetPos.y)];
      saveConfig();
    }
  }, delay);
}

/* ---------------- 积分获取（隐藏窗口 + 页面内 API 钩子） ----------------
 * 说明：主进程 webRequest.onCompleted 无法读取响应 body，
 * 因此在积分页面的页面上下文中注入 fetch/XHR 钩子来捕获内部接口响应。
 * ------------------------------------------------------------- */

const HOOK_SCRIPT = `
(function () {
  if (window.__traeHookInstalled) return 'installed';
  window.__traeHookInstalled = true;
  window.__traeApiCapture = [];
  function capture(url, text) {
    try {
      if (window.__traeApiCapture.length > 60) window.__traeApiCapture.shift();
      window.__traeApiCapture.push({ url: String(url), text: String(text).slice(0, 8000) });
    } catch (e) {}
  }
  function matchUrl(url) { return /trae\\/api|\\/api\\//i.test(String(url)); }
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function () {
      var args = arguments;
      var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      var p = origFetch.apply(this, args);
      if (matchUrl(url)) {
        p.then(function (res) {
          try {
            res.clone().text().then(function (t) { capture(url, t); }).catch(function () {});
          } catch (e) {}
        }).catch(function () {});
      }
      return p;
    };
  }
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__traeUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    if (matchUrl(xhr.__traeUrl)) {
      xhr.addEventListener('load', function () {
        try { capture(xhr.__traeUrl, xhr.responseText); } catch (e) {}
      });
    }
    return origSend.apply(this, arguments);
  };
  return 'ok';
})();
`;

function buildReadScript(selector) {
  return `
(function () {
  var out = { dom: null, keyword: null, api: [] };
  try {
    var el = document.querySelector(${JSON.stringify(selector)});
    if (el) {
      var t = (el.textContent || '').trim();
      if (t) out.dom = t;
    }
  } catch (e) {}
  try {
    out.api = (window.__traeApiCapture || []).map(function (x) {
      return { url: x.url, text: x.text };
    });
  } catch (e) {}
  try {
    var re = /([0-9][0-9,]{2,})\\s*积分|积分[^0-9]{0,8}([0-9][0-9,]{2,})/;
    var nodes = document.querySelectorAll('span, div, p, td, li, strong, b');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.childElementCount === 0) {
        var txt = (n.textContent || '').trim();
        if (txt && txt.length <= 40) {
          var m = txt.match(re);
          if (m) { out.keyword = m[1] || m[2]; break; }
        }
      }
    }
  } catch (e) {}
  return out;
})();
`;
}

function ensureFetcher() {
  if (fetcherWindow && !fetcherWindow.isDestroyed()) return fetcherWindow;
  fetcherWindow = new BrowserWindow({ show: false, width: 1280, height: 900 });
  const wc = fetcherWindow.webContents;
  wc.setBackgroundThrottling(false);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const inject = () => { wc.executeJavaScript(HOOK_SCRIPT, false).catch(() => {}); };
  wc.on('did-finish-load', inject);
  wc.on('dom-ready', inject);
  fetcherWindow.on('closed', () => { fetcherWindow = null; });
  return fetcherWindow;
}

async function navigateFetcher(win) {
  const wc = win.webContents;
  if (wc.isLoading()) return;
  if (wc.getURL().split('#')[0] === config.pointsUrl.split('#')[0]) {
    wc.reload();
    // reload 是异步启动的，稍等让 isLoading 生效，确保后续 waitForLoad 等待的是新页面而非旧页面
    await sleep(500);
  } else {
    await win.loadURL(config.pointsUrl);
  }
}

function waitForLoad(win, timeoutMs) {
  const wc = win.webContents;
  if (!wc.isLoading()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { cleanup(); resolve(); };
    const timer = setTimeout(finish, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      wc.removeListener('did-finish-load', finish);
      wc.removeListener('did-fail-load', finish);
    }
    wc.on('did-finish-load', finish);
    wc.on('did-fail-load', finish);
  });
}

function parseNumber(text) {
  if (text == null) return null;
  const n = parseInt(String(text).replace(/[,，\s]/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function collectBalanceKeys(node, prefix, out, depth) {
  if (depth > 6 || node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const v of node) collectBalanceKeys(v, prefix, out, depth + 1);
    return;
  }
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (v != null && typeof v === 'object') {
      collectBalanceKeys(v, prefix + key + '.', out, depth + 1);
    } else if (/(?:total)?balance|entitlement|credits?|points?/i.test(key)) {
      const n = parseNumber(v);
      if (n != null) out.push({ key: prefix + key, value: n });
    }
  }
}

function parseApiBalance(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const candidates = [];
  for (const item of items) {
    if (!item || typeof item.text !== 'string') continue;
    // 只解析 Trae 域名下与积分/权益相关的接口，避免误捕其他额度数据
    const url = String(item.url || '');
    if (!/trae/i.test(url)) continue;
    if (!/entitlement|credit|balance|point|quota|asset|billing/i.test(url)) continue;
    let data;
    try { data = JSON.parse(item.text); } catch (e) { continue; }
    collectBalanceKeys(data, '', candidates, 0);
  }
  if (candidates.length === 0) return null;
  const pools = [
    candidates.filter((c) => /total.*balance|balance.*total|total_entitlement|entitlement.*total/i.test(c.key)),
    candidates.filter((c) => /balance/i.test(c.key)),
    candidates
  ];
  for (const pool of pools) {
    if (pool.length === 0) continue;
    const values = [...new Set(pool.map((c) => c.value))];
    if (values.length === 1) return values[0];
  }
  return null;
}

async function pollBalance(win, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let stableVal = null;
  let stableCount = 0;
  let lastSeen = null;
  while (Date.now() < deadline) {
    let snap = null;
    try {
      snap = await win.webContents.executeJavaScript(buildReadScript(config.pointsSelector), false);
    } catch (e) {
      /* 页面跳转中，稍后重试 */
    }
    if (snap) {
      const domVal = parseNumber(snap.dom);
      const apiVal = parseApiBalance(snap.api);
      const kwVal = parseNumber(snap.keyword);
      const primary = domVal != null ? domVal : (apiVal != null ? apiVal : kwVal);
      if (primary != null) {
        lastSeen = primary;
        if (primary === stableVal) {
          stableCount++;
          // 页面重载后会先渲染缓存/骨架数字再更新为真实值，
          // 只有连续 3 次读数一致且距开始超过 1.6 秒才采纳，避免截胡瞬时错误值
          if (stableCount >= 3 && Date.now() - startedAt >= 1600) {
            console.log('[points] 读取成功: ' + primary + '（页面文本: "' + (snap.dom || '-') + '"）');
            return primary;
          }
        } else {
          stableVal = primary;
          stableCount = 1;
        }
      }
    }
    await sleep(500);
  }
  if (lastSeen != null && stableCount >= 2) {
    console.log('[points] 读数未完全稳定，采用最后读数: ' + lastSeen);
    return lastSeen;
  }
  return null;
}

function applyPoints(value) {
  const prev = lastPoints;
  lastPoints = value;
  if (prev != null && value !== prev) console.log('[points] 积分变化: ' + prev + ' -> ' + value);
  let payload;
  if (prev == null) {
    payload = { type: 'steady', value };
  } else if (value < prev) {
    payload = { type: 'decrease', value, delta: prev - value, alertMs: config.decreaseAlertMs };
  } else if (value > prev) {
    payload = { type: 'increase', value, delta: value - prev, alertMs: config.increaseAlertMs, enabled: !!config.increaseGreenEnabled };
  } else {
    payload = { type: 'steady', value };
  }
  sendToWidget(payload);
}

function sendToWidget(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('points-update', payload);
  }
}

async function fetchPoints() {
  if (fetchInFlight) return;
  fetchInFlight = true;
  try {
    const win = ensureFetcher();
    const handleNotLoggedIn = () => {
      console.error('[points] 未登录（dashboard 被重定向到登录页）');
      sendToWidget({ type: 'error', message: everSucceeded ? '会话失效' : '未登录' });
      if (!everSucceeded && !loginWindow) openLoginWindow();
    };
    try {
      await navigateFetcher(win);
      await waitForLoad(win, 15000);
    } catch (err) {
      if (!(err && /ERR_ABORTED/i.test(String(err.message || err)))) {
        console.error('[points] 页面加载失败:', err && err.message);
        sendToWidget({ type: 'error', message: '网络错误' });
        return;
      }
      await sleep(1500);
      await waitForLoad(win, 15000);
    }
    if (/\/login/i.test(win.webContents.getURL())) {
      handleNotLoggedIn();
      return;
    }
    const result = await pollBalance(win, 10000);
    if (result == null) {
      console.error('[points] 未读取到积分（未登录、会话失效或选择器失效）');
      sendToWidget({ type: 'error', message: everSucceeded ? '会话失效' : '未登录' });
      if (!everSucceeded && !loginWindow) openLoginWindow();
      return;
    }
    everSucceeded = true;
    applyPoints(result);
    exportSession();
  } catch (err) {
    console.error('[points] 获取异常:', err);
    sendToWidget({ type: 'error', message: '网络错误' });
  } finally {
    fetchInFlight = false;
  }
}

function startRefreshLoop() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { fetchPoints(); }, config.refreshIntervalMs);
}

/* ---------------- 登录会话本地加密保存 / 恢复 ----------------
 * TRAE 客户端的登录凭据经 DPAPI 加密且被进程独占锁定，无法跨应用读取，
 * 因此采用等效方案：网页登录成功后把会话 Cookie 用 safeStorage 加密存盘，
 * 下次启动自动恢复，实现"登录一次、长期免登录"。
 * ---------------------------------------------------------- */

function getSessionFile() {
  return path.join(app.getPath('userData'), 'session.enc');
}

async function exportSession() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const jar = await session.defaultSession.cookies.get({});
    const traeCookies = jar.filter((c) => /trae/i.test(c.domain || ''));
    if (traeCookies.length === 0) return;
    const payload = JSON.stringify(traeCookies.map((c) => ({
      url: 'http' + (c.secure ? 's' : '') + '://' + String(c.domain || '').replace(/^\./, '') + (c.path || '/'),
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      expirationDate: c.expirationDate || Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
      sameSite: ['no_restriction', 'lax', 'strict'].includes(c.sameSite) ? c.sameSite : undefined
    })));
    fs.writeFileSync(getSessionFile(), safeStorage.encryptString(payload));
  } catch (e) {
    console.error('[session] 导出失败:', e.message);
  }
}

async function restoreSession() {
  try {
    const file = getSessionFile();
    if (!fs.existsSync(file)) return false;
    if (!safeStorage.isEncryptionAvailable()) return false;
    const payload = safeStorage.decryptString(fs.readFileSync(file));
    if (!payload) return false;
    const list = JSON.parse(payload);
    if (!Array.isArray(list) || list.length === 0) return false;
    const cs = session.defaultSession.cookies;
    for (const c of list) {
      await cs.set(c).catch(() => {});
    }
    console.log('[session] 已恢复登录会话（' + list.length + ' 条 Cookie）');
    return true;
  } catch (e) {
    console.error('[session] 恢复失败:', e.message);
    return false;
  }
}

/* ---------------- 登录窗口 ---------------- */

function openLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show();
    loginWindow.focus();
    return;
  }
  loginWindow = new BrowserWindow({
    width: 1120,
    height: 800,
    title: '登录 Trae（登录成功后会自动关闭）',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  loginWindow.removeMenu();
  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // 直接加载积分页：未登录会自动跳到登录页，登录成功后直达 dashboard
  loginWindow.loadURL(config.pointsUrl).catch((err) => {
    console.error('[login] 登录页加载失败:', err && err.message);
    loginWindow.loadURL(config.loginUrl).catch(() => {});
  });
  loginWindow.on('closed', () => { loginWindow = null; stopLoginWatch(); });
  startLoginWatch();
}

function startLoginWatch() {
  stopLoginWatch();
  loginWatchTimer = setInterval(() => {
    if (!loginWindow) { stopLoginWatch(); return; }
    if (everSucceeded) {
      const w = loginWindow;
      loginWindow = null;
      w.close();
      stopLoginWatch();
    } else {
      fetchPoints();
    }
  }, 5000);
}

function stopLoginWatch() {
  if (loginWatchTimer) {
    clearInterval(loginWatchTimer);
    loginWatchTimer = null;
  }
}

/* ---------------- 设置窗口 ---------------- */

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 400,
    height: 480,
    resizable: false,
    title: '设置',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWindow.removeMenu();
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

/* ---------------- IPC ---------------- */

ipcMain.handle('get-widget-info', () => {
  const info = getImageInfo();
  return info ? { natural: info.natural, bbox: info.bbox, scale: info.scale, topZone: TOP_ZONE } : null;
});

ipcMain.handle('get-config', () => Object.assign({}, config));

ipcMain.handle('save-settings', (_e, partial) => {
  const oldScale = config.imageScale;
  const oldTrim = config.trimTransparentMargin;
  config = Object.assign({}, DEFAULT_CONFIG, sanitizeConfig(Object.assign({}, config, partial || {})));
  saveConfig();
  startRefreshLoop();
  if ((oldScale !== config.imageScale || oldTrim !== config.trimTransparentMargin) && mainWindow && !mainWindow.isDestroyed()) {
    const { info, width, height } = computeWidgetSize();
    resizeWidgetWindow(width, height);
    scheduleSavePosition();
    if (info) {
      mainWindow.webContents.send('layout-update', { bbox: info.bbox, scale: info.scale, topZone: TOP_ZONE });
    }
  }
  for (const w of BrowserWindow.getAllWindows()) {
    if (w !== mainWindow) w.webContents.send('config-updated', config);
  }
  return Object.assign({}, config);
});

ipcMain.handle('refresh-points', async () => {
  if (!fetchInFlight) fetchPoints();
  return true;
});

ipcMain.on('window-move', (_e, data) => {
  const dx = data && data.dx;
  const dy = data && data.dy;
  if (!mainWindow || !isNum(dx) || !isNum(dy) || (!dx && !dy)) return;
  widgetPos.x += dx;
  widgetPos.y += dy;
  // 必须用 setBounds 显式携带固定尺寸。setPosition 会连带 Electron 内部缓存的尺寸
  // 做 DIP→物理像素换算（125% 缩放下出现小数并向上取整后写回缓存），窗口每次移动
  // 被棘轮式撑大 1px；实测 500 次移动从 380x504 膨胀到 880x1004。
  mainWindow.setBounds({
    x: Math.round(widgetPos.x),
    y: Math.round(widgetPos.y),
    width: widgetSize.width,
    height: widgetSize.height
  });
  scheduleSavePosition();
});

ipcMain.on('save-position', () => scheduleSavePosition(0));

ipcMain.on('show-context-menu', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    { label: '立即刷新', click: () => { if (!fetchInFlight) fetchPoints(); } },
    { label: '重新登录', click: () => openLoginWindow() },
    { label: '设置', click: () => openSettingsWindow() },
    { type: 'separator' },
    {
      label: '窗口置顶',
      type: 'checkbox',
      checked: mainWindow.isAlwaysOnTop(),
      click: () => mainWindow.setAlwaysOnTop(!mainWindow.isAlwaysOnTop(), 'screen-saver')
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
  menu.popup({ window: mainWindow });
});

/* ---------------- 启动 ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap);
}

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    config.windowPosition = [Math.round(widgetPos.x), Math.round(widgetPos.y)];
    saveConfig();
  }
});

function bootstrap() {
  config = loadConfig();
  createMainWindow();
  restoreSession().finally(() => {
    startRefreshLoop();
    fetchPoints();
  });
  if (process.env.WIDGET_SMOKE_TEST) setTimeout(() => app.quit(), 6000);
}
