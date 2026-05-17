const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shiftsight', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  getOverlayConfig: () => ipcRenderer.invoke('overlay:get-config'),
  getReminderConfig: () => ipcRenderer.invoke('reminder:get-config'),
  startReminderBreak: () => ipcRenderer.send('reminder:start-break'),
  finishReminderBreak: () => ipcRenderer.send('reminder:finish-break'),
  snoozeReminder: (minutes) => ipcRenderer.send('reminder:snooze', minutes),
  skipBreak: () => ipcRenderer.send('break:skip'),
  breakFinished: () => ipcRenderer.send('break:finished')
});
