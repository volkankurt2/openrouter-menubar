const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain } = require('electron');
const path = require('path');
const https = require('https');
const os = require('os');
const fs = require('fs');

let tray = null;
let popupWindow = null;
let lastData = null;
let refreshInterval = null;
const REFRESH_MS = 30 * 1000; // 30 seconds

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function getConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to read config:', err);
  }
  return {};
}

function saveConfig(config) {
  try {
    const configPath = getConfigPath();
    const existing = getConfig();
    fs.writeFileSync(configPath, JSON.stringify({ ...existing, ...config }, null, 2));
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

function getApiKey() {
  const config = getConfig();
  if (config.openRouterApiKey) {
    return config.openRouterApiKey;
  }
  return process.env.OPENROUTER_API_KEY || '';
}

function getAutoLaunch() {
  const config = getConfig();
  // Default to false if not set
  return config.autoLaunch === true;
}

function applyAutoLaunch(enabled) {
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true
    });
  }
}

function fetchBalance() {
  return new Promise((resolve, reject) => {
    const key = getApiKey();
    if (!key) {
      reject(new Error('API_KEY_NOT_SET'));
      return;
    }

    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/auth/key',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.data) {
            resolve(parsed.data);
          } else {
            reject(new Error('Invalid API response'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function updateTrayTitle(data) {
  if (!tray) return;
  
  if (!data) {
    tray.setTitle(' OR');
    return;
  }

  const remaining = data.limit_remaining;
  const limit = data.limit;
  const pct = limit > 0 ? Math.round((remaining / limit) * 100) : 0;
  
  // Color indicator via emoji
  let indicator = '🟢';
  if (pct < 20) indicator = '🔴';
  else if (pct < 50) indicator = '🟡';

  tray.setTitle(` $${remaining.toFixed(2)}`);
  tray.setToolTip(`OpenRouter: $${remaining.toFixed(2)} remaining (${pct}%)`);
}

function createTray() {
  // Create a simple icon (16x16 white circle)
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFCSURBVDiNpZM9SwNBEIafvYuJMUQUFAsRBAWxsLCwsLCwsBD8CRYWFhYWFhYWFhYWFp6FhYWFhYWFhYWFhYWFhYWFhRBNJJf7cne7O4OFkJDLXRIcmGLYeeb9mN1ZMcasaq3fReSwrutaRMSJyI2IfALAzG4BqOo7gMuyLN+894iIp2kaExG11g4AICJ2uVwuIiIiIiIiWmtFRERERGw2m1UA2O/3e8MwDABgrR0A0HUdAKiqCgAopQAASimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSim1UkoppZRSSim1UkoppZRSSim1UkoppZRSSim1UkoppZRSSim1UkoppZRSSim1UkoppZRSSim1UkoppZRSSim1UkoppdRKSimllFJKqZVSSqmVUkqplVJKKaWUUkqplVJKKaVWSqmVUkqplVJKqZX6B/AHAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAv4Bv9QPLe4LrVcAAAAASUVORK5CYII='
  );
  
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setTitle(' OR');

  tray.on('click', togglePopup);
  tray.on('right-click', () => {
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Refresh', click: doRefresh },
      { type: 'separator' },
      { label: 'Open OpenRouter', click: () => shell.openExternal('https://openrouter.ai/settings/keys') },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ]);
    tray.popUpContextMenu(contextMenu);
  });
}

function createPopupWindow() {
  popupWindow = new BrowserWindow({
    width: 340,
    height: 460,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  popupWindow.loadFile('popup.html');
  
  popupWindow.on('blur', () => {
    popupWindow.hide();
  });
}

function togglePopup() {
  if (!popupWindow) return;

  if (popupWindow.isVisible()) {
    popupWindow.hide();
    return;
  }

  const trayBounds = tray.getBounds();
  const windowBounds = popupWindow.getBounds();

  const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  const y = Math.round(trayBounds.y + trayBounds.height + 4);

  popupWindow.setPosition(x, y, false);
  popupWindow.show();
  popupWindow.focus();

  // Send current data
  if (lastData) {
    popupWindow.webContents.send('data-update', { data: lastData, error: null });
  } else if (!getApiKey()) {
    popupWindow.webContents.send('data-update', { data: null, error: 'API_KEY_NOT_SET' });
  } else {
    popupWindow.webContents.send('data-update', { data: null, error: null, loading: true });
  }
}

async function doRefresh() {
  try {
    const data = await fetchBalance();
    lastData = data;
    updateTrayTitle(data);
    if (popupWindow?.isVisible()) {
      popupWindow.webContents.send('data-update', { data, error: null });
    }
  } catch (err) {
    lastData = null;
    updateTrayTitle(null);
    if (popupWindow?.isVisible()) {
      popupWindow.webContents.send('data-update', { data: null, error: err.message });
    }
  }
}

ipcMain.on('refresh', doRefresh);
ipcMain.on('open-link', (_, url) => shell.openExternal(url));

ipcMain.handle('get-config', () => {
  return {
    apiKey: getApiKey(),
    autoLaunch: getAutoLaunch()
  };
});

ipcMain.on('save-config', (_, { apiKey, autoLaunch }) => {
  saveConfig({ openRouterApiKey: apiKey, autoLaunch });
  applyAutoLaunch(autoLaunch);
  
  if (apiKey) {
    doRefresh();
  } else {
    lastData = null;
    updateTrayTitle(null);
    if (popupWindow?.isVisible()) {
      popupWindow.webContents.send('data-update', { data: null, error: 'API_KEY_NOT_SET' });
    }
  }
});

app.whenReady().then(() => {
  app.dock?.hide(); // Hide from dock on macOS
  
  // Apply auto-launch setting on startup
  applyAutoLaunch(getAutoLaunch());
  
  createTray();
  createPopupWindow();
  doRefresh();
  refreshInterval = setInterval(doRefresh, REFRESH_MS);
});

app.on('window-all-closed', (e) => e.preventDefault());
