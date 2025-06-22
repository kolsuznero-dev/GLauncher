const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Ayar yönetimi
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

    // Oyun yönetimi
    getVersions: () => ipcRenderer.invoke('get-versions'),
    launchGame: (options) => ipcRenderer.invoke('launch-game', options),

    // Launcher sınıfından gelen olayları dinlemek için kanallar
    onLog: (callback) => ipcRenderer.on('log', (_event, value) => callback(value)),
    onStatusUpdate: (callback) => ipcRenderer.on('status-update', (_event, value) => callback(value)),
    onGameClose: (callback) => ipcRenderer.on('game-close', (_event) => callback()),
    onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_event, value) => callback(value)),
});
