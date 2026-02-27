const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain } = require('electron');
const { exec } = require('child_process');
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

function getApiKeys() {
  const config = getConfig();
  let keys = [];
  if (Array.isArray(config.openRouterApiKeys)) {
    keys = config.openRouterApiKeys;
  } else if (config.openRouterApiKey) {
    // Legacy fallback
    keys = [config.openRouterApiKey];
  } else if (process.env.OPENROUTER_API_KEY) {
    keys = [process.env.OPENROUTER_API_KEY];
  }
  return keys.filter(k => k && k.trim().length > 0);
}

function getActiveKeyIndex() {
  const config = getConfig();
  return typeof config.activeKeyIndex === 'number' ? config.activeKeyIndex : 0;
}

function getFailoverThreshold() {
  const config = getConfig();
  return typeof config.failoverThreshold === 'number' ? config.failoverThreshold : 0.50; // default 50 cents
}

function getApiKey() {
  const keys = getApiKeys();
  const idx = getActiveKeyIndex();
  if (keys.length > 0) {
    return keys[idx] || keys[0];
  }
  return '';
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

function fetchBalance(keyToUse) {
  return new Promise((resolve, reject) => {
    const key = keyToUse || getApiKey();
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
            resolve({ ...parsed.data, key }); // inject key so we know which one fetched
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

const { Notification } = require('electron');

async function triggerFailover(currentIndex, keys) {
  // Find next key
  const nextIndex = (currentIndex + 1) % keys.length;
  if (nextIndex === currentIndex) return false; // same key, no others

  // Save config explicitly with new index
  try {
    const configPath = getConfigPath();
    const existing = getConfig();
    fs.writeFileSync(configPath, JSON.stringify({ ...existing, activeKeyIndex: nextIndex }, null, 2));
    
    // Switch the environment if claude mode is active
    let claudeMode = '';
    const modePath = path.join(os.homedir(), '.claude_mode');
    if (fs.existsSync(modePath)) {
      claudeMode = fs.readFileSync(modePath, 'utf8').trim();
    }
    
    if (claudeMode === 'openrouter') {
      const scriptPath = path.join(__dirname, 'switch-claude-script.sh');
      exec(`bash "${scriptPath}" or "${keys[nextIndex]}"`);
    }

    // Send notification
    new Notification({
      title: 'OpenRouter Balance Emtpy',
      body: 'Switched to backup API Key automatically.',
      silent: false
    }).show();

    return true; // Successfully triggered
  } catch (err) {
    console.error('Failed failover:', err);
    return false;
  }
}

async function doRefresh() {
  try {
    let data = await fetchBalance();
    const threshold = getFailoverThreshold();
    const keys = getApiKeys();
    
    if (data.limit_remaining !== undefined && data.limit_remaining < threshold && keys.length > 1) {
      const currentIndex = getActiveKeyIndex();
      const failoverDone = await triggerFailover(currentIndex, keys);
      if (failoverDone) {
        // Fetch again with the new key right away
        data = await fetchBalance();
      }
    }
    
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

// ... End of generic imports and functions ...

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // If the user tries to open a second instance, just show the popup of the existing one
    if (popupWindow) {
      if (!popupWindow.isVisible()) {
        togglePopup();
      } else {
        popupWindow.focus();
      }
    }
  });

  // Bind IPCs
  ipcMain.on('refresh', doRefresh);
  ipcMain.on('open-link', (_, url) => shell.openExternal(url));

  ipcMain.handle('get-config', () => {
    let claudeMode = '';
    try {
      const modePath = path.join(os.homedir(), '.claude_mode');
      if (fs.existsSync(modePath)) {
        claudeMode = fs.readFileSync(modePath, 'utf8').trim();
      }
    } catch (e) {
      // ignore
    }

    return {
      apiKeys: getApiKeys(),
      activeKeyIndex: getActiveKeyIndex(),
      failoverThreshold: getFailoverThreshold(),
      autoLaunch: getAutoLaunch(),
      claudeMode
    };
  });

  ipcMain.on('save-config', (_, { apiKeys, activeKeyIndex, failoverThreshold, autoLaunch }) => {
    saveConfig({ 
      openRouterApiKeys: apiKeys,
      activeKeyIndex: activeKeyIndex || 0,
      failoverThreshold: failoverThreshold || 0.50,
      autoLaunch 
    });
    
    applyAutoLaunch(autoLaunch);
    
    if (apiKeys && apiKeys.length > 0) {
      doRefresh();
    } else {
      lastData = null;
      updateTrayTitle(null);
      if (popupWindow?.isVisible()) {
        popupWindow.webContents.send('data-update', { data: null, error: 'API_KEY_NOT_SET' });
      }
    }
  });

  ipcMain.handle('setup-claude', async (_, { mode, apiKey }) => {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'switch-claude-script.sh');
      
      // First setup the shell files
      exec(`bash "${scriptPath}" setup`, (error, stdout, stderr) => {
        if (error) {
          console.error('Setup error:', error);
          return reject(error.message || 'Setup failed');
        }

        // Then execute mode switch
        let switchCmd = '';
        if (mode === 'or' || mode === 'openrouter') {
          const keyToUse = apiKey || getApiKey();
          if (!keyToUse) return reject('API Key is required for OpenRouter mode');
          switchCmd = `bash "${scriptPath}" or "${keyToUse}"`;
        } else {
          switchCmd = `bash "${scriptPath}" ant`;
        }

        exec(switchCmd, (err, out, stdErr) => {
          if (err) {
            console.error('Switch error:', err);
            return reject(err.message || 'Switch failed');
          }
          resolve({ success: true, message: out });
        });
      });
    });
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

  app.on('before-quit', () => {
    if (refreshInterval) clearInterval(refreshInterval);
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });

  app.on('window-all-closed', (e) => e.preventDefault());
}


