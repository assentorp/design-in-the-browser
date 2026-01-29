import { app, BrowserWindow, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

// Track if update is downloaded and ready
let updateDownloaded = false;

let mainWindowRef: BrowserWindow | null = null;
let isManualCheck = false;

export function checkForUpdates(mainWindow: BrowserWindow) {
  mainWindowRef = mainWindow;

  // Configure auto-updater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Check for updates
  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    mainWindow.webContents.send('app:update-available', {
      version: info.version,
      url: `https://github.com/assentorp/ditb-releases/releases/tag/v${info.version}`,
    });
    isManualCheck = false;
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] Up to date');
    if (isManualCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'No Updates',
        message: 'You are running the latest version.',
        buttons: ['OK'],
      });
      isManualCheck = false;
    }
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
    updateDownloaded = true;
    mainWindow.webContents.send('app:update-downloaded', {
      version: info.version,
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err);
    if (isManualCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Error',
        message: 'Failed to check for updates. Please try again later.',
        buttons: ['OK'],
      });
      isManualCheck = false;
    }
  });

  // Check for updates after a short delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[Updater] Check failed:', err);
    });
  }, 3000);
}

export function manualCheckForUpdates() {
  isManualCheck = true;
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[Updater] Manual check failed:', err);
    if (mainWindowRef) {
      dialog.showMessageBox(mainWindowRef, {
        type: 'error',
        title: 'Update Error',
        message: 'Failed to check for updates. Please try again later.',
        buttons: ['OK'],
      });
    }
    isManualCheck = false;
  });
}

export function downloadUpdate() {
  console.log('[Updater] Starting download...');
  autoUpdater.downloadUpdate().then(() => {
    console.log('[Updater] Download started successfully');
  }).catch((err) => {
    console.error('[Updater] Download failed:', err);
    if (mainWindowRef) {
      dialog.showMessageBox(mainWindowRef, {
        type: 'error',
        title: 'Download Error',
        message: `Failed to download update: ${err.message || err}`,
        buttons: ['OK'],
      });
    }
  });
}

export function installUpdate() {
  console.log('[Updater] quitAndInstall called, updateDownloaded:', updateDownloaded);

  if (!updateDownloaded) {
    console.error('[Updater] Update not downloaded yet, cannot install');
    if (mainWindowRef) {
      dialog.showMessageBox(mainWindowRef, {
        type: 'error',
        title: 'Update Error',
        message: 'Update has not finished downloading. Please wait and try again.',
        buttons: ['OK'],
      });
    }
    return;
  }

  console.log('[Updater] Calling autoUpdater.quitAndInstall...');

  // On macOS, the 'window-all-closed' handler doesn't quit the app
  // and 'activate' recreates windows — both interfere with quitAndInstall.
  // Remove them and explicitly close all windows first.
  app.removeAllListeners('window-all-closed');
  app.removeAllListeners('activate');
  for (const win of BrowserWindow.getAllWindows()) {
    win.removeAllListeners('close');
    win.close();
  }

  setImmediate(() => autoUpdater.quitAndInstall(false, true));
}
