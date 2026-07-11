import { BrowserWindow, ipcMain, app, dialog, session, webContents as webContentsModule, WebContentsView, clipboard, nativeImage } from 'electron';
import { downloadUpdate, installUpdate } from './updater';
import * as pty from 'node-pty';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { spawn, exec, type ChildProcess } from 'child_process';
import type { AnnotationData, ShellType, CodeEditor, ExternalEditor } from '../shared/types';
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
  const editorConfigs: Record<ExternalEditor, { cmd: string; macPaths?: string[]; winPaths?: string[]; buildArgs: (file: string, line?: number, col?: number, projectPath?: string) => string[] }> = {
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

  function resolveEditorCmd(editor: ExternalEditor): { cmd: string; prependArgs: string[]; extraEnv: Record<string, string> } {
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
    // The built-in editor is handled entirely in the renderer; never spawn for it.
    if (editor === 'builtin') return;
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
    // The built-in editor is always available — list it first.
    const detected: CodeEditor[] = ['builtin'];
    const envPath = `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin`;
    for (const [name, config] of Object.entries(editorConfigs) as [ExternalEditor, typeof editorConfigs[ExternalEditor]][]) {
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

  // Resolve filePath to its real on-disk location and verify it lies inside
  // projectPath. Both sides go through realpath so a symlink inside the project
  // can't smuggle reads/writes outside it (path.resolve alone doesn't follow
  // links), and a symlinked project root (e.g. /tmp → /private/tmp) still works.
  function resolveInsideProject(filePath: string, projectPath: string): { ok: true; target: string } | { ok: false; error: string } {
    let root: string;
    try {
      root = fs.realpathSync(path.resolve(projectPath));
    } catch {
      return { ok: false, error: 'Project folder not found.' };
    }
    let target: string;
    try {
      target = fs.realpathSync(path.resolve(filePath));
    } catch {
      return { ok: false, error: 'File not found.' };
    }
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, error: 'Path is outside the project.' };
    }
    return { ok: true, target };
  }

  // Read a project file's text for the in-app code editor. The path must resolve
  // inside projectPath — this guards against the webview tricking us into reading
  // arbitrary files on disk.
  ipcMain.handle('file:read', async (_, { filePath, projectPath }: { filePath: string; projectPath: string }) => {
    try {
      const resolved = resolveInsideProject(filePath, projectPath);
      if (!resolved.ok) return { ok: false as const, error: resolved.error };
      const target = resolved.target;
      const stat = fs.statSync(target);
      if (!stat.isFile()) return { ok: false as const, error: 'Not a file.' };
      // Refuse oversized files — the editor is meant for source, not binaries/blobs.
      if (stat.size > 2 * 1024 * 1024) return { ok: false as const, error: 'File is too large to edit here.' };
      const content = fs.readFileSync(target, 'utf8');
      return { ok: true as const, content, path: target };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Write edited text back to a project file (same in-project safety check as
  // read). The editor only saves files it previously opened, so the target must
  // already exist — which lets the check realpath the file itself.
  ipcMain.handle('file:write', async (_, { filePath, content, projectPath }: { filePath: string; content: string; projectPath: string }) => {
    try {
      const resolved = resolveInsideProject(filePath, projectPath);
      if (!resolved.ok) return { ok: false as const, error: resolved.error };
      fs.writeFileSync(resolved.target, content, 'utf8');
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Search for element in project and open in VS Code
  ipcMain.handle('vscode:search-element', async (_, { projectPath, info }: { projectPath: string; info: { componentNames: string[]; id: string | null; textContent: string; ownText?: string; headingText?: string; tagName?: string; dataAttrs: Record<string, string>; pageUrl: string } }) => {
    const excludeDirs = ['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output', 'coverage', '.cache'];
    const excludeArgs = excludeDirs.flatMap(d => ['--exclude-dir', d]);
    const includeArgs = ['--include=*.tsx', '--include=*.jsx', '--include=*.ts', '--include=*.js',
                         '--include=*.vue', '--include=*.svelte'];

    console.log('[IPC] Searching for element:', {
      componentNames: info.componentNames?.slice(0, 5),
      id: info.id,
      ownText: (info.ownText || '').substring(0, 40),
      headingText: (info.headingText || '').substring(0, 40),
      text: (info.textContent || '').substring(0, 40),
      tagName: info.tagName,
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

    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // --- Route-aware scoring -------------------------------------------------
    // The clicked element lives on a page; files under that page's route folder
    // are far more likely than shared root files (layout.tsx, providers, etc.).
    const urlPath = (info.pageUrl || '/').replace(/\/$/, '') || '/';
    const urlSegments = urlPath.split('/').filter(Boolean).map(s => s.toLowerCase());
    const rootishPattern = /(^|\/)(layout|template|_app|_document|providers?|globals?|root)\.[jt]sx?$/i;
    const uiPathPattern = /(component|page|section|view|screen|app|ui|feature|module|widget)\b/i;
    const nonUiPathPattern = /(_?scripts?|utils?|helpers?|\/lib\/|config|migrations?|seeds?|\/cli\/|test|spec|__tests?__|\.config\.|\.setup\.)/i;

    function scoreFile(file: string): number {
      const rel = path.relative(projectPath, file).toLowerCase();
      let s = 0;
      // Files under (or named like) a URL segment are strongly preferred.
      if (urlSegments.some(seg => rel.includes('/' + seg + '/') || rel.includes('/' + seg + '.'))) s += 30;
      if (rootishPattern.test(rel)) s -= 40; // demote layout.tsx & friends
      if (uiPathPattern.test(rel)) s += 8;
      if (nonUiPathPattern.test(rel)) s -= 25;
      return s;
    }

    // Accumulate scored candidates from every signal, then rank.
    const scored = new Map<string, { file: string; line: number; strategy: string; score: number }>();
    function add(results: { file: string; line: number }[], strategy: string, base: number, perFile = 1) {
      const seenFile = new Map<string, number>();
      for (const r of results) {
        const used = seenFile.get(r.file) || 0;
        if (used >= perFile) continue; // avoid one file flooding the list
        seenFile.set(r.file, used + 1);
        const key = `${r.file}:${r.line}`;
        const score = base + scoreFile(r.file);
        const existing = scored.get(key);
        if (!existing || score > existing.score) scored.set(key, { ...r, strategy, score });
      }
    }

    // Every strategy below spawns an independent `grep` over the project tree.
    // They don't depend on each other, so we collect them as tasks, fire them
    // all off concurrently, then process the results in push order (which keeps
    // scoring deterministic — equal scores keep the first-added candidate).
    // Running sequentially meant ~18 full-tree greps end to end (multi-second
    // stall before the editor opens); concurrently it's ~one grep's wall-clock.
    const tasks: { results: Promise<{ file: string; line: number }[]>; handle: (r: { file: string; line: number }[]) => void }[] = [];

    // Strategy: React component name → its definition file (closest first).
    const names = (info.componentNames || []).slice(0, 5);
    for (const [i, name] of names.entries()) {
      const pattern = `(function|const|let|var|export default|export)\\s+${esc(name)}`;
      tasks.push({
        results: grepAll(pattern, 5),
        handle: (results) => {
          // Closer components (lower i) score higher; filename match is best.
          for (const r of results) {
            const base = path.basename(r.file).replace(/\.(tsx?|jsx?|vue|svelte)$/, '');
            const filenameMatch = base === name || base === name.replace(/^[a-z]/, c => c.toUpperCase());
            add([r], `component "${name}"${filenameMatch ? ' (file match)' : ''}`, (filenameMatch ? 95 : 70) - i * 5);
          }
        },
      });
    }

    // Strategy: data-testid / data-component / etc.
    for (const [attr, value] of Object.entries(info.dataAttrs || {})) {
      if (!value) continue;
      tasks.push({ results: grepAll(`${esc(attr)}=.*${esc(value)}`, 3), handle: (r) => add(r, `${attr}="${value}"`, 90) });
    }

    // Strategy: element id
    if (info.id) {
      tasks.push({ results: grepAll(`id=["'{].*${esc(info.id)}`, 3), handle: (r) => add(r, `id="${info.id}"`, 88) });
    }

    // Strip decorative wrapping punctuation (curly/straight quotes, dashes,
    // colons, whitespace) so a leading "“" in the rendered text doesn't break
    // the match against source that doesn't include it.
    const stripWrap = (s: string) => (s || '').trim()
      .replace(/^[\s"'“”‘’«»\-–—:.,]+/, '')
      .replace(/[\s"'“”‘’«»\-–—:.,]+$/, '');

    const headingText = stripWrap(info.headingText || '');
    const ownText = stripWrap(info.ownText || '');
    const fullText = stripWrap(info.textContent || '');

    // Build a grep pattern from a string's alphanumeric tokens joined by a loose
    // gap. This tolerates whatever sits between words in source — HTML entities
    // (&apos;), quote chars, JSX expressions, extra whitespace — as long as the
    // run is on one line (grep is line-based). Far more robust than exact text.
    const loosePattern = (s: string, maxTokens = 8): string | null => {
      const tokens = (s.match(/[\p{L}\p{N}]+/gu) || []).filter(t => t.length >= 2).slice(0, maxTokens);
      if (tokens.length < 1) return null;
      return tokens.map(esc).join('.{0,16}');
    };

    // Strategy: nearest heading text (very distinctive).
    const headingPat = loosePattern(headingText);
    if (headingPat) {
      tasks.push({ results: grepAll(headingPat, 5), handle: (r) => add(r, `heading "${headingText.substring(0, 24)}"`, 84, 2) });
    }

    // Strategy: the element's own (direct) text — sharper than the whole subtree.
    const ownPat = loosePattern(ownText);
    if (ownPat) {
      tasks.push({ results: grepAll(ownPat, 5), handle: (r) => add(r, `text "${ownText.substring(0, 24)}"`, 80, 2) });
    }

    // Strategy: full subtree text (when it differs from the element's own text).
    if (fullText && fullText !== ownText) {
      const fullPat = loosePattern(fullText);
      if (fullPat) tasks.push({ results: grepAll(fullPat, 5), handle: (r) => add(r, `text "${fullText.substring(0, 24)}…"`, 56, 2) });
    }

    // Strategy: distinctive word phrases / single long words as a final net,
    // in case the loose pattern's run is broken across multiple source lines.
    const phraseSource = ownText || fullText || headingText;
    if (phraseSource) {
      const commonWords = /^(about|these|those|there|their|which|where|while|would|should|could|because|through|using|since)$/i;
      const words = (phraseSource.match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length >= 5 && !commonWords.test(w));
      for (let i = 0; i < Math.min(words.length - 1, 5); i++) {
        const w0 = words[i], w1 = words[i + 1];
        tasks.push({ results: grepAll(esc(w0) + '.{0,40}' + esc(w1), 5), handle: (r) => add(r, `phrase "${w0} ${w1}"`, 46, 1) });
      }
      const longWords = words.filter(w => w.length >= 8).slice(0, 3);
      for (const w of longWords) {
        tasks.push({ results: grepAll(esc(w), 5), handle: (r) => add(r, `word "${w}"`, 34, 1) });
      }
    }

    // Drain all grep strategies concurrently, then apply their handlers in push
    // order so scoring/tie-breaks stay identical to the old sequential version.
    const allResults = await Promise.all(tasks.map(t => t.results));
    allResults.forEach((r, i) => tasks[i].handle(r));

    // Strategy: URL → page file. Always added as a sensible baseline candidate.
    {
      const pageCandidates = [
        path.join('src', 'app', urlPath, 'page.tsx'),
        path.join('src', 'app', urlPath, 'page.jsx'),
        path.join('src', 'app', urlPath, 'page.ts'),
        path.join('src', 'app', urlPath, 'page.js'),
        path.join('src', 'pages', urlPath + '.tsx'),
        path.join('src', 'pages', urlPath + '.jsx'),
        path.join('src', 'pages', urlPath, 'index.tsx'),
        path.join('app', urlPath, 'page.tsx'),
        path.join('pages', urlPath + '.tsx'),
        path.join('pages', urlPath, 'index.tsx'),
      ].map(p => path.join(projectPath, p));
      // Route groups: src/app/(group)/urlPath/page.tsx
      const appDir = path.join(projectPath, 'src', 'app');
      if (urlSegments.length > 0 && fs.existsSync(appDir)) {
        try {
          for (const entry of fs.readdirSync(appDir)) {
            if (entry.startsWith('(') && entry.endsWith(')')) {
              pageCandidates.push(path.join(appDir, entry, ...urlSegments, 'page.tsx'));
            }
          }
        } catch { /* ignore */ }
      }
      const pageFile = pageCandidates.find(c => fs.existsSync(c));
      if (pageFile) add([{ file: pageFile, line: 1 }], `page for "${urlPath}"`, 60);
    }

    // --- Cross-signal corroboration ------------------------------------------
    // Any single grep strategy can land in the wrong file (a loose text run also
    // appears in a shared component; a common component name is defined in two
    // places). The strongest signal that we found the RIGHT file is INDEPENDENT
    // signals agreeing on it: the component name resolves to File X *and* the
    // element's text lives in File X *and* it sits under the page's route. Group
    // matches by file, count how many distinct signal classes point at each, and
    // boost the agreed-upon file so it decisively outranks lone weak matches.
    type SignalClass = 'struct' | 'attr' | 'content' | 'route';
    const classOf = (strategy: string): SignalClass => {
      if (strategy.startsWith('component')) return 'struct';
      if (strategy.startsWith('page for')) return 'route';
      if (strategy.startsWith('id=') || strategy.startsWith('data-') ||
          strategy.startsWith('aria-') || strategy.startsWith('role=')) return 'attr';
      return 'content'; // heading / text / phrase / word
    };

    const byFile = new Map<string, { classes: Set<SignalClass>; contentHits: number }>();
    for (const c of scored.values()) {
      const cls = classOf(c.strategy);
      let e = byFile.get(c.file);
      if (!e) { e = { classes: new Set(), contentHits: 0 }; byFile.set(c.file, e); }
      e.classes.add(cls);
      if (cls === 'content') e.contentHits++;
    }

    const corroboration = (file: string): number => {
      const e = byFile.get(file);
      if (!e) return 0;
      // Each distinct class beyond the first is strong independent agreement.
      let boost = (e.classes.size - 1) * 45;
      // A component-definition file that also contains the element's text is the
      // single most reliable "this is it" — give it an extra bump.
      if (e.classes.has('struct') && e.classes.has('content')) boost += 25;
      // Multiple content hits derive from the same text, so they corroborate only
      // weakly — a small, capped bonus.
      boost += Math.min(e.contentHits - 1, 3) * 6;
      return boost;
    };

    // Re-score with corroboration. Within a file, nudge content/usage lines above
    // the bare `function X()` definition line so we open where the element is.
    const rescored = Array.from(scored.values()).map(c => ({
      ...c,
      finalScore: c.score + corroboration(c.file) + (classOf(c.strategy) === 'content' ? 6 : 0),
    }));

    // Rank, dedupe, cap. Keep at most 2 entries per file so the list stays varied.
    const ranked = rescored.sort((a, b) => b.finalScore - a.finalScore);
    const perFileCount = new Map<string, number>();
    const candidates: { file: string; line: number; strategy: string }[] = [];
    for (const c of ranked) {
      const n = perFileCount.get(c.file) || 0;
      if (n >= 2) continue;
      perFileCount.set(c.file, n + 1);
      candidates.push({ file: c.file, line: c.line, strategy: c.strategy });
      if (candidates.length >= 6) break;
    }

    if (candidates.length === 0) {
      console.log('[IPC] Could not find element source');
      return null;
    }
    // Confidence = how decisively the winning FILE beat the next different file.
    // A large gap means independent signals converged; a small gap means it was a
    // coin-flip between files (the UI keeps the "wrong file?" picker for those).
    const top = ranked[0];
    const nextOtherFile = ranked.find(c => c.file !== top.file);
    const confidenceGap = nextOtherFile ? top.finalScore - nextOtherFile.finalScore : top.finalScore;
    const topClasses = byFile.get(top.file)?.classes.size ?? 1;
    console.log('[IPC] Element candidates:', candidates.map(c => `${path.relative(projectPath, c.file)}:${c.line} (${c.strategy})`),
      `| top gap=${confidenceGap} classes=${topClasses}`);
    return { candidates, confidence: { gap: confidenceGap, agreeingSignals: topClasses } };
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

  // Resolve a project's favicon from its files (the dev server usually isn't
  // running when the project list shows, so we can't fetch it over HTTP).
  // Returns a data: URL or null. Cached per path for the app's lifetime.
  const faviconCache = new Map<string, string | null>();

  const FAVICON_MIME: Record<string, string> = {
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };

  const readIconFile = async (p: string): Promise<string | null> => {
    const mime = FAVICON_MIME[path.extname(p).toLowerCase()];
    if (!mime) return null;
    try {
      const stat = await fs.promises.stat(p);
      // Favicons are small; anything huge is not a favicon (and would bloat
      // the renderer as a base64 string).
      if (!stat.isFile() || stat.size === 0 || stat.size > 256 * 1024) return null;
      const buf = await fs.promises.readFile(p);
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  };

  const findProjectFavicon = async (root: string): Promise<string | null> => {
    // Common on-disk locations across static sites, Vite, CRA, Next.js
    // (pages + app router), Nuxt, Angular, SvelteKit.
    const candidates = [
      'favicon.svg', 'favicon.ico', 'favicon.png',
      'public/favicon.svg', 'public/favicon.ico', 'public/favicon.png',
      'static/favicon.svg', 'static/favicon.ico', 'static/favicon.png',
      'app/favicon.ico', 'src/app/favicon.ico', 'src/favicon.ico',
      'apple-touch-icon.png', 'public/apple-touch-icon.png',
    ];
    for (const rel of candidates) {
      const dataUrl = await readIconFile(path.join(root, rel));
      if (dataUrl) return dataUrl;
    }

    // Fall back to the <link rel="...icon..."> of a root HTML file.
    for (const htmlRel of ['index.html', 'public/index.html', 'src/index.html']) {
      let html: string;
      try {
        html = await fs.promises.readFile(path.join(root, htmlRel), 'utf8');
      } catch {
        continue;
      }
      const link = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i)?.[0];
      const href = link?.match(/href=["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      if (href.startsWith('data:image/')) return href;
      if (/^(https?:)?\/\//i.test(href)) continue; // remote icon — skip
      const cleaned = decodeURIComponent(href.split(/[?#]/)[0]).replace(/^\.?\//, '');
      // Try relative to the HTML file, the project root, and public/ (dev
      // servers map absolute paths like /favicon.svg onto public/).
      const bases = [path.dirname(path.join(root, htmlRel)), root, path.join(root, 'public')];
      for (const base of bases) {
        const target = path.resolve(base, cleaned);
        if (target !== root && !target.startsWith(root + path.sep)) continue;
        const dataUrl = await readIconFile(target);
        if (dataUrl) return dataUrl;
      }
    }
    return null;
  };

  ipcMain.handle('project:favicon', async (_, { projectPath }: { projectPath: string }) => {
    const key = path.resolve(projectPath);
    const cached = faviconCache.get(key);
    if (cached !== undefined) return cached;
    const result = await findProjectFavicon(key);
    faviconCache.set(key, result);
    return result;
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

