import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

export function checkForUpdates(mainWindow: BrowserWindow) {
  // Configure auto-updater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Check for updates
  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    mainWindow.webContents.send('app:update-available', {
      version: info.version,
      url: `https://github.com/assentorp/ditb/releases/tag/v${info.version}`,
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] Up to date');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log('[Updater] Download progress:', Math.round(progress.percent) + '%');
    mainWindow.webContents.send('app:update-progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info.version);
    mainWindow.webContents.send('app:update-downloaded', {
      version: info.version,
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err);
  });

  // Check for updates after a short delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[Updater] Check failed:', err);
    });
  }, 3000);
}

export function downloadUpdate() {
  autoUpdater.downloadUpdate().catch((err) => {
    console.error('[Updater] Download failed:', err);
  });
}

export function installUpdate() {
  autoUpdater.quitAndInstall(false, true);
}
