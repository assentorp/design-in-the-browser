import { app, BrowserWindow, screen, session, nativeImage } from 'electron';
import * as path from 'path';
import { setupIPC } from './ipc';
import { createMenu } from './menu';
import { checkForUpdates } from './updater';

// Disable hardware acceleration on Windows to prevent gray screen issues
if (process.platform === 'win32') {
  app.disableHardwareAcceleration();
}

// Set dock icon on macOS
if (process.platform === 'darwin') {
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
  try {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      app.dock.setIcon(icon);
    }
  } catch (e) {
    // Icon not found, use default
  }
}

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

// Suppress security warnings in dev mode (they're expected for webview usage)
if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

// Get the correct base path for resources
function getResourcePath(...segments: string[]): string {
  if (isDev) {
    // In dev, use __dirname which points to dist/main
    return path.join(__dirname, '..', ...segments);
  } else {
    // In production, use app.getAppPath() which points to the asar/app directory
    return path.join(app.getAppPath(), 'dist', ...segments);
  }
}

function createWindow() {
  const preloadPath = getResourcePath('preload', 'main-preload.js');
  console.log('[Main] isDev:', isDev);
  console.log('[Main] App path:', app.getAppPath());
  console.log('[Main] Preload path:', preloadPath);

  // Create icon for window
  let icon;
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = undefined;
  } catch (e) {
    icon = undefined;
  }

  mainWindow = new BrowserWindow({
    width: Math.round(screen.getPrimaryDisplay().workAreaSize.width * 0.9),
    height: Math.round(screen.getPrimaryDisplay().workAreaSize.height * 0.9),
    minWidth: 1000,
    minHeight: 600,
    title: 'Design In The Browser',
    icon,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for preload to work properly
      preload: preloadPath,
      webviewTag: true,
    },
  });

  // Allow webview to load any URL - remove restrictive CSP headers
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    // Remove any existing CSP headers (they may be restrictive)
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    delete headers['x-content-security-policy'];
    delete headers['X-Content-Security-Policy'];
    // Set a permissive CSP
    headers['Content-Security-Policy'] = [
      "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
      "img-src * data: blob:; " +
      "script-src * 'unsafe-inline' 'unsafe-eval' blob:; " +
      "style-src * 'unsafe-inline';"
    ];
    callback({ responseHeaders: headers });
  });

  // Log load failures for debugging
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Main] Failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Page loaded successfully');
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    const rendererPath = getResourcePath('renderer', 'index.html');
    console.log('[Main] Loading renderer from:', rendererPath);
    mainWindow.loadFile(rendererPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  setupIPC(mainWindow);
  createMenu(mainWindow);
  checkForUpdates(mainWindow);
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
