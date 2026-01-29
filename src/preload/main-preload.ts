import { contextBridge, ipcRenderer } from 'electron';
import type { AnnotationData, MainAPI, ShellType } from '../shared/types';

console.log('[Preload] Script starting...');

const mainAPI: MainAPI = {
  createTerminal: (sessionId: string, cwd?: string, shell?: ShellType) => {
    ipcRenderer.send('terminal:create', { sessionId, cwd, shell });
  },

  getPlatform: () => process.platform,

  checkWslAvailable: () => ipcRenderer.invoke('wsl:check'),

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
    ipcRenderer.send('app:download-update');
  },

  installUpdate: () => {
    ipcRenderer.send('app:install-update');
  },

  startVSCodeServer: (projectPath: string) => {
    return ipcRenderer.invoke('vscode:start', { projectPath });
  },

  stopVSCodeServer: () => {
    return ipcRenderer.invoke('vscode:stop');
  },

  openInVSCode: (filePath: string, line?: number, column?: number) => {
    ipcRenderer.send('vscode:open-file', { filePath, line, column });
  },

  checkUrl: (url: string): Promise<boolean> => {
    return ipcRenderer.invoke('url:check', { url });
  },

  searchAndOpenInVSCode: (projectPath: string, info: import('../shared/types').ElementSearchInfo): Promise<{ file: string; line: number } | null> => {
    return ipcRenderer.invoke('vscode:search-element', { projectPath, info });
  },
};

contextBridge.exposeInMainWorld('mainAPI', mainAPI);
console.log('[Preload] mainAPI exposed to window');
