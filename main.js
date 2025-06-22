const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const MinecraftLauncher = require('./launcher.js');

// Ayarlar dosyasının yolu. Kullanıcı verileri klasöründe saklanır.
const settingsPath = path.join(app.getPath('userData'), 'glauncher_settings.json');
let launcher;

// Ayarları okuyan fonksiyon
function readSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
    } catch (error) {
        console.error('Ayarlar okunurken hata oluştu:', error);
    }
    return {}; // Hata veya dosya yoksa boş obje döndür
}

// Ayarları kaydeden fonksiyon
function saveSettings(settings) {
    try {
        // JSON'u düzgün formatlı kaydetmek için (okunabilirlik) null, 2 ekliyoruz.
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error('Ayarlar kaydedilirken hata oluştu:', error);
    }
}

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        title: 'GLauncher',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    launcher = new MinecraftLauncher(mainWindow);
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// --- IPC Kanalları ---

ipcMain.handle('get-settings', () => readSettings());
ipcMain.handle('save-settings', (event, settings) => saveSettings(settings));

ipcMain.handle('get-versions', async () => {
    if (!launcher) return [];
    try {
        return await launcher.getVersionManifest();
    } catch (error) {
        console.error('Sürümler alınırken hata:', error);
        return [];
    }
});

ipcMain.handle('launch-game', async (event, options) => {
    if (!launcher) return;
    // Oyunu başlatmadan önce son kullanıcı adını kaydet.
    saveSettings({ lastUsername: options.username });
    launcher.launch(options);
});
