import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AnnotationData, MainAPI, ShellType, AppSettings, ProjectPreset, DesignToken } from '../shared/types';

console.log('[Preload] Script starting...');

const mainAPI: MainAPI = {
  createTerminal: (sessionId: string, cwd?: string, shell?: ShellType) => {
    ipcRenderer.send('terminal:create', { sessionId, cwd, shell });
  },

  getPlatform: () => process.platform,

  checkWslAvailable: () => ipcRenderer.invoke('wsl:check'),

  listProjectFiles: (projectPath: string) => ipcRenderer.invoke('project:list-files', { projectPath }),

  listDesignTokens: (projectPath: string) => ipcRenderer.invoke('project:list-tokens', { projectPath }),

  destroyTerminal: (sessionId: string) => {
    ipcRenderer.send('terminal:destroy', { sessionId });
  },

  sendTerminalInput: (sessionId: string, data: string) => {
    ipcRenderer.send('terminal:input', { sessionId, data });
  },

  pasteImageToTerminal: (sessionId: string, filePath: string): Promise<boolean> => {
    return ipcRenderer.invoke('terminal:paste-image', { sessionId, filePath });
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

  createNewWebpage: (name: string) => {
    return ipcRenderer.invoke('project:create-starter', { name });
  },

  startStaticServer: (projectPath: string): Promise<number> => {
    return ipcRenderer.invoke('static-server:start', { projectPath });
  },

  stopStaticServer: (projectPath: string): Promise<void> => {
    return ipcRenderer.invoke('static-server:stop', { projectPath });
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

  openExternal: (url: string) => {
    ipcRenderer.send('app:open-external', url);
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

  searchAndOpenInEditor: (projectPath: string, info: import('../shared/types').ElementSearchInfo): Promise<{ candidates: import('../shared/types').ElementCandidate[]; confidence?: import('../shared/types').ElementSearchConfidence } | null> => {
    return ipcRenderer.invoke('vscode:search-element', { projectPath, info });
  },

  readProjectFile: (filePath: string, projectPath: string) => {
    return ipcRenderer.invoke('file:read', { filePath, projectPath });
  },

  writeProjectFile: (filePath: string, content: string, projectPath: string) => {
    return ipcRenderer.invoke('file:write', { filePath, content, projectPath });
  },

  getSettings: (): Promise<AppSettings> => {
    return ipcRenderer.invoke('settings:get');
  },

  saveSettings: (settings: Partial<AppSettings>): Promise<AppSettings> => {
    return ipcRenderer.invoke('settings:save', settings);
  },

  getPresets: (): Promise<ProjectPreset[]> => {
    return ipcRenderer.invoke('presets:get');
  },

  savePresets: (presets: ProjectPreset[]): Promise<ProjectPreset[]> => {
    return ipcRenderer.invoke('presets:save', presets);
  },

  getProjectFavicon: (projectPath: string): Promise<string | null> => {
    return ipcRenderer.invoke('project:favicon', { projectPath });
  },

  saveProjectPreview: (projectPath: string, dataUrl: string): Promise<boolean> => {
    return ipcRenderer.invoke('project:save-preview', { projectPath, dataUrl });
  },

  getProjectPreview: (projectPath: string): Promise<string | null> => {
    return ipcRenderer.invoke('project:get-preview', { projectPath });
  },

  deleteProjectPreview: (projectPath: string): Promise<void> => {
    return ipcRenderer.invoke('project:delete-preview', { projectPath });
  },

  getPathForFile: (file: File): string => {
    return webUtils.getPathForFile(file);
  },

  getAppVersion: () => ipcRenderer.invoke('app:version'),

  clearWebviewCache: () => ipcRenderer.invoke('webview:clear-cache'),

  sendAllEdits: () => ipcRenderer.send('webview:send-all'),

  attachDevTools: (targetId: number, bounds: { x: number; y: number; width: number; height: number }): Promise<boolean> => {
    return ipcRenderer.invoke('devtools:attach', { targetId, bounds });
  },

  setDevToolsBounds: (targetId: number, bounds: { x: number; y: number; width: number; height: number }): Promise<void> => {
    return ipcRenderer.invoke('devtools:set-bounds', { targetId, bounds });
  },

  detachDevTools: (targetId: number): Promise<void> => {
    return ipcRenderer.invoke('devtools:detach', { targetId });
  },
};

contextBridge.exposeInMainWorld('mainAPI', mainAPI);
console.log('[Preload] mainAPI exposed to window');

// Each of these channels has a single renderer consumer, but that consumer
// re-registers on every React mount (Browser remounts on each project-tab
// switch) and there is no unsubscribe. Keep exactly one ipcRenderer listener
// per channel and let re-registration REPLACE the callback, so listeners and
// stale closures don't accumulate for the app's lifetime.
function exposeReplaceableListener(globalName: string, channel: string) {
  let current: ((...args: unknown[]) => void) | null = null;
  ipcRenderer.on(channel, (_event, ...args: unknown[]) => current?.(...args));
  contextBridge.exposeInMainWorld(globalName, (callback: (...args: unknown[]) => void) => {
    current = callback;
  });
}

// Settings open listener is exposed separately since it needs to work before mainAPI is fully loaded
exposeReplaceableListener('onSettingsOpen', 'open-settings');
exposeReplaceableListener('onWhatsNewOpen', 'open-whats-new');
exposeReplaceableListener('onSendQueuedEdits', 'send-queued-edits');
exposeReplaceableListener('onToggleAnnotate', 'toggle-annotate');
exposeReplaceableListener('onSwitchTab', 'switch-tab');
exposeReplaceableListener('onClearCacheReload', 'clear-cache-and-reload');
exposeReplaceableListener('onReloadWebview', 'reload-webview');
exposeReplaceableListener('onToggleInspector', 'toggle-inspector');
exposeReplaceableListener('onBlockedNewWindow', 'blocked-new-window');
exposeReplaceableListener('onPaneZoom', 'pane-zoom');
