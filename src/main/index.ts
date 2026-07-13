import { app, BrowserWindow, screen, session, nativeImage, Menu, clipboard, shell } from 'electron';
import * as path from 'path';
import { setupIPC, rebindIPCMainWindow } from './ipc';
import { createMenu } from './menu';
import { checkForUpdates } from './updater';
import { getSettings, saveSettings } from './settings';

// Disable Chromium's media router to prevent macOS local network permission prompt
app.commandLine.appendSwitch('disable-features', 'MediaRouter');

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
let ipcSetup = false;

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

  const settings = getSettings();
  const saved = settings.windowBounds;
  const workArea = screen.getPrimaryDisplay().workAreaSize;

  const windowOpts: Electron.BrowserWindowConstructorOptions = {
    width: saved?.width || Math.round(workArea.width * 0.9),
    height: saved?.height || Math.round(workArea.height * 0.9),
    minWidth: 1000,
    minHeight: 600,
    title: `Design In The Browser v${app.getVersion()}`,
    icon,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for preload to work properly
      preload: preloadPath,
      webviewTag: true,
    },
  };

  if (saved?.x != null && saved?.y != null) {
    windowOpts.x = saved.x;
    windowOpts.y = saved.y;
  }

  mainWindow = new BrowserWindow(windowOpts);

  if (saved?.maximized) {
    mainWindow.maximize();
  }

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
    mainWindow!.setTitle(`Design In The Browser — v${app.getVersion()}`);
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    const rendererPath = getResourcePath('renderer', 'index.html');
    console.log('[Main] Loading renderer from:', rendererPath);
    mainWindow.loadFile(rendererPath);
  }

  mainWindow.on('close', () => {
    if (!mainWindow) return;
    const maximized = mainWindow.isMaximized();
    const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    saveSettings({
      windowBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized,
      },
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Keep main window at zoom level 0 (100%) — redirect zoom to webview via IPC
  mainWindow.webContents.setZoomLevel(0);
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const level = mainWindow.webContents.getZoomLevel();
    if (level !== 0) {
      mainWindow.webContents.setZoomLevel(0);
    }
  }, 16);

  if (!ipcSetup) {
    setupIPC(mainWindow);
    ipcSetup = true;
  } else {
    // macOS: window was closed and recreated via dock activate — point the
    // already-registered handlers at the new window.
    rebindIPCMainWindow(mainWindow);
  }
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

// Cmd+1..9 switches project tabs — intercept on ALL webContents (main window + webviews)
app.on('web-contents-created', (_, contents) => {
  contents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;
    if (!input.meta && !input.control) return;

    // Cmd+Shift+S: send queued edits (handle before the shift filter)
    if (input.shift && !input.alt && (input.key === 's' || input.key === 'S') && mainWindow) {
      _event.preventDefault();
      mainWindow.webContents.send('send-queued-edits');
      return;
    }

    // Cmd+R: reload webview (not the Electron app)
    if (!input.shift && !input.alt && (input.key === 'r' || input.key === 'R') && mainWindow) {
      _event.preventDefault();
      mainWindow.webContents.send('reload-webview');
      return;
    }

    if (input.shift || input.alt) return;
    const num = parseInt(input.key, 10);
    if (num >= 1 && num <= 9 && mainWindow) {
      _event.preventDefault();
      mainWindow.webContents.send('switch-tab', num - 1);
      return;
    }

    // Cmd+=/-, Cmd+0: block native zoom, send to renderer for context-aware zoom
    if ((input.key === '=' || input.key === '+' || input.key === '-' || input.key === '0') && mainWindow) {
      _event.preventDefault();
      const source = contents.getType() === 'webview' ? 'browser' : 'renderer';
      const direction = input.key === '-' ? 'out' : input.key === '0' ? 'reset' : 'in';
      mainWindow.webContents.send('pane-zoom', direction, source);
    }
  });
});

// Allow navigation in webview
app.on('web-contents-created', (_, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (url && mainWindow) {
        mainWindow.webContents.send('blocked-new-window', url);
      }
      return { action: 'deny' };
    });

    // Context menu for webview
    contents.on('context-menu', (_, params) => {
      const menuItems: Electron.MenuItemConstructorOptions[] = [];

      // Link actions
      if (params.linkURL) {
        menuItems.push(
          { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) },
          { label: 'Open in Browser', click: () => shell.openExternal(params.linkURL) },
        );
      }

      // Selected text
      if (params.selectionText) {
        if (menuItems.length > 0) menuItems.push({ type: 'separator' });
        menuItems.push({ label: 'Copy', click: () => clipboard.writeText(params.selectionText) });
      }

      // Navigation
      if (menuItems.length > 0) menuItems.push({ type: 'separator' });
      menuItems.push(
        { label: 'Back', enabled: contents.canGoBack(), click: () => contents.goBack() },
        { label: 'Forward', enabled: contents.canGoForward(), click: () => contents.goForward() },
        { label: 'Reload', click: () => contents.reloadIgnoringCache() },
      );

      Menu.buildFromTemplate(menuItems).popup();
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
