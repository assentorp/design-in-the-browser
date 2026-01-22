import { contextBridge, ipcRenderer } from 'electron';
import type { AnnotationData, MainAPI } from '../shared/types';

console.log('[Preload] Script starting...');

const mainAPI: MainAPI = {
  sendTerminalInput: (data: string) => {
    ipcRenderer.send('terminal:input', data);
  },

  resizeTerminal: (cols: number, rows: number) => {
    ipcRenderer.send('terminal:resize', { cols, rows });
  },

  terminalReady: () => {
    ipcRenderer.send('terminal:ready');
  },

  sendAnnotation: (data: AnnotationData) => {
    ipcRenderer.send('annotation:send', data);
  },

  onTerminalData: (callback: (data: string) => void) => {
    ipcRenderer.on('terminal:data', (_, data) => callback(data));
  },

  toggleAnnotateMode: () => {
    ipcRenderer.send('toggle-annotate');
  },

  onAnnotateModeChanged: (callback: (enabled: boolean) => void) => {
    ipcRenderer.on('toggle-annotate', (_, enabled) => callback(enabled));
  },
};

contextBridge.exposeInMainWorld('mainAPI', mainAPI);
console.log('[Preload] mainAPI exposed to window');
