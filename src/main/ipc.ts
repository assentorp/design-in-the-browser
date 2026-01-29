import { BrowserWindow, ipcMain, app, dialog } from 'electron';
import { downloadUpdate, installUpdate } from './updater';
import * as pty from 'node-pty';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { spawn, exec, type ChildProcess } from 'child_process';
import type { AnnotationData, ShellType } from '../shared/types';
import { getSettings, saveSettings, getScreenshotCleanupMs, type AppSettings } from './settings';

interface SessionState {
  ptyProcess: pty.IPty;
  ready: boolean;
  outputBuffer: string[];
}

const sessions = new Map<string, SessionState>();
const vscodeServers = new Map<string, { process: ChildProcess; port: number }>();
let vscodePortCounter = 4850;

// Convert Windows path to WSL path
function toWslPath(windowsPath: string): string {
  // Convert C:\Users\foo to /mnt/c/Users/foo
  const match = windowsPath.match(/^([a-zA-Z]):\\(.*)$/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
  }
  return windowsPath.replace(/\\/g, '/');
}

export function setupIPC(mainWindow: BrowserWindow) {
  const defaultShell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh';

  // Create a new terminal session
  ipcMain.on('terminal:create', (_, { sessionId, cwd, shell }: { sessionId: string; cwd?: string; shell?: ShellType }) => {
    if (sessions.has(sessionId)) {
      console.log('[IPC] Session already exists:', sessionId);
      return;
    }

    const useWsl = shell === 'wsl' && process.platform === 'win32';
    const shellToUse = useWsl ? 'wsl.exe' : defaultShell;
    const cwdToUse = cwd || process.env.HOME || process.cwd();

    console.log('[IPC] Creating new session:', sessionId, 'cwd:', cwdToUse, 'shell:', shellToUse, 'useWsl:', useWsl);

    // For WSL, we need to convert the Windows path and cd into it
    const shellArgs: string[] = [];
    let wslCwd = cwdToUse;

    if (useWsl && cwd) {
      // Convert Windows path to WSL path
      wslCwd = toWslPath(cwd);
      // Start WSL with bash and cd to the directory
      shellArgs.push('-e', 'bash', '-c', `cd "${wslCwd}" && exec bash`);
    }

    const ptyProcess = pty.spawn(shellToUse, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: useWsl ? undefined : cwdToUse,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    });

    const session: SessionState = {
      ptyProcess,
      ready: false,
      outputBuffer: [],
    };

    sessions.set(sessionId, session);
    console.log('[IPC] PTY process started for session:', sessionId, 'PID:', ptyProcess.pid);

    // Send terminal output to renderer (buffer until ready)
    ptyProcess.onData((data) => {
      const s = sessions.get(sessionId);
      if (!s) return;

      if (s.ready) {
        mainWindow.webContents.send('terminal:data', { sessionId, data });
      } else {
        s.outputBuffer.push(data);
      }
    });

    ptyProcess.onExit(() => {
      console.log('[IPC] PTY process exited for session:', sessionId);
    });
  });

  // Destroy a terminal session
  ipcMain.on('terminal:destroy', (_, { sessionId }: { sessionId: string }) => {
    const session = sessions.get(sessionId);
    if (session) {
      console.log('[IPC] Destroying session:', sessionId);
      session.ptyProcess.kill();
      sessions.delete(sessionId);
    }
  });

  // Handle renderer ready signal
  ipcMain.on('terminal:ready', (_, { sessionId }: { sessionId: string }) => {
    const session = sessions.get(sessionId);
    if (!session) return;

    console.log('[IPC] Renderer ready for session:', sessionId, 'flushing buffer:', session.outputBuffer.length, 'chunks');
    session.ready = true;

    // Flush buffered output
    for (const data of session.outputBuffer) {
      mainWindow.webContents.send('terminal:data', { sessionId, data });
    }
    session.outputBuffer = [];
  });

  // Handle terminal input from renderer
  ipcMain.on('terminal:input', (_, { sessionId, data }: { sessionId: string; data: string }) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.ptyProcess.write(data);
    }
  });

  // Handle terminal resize
  ipcMain.on('terminal:resize', (_, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
    const session = sessions.get(sessionId);
    if (session && cols > 0 && rows > 0) {
      session.ptyProcess.resize(cols, rows);
    }
  });

  // Handle folder picker dialog
  ipcMain.handle('dialog:showOpenDialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // Handle running a command in a terminal
  ipcMain.on('terminal:run-command', (_, { sessionId, command }: { sessionId: string; command: string }) => {
    const session = sessions.get(sessionId);
    if (session) {
      console.log('[IPC] Running command in session:', sessionId, 'command:', command);
      session.ptyProcess.write(command + '\r');
    }
  });

  // Check if a URL is reachable (used for retry logic)
  ipcMain.handle('url:check', async (_, { url: checkUrl }: { url: string }) => {
    return new Promise<boolean>((resolve) => {
      const mod = checkUrl.startsWith('https') ? https : http;
      const req = mod.get(checkUrl, (res) => {
        res.destroy();
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(3000, () => {
        req.destroy();
        resolve(false);
      });
    });
  });

  // Handle annotation submission
  ipcMain.on('annotation:send', async (_, data: AnnotationData) => {
    console.log('[IPC] Received annotation data, sessionId:', data.sessionId, 'terminalTabId:', data.terminalTabId);

    // Find session - use specific terminalTabId if provided, otherwise fallback to finding first match
    let session: SessionState | undefined;

    if (data.terminalTabId) {
      session = sessions.get(data.terminalTabId);
    }

    if (!session) {
      session = sessions.get(data.sessionId);
    }

    if (!session) {
      // Try to find a session that starts with this sessionId (for terminal tabs)
      for (const [key, sess] of sessions) {
        if (key.startsWith(data.sessionId + '-')) {
          session = sess;
          break;
        }
      }
    }
    if (!session) {
      console.log('[IPC] No session found for:', data.sessionId);
      return;
    }

    const tempDir = app.getPath('temp');
    const timestamp = Date.now();

    // Check if this is multi-edit data
    const anyData = data as unknown as { annotations?: MultiEditAnnotation[] };
    if (anyData.annotations && Array.isArray(anyData.annotations)) {
      console.log('[IPC] Processing multi-edit, count:', anyData.annotations.length);

      const screenshotPaths: string[] = [];

      // Save screenshot for each annotation
      for (let i = 0; i < anyData.annotations.length; i++) {
        const ann = anyData.annotations[i];
        if (ann.screenshot) {
          try {
            const screenshotPath = path.join(tempDir, `claude-design-screenshot-${timestamp}-${i}.png`);
            const base64Data = ann.screenshot.replace(/^data:image\/png;base64,/, '');
            fs.writeFileSync(screenshotPath, base64Data, 'base64');
            screenshotPaths.push(screenshotPath);
            console.log('[IPC] Screenshot saved:', screenshotPath);
          } catch (err) {
            console.error('[IPC] Failed to save screenshot:', err);
            screenshotPaths.push('');
          }
        } else {
          screenshotPaths.push('');
        }
      }

      const prompt = formatMultiEditPrompt(anyData.annotations, screenshotPaths);
      session.ptyProcess.write(prompt);
      session.ptyProcess.write('\r');

      // Clean up images after a delay
      const pathsToClean = screenshotPaths.filter(Boolean);
      if (pathsToClean.length > 0) {
        const cleanupDelay = getScreenshotCleanupMs();
        setTimeout(() => {
          for (const p of pathsToClean) {
            try {
              fs.unlinkSync(p);
              console.log('[IPC] Image cleaned up:', p);
            } catch {
              // Ignore cleanup errors
            }
          }
        }, cleanupDelay);
      }
    } else {
      // Single annotation
      let screenshotPath: string | undefined;
      let referenceImagePath: string | undefined;

      // Save screenshot if present
      if (data.screenshot) {
        try {
          screenshotPath = path.join(tempDir, `claude-design-screenshot-${timestamp}.png`);
          const base64Data = data.screenshot.replace(/^data:image\/png;base64,/, '');
          fs.writeFileSync(screenshotPath, base64Data, 'base64');
          console.log('[IPC] Screenshot saved:', screenshotPath);
        } catch (err) {
          console.error('[IPC] Failed to save screenshot:', err);
        }
      }

      // Save reference image if present
      if (data.referenceImage) {
        try {
          const matches = data.referenceImage.match(/^data:image\/(\w+);base64,/);
          const ext = matches ? matches[1] : 'png';
          referenceImagePath = path.join(tempDir, `claude-design-reference-${timestamp}.${ext}`);
          const base64Data = data.referenceImage.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(referenceImagePath, base64Data, 'base64');
          console.log('[IPC] Reference image saved:', referenceImagePath);
        } catch (err) {
          console.error('[IPC] Failed to save reference image:', err);
        }
      }

      const prompt = formatAnnotationPrompt(data, screenshotPath, referenceImagePath);
      session.ptyProcess.write(prompt);
      session.ptyProcess.write('\r');

      // Clean up images after a delay
      const pathsToClean = [screenshotPath, referenceImagePath].filter(Boolean) as string[];
      if (pathsToClean.length > 0) {
        const cleanupDelay = getScreenshotCleanupMs();
        setTimeout(() => {
          for (const p of pathsToClean) {
            try {
              fs.unlinkSync(p);
              console.log('[IPC] Image cleaned up:', p);
            } catch {
              // Ignore cleanup errors
            }
          }
        }, cleanupDelay);
      }
    }
  });

  // Start VS Code serve-web server
  ipcMain.handle('vscode:start', async (_, { projectPath }: { projectPath: string }) => {
    // Kill any existing server first
    const existing = vscodeServers.get('current');
    if (existing) {
      existing.process.kill();
      vscodeServers.delete('current');
    }

    const port = vscodePortCounter++;
    console.log('[IPC] Starting VS Code server on port:', port, 'path:', projectPath);

    return new Promise<number>((resolve, reject) => {
      const proc = spawn('code', [
        'serve-web',
        '--port', String(port),
        '--without-connection-token',
        '--accept-server-license-terms',
      ], {
        cwd: projectPath || undefined,
        env: { ...process.env },
        shell: true,
      });

      let resolved = false;

      proc.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        console.log('[VSCode Server]', output.trim());
        if (!resolved && (output.includes('Web UI available') || output.includes('available at') || output.includes(`localhost:${port}`))) {
          resolved = true;
          vscodeServers.set('current', { process: proc, port });
          resolve(port);
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        console.log('[VSCode Server stderr]', output.trim());
        // VS Code sometimes logs the ready message to stderr
        if (!resolved && (output.includes('Web UI available') || output.includes('available at') || output.includes(`localhost:${port}`))) {
          resolved = true;
          vscodeServers.set('current', { process: proc, port });
          resolve(port);
        }
      });

      proc.on('error', (err) => {
        console.error('[IPC] VS Code server failed to start:', err);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      proc.on('exit', (code) => {
        console.log('[IPC] VS Code server exited with code:', code);
        vscodeServers.delete('current');
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          // Still resolve with the port - server may be ready but didn't log expected message
          vscodeServers.set('current', { process: proc, port });
          resolve(port);
        }
      }, 15000);
    });
  });

  // Stop VS Code server
  ipcMain.handle('vscode:stop', async () => {
    const existing = vscodeServers.get('current');
    if (existing) {
      console.log('[IPC] Stopping VS Code server on port:', existing.port);
      existing.process.kill();
      vscodeServers.delete('current');
    }
  });

  // Open file in VS Code desktop app
  ipcMain.on('vscode:open-file', (_, { filePath, line, column }: { filePath: string; line?: number; column?: number }) => {
    let uri = filePath;
    if (line) {
      uri += `:${line}`;
      if (column) uri += `:${column}`;
    }
    console.log('[IPC] Opening in VS Code:', uri);
    exec(`code --goto "${uri}"`);
  });

  // Search for element in project and open in VS Code
  ipcMain.handle('vscode:search-element', async (_, { projectPath, info }: { projectPath: string; info: { componentNames: string[]; id: string | null; textContent: string; dataAttrs: Record<string, string>; pageUrl: string } }) => {
    const excludeDirs = ['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output', 'coverage', '.cache'];
    const excludeArgs = excludeDirs.flatMap(d => ['--exclude-dir', d]);
    const includeArgs = ['--include=*.tsx', '--include=*.jsx', '--include=*.ts', '--include=*.js',
                         '--include=*.vue', '--include=*.svelte'];

    console.log('[IPC] Searching for element:', {
      componentNames: info.componentNames?.slice(0, 5),
      id: info.id,
      text: (info.textContent || '').substring(0, 40),
      dataAttrs: info.dataAttrs,
      pageUrl: info.pageUrl,
    });

    // Helper: run grep and return matches
    function grepAll(pattern: string, maxResults = 10): Promise<{ file: string; line: number }[]> {
      return new Promise((resolve) => {
        const grep = spawn('grep', [
          '-rn', '-E', ...includeArgs, ...excludeArgs, '-m', String(maxResults),
          pattern, projectPath,
        ], { shell: false });

        let output = '';
        let resolved = false;
        grep.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
        grep.on('close', () => {
          if (resolved) return;
          resolved = true;
          const results: { file: string; line: number }[] = [];
          for (const line of output.trim().split('\n')) {
            if (!line) continue;
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) continue;
            const file = line.substring(0, colonIdx);
            const rest = line.substring(colonIdx + 1);
            const lineNum = parseInt(rest.split(':')[0], 10);
            if (!isNaN(lineNum)) results.push({ file, line: lineNum });
          }
          resolve(results);
        });
        grep.on('error', () => { if (!resolved) { resolved = true; resolve([]); } });
        setTimeout(() => { if (!resolved) { resolved = true; grep.kill(); resolve([]); } }, 5000);
      });
    }

    function openResult(result: { file: string; line: number }, strategy: string): { file: string; line: number } {
      console.log(`[IPC] Found element via ${strategy}:`, `${result.file}:${result.line}`);
      return result;
    }

    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Strategy 1: React component name → find its definition file
    // The closest component in the fiber tree is the one that renders this element
    for (const name of (info.componentNames || []).slice(0, 5)) {
      // Search for component definition: function Name, const Name, export default Name, etc.
      const pattern = `(function|const|let|var|export default|export)\\s+${esc(name)}`;
      const results = await grepAll(pattern, 5);
      if (results.length === 1) return openResult(results[0], `component "${name}"`);
      if (results.length > 1) {
        // Prefer files whose name matches the component name
        const byFilename = results.find(r => {
          const base = path.basename(r.file).replace(/\.(tsx?|jsx?|vue|svelte)$/, '');
          return base === name || base === name.replace(/^[a-z]/, c => c.toUpperCase());
        });
        if (byFilename) return openResult(byFilename, `component "${name}" (filename match)`);
        // Otherwise use first result
        return openResult(results[0], `component "${name}"`);
      }
    }

    // Strategy 2: data-testid or data-component
    for (const [attr, value] of Object.entries(info.dataAttrs || {})) {
      if (!value) continue;
      const results = await grepAll(`${esc(attr)}=.*${esc(value)}`, 3);
      if (results.length > 0) return openResult(results[0], `data attr ${attr}="${value}"`);
    }

    // Strategy 3: Search by id
    if (info.id) {
      const results = await grepAll(`id=["'{].*${esc(info.id)}`, 3);
      if (results.length > 0) return openResult(results[0], `id="${info.id}"`);
    }

    // Strategy 4: Search for text content in source
    if (info.textContent) {
      const fullText = info.textContent.trim();

      // Try the full text first (short texts like "$69/mo")
      if (fullText.length >= 3 && fullText.length <= 60) {
        const results = await grepAll(esc(fullText), 3);
        if (results.length > 0) return openResult(results[0], `text "${fullText.substring(0, 30)}"`);
      }

      // Try first 40 chars (for longer texts)
      if (fullText.length > 10) {
        const sub = fullText.substring(0, 40);
        const results = await grepAll(esc(sub), 3);
        if (results.length > 0) return openResult(results[0], `text "${sub.substring(0, 30)}..."`);
      }

      // Try splitting into words and searching for distinctive multi-word phrases
      const words = fullText.split(/\s+/).filter(w => w.length >= 3);
      // Try pairs of consecutive words
      for (let i = 0; i < Math.min(words.length - 1, 5); i++) {
        const phrase = words[i] + '.*' + esc(words[i + 1]);
        const results = await grepAll(phrase, 3);
        if (results.length > 0) return openResult(results[0], `phrase "${words[i]} ${words[i + 1]}"`);
      }
      // Try individual distinctive words (skip common ones)
      const commonWords = /^(the|and|or|a|an|is|are|was|were|be|to|of|in|for|on|with|at|by|from|this|that|our|your|you|we|all|can|get|has|have|not|but|its|more|out|than|them|then|way|will|about|also|been|come|each|just|like|make|many|most|new|now|only|other|over|some|such|take|time|very|when|who|how|per|into|one|two|Start|Free|Pro|Plan)$/i;
      for (const word of words.slice(0, 8)) {
        if (word.length < 5 || commonWords.test(word)) continue;
        const results = await grepAll(esc(word), 5);
        if (results.length === 1) return openResult(results[0], `word "${word}"`);
      }
    }

    // Strategy 5: Fallback — find page file from URL path (e.g. /pricing → src/app/pricing/page.tsx)
    if (info.pageUrl) {
      const urlPath = info.pageUrl.replace(/\/$/, '') || '/';
      // Common framework page file patterns
      const candidates = [
        path.join(projectPath, 'src', 'app', urlPath, 'page.tsx'),
        path.join(projectPath, 'src', 'app', urlPath, 'page.jsx'),
        path.join(projectPath, 'src', 'app', urlPath, 'page.ts'),
        path.join(projectPath, 'src', 'app', urlPath, 'page.js'),
        path.join(projectPath, 'src', 'pages', urlPath + '.tsx'),
        path.join(projectPath, 'src', 'pages', urlPath + '.jsx'),
        path.join(projectPath, 'src', 'pages', urlPath, 'index.tsx'),
        path.join(projectPath, 'src', 'pages', urlPath, 'index.jsx'),
        path.join(projectPath, 'app', urlPath, 'page.tsx'),
        path.join(projectPath, 'pages', urlPath + '.tsx'),
        path.join(projectPath, 'pages', urlPath, 'index.tsx'),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return openResult({ file: candidate, line: 1 }, `URL path "${urlPath}"`);
        }
      }
      // Also try route groups: src/app/(group)/urlPath/page.tsx
      const urlSegments = urlPath.split('/').filter(Boolean);
      if (urlSegments.length > 0) {
        const appDir = path.join(projectPath, 'src', 'app');
        if (fs.existsSync(appDir)) {
          try {
            const entries = fs.readdirSync(appDir);
            for (const entry of entries) {
              if (entry.startsWith('(') && entry.endsWith(')')) {
                const candidate = path.join(appDir, entry, ...urlSegments, 'page.tsx');
                if (fs.existsSync(candidate)) {
                  return openResult({ file: candidate, line: 1 }, `route group "${entry}/${urlPath}"`);
                }
              }
            }
          } catch { /* ignore */ }
        }
      }
    }

    console.log('[IPC] Could not find element source');
    return null;
  });

  // Get app settings
  ipcMain.handle('settings:get', () => {
    return getSettings();
  });

  // Save app settings
  ipcMain.handle('settings:save', (_, settings: Partial<AppSettings>) => {
    return saveSettings(settings);
  });

  // Check if WSL is available on Windows
  ipcMain.handle('wsl:check', async () => {
    if (process.platform !== 'win32') {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      exec('wsl --status', (error) => {
        resolve(!error);
      });
    });
  });

  // Handle update download request
  ipcMain.on('app:download-update', () => {
    console.log('[IPC] Download update requested');
    downloadUpdate();
  });

  // Handle update install request
  ipcMain.on('app:install-update', () => {
    console.log('[IPC] Install update requested');
    installUpdate();
  });

  // Clean up on window close
  mainWindow.on('closed', () => {
    for (const [sessionId, session] of sessions) {
      console.log('[IPC] Cleaning up session:', sessionId);
      session.ptyProcess.kill();
    }
    sessions.clear();

    // Kill all VS Code servers
    for (const [key, server] of vscodeServers) {
      console.log('[IPC] Killing VS Code server:', key);
      server.process.kill();
    }
    vscodeServers.clear();
  });
}

function formatAnnotationPrompt(data: AnnotationData, screenshotPath?: string, referenceImagePath?: string): string {
  const { element, request, selectedText, elements } = data;

  let prompt: string;

  // Handle text selection annotations
  if (selectedText) {
    // Format: "simpl": Fix typo
    prompt = `"${selectedText}": ${request}`;
  }
  // Handle multi-select annotations
  else if (elements && elements.length > 1) {
    // Format: <button.nav-link>, <button.nav-link>, <button.nav-link>: Add hover effect
    const displaySelectors = elements.map(e => e.displaySelector || `<${e.tagName}>`).join(', ');
    prompt = `${displaySelectors}: ${request}`;
  }
  // Handle single element annotations
  else {
    // Include text and attributes for faster grepping
    const parts = [`<${element.tagName}>`];
    if (element.text) parts.push(`"${element.text}"`);
    if (element.attributes) parts.push(`[${element.attributes}]`);
    prompt = `${parts.join(' ')}: ${request}`;
  }

  // Add screenshot path for Claude to read
  if (screenshotPath) {
    prompt += ` (see element screenshot: ${screenshotPath})`;
  }

  // Add reference image path for Claude to read
  if (referenceImagePath) {
    prompt += ` (see reference image: ${referenceImagePath})`;
  }

  return prompt;
}

interface MultiEditAnnotation {
  selector: string;
  tagName: string;
  text?: string;
  attributes?: string;
  note: string;
  screenshot?: string;
}

function formatMultiEditPrompt(annotations: MultiEditAnnotation[], screenshotPaths: string[]): string {
  const parts: string[] = [];

  for (let i = 0; i < annotations.length; i++) {
    const ann = annotations[i];
    const screenshot = screenshotPaths[i];

    // Format: <tagName> "text": note (see screenshot: path)
    let line = `<${ann.tagName}>`;
    if (ann.text) line += ` "${ann.text}"`;
    line += `: ${ann.note}`;
    if (screenshot) line += ` (see screenshot: ${screenshot})`;

    parts.push(line);
  }

  return parts.join('\n');
}
