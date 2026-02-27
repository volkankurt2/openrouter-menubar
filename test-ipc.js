const { app, ipcMain } = require('electron');
console.log('app is:', !!app);
console.log('ipcMain is:', !!ipcMain);
app.whenReady().then(() => {
  console.log('Inside ready, ipcMain is:', !!ipcMain);
  app.quit();
});
