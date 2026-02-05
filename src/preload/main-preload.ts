import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AnnotationData, MainAPI, ShellType, AppSettings } from '../shared/types';

console.log('[Preload] Script starting...');

const mainAPI: MainAPI = {
  createTerminal: (sessionId: string, cwd?: string, shell?: ShellType) => {
    ipcRenderer.send('terminal:create', { sessionId, cwd, shell });
  },

  getPlatform: () => process.platform,

  checkWslAvailable: () => ipcRenderer.invoke('wsl:check'),

  listProjectFiles: (projectPath: string) => ipcRenderer.invoke('project:list-files', { projectPath }),

  destroyTerminal: (sessionId: string) => {
    ipcRenderer.send('terminal:destroy', { sessionId });
  },

  sendTerminalInput: (sessionId: string, data: string) => {
    ipcRenderer.send('terminal:input', { sessionId, data });
  },

  resizeTerminal: (sessionId: string, cols: number, rows: number) => {
    ipcRenderer.send('terminal:resize', { sessionId, cols, rows });
  },

  terminalReady: (sessionId: string) => {
    ipcRenderer.send('terminal:ready', { sessionId });
  },

  sendAnnotation: (data: AnnotationData) => {
    ipcRenderer.send('annotation:send', data);
  },

  onTerminalData: (callback: (sessionId: string, data: string) => void) => {
    ipcRenderer.on('terminal:data', (_, { sessionId, data }) => callback(sessionId, data));
  },

  toggleAnnotateMode: () => {
    ipcRenderer.send('toggle-annotate');
  },

  onAnnotateModeChanged: (callback: (enabled: boolean) => void) => {
    ipcRenderer.on('toggle-annotate', (_, enabled) => callback(enabled));
  },

  showOpenDialog: async () => {
    return ipcRenderer.invoke('dialog:showOpenDialog');
  },

  runCommand: (sessionId: string, command: string) => {
    ipcRenderer.send('terminal:run-command', { sessionId, command });
  },

  onUpdateAvailable: (callback: (info: { version: string; url: string }) => void) => {
    ipcRenderer.on('app:update-available', (_, info) => callback(info));
  },

  onUpdateProgress: (callback: (info: { percent: number; transferred: number; total: number }) => void) => {
    ipcRenderer.on('app:update-progress', (_, info) => callback(info));
  },

  onUpdateDownloaded: (callback: (info: { version: string }) => void) => {
    ipcRenderer.on('app:update-downloaded', (_, info) => callback(info));
  },

  downloadUpdate: () => {
    console.log('[Preload] downloadUpdate called');
    ipcRenderer.send('app:download-update');
  },

  installUpdate: () => {
    ipcRenderer.send('app:install-update');
  },


  openInEditor: (filePath: string, line?: number, column?: number, projectPath?: string) => {
    ipcRenderer.send('editor:open-file', { filePath, line, column, projectPath });
  },

  detectEditors: () => {
    return ipcRenderer.invoke('editor:detect');
  },

  checkUrl: (url: string): Promise<boolean> => {
    return ipcRenderer.invoke('url:check', { url });
  },

  searchAndOpenInEditor: (projectPath: string, info: import('../shared/types').ElementSearchInfo): Promise<{ file: string; line: number } | null> => {
    return ipcRenderer.invoke('vscode:search-element', { projectPath, info });
  },

  getSettings: (): Promise<AppSettings> => {
    return ipcRenderer.invoke('settings:get');
  },

  saveSettings: (settings: Partial<AppSettings>): Promise<AppSettings> => {
    return ipcRenderer.invoke('settings:save', settings);
  },

  getPathForFile: (file: File): string => {
    return webUtils.getPathForFile(file);
  },

  getAppVersion: () => ipcRenderer.invoke('app:version'),
};

contextBridge.exposeInMainWorld('mainAPI', mainAPI);
console.log('[Preload] mainAPI exposed to window');

// Expose settings open listener separately since it needs to work before mainAPI is fully loaded
contextBridge.exposeInMainWorld('onSettingsOpen', (callback: () => void) => {
  ipcRenderer.on('open-settings', () => callback());
});

contextBridge.exposeInMainWorld('onWhatsNewOpen', (callback: () => void) => {
  ipcRenderer.on('open-whats-new', () => callback());
});

contextBridge.exposeInMainWorld('onSendQueuedEdits', (callback: () => void) => {
  ipcRenderer.on('send-queued-edits', () => callback());
});
