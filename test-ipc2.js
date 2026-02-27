const electron = require('electron');
console.log('electron exported keys:', Object.keys(electron));
try {
  console.log('ipcMain type:', typeof electron.ipcMain);
} catch (e) {
  console.log('error accessing ipcMain:', e.message);
}
