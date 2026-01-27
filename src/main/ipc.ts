import { BrowserWindow, ipcMain, app, dialog } from 'electron';
import * as pty from 'node-pty';
import * as path from 'path';
import * as fs from 'fs';
import type { AnnotationData } from '../shared/types';

interface SessionState {
  ptyProcess: pty.IPty;
  ready: boolean;
  outputBuffer: string[];
}

const sessions = new Map<string, SessionState>();

export function setupIPC(mainWindow: BrowserWindow) {
  const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh';

  // Create a new terminal session
  ipcMain.on('terminal:create', (_, { sessionId, cwd }: { sessionId: string; cwd?: string }) => {
    if (sessions.has(sessionId)) {
      console.log('[IPC] Session already exists:', sessionId);
      return;
    }

    console.log('[IPC] Creating new session:', sessionId, 'cwd:', cwd);

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: cwd || process.env.HOME || process.cwd(),
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
        setTimeout(() => {
          for (const p of pathsToClean) {
            try {
              fs.unlinkSync(p);
              console.log('[IPC] Image cleaned up:', p);
            } catch {
              // Ignore cleanup errors
            }
          }
        }, 60000);
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
        setTimeout(() => {
          for (const p of pathsToClean) {
            try {
              fs.unlinkSync(p);
              console.log('[IPC] Image cleaned up:', p);
            } catch {
              // Ignore cleanup errors
            }
          }
        }, 60000);
      }
    }
  });

  // Clean up on window close
  mainWindow.on('closed', () => {
    for (const [sessionId, session] of sessions) {
      console.log('[IPC] Cleaning up session:', sessionId);
      session.ptyProcess.kill();
    }
    sessions.clear();
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
