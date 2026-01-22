import { BrowserWindow, ipcMain, app } from 'electron';
import * as pty from 'node-pty';
import * as path from 'path';
import * as fs from 'fs';
import type { AnnotationData } from '../shared/types';

let ptyProcess: pty.IPty | null = null;
let rendererReady = false;
let outputBuffer: string[] = [];

export function setupIPC(mainWindow: BrowserWindow) {
  // Create PTY process running claude
  const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh';
  console.log('[IPC] Starting PTY with shell:', shell);

  ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 30,
    cwd: process.env.HOME || process.cwd(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
    },
  });

  console.log('[IPC] PTY process started, PID:', ptyProcess.pid);

  // Send terminal output to renderer (buffer until ready)
  ptyProcess.onData((data) => {
    if (rendererReady) {
      mainWindow.webContents.send('terminal:data', data);
    } else {
      outputBuffer.push(data);
    }
  });

  // Handle renderer ready signal
  ipcMain.on('terminal:ready', () => {
    console.log('[IPC] Renderer ready, flushing buffer:', outputBuffer.length, 'chunks');
    rendererReady = true;
    // Flush buffered output
    for (const data of outputBuffer) {
      mainWindow.webContents.send('terminal:data', data);
    }
    outputBuffer = [];
  });


  // Handle terminal input from renderer
  ipcMain.on('terminal:input', (_, data: string) => {
    console.log('[IPC] Received terminal input:', data.length, 'chars');
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  });

  // Handle terminal resize
  ipcMain.on('terminal:resize', (_, { cols, rows }: { cols: number; rows: number }) => {
    console.log('[IPC] Terminal resize:', cols, 'x', rows);
    if (ptyProcess && cols > 0 && rows > 0) {
      ptyProcess.resize(cols, rows);
    }
  });

  // Handle annotation submission
  ipcMain.on('annotation:send', async (_, data: AnnotationData) => {
    if (!ptyProcess) return;

    let screenshotPath: string | undefined;

    // Save screenshot if present
    if (data.screenshot) {
      try {
        const tempDir = app.getPath('temp');
        screenshotPath = path.join(tempDir, `claude-design-${Date.now()}.png`);
        const base64Data = data.screenshot.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(screenshotPath, base64Data, 'base64');
        console.log('[IPC] Screenshot saved:', screenshotPath);
      } catch (err) {
        console.error('[IPC] Failed to save screenshot:', err);
      }
    }

    const prompt = formatAnnotationPrompt(data, screenshotPath);
    ptyProcess.write(prompt);
    ptyProcess.write('\r');

    // Clean up screenshot after a delay (give Claude time to read it)
    if (screenshotPath) {
      setTimeout(() => {
        try {
          fs.unlinkSync(screenshotPath);
          console.log('[IPC] Screenshot cleaned up:', screenshotPath);
        } catch {
          // Ignore cleanup errors
        }
      }, 60000); // 1 minute
    }
  });

  // Clean up on window close
  mainWindow.on('closed', () => {
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }
  });
}

function formatAnnotationPrompt(data: AnnotationData, screenshotPath?: string): string {
  const { element, request } = data;

  // Include text and attributes for faster grepping
  const parts = [`<${element.tagName}>`];
  if (element.text) parts.push(`"${element.text}"`);
  if (element.attributes) parts.push(`[${element.attributes}]`);

  let prompt = `${parts.join(' ')}: ${request}`;

  // Add screenshot path for Claude to read
  if (screenshotPath) {
    prompt += ` (see element screenshot: ${screenshotPath})`;
  }

  return prompt;
}
