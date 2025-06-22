document.addEventListener('DOMContentLoaded', async () => {
    const usernameInput = document.getElementById('username');
    const versionSelect = document.getElementById('version-select');
    const launchButton = document.getElementById('launch-button');
    const consoleOutput = document.getElementById('console-output');
    const statusBar = document.getElementById('status-bar');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressDetails = document.getElementById('progress-details');

    // Başlatıcı açıldığında kayıtlı ayarları yükle
    try {
        const settings = await window.electronAPI.getSettings();
        if (settings && settings.lastUsername) {
            usernameInput.value = settings.lastUsername;
            logToConsole(`Hoş geldin, ${settings.lastUsername}!`);
        }
    } catch (error) {
        logToConsole('Kayıtlı ayarlar yüklenemedi: ' + error);
    }

    function logToConsole(message) {
        const line = document.createElement('div');
        const timestamp = `[${new Date().toLocaleTimeString()}]`;
        line.innerHTML = `<span style="color: #99aab5;">${timestamp}</span> ${message}`;
        if (message.includes('[HATA]') || message.includes('FATAL')) line.style.color = '#f04747';
        consoleOutput.appendChild(line);
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    function updateStatus(message) {
        statusBar.textContent = message;
        if (!message.toLowerCase().includes('indiriliyor')) {
            progressContainer.style.display = 'none';
        }
    }

    function resetUI() {
        launchButton.disabled = false;
        launchButton.textContent = "Başlat";
        updateStatus('Hazır');
    }

    async function populateVersions() {
        try {
            updateStatus('Sürümler yükleniyor...');
            const versions = await window.electronAPI.getVersions();
            versionSelect.innerHTML = '';
            const releaseGroup = document.createElement('optgroup');
            releaseGroup.label = 'Resmi Sürümler';
            const localGroup = document.createElement('optgroup');
            localGroup.label = 'Modlu Sürümler (Forge/OptiFine)';
            versions.forEach(version => {
                const option = document.createElement('option');
                option.value = version.id;
                option.textContent = version.id;
                if (version.type === 'release') releaseGroup.appendChild(option);
                else localGroup.appendChild(option);
            });
            if (localGroup.children.length > 0) versionSelect.appendChild(localGroup);
            if (releaseGroup.children.length > 0) versionSelect.appendChild(releaseGroup);
            launchButton.disabled = false;
            updateStatus('Hazır');
        } catch (error) {
            logToConsole('Sürümler yüklenirken hata oluştu: ' + error, true);
        }
    }

    launchButton.addEventListener('click', async () => {
        const username = usernameInput.value.trim();
        const versionId = versionSelect.value;
        if (!username) {
            updateStatus('Lütfen bir kullanıcı adı girin.');
            return;
        }
        launchButton.disabled = true;
        launchButton.textContent = "Başlatılıyor...";
        consoleOutput.innerHTML = '';
        window.electronAPI.launchGame({ username, versionId });
    });

    const formatBytes = (bytes, decimals = 2) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    };
    const formatTime = (seconds) => {
        if (seconds === Infinity || isNaN(seconds)) return '...';
        if (seconds < 60) return `${Math.round(seconds)}s kaldı`;
        return `${Math.round(seconds / 60)}dk kaldı`;
    };

    window.electronAPI.onLog((message) => logToConsole(message));
    window.electronAPI.onStatusUpdate((message) => updateStatus(message));
    window.electronAPI.onGameClose(() => resetUI());
    window.electronAPI.onDownloadProgress((progress) => {
        progressContainer.style.display = 'block';
        progressBar.style.width = `${progress.percentage.toFixed(2)}%`;
        const downloaded = formatBytes(progress.downloaded);
        const total = formatBytes(progress.total);
        const speed = formatBytes(progress.speed) + '/s';
        const eta = formatTime(progress.eta);
        progressDetails.textContent = `${downloaded} / ${total} | ${speed} | ${eta}`;
    });

    await populateVersions();
});
