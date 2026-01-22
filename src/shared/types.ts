export interface AnnotationData {
  url: string;
  element: {
    tagName: string;
    text?: string;
    attributes?: string;
    selector: string;
  };
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  screenshot?: string; // base64 image data
  request: string;
}

export interface ElementInfo {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  outerHTML: string;
}

export interface IpcChannels {
  // Main -> Renderer
  'terminal:data': string;
  'webview:toggle-annotate': boolean;

  // Renderer -> Main
  'terminal:input': string;
  'terminal:resize': { cols: number; rows: number };
  'annotation:send': AnnotationData;

  // Webview -> Renderer
  'annotation:element-selected': ElementInfo;
}

export interface WebviewAPI {
  sendAnnotation: (data: AnnotationData) => void;
  onToggleAnnotate: (callback: (enabled: boolean) => void) => void;
}

export interface MainAPI {
  sendTerminalInput: (data: string) => void;
  resizeTerminal: (cols: number, rows: number) => void;
  terminalReady: () => void;
  sendAnnotation: (data: AnnotationData) => void;
  onTerminalData: (callback: (data: string) => void) => void;
  toggleAnnotateMode: () => void;
  onAnnotateModeChanged: (callback: (enabled: boolean) => void) => void;
}

declare global {
  interface Window {
    mainAPI: MainAPI;
    webviewAPI: WebviewAPI;
  }
}
