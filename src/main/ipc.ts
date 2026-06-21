import { BrowserWindow, ipcMain, app, dialog, session, webContents as webContentsModule, WebContentsView, clipboard, nativeImage } from 'electron';
import { downloadUpdate, installUpdate } from './updater';
import * as pty from 'node-pty';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { spawn, exec, type ChildProcess } from 'child_process';
import type { AnnotationData, ShellType, CodeEditor } from '../shared/types';
import { formatAnnotationPrompt, formatMultiEditPrompt, type MultiEditAnnotation } from '../shared/format-prompt';
import { getSettings, saveSettings, getScreenshotCleanupMs, type AppSettings } from './settings';
import { getPresets, savePresets } from './presets';
import { getDesignTokens } from './tailwind-tokens';

// Max buffered output chunks before renderer signals ready (~5MB worth)
const MAX_OUTPUT_BUFFER = 1000;

// Blank starter page used by Starter Project. Intentionally empty — a single
// centered prompt invites the user to click and describe what to build.
// Self-contained: inline styles, no external assets. __PROJECT_NAME__ is
// replaced at write time.
const STARTER_PROJECT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>__PROJECT_NAME__</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
      color: #0f172a;
      background: #ffffff;
      -webkit-font-smoothing: antialiased;
      min-height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 32px;
    }
    .canvas { max-width: 520px; }
    h1 {
      font-size: clamp(26px, 4vw, 36px);
      line-height: 1.15;
      letter-spacing: -0.02em;
      margin: 0 0 14px;
    }
    p {
      font-size: 17px;
      line-height: 1.6;
      color: #64748b;
      margin: 0 auto;
      max-width: 420px;
    }
  </style>
</head>
<body>
  <main class="canvas">
    <h1>This is your blank canvas.</h1>
    <p>Click anywhere on the page and tell the AI what you'd like here.</p>
  </main>
</body>
</html>
`;

interface SessionState {
  ptyProcess: pty.IPty;
  ready: boolean;
  outputBuffer: string[];
  disposables: { dispose: () => void }[];
  // True once the PTY has emitted any output — used as a signal that shell
  // init is far enough along to accept typed commands without dropping the
  // first character (e.g. .zshrc banners or screen clears stomping the echo).
  shellPromptSeen: boolean;
}

const sessions = new Map<string, SessionState>();
const vscodeServers = new Map<string, { process: ChildProcess; port: number; projectPath: string }>();
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

    // Spawn as login shell so .zprofile/.zshrc/.bash_profile are sourced
    // (critical for PATH, SSH_AUTH_SOCK, nvm, homebrew, git credentials, MCP tools)
    const shellArgs: string[] = [];
    let wslCwd = cwdToUse;

    if (useWsl && cwd) {
      // Convert Windows path to WSL path
      wslCwd = toWslPath(cwd);
      // Start WSL with bash and cd to the directory
      shellArgs.push('-e', 'bash', '-c', `cd "${wslCwd}" && exec bash`);
    } else if (!useWsl && process.platform !== 'win32') {
      // Login shell flag for zsh/bash on macOS/Linux. PowerShell doesn't
      // understand `-l` and would exit immediately with a parse error.
      shellArgs.push('-l');
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
      disposables: [],
      shellPromptSeen: false,
    };

    sessions.set(sessionId, session);
    console.log('[IPC] PTY process started for session:', sessionId, 'PID:', ptyProcess.pid);

    // Send terminal output to renderer (buffer until ready, with cap)
    const dataDisposable = ptyProcess.onData((data) => {
      const s = sessions.get(sessionId);
      if (!s) return;

      s.shellPromptSeen = true;

      if (s.ready) {
        if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
        mainWindow.webContents.send('terminal:data', { sessionId, data });
      } else {
        if (s.outputBuffer.length < MAX_OUTPUT_BUFFER) {
          s.outputBuffer.push(data);
        }
        // Drop data beyond the cap — renderer will get what's available when it signals ready
      }
    });

    const exitDisposable = ptyProcess.onExit(() => {
      console.log('[IPC] PTY process exited for session:', sessionId);
      const s = sessions.get(sessionId);
      if (!s) return;
      for (const d of s.disposables) d.dispose();
      s.disposables.length = 0;
      s.outputBuffer.length = 0;
      sessions.delete(sessionId);
    });

    session.disposables.push(dataDisposable, exitDisposable);
  });

  // Destroy a terminal session
  ipcMain.on('terminal:destroy', (_, { sessionId }: { sessionId: string }) => {
    const session = sessions.get(sessionId);
    if (session) {
      console.log('[IPC] Destroying session:', sessionId);
      for (const d of session.disposables) d.dispose();
      session.disposables.length = 0;
      session.outputBuffer.length = 0;
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
    if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      for (const data of session.outputBuffer) {
        mainWindow.webContents.send('terminal:data', { sessionId, data });
      }
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

  // Handle image paste into terminal.
  //
  // CLI tools (Claude Code, Cursor, Gemini) only render an attached image
  // (e.g. "[Image #1]") when they receive actual image data from the OS
  // clipboard, triggered by Ctrl+V. Pasting a file path as text — what a plain
  // drag-and-drop does — just inserts the literal path. So for dropped image
  // files we load the image, write it to the OS clipboard, and send Ctrl+V
  // (0x16) to the PTY so the CLI reads the clipboard and attaches the image.
  ipcMain.handle('terminal:paste-image', (_, { sessionId, filePath }: { sessionId: string; filePath: string }) => {
    const session = sessions.get(sessionId);
    if (!session) return false;
    try {
      const image = nativeImage.createFromPath(filePath);
      if (image.isEmpty()) return false;
      clipboard.writeImage(image);
      session.ptyProcess.write('\x16'); // Ctrl+V
      return true;
    } catch (err) {
      console.warn('[IPC] terminal:paste-image failed for', filePath, err instanceof Error ? err.message : err);
      return false;
    }
  });

  // Handle terminal resize
  ipcMain.on('terminal:resize', (_, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
    const session = sessions.get(sessionId);
    if (!session || cols <= 0 || rows <= 0) return;
    try {
      session.ptyProcess.resize(cols, rows);
    } catch (err) {
      // node-pty throws on Windows if the PTY exited between the renderer
      // sending resize and us handling it. Safe to ignore — onExit will
      // clean up the session shortly.
      console.warn('[IPC] terminal:resize ignored for', sessionId, err instanceof Error ? err.message : err);
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

  // Tiny static HTTP server used by Starter Projects so file-relative URLs,
  // ES modules, fetch(), service workers, etc. all work. Keyed by projectPath
  // with a refcount so multiple sessions on the same folder share one server.
  // Also watches the project tree and broadcasts a "reload" SSE event to all
  // connected pages whenever a file changes (e.g. when Claude Code edits a
  // file), so the browser refreshes automatically.
  interface StaticServerEntry {
    server: http.Server;
    port: number;
    refCount: number;
    watcher: fs.FSWatcher | null;
    clients: Set<http.ServerResponse>;
    notifyTimer: NodeJS.Timeout | null;
  }
  const staticServers = new Map<string, StaticServerEntry>();

  const STATIC_MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm':  'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
    '.otf':  'font/otf',
    '.txt':  'text/plain; charset=utf-8',
    '.md':   'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
  };

  // Paths we never want to trigger a reload for (build output, VCS, deps).
  const WATCH_IGNORE = /(^|[\\/])(node_modules|\.git|dist|build|\.next|\.nuxt|\.output|\.cache|\.turbo|\.vercel|\.svelte-kit|\.DS_Store)([\\/]|$)/;

  // Injected into every served HTML response. Opens an EventSource to the
  // server's /__reload endpoint and triggers a full reload on the "reload"
  // event. Wrapped in try/catch so a broken EventSource never breaks the page.
  const RELOAD_SCRIPT = `
<script>(function(){try{var es=new EventSource('/__reload');es.addEventListener('reload',function(){location.reload();});}catch(e){}})();</script>
`;

  function injectReloadScript(html: Buffer): Buffer {
    const text = html.toString('utf8');
    const lower = text.toLowerCase();
    const idx = lower.lastIndexOf('</body>');
    const injected = idx >= 0
      ? text.slice(0, idx) + RELOAD_SCRIPT + text.slice(idx)
      : text + RELOAD_SCRIPT;
    return Buffer.from(injected, 'utf8');
  }

  function broadcastReload(entry: StaticServerEntry) {
    for (const client of entry.clients) {
      try { client.write('event: reload\ndata: {}\n\n'); }
      catch { /* will be cleaned up on next 'close' */ }
    }
  }

  function createStaticServer(projectPath: string, getEntry: () => StaticServerEntry | undefined): http.Server {
    const root = path.resolve(projectPath);
    return http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

        // SSE reload channel — keep the response open and register the client.
        if (urlPath === '/__reload') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          res.write(': connected\n\n');
          const entry = getEntry();
          if (!entry) { res.end(); return; }
          entry.clients.add(res);
          // Keep-alive ping every 25s so intermediaries don't drop the stream.
          const ping = setInterval(() => {
            try { res.write(': ping\n\n'); } catch { /* ignore */ }
          }, 25_000);
          req.on('close', () => {
            clearInterval(ping);
            entry.clients.delete(res);
          });
          return;
        }

        let rel = urlPath.replace(/^\/+/, '');
        let target = path.resolve(root, rel);

        // Reject path traversal — must stay inside project root.
        if (target !== root && !target.startsWith(root + path.sep)) {
          res.writeHead(403); res.end('Forbidden'); return;
        }

        let stat: fs.Stats;
        try { stat = fs.statSync(target); }
        catch { res.writeHead(404); res.end('Not found'); return; }

        if (stat.isDirectory()) {
          // Redirect /foo → /foo/ so relative links resolve correctly.
          if (!urlPath.endsWith('/')) {
            res.writeHead(301, { Location: urlPath + '/' });
            res.end();
            return;
          }
          target = path.join(target, 'index.html');
          try { stat = fs.statSync(target); }
          catch { res.writeHead(404); res.end('Not found'); return; }
        }

        const ext = path.extname(target).toLowerCase();
        const contentType = STATIC_MIME[ext] || 'application/octet-stream';

        // For HTML, read into memory and inject the reload script so the page
        // refreshes when project files change. For everything else, stream.
        if (ext === '.html' || ext === '.htm') {
          const body = injectReloadScript(fs.readFileSync(target));
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': body.length,
            'Cache-Control': 'no-store',
          });
          res.end(body);
          return;
        }

        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stat.size,
          'Cache-Control': 'no-store',
        });
        fs.createReadStream(target).pipe(res);
      } catch (err) {
        console.error('[StaticServer] error:', err);
        if (!res.headersSent) res.writeHead(500);
        res.end('Server error');
      }
    });
  }

  function startWatcher(root: string, entry: StaticServerEntry): fs.FSWatcher | null {
    try {
      const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (filename && WATCH_IGNORE.test(filename.toString())) return;
        // Coalesce rapid bursts (editors often emit multiple events per save).
        if (entry.notifyTimer) clearTimeout(entry.notifyTimer);
        entry.notifyTimer = setTimeout(() => {
          entry.notifyTimer = null;
          broadcastReload(entry);
        }, 80);
      });
      watcher.on('error', (err) => console.error('[StaticServer] watcher error:', err));
      return watcher;
    } catch (err) {
      // Recursive fs.watch isn't supported on every platform/Node combo.
      // Fall back to no hot-reload rather than failing the whole server.
      console.warn('[StaticServer] file watcher unavailable, hot reload disabled:', err);
      return null;
    }
  }

  ipcMain.handle('static-server:start', async (_, { projectPath }: { projectPath: string }) => {
    const key = path.resolve(projectPath);
    const existing = staticServers.get(key);
    if (existing) {
      existing.refCount += 1;
      return existing.port;
    }

    const entry: StaticServerEntry = {
      server: null as unknown as http.Server,
      port: 0,
      refCount: 1,
      watcher: null,
      clients: new Set(),
      notifyTimer: null,
    };
    entry.server = createStaticServer(key, () => staticServers.get(key));

    const port: number = await new Promise((resolve, reject) => {
      entry.server.once('error', reject);
      // 127.0.0.1 (not 0.0.0.0) so the dev server is never exposed on the LAN.
      entry.server.listen(0, '127.0.0.1', () => {
        const addr = entry.server.address();
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('Failed to obtain server port'));
      });
    });
    entry.port = port;
    entry.watcher = startWatcher(key, entry);

    staticServers.set(key, entry);
    console.log('[StaticServer] started, port:', port, 'path:', key, 'hot-reload:', entry.watcher ? 'on' : 'off');
    return port;
  });

  ipcMain.handle('static-server:stop', async (_, { projectPath }: { projectPath: string }) => {
    const key = path.resolve(projectPath);
    const entry = staticServers.get(key);
    if (!entry) return;
    entry.refCount -= 1;
    if (entry.refCount > 0) return;
    console.log('[StaticServer] stopping, port:', entry.port, 'path:', key);
    if (entry.notifyTimer) clearTimeout(entry.notifyTimer);
    entry.watcher?.close();
    for (const client of entry.clients) {
      try { client.end(); } catch { /* ignore */ }
    }
    entry.clients.clear();
    entry.server.close();
    staticServers.delete(key);
  });

  // Starter Project: pick a parent dir, write a boilerplate index.html.
  // Returns { path } on success, { cancelled: true } if the user closed the
  // folder picker, or throws if the target folder already exists.
  ipcMain.handle('project:create-starter', async (_, { name }: { name: string }) => {
    const safeName = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/^\.+/, '');
    if (!safeName) throw new Error('Invalid project name');

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose where to create the project folder',
      buttonLabel: 'Create Here',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true as const };
    }

    const parentDir = result.filePaths[0];
    const projectPath = path.join(parentDir, safeName);
    if (fs.existsSync(projectPath)) {
      throw new Error(`A folder named "${safeName}" already exists in ${parentDir}`);
    }

    fs.mkdirSync(projectPath, { recursive: true });
    fs.writeFileSync(path.join(projectPath, 'index.html'), STARTER_PROJECT_HTML.replace(/__PROJECT_NAME__/g, safeName), 'utf8');
    return { path: projectPath };
  });

  // Handle running a command in a terminal. We defer the write until the
  // shell has produced its first output (a sign that .zshrc has finished
  // sourcing and the prompt has been drawn) plus a short stabilisation
  // delay, otherwise a banner or screen-clear from shell init can eat the
  // first character of the typed command (e.g. "laude" instead of "claude").
  ipcMain.on('terminal:run-command', (_, { sessionId, command }: { sessionId: string; command: string }) => {
    const session = sessions.get(sessionId);
    if (!session) return;

    const STABILISE_MS = 300;
    const POLL_MS = 50;
    const MAX_WAIT_MS = 3000;

    const write = () => {
      const s = sessions.get(sessionId);
      if (!s) return;
      console.log('[IPC] Running command in session:', sessionId, 'command:', command);
      s.ptyProcess.write(command + '\r');
    };

    if (session.shellPromptSeen) {
      setTimeout(write, STABILISE_MS);
      return;
    }

    const startedAt = Date.now();
    const poll = setInterval(() => {
      const s = sessions.get(sessionId);
      if (!s) {
        clearInterval(poll);
        return;
      }
      if (s.shellPromptSeen || Date.now() - startedAt >= MAX_WAIT_MS) {
        clearInterval(poll);
        setTimeout(write, STABILISE_MS);
      }
    }, POLL_MS);
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

    const screenshotDir = app.getPath('temp');
    const timestamp = Date.now();

    // Check if this is multi-edit data
    const anyData = data as unknown as { annotations?: MultiEditAnnotation[] };
    if (anyData.annotations && Array.isArray(anyData.annotations)) {
      console.log('[IPC] Processing multi-edit, count:', anyData.annotations.length);

      const screenshotPaths: string[] = [];

      // Save screenshot for each annotation, then release base64 from memory
      for (let i = 0; i < anyData.annotations.length; i++) {
        const ann = anyData.annotations[i];
        if (ann.screenshot) {
          try {
            const screenshotPath = path.join(screenshotDir, `claude-design-screenshot-${timestamp}-${i}.png`);
            const base64Data = ann.screenshot.replace(/^data:image\/png;base64,/, '');
            fs.writeFileSync(screenshotPath, base64Data, 'base64');
            screenshotPaths.push(screenshotPath);
            console.log('[IPC] Screenshot saved:', screenshotPath);
          } catch (err) {
            console.error('[IPC] Failed to save screenshot:', err);
            screenshotPaths.push('');
          }
          ann.screenshot = '';  // Release base64 string from memory
        } else {
          screenshotPaths.push('');
        }
      }

      const prompt = formatMultiEditPrompt(anyData.annotations, screenshotPaths);
      session.ptyProcess.write(prompt);
      setTimeout(() => session.ptyProcess.write('\r'), 100);

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

      // Save screenshot if present, then release base64 from memory
      if (data.screenshot) {
        try {
          screenshotPath = path.join(screenshotDir, `claude-design-screenshot-${timestamp}.png`);
          const base64Data = data.screenshot.replace(/^data:image\/png;base64,/, '');
          fs.writeFileSync(screenshotPath, base64Data, 'base64');
          console.log('[IPC] Screenshot saved:', screenshotPath);
        } catch (err) {
          console.error('[IPC] Failed to save screenshot:', err);
        }
        data.screenshot = '';  // Release base64 string from memory
      }

      // Save reference image if present, then release base64 from memory
      if (data.referenceImage) {
        try {
          const matches = data.referenceImage.match(/^data:image\/(\w+);base64,/);
          const ext = matches ? matches[1] : 'png';
          referenceImagePath = path.join(screenshotDir, `claude-design-reference-${timestamp}.${ext}`);
          const base64Data = data.referenceImage.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(referenceImagePath, base64Data, 'base64');
          console.log('[IPC] Reference image saved:', referenceImagePath);
        } catch (err) {
          console.error('[IPC] Failed to save reference image:', err);
        }
        data.referenceImage = '';  // Release base64 string from memory
      }

      const prompt = formatAnnotationPrompt(data, screenshotPath, referenceImagePath);
      session.ptyProcess.write(prompt);
      setTimeout(() => session.ptyProcess.write('\r'), 100);

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
    // Reuse existing server if it's for the same project and still alive
    const existing = vscodeServers.get('current');
    if (existing && existing.projectPath === projectPath) {
      // Verify the server is actually responding
      try {
        await new Promise<void>((resolve, reject) => {
          const req = http.get(`http://localhost:${existing.port}`, (res) => {
            res.resume();
            resolve();
          });
          req.on('error', reject);
          req.setTimeout(2000, () => { req.destroy(); reject(new Error('timeout')); });
        });
        console.log('[IPC] Reusing existing VS Code server on port:', existing.port);
        return existing.port;
      } catch {
        console.log('[IPC] Existing server not responding, starting fresh');
        existing.process.kill();
        vscodeServers.delete('current');
      }
    } else if (existing) {
      // Kill existing server if it's for a different project
      existing.process.kill();
      vscodeServers.delete('current');
    }

    const port = vscodePortCounter++;
    console.log('[IPC] Starting VS Code server on port:', port, 'path:', projectPath);

    // Find the code command - Electron apps don't inherit full PATH
    const codePaths = process.platform === 'darwin'
      ? ['/usr/local/bin/code', '/opt/homebrew/bin/code', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']
      : process.platform === 'win32'
        ? ['code']
        : ['/usr/bin/code', '/usr/local/bin/code', 'code'];

    let codeCommand = 'code';
    for (const p of codePaths) {
      try {
        if (require('fs').existsSync(p)) {
          codeCommand = p;
          break;
        }
      } catch {
        // Ignore
      }
    }
    console.log('[IPC] Using code command:', codeCommand);

    return new Promise<number>((resolve, reject) => {
      const proc = spawn(codeCommand, [
        'serve-web',
        '--port', String(port),
        '--without-connection-token',
        '--accept-server-license-terms',
      ], {
        cwd: projectPath || undefined,
        env: { ...process.env, PATH: `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin` },
        shell: true,
      });

      let resolved = false;

      proc.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        console.log('[VSCode Server]', output.trim());
        if (!resolved && (output.includes('Web UI available') || output.includes('available at') || output.includes(`localhost:${port}`))) {
          resolved = true;
          vscodeServers.set('current', { process: proc, port, projectPath });
          resolve(port);
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        console.log('[VSCode Server stderr]', output.trim());
        // VS Code sometimes logs the ready message to stderr
        if (!resolved && (output.includes('Web UI available') || output.includes('available at') || output.includes(`localhost:${port}`))) {
          resolved = true;
          vscodeServers.set('current', { process: proc, port, projectPath });
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
        // Only clean up if this is still the current server
        const current = vscodeServers.get('current');
        if (current && current.process === proc) {
          vscodeServers.delete('current');
        }
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          // Still resolve with the port - server may be ready but didn't log expected message
          vscodeServers.set('current', { process: proc, port, projectPath });
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
  // Editor configurations: CLI commands and how to format file:line arguments
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const editorConfigs: Record<CodeEditor, { cmd: string; macPaths?: string[]; winPaths?: string[]; buildArgs: (file: string, line?: number, col?: number, projectPath?: string) => string[] }> = {
    vscode: {
      cmd: 'code',
      macPaths: ['/usr/local/bin/code', '/opt/homebrew/bin/code', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'],
      winPaths: [
        path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
        path.join(programFiles, 'Microsoft VS Code', 'bin', 'code.cmd'),
        path.join(programFilesX86, 'Microsoft VS Code', 'bin', 'code.cmd'),
      ],
      buildArgs: (file, line, col, projectPath) => {
        const args: string[] = [];
        if (projectPath) args.push(projectPath);
        if (line) {
          let uri = file;
          uri += `:${line}`;
          if (col) uri += `:${col}`;
          args.push('--goto', uri);
        } else if (!projectPath || file !== projectPath) {
          args.push(file);
        }
        return args;
      },
    },
    cursor: {
      cmd: 'cursor',
      macPaths: ['/usr/local/bin/cursor', '/opt/homebrew/bin/cursor', '/Applications/Cursor.app/Contents/Resources/app/bin/cursor'],
      winPaths: [
        path.join(localAppData, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
        path.join(programFiles, 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
      ],
      buildArgs: (file, line, col, projectPath) => {
        const args: string[] = [];
        if (projectPath) args.push(projectPath);
        if (line) {
          let uri = file;
          uri += `:${line}`;
          if (col) uri += `:${col}`;
          args.push('--goto', uri);
        } else if (!projectPath || file !== projectPath) {
          args.push(file);
        }
        return args;
      },
    },
    zed: {
      cmd: 'zed',
      macPaths: ['/usr/local/bin/zed', '/opt/homebrew/bin/zed'],
      buildArgs: (file, line) => {
        let uri = file;
        if (line) uri += `:${line}`;
        return [uri];
      },
    },
    sublime: {
      cmd: 'subl',
      macPaths: ['/usr/local/bin/subl', '/opt/homebrew/bin/subl', '/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl'],
      winPaths: [
        path.join(programFiles, 'Sublime Text', 'subl.exe'),
        path.join(programFiles, 'Sublime Text 3', 'sublime_text.exe'),
      ],
      buildArgs: (file, line, col) => {
        let uri = file;
        if (line) { uri += `:${line}`; if (col) uri += `:${col}`; }
        return [uri];
      },
    },
    webstorm: {
      cmd: 'webstorm',
      macPaths: ['/usr/local/bin/webstorm', '/opt/homebrew/bin/webstorm'],
      buildArgs: (file, line) => {
        const args = ['--line', String(line || 1), file];
        return args;
      },
    },
    nova: {
      cmd: 'nova',
      macPaths: ['/usr/local/bin/nova'],
      buildArgs: (file, line) => {
        let uri = file;
        if (line) uri += `:${line}`;
        return [uri];
      },
    },
  };

  // Electron-based editors (Cursor, VS Code) use shell wrapper scripts that
  // break on paths with special characters like parentheses (e.g. `(home)`).
  // The wrappers use `eval` which re-parses arguments through the shell.
  // To avoid this, resolve to the actual Electron binary + CLI JS on macOS.
  const electronEditorPaths: Partial<Record<CodeEditor, { electronBin: string; cliJs: string }>> = {
    cursor: {
      electronBin: '/Applications/Cursor.app/Contents/MacOS/Cursor',
      cliJs: '/Applications/Cursor.app/Contents/Resources/app/out/cli.js',
    },
    vscode: {
      electronBin: '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
      cliJs: '/Applications/Visual Studio Code.app/Contents/Resources/app/out/cli.js',
    },
  };

  function resolveEditorCmd(editor: CodeEditor): { cmd: string; prependArgs: string[]; extraEnv: Record<string, string> } {
    // On macOS, bypass shell wrappers for Electron-based editors
    if (process.platform === 'darwin') {
      const ep = electronEditorPaths[editor];
      if (ep && fs.existsSync(ep.electronBin) && fs.existsSync(ep.cliJs)) {
        return { cmd: ep.electronBin, prependArgs: [ep.cliJs], extraEnv: { ELECTRON_RUN_AS_NODE: '1' } };
      }
    }
    const config = editorConfigs[editor];
    if (process.platform === 'darwin' && config.macPaths) {
      for (const p of config.macPaths) {
        if (fs.existsSync(p)) return { cmd: p, prependArgs: [], extraEnv: {} };
      }
    }
    if (process.platform === 'win32' && config.winPaths) {
      for (const p of config.winPaths) {
        if (fs.existsSync(p)) return { cmd: p, prependArgs: [], extraEnv: {} };
      }
    }
    return { cmd: config.cmd, prependArgs: [], extraEnv: {} };
  }

  ipcMain.on('editor:open-file', (_, { filePath, line, column, projectPath }: { filePath: string; line?: number; column?: number; projectPath?: string }) => {
    const settings = getSettings();
    const editor = (settings.editor || 'vscode') as CodeEditor;
    const config = editorConfigs[editor];
    const { cmd, prependArgs, extraEnv } = resolveEditorCmd(editor);
    const args = [...prependArgs, ...config.buildArgs(filePath, line, column, projectPath)];
    console.log('[IPC] Opening in editor:', editor, cmd, args.join(' '));
    // Windows: use shell:true so .cmd/.bat shims (e.g. code.cmd) resolve and run
    // (Node can't spawn a .cmd directly without a shell).
    const useShell = process.platform === 'win32';
    // With shell:true, Node does NOT quote the command or arguments — it joins
    // them into a single string for cmd.exe. The resolved editor path (e.g.
    // "...\Microsoft VS Code\bin\code.cmd") and the project path usually contain
    // spaces, so without quoting cmd.exe splits them into separate tokens and the
    // launch fails silently. Quote them ourselves on Windows.
    const quoteForShell = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const spawnCmd = useShell ? quoteForShell(cmd) : cmd;
    const spawnArgs = useShell ? args.map(quoteForShell) : args;
    // Append common editor install dirs to PATH using the platform separator.
    // On Windows the extra Unix dirs don't apply and using ':' would corrupt the
    // existing PATH, so only extend PATH on non-Windows platforms.
    const launchPath = process.platform === 'win32'
      ? process.env.PATH
      : `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin`;
    spawn(spawnCmd, spawnArgs, {
      detached: true,
      stdio: 'ignore',
      shell: useShell,
      windowsHide: true,
      env: { ...process.env, ...extraEnv, PATH: launchPath },
    }).unref();
  });

  ipcMain.handle('editor:detect', async () => {
    const detected: CodeEditor[] = [];
    const envPath = `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin`;
    for (const [name, config] of Object.entries(editorConfigs) as [CodeEditor, typeof editorConfigs[CodeEditor]][]) {
      // Check macOS app paths first
      if (process.platform === 'darwin' && config.macPaths) {
        if (config.macPaths.some(p => fs.existsSync(p))) {
          detected.push(name);
          continue;
        }
      }
      // Check Windows install paths
      if (process.platform === 'win32' && config.winPaths) {
        if (config.winPaths.some(p => fs.existsSync(p))) {
          detected.push(name);
          continue;
        }
      }
      // Fall back to `which` / `where`
      try {
        const whichCmd = process.platform === 'win32' ? 'where' : 'which';
        await new Promise<void>((resolve, reject) => {
          exec(`${whichCmd} ${config.cmd}`, { env: { ...process.env, PATH: envPath } }, (err) => err ? reject(err) : resolve());
        });
        detected.push(name);
      } catch { /* not installed */ }
    }
    return detected;
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

      // Rank results: prefer component/UI files over scripts, configs, etc.
      const uiPathPattern = /(component|page|section|view|screen|layout|template|app|ui|feature|module|widget)\b/i;
      const nonUiPathPattern = /(_?scripts?|utils?|helpers?|lib|config|migrations?|seeds?|cli|test|spec|__test__|__spec__|\.config\.|\.setup\.)/i;
      function rankResults(results: { file: string; line: number }[]): { file: string; line: number }[] {
        return results.sort((a, b) => {
          const aIsUi = uiPathPattern.test(a.file) ? 0 : 1;
          const bIsUi = uiPathPattern.test(b.file) ? 0 : 1;
          const aIsNon = nonUiPathPattern.test(a.file) ? 1 : 0;
          const bIsNon = nonUiPathPattern.test(b.file) ? 1 : 0;
          return (aIsUi + aIsNon) - (bIsUi + bIsNon);
        });
      }

      // Try the full text first (short texts like "$69/mo")
      if (fullText.length >= 3 && fullText.length <= 60) {
        const results = rankResults(await grepAll(esc(fullText), 5));
        if (results.length > 0) return openResult(results[0], `text "${fullText.substring(0, 30)}"`);
      }

      // Try first 40 chars (for longer texts)
      if (fullText.length > 10) {
        const sub = fullText.substring(0, 40);
        const results = rankResults(await grepAll(esc(sub), 5));
        if (results.length > 0) return openResult(results[0], `text "${sub.substring(0, 30)}..."`);
      }

      // Try splitting into words and searching for distinctive multi-word phrases
      const words = fullText.split(/\s+/).filter(w => w.length >= 3);
      // Try pairs of consecutive words
      for (let i = 0; i < Math.min(words.length - 1, 5); i++) {
        const phrase = words[i] + '.*' + esc(words[i + 1]);
        const results = rankResults(await grepAll(phrase, 5));
        if (results.length > 0) return openResult(results[0], `phrase "${words[i]} ${words[i + 1]}"`);
      }
      // Try individual distinctive words (skip common ones)
      const commonWords = /^(the|and|or|a|an|is|are|was|were|be|to|of|in|for|on|with|at|by|from|this|that|our|your|you|we|all|can|get|has|have|not|but|its|more|out|than|them|then|way|will|about|also|been|come|each|just|like|make|many|most|new|now|only|other|over|some|such|take|time|very|when|who|how|per|into|one|two|Start|Free|Pro|Plan)$/i;
      for (const word of words.slice(0, 8)) {
        if (word.length < 5 || commonWords.test(word)) continue;
        const results = rankResults(await grepAll(esc(word), 5));
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

  // Get app version
  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });

  // Get app settings
  ipcMain.handle('settings:get', () => {
    return getSettings();
  });

  // Save app settings
  ipcMain.handle('settings:save', (_, settings: Partial<AppSettings>) => {
    return saveSettings(settings);
  });

  // Get project presets
  ipcMain.handle('presets:get', () => {
    return getPresets();
  });

  // Save project presets
  ipcMain.handle('presets:save', (_, presets) => {
    return savePresets(presets);
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

  // List project files for @-mention autocomplete.
  // Uses async fs to keep the main-process event loop responsive (sync readdir
  // on a large tree freezes window dragging, menus, IPC), and caches the result
  // per projectPath for FILE_LIST_TTL_MS so dev-server reload storms (e.g. after
  // a git branch switch) don't trigger repeated full-tree walks.
  type ProjectFile = { name: string; dir: string };
  const FILE_LIST_TTL_MS = 30_000;
  const fileListCache = new Map<string, { ts: number; files: ProjectFile[] }>();
  const fileListInFlight = new Map<string, Promise<ProjectFile[]>>();
  const FILE_EXCLUDE_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
    'coverage', '.cache', '.turbo', '.vercel', '.svelte-kit', '__pycache__',
    'venv', '.venv', '.idea', '.vscode', '.DS_Store',
  ]);
  const FILE_INCLUDE_EXTS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.scss', '.html',
    '.vue', '.svelte', '.md', '.yaml', '.yml', '.env', '.toml',
    '.py', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.java',
  ]);
  const FILE_LIST_MAX = 10000;

  async function listProjectFiles(projectPath: string): Promise<ProjectFile[]> {
    const results: ProjectFile[] = [];
    async function walk(dir: string): Promise<void> {
      if (results.length >= FILE_LIST_MAX) return;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= FILE_LIST_MAX) return;
        if (entry.isDirectory()) {
          if (!FILE_EXCLUDE_DIRS.has(entry.name)) {
            await walk(path.join(dir, entry.name));
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (FILE_INCLUDE_EXTS.has(ext)) {
            const relDir = path.relative(projectPath, dir);
            results.push({ name: entry.name, dir: relDir || '.' });
          }
        }
      }
    }
    await walk(projectPath);
    return results;
  }

  ipcMain.handle('project:list-files', async (_, { projectPath }: { projectPath: string }) => {
    const cached = fileListCache.get(projectPath);
    if (cached && Date.now() - cached.ts < FILE_LIST_TTL_MS) {
      return cached.files;
    }
    const inFlight = fileListInFlight.get(projectPath);
    if (inFlight) return inFlight;

    const promise = listProjectFiles(projectPath)
      .then((files) => {
        fileListCache.set(projectPath, { ts: Date.now(), files });
        return files;
      })
      .finally(() => {
        fileListInFlight.delete(projectPath);
      });
    fileListInFlight.set(projectPath, promise);
    return promise;
  });

  // List design tokens for >mention autocomplete (cached + in-flight dedup).
  // getDesignTokens is sync and reads several CSS files; cache to avoid rerunning
  // on every webview reload.
  type DesignTokenList = ReturnType<typeof getDesignTokens>;
  const TOKEN_TTL_MS = 30_000;
  const tokenCache = new Map<string, { ts: number; tokens: DesignTokenList }>();
  const tokenInFlight = new Map<string, Promise<DesignTokenList>>();

  ipcMain.handle('project:list-tokens', async (_, { projectPath }: { projectPath: string }) => {
    const cached = tokenCache.get(projectPath);
    if (cached && Date.now() - cached.ts < TOKEN_TTL_MS) {
      return cached.tokens;
    }
    const inFlight = tokenInFlight.get(projectPath);
    if (inFlight) return inFlight;

    // getDesignTokens is sync; defer to a microtask so the IPC reply path stays
    // async-friendly and we can dedupe overlapping calls via the in-flight map.
    const promise = Promise.resolve()
      .then(() => {
        try {
          return getDesignTokens(projectPath);
        } catch (err) {
          console.error('[IPC] Failed to get design tokens:', err);
          return [] as DesignTokenList;
        }
      })
      .then((tokens) => {
        tokenCache.set(projectPath, { ts: Date.now(), tokens });
        return tokens;
      })
      .finally(() => {
        tokenInFlight.delete(projectPath);
      });
    tokenInFlight.set(projectPath, promise);
    return promise;
  });

  // Clear webview session cache and storage data
  ipcMain.handle('webview:clear-cache', async () => {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData();
  });

  // Docked Chrome DevTools: hosted by a top-level WebContentsView (NOT a <webview>,
  // because devToolsWebContents must have no embedders). The renderer reserves
  // empty layout space and sends bounds to overlay this view on top.
  //
  // The view is created once per target webContents and kept alive for the
  // target's lifetime. Closing the panel just unparents the view (hiding it);
  // reopening re-parents it. This avoids Electron's stale-binding issue when
  // setDevToolsWebContents is called twice on the same target.
  const devToolsViews = new Map<number, WebContentsView>();

  const destroyDevToolsView = (targetId: number) => {
    const view = devToolsViews.get(targetId);
    if (!view) return;
    try {
      if (!mainWindow.isDestroyed()) {
        mainWindow.contentView.removeChildView(view);
      }
    } catch {
      // already removed
    }
    devToolsViews.delete(targetId);
  };

  ipcMain.handle('devtools:attach', async (_, { targetId, bounds }: { targetId: number; bounds: { x: number; y: number; width: number; height: number } }) => {
    const target = webContentsModule.fromId(targetId);
    if (!target) return false;
    try {
      let view = devToolsViews.get(targetId);
      if (!view) {
        view = new WebContentsView();
        devToolsViews.set(targetId, view);
        mainWindow.contentView.addChildView(view);
        target.setDevToolsWebContents(view.webContents);
        target.openDevTools({ mode: 'detach' });
        // Clean up the view automatically when the page is destroyed
        target.once('destroyed', () => destroyDevToolsView(targetId));
      } else {
        // View was unparented on previous close — re-parent it
        try {
          mainWindow.contentView.addChildView(view);
        } catch {
          // Already a child — fine
        }
      }
      view.setBounds(bounds);
      return true;
    } catch (err) {
      console.error('[IPC] devtools:attach error:', err);
      return false;
    }
  });

  ipcMain.handle('devtools:set-bounds', async (_, { targetId, bounds }: { targetId: number; bounds: { x: number; y: number; width: number; height: number } }) => {
    const view = devToolsViews.get(targetId);
    if (!view) return;
    try {
      view.setBounds(bounds);
    } catch (err) {
      console.error('[IPC] devtools:set-bounds error:', err);
    }
  });

  ipcMain.handle('devtools:detach', async (_, { targetId }: { targetId: number }) => {
    // Just unparent the view (hides it visually). DevTools session stays alive
    // so reopening is instant and the inspector state is preserved.
    const view = devToolsViews.get(targetId);
    if (!view) return;
    try {
      if (!mainWindow.isDestroyed()) {
        mainWindow.contentView.removeChildView(view);
      }
    } catch (err) {
      console.error('[IPC] devtools:detach error:', err);
    }
  });

  // Send all queued edits — execute directly on webview webContents
  ipcMain.on('webview:send-all', () => {
    const allContents = webContentsModule.getAllWebContents();
    for (const contents of allContents) {
      if (contents.getType() === 'webview') {
        contents.executeJavaScript('window.__claudeDesignSendAll && window.__claudeDesignSendAll(); true;').catch(() => {});
      }
    }
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

  // Open URL in default browser
  ipcMain.on('app:open-external', async (_, url: string) => {
    const { shell } = await import('electron');
    shell.openExternal(url);
  });

  // Clean up on window close
  mainWindow.on('closed', () => {
    for (const [sessionId, session] of sessions) {
      console.log('[IPC] Cleaning up session:', sessionId);
      for (const d of session.disposables) d.dispose();
      session.disposables.length = 0;
      session.outputBuffer.length = 0;
      session.ptyProcess.kill();
    }
    sessions.clear();

    // Kill all VS Code servers
    for (const [key, server] of vscodeServers) {
      console.log('[IPC] Killing VS Code server:', key);
      server.process.kill();
    }
    vscodeServers.clear();

    // Stop all Starter Project static servers
    for (const [key, entry] of staticServers) {
      console.log('[IPC] Stopping static server:', key);
      if (entry.notifyTimer) clearTimeout(entry.notifyTimer);
      entry.watcher?.close();
      for (const client of entry.clients) {
        try { client.end(); } catch { /* ignore */ }
      }
      entry.clients.clear();
      entry.server.close();
    }
    staticServers.clear();
  });
}

