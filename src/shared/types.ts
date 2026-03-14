export interface AnnotationElement {
  tagName: string;
  text?: string;
  attributes?: string;
  selector: string;
  displaySelector?: string;
  screenshot?: string; // base64 image data for individual element
}

export interface MultiEditAnnotation {
  selector: string;
  tagName: string;
  text?: string;
  attributes?: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  note: string;
  screenshot?: string; // base64 image data
}

export interface MultiEditData {
  url: string;
  sessionId: string;
  terminalTabId?: string;
  annotations: MultiEditAnnotation[];
}

export interface AnnotationData {
  url: string;
  sessionId: string;
  terminalTabId?: string;
  element: AnnotationElement;
  // For multi-select: array of all selected elements
  elements?: AnnotationElement[];
  // For text selection: the selected text string
  selectedText?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  screenshot?: string; // base64 image data
  referenceImage?: string; // base64 image data for user-provided reference
  request: string;
}

export interface TerminalTab {
  id: string;
  name: string;
}

export interface SessionPendingEdit {
  note: string;
  selector: string;
  tagName?: string;
  text?: string;
  attributes?: string;
}

export interface Session {
  id: string;
  name: string;
  projectPath: string;
  startCommand: string;
  browserWidth: number;
  terminalCollapsed: boolean;
  url: string;
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string;
  terminalTabCounter: number;
  devServerTabId: string | null;
  cliToolTabId: string | null;
  cliTool: CliTool | null;
  cliToolRunning: boolean;
  shell: ShellType;
  pendingEdits: SessionPendingEdit[];
  presetId?: string;
}

export interface PersistedSession {
  presetId: string;
  url: string;
  browserWidth: number;
  terminalCollapsed: boolean;
  terminalTabNames: string[];
}

export interface PersistedSessionState {
  sessions: PersistedSession[];
  activeSessionIndex: number;
  sessionCounter: number;
}

export type CliTool = 'claude' | 'cursor' | 'gemini' | 'codex';

export type ShellType = 'default' | 'wsl';

export type CodeEditor = 'vscode' | 'cursor' | 'zed' | 'sublime' | 'webstorm' | 'nova';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface AppSettings {
  screenshotCleanupMinutes: number;
  editor: CodeEditor;
  editorChosen: boolean;
  analyticsEnabled: boolean;
  analyticsConsentGiven: boolean;
  onboardingCompleted: boolean;
  discordDismissed: boolean;
  windowBounds?: WindowBounds;
  browserWidthPercent?: number;
}

export interface ProjectPreset {
  id: string;
  name: string;
  path: string;
  startCommand: string;
  url: string;
  cliTool: CliTool;
  shell?: ShellType;
  claudeModel?: string;
  dangerouslySkipPermissions?: boolean;
  lastOpenedAt?: number;
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
  'terminal:data': { sessionId: string; data: string };
  'webview:toggle-annotate': boolean;

  // Renderer -> Main
  'terminal:input': { sessionId: string; data: string };
  'terminal:resize': { sessionId: string; cols: number; rows: number };
  'terminal:create': { sessionId: string };
  'terminal:destroy': { sessionId: string };
  'annotation:send': AnnotationData;

  // Webview -> Renderer
  'annotation:element-selected': ElementInfo;
}

export interface WebviewAPI {
  sendAnnotation: (data: AnnotationData) => void;
  onToggleAnnotate: (callback: (enabled: boolean) => void) => void;
}

export interface ProjectFile {
  name: string;
  dir: string;
}

export interface DesignToken {
  name: string;
  value: string;
  category: string;
  source: 'tailwind' | 'css-var';
}

export interface MainAPI {
  createTerminal: (sessionId: string, cwd?: string, shell?: ShellType) => void;
  getPlatform: () => string;
  checkWslAvailable: () => Promise<boolean>;
  listProjectFiles: (projectPath: string) => Promise<ProjectFile[]>;
  listDesignTokens: (projectPath: string) => Promise<DesignToken[]>;
  destroyTerminal: (sessionId: string) => void;
  sendTerminalInput: (sessionId: string, data: string) => void;
  resizeTerminal: (sessionId: string, cols: number, rows: number) => void;
  terminalReady: (sessionId: string) => void;
  sendAnnotation: (data: AnnotationData) => void;
  onTerminalData: (callback: (sessionId: string, data: string) => void) => void;
  toggleAnnotateMode: () => void;
  onAnnotateModeChanged: (callback: (enabled: boolean) => void) => void;
  showOpenDialog: () => Promise<string | null>;
  runCommand: (sessionId: string, command: string) => void;
  onUpdateAvailable: (callback: (info: { version: string; url: string }) => void) => void;
  onUpdateProgress: (callback: (info: { percent: number; transferred: number; total: number }) => void) => void;
  onUpdateDownloaded: (callback: (info: { version: string }) => void) => void;
  downloadUpdate: () => void;
  installUpdate: () => void;
  openInEditor: (filePath: string, line?: number, column?: number, projectPath?: string) => void;
  detectEditors: () => Promise<CodeEditor[]>;
  checkUrl: (url: string) => Promise<boolean>;
  searchAndOpenInEditor: (projectPath: string, info: ElementSearchInfo) => Promise<{ file: string; line: number } | null>;
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  getPresets: () => Promise<ProjectPreset[]>;
  savePresets: (presets: ProjectPreset[]) => Promise<ProjectPreset[]>;
  getPathForFile: (file: File) => string;
  getAppVersion: () => Promise<string>;
  clearWebviewCache: () => Promise<void>;
  sendAllEdits: () => void;
  getSessionState: () => Promise<PersistedSessionState | null>;
  saveSessionState: (state: PersistedSessionState) => Promise<void>;
}

export interface ElementSearchInfo {
  componentNames: string[];
  id: string | null;
  textContent: string;
  dataAttrs: Record<string, string>;
  pageUrl: string;
}

declare global {
  interface Window {
    mainAPI: MainAPI;
    webviewAPI: WebviewAPI;
  }
}
