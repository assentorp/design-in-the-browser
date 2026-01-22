import { app, BrowserWindow, session } from 'electron';
import * as path from 'path';
import { setupIPC } from './ipc';
import { createMenu } from './menu';

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV !== 'production' || !app.isPackaged;

// Suppress security warnings in dev mode (they're expected for webview usage)
if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

function createWindow() {
  const preloadPath = path.join(__dirname, '..', 'preload', 'main-preload.js');
  console.log('[Main] Preload path:', preloadPath);

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 600,
    title: 'Claude Design',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for preload to work properly
      preload: preloadPath,
      webviewTag: true,
    },
  });

  // Allow webview to load any URL
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src * 'unsafe-inline' 'unsafe-eval' data: blob:"],
      },
    });
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  setupIPC(mainWindow);
  createMenu(mainWindow);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Allow navigation in webview
app.on('web-contents-created', (_, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });

    // Suppress expected navigation errors
    contents.on('did-fail-load', (event, errorCode, errorDescription) => {
      // ERR_ABORTED (-3) is expected during navigation
      // ERR_BLOCKED_BY_CLIENT (-20) happens with ad blockers
      if (errorCode !== -3 && errorCode !== -20) {
        console.warn('Webview load failed:', errorCode, errorDescription);
      }
    });
  }
});

// Suppress unhandled promise rejections from webview IPC
process.on('unhandledRejection', (reason: Error) => {
  // Ignore cloning errors from webview executeJavaScript
  if (reason?.message?.includes('could not be cloned')) {
    return;
  }
  console.error('Unhandled rejection:', reason);
});
