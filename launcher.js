const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const { spawn } = require('child_process');
const { app } = require('electron');
const crypto = require('crypto');

class MinecraftLauncher {
    constructor(win) {
        this.win = win;
        this.DATA_DIR = path.join(app.getPath('userData'), 'minecraft_data');
        this.VERSIONS_DIR = path.join(this.DATA_DIR, 'versions');
        this.LIBRARIES_DIR = path.join(this.DATA_DIR, 'libraries');
        this.ASSETS_DIR = path.join(this.DATA_DIR, 'assets');
    }

    log(message) {
        console.log(message);
        if (this.win) this.win.webContents.send('log', message.toString());
    }

    setStatus(message) {
        console.log(`Status: ${message}`);
        if (this.win) this.win.webContents.send('status-update', message);
    }

    sendProgress(progressData) {
        if (this.win) this.win.webContents.send('download-progress', progressData);
    }

    async getVersionManifest() {
        this.setStatus('Sürüm manifestosu alınıyor...');
        const mojangManifestUrl = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
        const mojangResponse = await axios.get(mojangManifestUrl);
        let versions = mojangResponse.data.versions;

        this.setStatus('Yerel sürümler taranıyor...');
        if (await fs.pathExists(this.VERSIONS_DIR)) {
            const localVersionDirs = await fs.readdir(this.VERSIONS_DIR);
            for (const dirName of localVersionDirs) {
                const jsonPath = path.join(this.VERSIONS_DIR, dirName, `${dirName}.json`);
                if (await fs.pathExists(jsonPath)) {
                    if (!versions.some(v => v.id === dirName)) {
                        const versionJson = await fs.readJson(jsonPath);
                        versions.push({
                            id: dirName,
                            type: versionJson.type || 'local',
                            releaseTime: versionJson.releaseTime || new Date(0).toISOString(),
                        });
                    }
                }
            }
        }
        
        versions.sort((a, b) => new Date(b.releaseTime) - new Date(a.releaseTime));
        this.setStatus('Sürümler başarıyla alındı.');
        return versions;
    }
    
    async resolveVersion(versionId) {
        const versionJsonPath = path.join(this.VERSIONS_DIR, versionId, `${versionId}.json`);
        
        if (!await fs.pathExists(versionJsonPath)) {
            this.setStatus(`${versionId}.json yerel olarak bulunamadı, indiriliyor...`);
            const mojangManifestUrl = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
            const mojangResponse = await axios.get(mojangManifestUrl);
            const versionInfo = mojangResponse.data.versions.find(v => v.id === versionId);
            if (!versionInfo || !versionInfo.url) {
                throw new Error(`İndirilecek sürüm (${versionId}) için manifestoda URL bulunamadı.`);
            }
            await this.downloadFile(versionInfo.url, versionJsonPath, true);
            this.setStatus(`${versionId}.json başarıyla indirildi.`);
        }

        let versionJson = await fs.readJson(versionJsonPath);

        if (versionJson.inheritsFrom) {
            const parentVersionJson = await this.resolveVersion(versionJson.inheritsFrom);
            versionJson.libraries = parentVersionJson.libraries.concat(versionJson.libraries || []);
            versionJson.mainClass = versionJson.mainClass || parentVersionJson.mainClass;
            versionJson.assetIndex = versionJson.assetIndex || parentVersionJson.assetIndex;
            
            const parentJvmArgs = parentVersionJson.arguments?.jvm ?? [];
            const childJvmArgs = versionJson.arguments?.jvm ?? [];
            const parentGameArgs = parentVersionJson.arguments?.game ?? [];
            const childGameArgs = versionJson.arguments?.game ?? [];
            versionJson.arguments = {
                jvm: parentJvmArgs.concat(childJvmArgs),
                game: parentGameArgs.concat(childGameArgs)
            };
        }
        return versionJson;
    }

    async launch(options) {
        try {
            const { username, versionId } = options;
            
            this.log(`'${versionId}' sürümü '${username}' için başlatılıyor...`);
            await fs.ensureDir(this.DATA_DIR);

            this.setStatus(`${versionId} sürüm bilgisi çözümleniyor...`);
            const versionJson = await this.resolveVersion(versionId);
            
            const NATIVES_DIR_VERSION = path.join(this.DATA_DIR, 'natives', versionId);
            const vanillaJarId = versionJson.inheritsFrom || versionJson.id;
            const clientJarPath = path.join(this.VERSIONS_DIR, vanillaJarId, `${vanillaJarId}.jar`);

            if(!await fs.pathExists(clientJarPath)){
                 const mojangManifestUrl = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
                 const versionManifest = (await axios.get(mojangManifestUrl)).data;
                 const versionInfo = versionManifest.versions.find(v => v.id === vanillaJarId);
                 if (!versionInfo) throw new Error(`Ana sürüm ${vanillaJarId} manifestoda bulunamadı.`);
                 const versionDetail = (await axios.get(versionInfo.url)).data;
                 await this.downloadFile(versionDetail.downloads.client.url, clientJarPath, true);
            }
            
            this.setStatus('Kütüphaneler indiriliyor...');
            await this.downloadLibraries(versionJson);

            this.setStatus('Native dosyalar ayıklanıyor...');
            await this.extractNatives(versionJson, NATIVES_DIR_VERSION);
            
            this.setStatus('Assetler indiriliyor...');
            await this.downloadAssets(versionJson);

            this.setStatus('Başlatma komutu oluşturuluyor...');
            const command = this.constructLaunchCommand(versionJson, { username, clientJarPath, nativesDir: NATIVES_DIR_VERSION });

            this.setStatus('Oyun başlatılıyor...');
            this.log(`Komut: ${command.command} ${command.args.join(' ')}`);
            
            const minecraftProcess = spawn(command.command, command.args, { cwd: this.DATA_DIR });

            minecraftProcess.stdout.on('data', (data) => this.log(`[MC] ${data.toString().trim()}`));
            minecraftProcess.stderr.on('data', (data) => this.log(`[MC HATA] ${data.toString().trim()}`));

            minecraftProcess.on('close', (code) => {
                this.log(`Minecraft process'i ${code} koduyla kapatıldı.`);
                if (this.win) this.win.webContents.send('game-close');
            });
        } catch (error) {
            this.log(`\n\nFATAL BAŞLATMA HATASI: ${error.stack}`);
            if (this.win) this.win.webContents.send('game-close');
        }
    }
    
    async downloadFile(url, dest, showProgress = false) {
        if (await fs.pathExists(dest)) return;
        await fs.ensureDir(path.dirname(dest));

        const response = await axios.get(url, { responseType: 'stream' });
        const totalLength = parseInt(response.headers['content-length'], 10);
        let downloadedLength = 0;
        let lastTime = Date.now();
        let lastDownloaded = 0;
        
        const fileName = path.basename(dest);
        this.setStatus(`${fileName} indiriliyor...`);

        const writer = fs.createWriteStream(dest);
        response.data.on('data', (chunk) => {
            downloadedLength += chunk.length;
            if (showProgress) {
                const now = Date.now();
                const timeDiff = (now - lastTime) / 1000;
                if (timeDiff >= 0.5 || downloadedLength === totalLength) {
                    const bytesSinceLast = downloadedLength - lastDownloaded;
                    const speed = bytesSinceLast / timeDiff;
                    const percentage = (downloadedLength / totalLength) * 100;
                    const remainingBytes = totalLength - downloadedLength;
                    const eta = speed > 0 ? remainingBytes / speed : Infinity;
                    this.sendProgress({ percentage, speed, eta, downloaded: downloadedLength, total: totalLength });
                    lastTime = now;
                    lastDownloaded = downloadedLength;
                }
            }
        });

        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }

    async downloadLibraries(versionJson) {
        for (const lib of versionJson.libraries) {
            if (lib.rules && !this.checkRules(lib.rules)) continue;
            if (lib.downloads && lib.downloads.artifact) {
                const artifact = lib.downloads.artifact;
                const libPath = path.join(this.LIBRARIES_DIR, artifact.path);
                await this.downloadFile(artifact.url, libPath, false);
            }
        }
    }

    async extractNatives(versionJson, nativesDir) {
        await fs.ensureDir(nativesDir);
        await fs.emptyDir(nativesDir);
        for (const lib of versionJson.libraries) {
            if (!lib.natives || (lib.rules && !this.checkRules(lib.rules))) continue;
            const os = this.getOS();
            const nativeKey = lib.natives[os]?.replace('${arch}', process.arch.replace('x', ''));
            if (!nativeKey || !lib.downloads.classifiers?.[nativeKey]) continue;
            const artifact = lib.downloads.classifiers[nativeKey];
            const libPath = path.join(this.LIBRARIES_DIR, artifact.path);
            await this.downloadFile(artifact.url, libPath, false);
            const zip = new AdmZip(libPath);
            zip.extractAllTo(nativesDir, true);
        }
    }

    async downloadAssets(versionJson) {
        if (!versionJson.assetIndex) {
            this.log(`Eski asset sürümü (${versionJson.id}). Asset indirme işlemi atlandı.`);
            return;
        }
        const assetIndexPath = path.join(this.ASSETS_DIR, 'indexes', `${versionJson.assetIndex.id}.json`);
        await this.downloadFile(versionJson.assetIndex.url, assetIndexPath, false);
        const assetIndex = await fs.readJson(assetIndexPath);
        const totalAssets = Object.keys(assetIndex.objects).length;
        let downloadedCount = 0;
        for (const assetName in assetIndex.objects) {
            downloadedCount++;
            const asset = assetIndex.objects[assetName];
            const hash = asset.hash;
            const subDir = hash.substring(0, 2);
            const assetFileUrl = `https://resources.download.minecraft.net/${subDir}/${hash}`;
            const assetFilePath = path.join(this.ASSETS_DIR, 'objects', subDir, hash);
            if (!await fs.pathExists(assetFilePath)) {
                 this.setStatus(`Assetler indiriliyor... (${downloadedCount}/${totalAssets})`);
                await this.downloadFile(assetFileUrl, assetFilePath, false);
            }
        }
        this.setStatus('Assetler doğrulandı.');
    }

    constructLaunchCommand(versionJson, options) {
        const { username, clientJarPath, nativesDir } = options;
        const separator = this.getOS() === 'windows' ? ';' : ':';
        let classpath = [];
        versionJson.libraries.forEach(lib => {
            if (!lib.rules || this.checkRules(lib.rules)) {
                if (lib.downloads && lib.downloads.artifact) {
                    classpath.push(path.join(this.LIBRARIES_DIR, lib.downloads.artifact.path));
                }
            }
        });
        classpath.push(clientJarPath);
        const classpathString = classpath.join(separator);
        const offlineUUIDBuffer = crypto.createHash('md5').update(Buffer.from('OfflinePlayer:' + username, 'utf8')).digest();
        offlineUUIDBuffer[6] = (offlineUUIDBuffer[6] & 0x0f) | 0x30;
        offlineUUIDBuffer[8] = (offlineUUIDBuffer[8] & 0x3f) | 0x80;
        const offlineUUID = offlineUUIDBuffer.toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
        const replacements = {
            '${auth_player_name}': username,
            '${version_name}': versionJson.id,
            '${game_directory}': this.DATA_DIR,
            '${assets_root}': this.ASSETS_DIR,
            '${assets_index_name}': versionJson.assetIndex.id,
            '${auth_uuid}': offlineUUID,
            '${auth_access_token}': offlineUUID,
            '${user_type}': 'legacy',
            '${clientid}': 'GLauncher_ClientID',
            '${auth_xuid}': '0',
            '${version_type}': versionJson.type,
            '${natives_directory}': nativesDir,
            '${launcher_name}': 'GLauncher',
            '${launcher_version}': '1.2.0',
            '${classpath}': classpathString
        };
        let jvmArgs = [];
        let gameArgs = [];
        if (versionJson.arguments) {
            versionJson.arguments.jvm?.forEach(arg => {
                if (typeof arg === 'string') {
                    jvmArgs.push(this.replacePlaceholders(arg, replacements));
                } else if (this.checkRules(arg.rules)) {
                    const value = Array.isArray(arg.value) ? arg.value : [arg.value];
                    value.forEach(v => jvmArgs.push(this.replacePlaceholders(v, replacements)));
                }
            });
            versionJson.arguments.game?.forEach(arg => {
                if (typeof arg === 'string') {
                    gameArgs.push(this.replacePlaceholders(arg, replacements));
                }
            });
        } else {
            jvmArgs.push(`-Djava.library.path=${nativesDir}`);
            jvmArgs.push('-cp', classpathString);
            gameArgs.push(...versionJson.minecraftArguments.split(' ').map(arg => this.replacePlaceholders(arg, replacements)));
        }
        const finalArgs = [ ...jvmArgs, versionJson.mainClass, ...gameArgs ];
        return { command: this.findJava(), args: finalArgs.filter(arg => arg) };
    }

    replacePlaceholders(arg, replacements) {
        let result = arg;
        for (const key in replacements) {
            result = result.replace(new RegExp(key.replace(/[${}]/g, '\\$&'), 'g'), replacements[key]);
        }
        return result;
    }

    checkRules(rules) {
        if (!rules) return true;
        let allow = false;
        for (const rule of rules) {
            let applies = true;
            if (rule.os && rule.os.name && rule.os.name !== this.getOS()) {
                applies = false;
            }
            if (applies) {
                allow = rule.action === 'allow';
            }
        }
        return allow;
    }
    
    findJava() {
        const javaHome = process.env.JAVA_HOME;
        if (javaHome) {
            const javaPath = path.join(javaHome, 'bin', 'java' + (this.getOS() === 'windows' ? '.exe' : ''));
            if (fs.existsSync(javaPath)) return javaPath;
        }
        return 'java';
    }

    getOS() {
        switch (process.platform) {
            case 'win32': return 'windows';
            case 'darwin': return 'osx';
            case 'linux': return 'linux';
            default: return 'unknown';
        }
    }
}

module.exports = MinecraftLauncher;