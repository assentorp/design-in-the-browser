import { BrowserWindow, Menu, MenuItemConstructorOptions, app, session } from 'electron';
import { manualCheckForUpdates } from './updater';

export function createMenu(mainWindow: BrowserWindow) {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: `${app.name} v${app.getVersion()}`,
            submenu: [
              { role: 'about' as const },
              {
                label: 'Check for Updates...',
                click: () => manualCheckForUpdates(),
              },
              { type: 'separator' as const },
              {
                label: 'Settings...',
                accelerator: 'CmdOrCtrl+,',
                click: () => {
                  mainWindow.webContents.send('open-settings');
                },
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        ...(!isMac
          ? [
              {
                label: 'Settings...',
                accelerator: 'CmdOrCtrl+,' as const,
                click: () => {
                  mainWindow.webContents.send('open-settings');
                },
              },
              { type: 'separator' as const },
            ]
          : []),
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Toggle Edit Mode',
          click: () => {
            mainWindow.webContents.send('toggle-annotate');
          },
        },
        {
          label: 'Send Queued Edits',
          accelerator: 'CmdOrCtrl+Shift+S',
          // Handled via before-input-event for webview compatibility
          click: () => {
            mainWindow.webContents.send('send-queued-edits');
          },
        },
        {
          label: 'Clear Cache & Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: async () => {
            await session.defaultSession.clearCache();
            mainWindow.webContents.send('clear-cache-and-reload');
          },
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: `Version ${app.getVersion()}`,
          enabled: false,
        },
        { type: 'separator' as const },
        {
          label: "What's New...",
          click: () => {
            mainWindow.webContents.send('open-whats-new');
          },
        },
        { type: 'separator' as const },
        ...(!isMac
          ? [
              {
                label: 'Check for Updates...',
                click: () => manualCheckForUpdates(),
              },
              { type: 'separator' as const },
            ]
          : []),
        {
          label: 'Learn More',
          click: async () => {
            const { shell } = await import('electron');
            shell.openExternal('https://github.com/assentorp/design-in-the-browser');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
