import { useState, useEffect, useRef, useCallback, type MutableRefObject } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalTab, ShellType } from '../../shared/types';
import { appConfirm } from './ConfirmDialog';

const getMainAPI = () => (typeof window !== 'undefined' ? window.mainAPI : undefined);

interface TerminalInstance {
  terminal: XTerm;
  fitAddon: FitAddon;
  containerEl: HTMLDivElement;
}

// Global state for terminal instances (keyed by tab ID)
const terminalInstances = new Map<string, TerminalInstance>();
const createdTabs = new Set<string>();
// Spawn arguments per tab, so a tab whose shell died can be restarted in the
// same project directory without the owning component being involved.
const tabSpawnConfig = new Map<string, { cwd?: string; shell?: ShellType }>();
// Tabs whose PTY has exited. Their xterm is still on screen but keystrokes
// have nowhere to go, so we swallow them and offer a restart instead.
const deadTabs = new Set<string>();
// The tab the user is currently looking at, mirrored at module scope for the
// once-registered main-process listeners below.
let currentActiveTabId: string | null = null;
let dataListenerSetup = false;

// Writes queued before the xterm instance is created — flushed on creation.
const pendingTerminalWrites = new Map<string, string[]>();

export function scrollTerminalToBottom(tabId: string) {
  const instance = terminalInstances.get(tabId);
  if (instance) {
    instance.terminal.scrollToBottom();
  }
}

// Write text directly into a terminal tab's xterm.js instance (bypassing the
// PTY). Used for informational banners. If the terminal hasn't been created
// yet the write is queued and flushed when the instance is ready.
export function writeToTerminal(tabId: string, text: string) {
  const instance = terminalInstances.get(tabId);
  if (instance) {
    instance.terminal.write(text);
    return;
  }
  const queue = pendingTerminalWrites.get(tabId) || [];
  queue.push(text);
  pendingTerminalWrites.set(tabId, queue);
}

// Bring a tab's shell back after its PTY exited (either the user quit the
// shell, or it died while the machine was asleep).
function respawnTerminal(tabId: string) {
  const mainAPI = getMainAPI();
  const instance = terminalInstances.get(tabId);
  if (!mainAPI || !instance) return;

  deadTabs.delete(tabId);
  instance.terminal.write('\r\n');
  const config = tabSpawnConfig.get(tabId);
  mainAPI.createTerminal(tabId, config?.cwd, config?.shell);
  mainAPI.terminalReady(tabId);
  try {
    if (instance.containerEl.offsetWidth > 0 && instance.containerEl.offsetHeight > 0) {
      instance.fitAddon.fit();
      mainAPI.resizeTerminal(tabId, instance.terminal.cols, instance.terminal.rows);
    }
  } catch {
    // Ignore fit errors
  }
  instance.terminal.focus();
}

function markTerminalDead(tabId: string) {
  if (deadTabs.has(tabId)) return;
  deadTabs.add(tabId);
  const instance = terminalInstances.get(tabId);
  if (!instance) return;
  instance.terminal.write('\r\n\x1b[33m[shell exited — press Enter to start a new one]\x1b[0m\r\n');
  instance.terminal.scrollToBottom();
}

const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;

interface TerminalProps {
  sessionId: string;
  collapsed?: boolean;
  tabs: TerminalTab[];
  activeTabId: string;
  tabCounter: number;
  onTabsChange: (tabs: TerminalTab[], activeTabId: string, tabCounter: number) => void;
  children?: React.ReactNode;
  projectPath?: string;
  shell?: ShellType;
  cliToolTabId?: string | null;
  cliToolRunning?: boolean;
  hasTodoItems?: boolean;
  onZoom?: MutableRefObject<((direction: string) => void) | null>;
}

export default function Terminal({ sessionId, collapsed, tabs, activeTabId, tabCounter, onTabsChange, children, projectPath, shell, cliToolTabId, cliToolRunning, hasTodoItems, onZoom }: TerminalProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const projectPathRef = useRef(projectPath);
  const shellRef = useRef(shell);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  projectPathRef.current = projectPath;
  shellRef.current = shell;

  // Set up global data listener once
  useEffect(() => {
    if (dataListenerSetup) return;
    dataListenerSetup = true;

    const mainAPI = getMainAPI();
    if (!mainAPI) return;

    mainAPI.onTerminalData((tabId: string, data: string) => {
      const instance = terminalInstances.get(tabId);
      if (instance) {
        instance.terminal.write(data);
        // Always scroll to bottom to show latest output
        instance.terminal.scrollToBottom();
      }
    });

    mainAPI.onTerminalExited?.((tabId: string) => {
      markTerminalDead(tabId);
    });

    // Waking from sleep leaves Chromium's keyboard focus stranded (usually on
    // the <webview> guest that owned it when the machine went down), so the
    // terminal stops receiving keystrokes and clicking it doesn't help. The
    // main process pulls focus back to this frame; re-fit and re-focus the
    // active terminal here, and check that every shell actually survived.
    mainAPI.onSystemResume?.(() => {
      const activeInstance = currentActiveTabId ? terminalInstances.get(currentActiveTabId) : null;
      if (activeInstance && currentActiveTabId) {
        try {
          if (activeInstance.containerEl.offsetWidth > 0 && activeInstance.containerEl.offsetHeight > 0) {
            activeInstance.fitAddon.fit();
            mainAPI.resizeTerminal(currentActiveTabId, activeInstance.terminal.cols, activeInstance.terminal.rows);
          }
        } catch {
          // Ignore fit errors
        }
        // Only reclaim focus if nothing outside the terminal holds it — the
        // user may have left the caret in the URL bar before sleeping.
        const active = document.activeElement;
        const focusIsLoose = !active || active === document.body || active === document.documentElement;
        if (focusIsLoose || activeInstance.containerEl.contains(active)) {
          activeInstance.terminal.blur();
          activeInstance.terminal.focus();
        }
      }

      if (!mainAPI.isTerminalAlive) return;
      for (const tabId of createdTabs) {
        mainAPI.isTerminalAlive(tabId).then((alive) => {
          if (!alive) markTerminalDead(tabId);
        }).catch(() => {
          // Probe failed — leave the tab alone rather than declaring it dead
        });
      }
    });
  }, []);

  // Create terminal for a tab
  const createTerminalForTab = useCallback((tabId: string) => {
    if (terminalInstances.has(tabId)) return;

    const mainAPI = getMainAPI();

    const terminal = new XTerm({
      cursorBlink: true,
      macOptionIsMeta: true,
      fontSize: fontSizeRef.current,
      fontFamily: '"SF Mono", Monaco, "Cascadia Code", "Consolas", monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
        cursorAccent: '#1a1a1a',
        selectionBackground: '#444',
        black: '#1a1a1a',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#8b5cf6',
        cyan: '#06b6d4',
        white: '#e5e5e5',
        brightBlack: '#525252',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#a78bfa',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      allowTransparency: false,
      // Every tab's buffer stays in memory for the whole session (2+ tabs per
      // project), so keep scrollback generous but not extravagant.
      scrollback: 4000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    const containerEl = document.createElement('div');
    containerEl.className = 'terminal-tab-content';
    containerEl.style.cssText = 'width: 100%; height: 100%; display: none;';

    terminalInstances.set(tabId, { terminal, fitAddon, containerEl });
    terminal.open(containerEl);

    // Flush any text queued via writeToTerminal() before the instance existed.
    const pending = pendingTerminalWrites.get(tabId);
    if (pending) {
      for (const text of pending) terminal.write(text);
      pendingTerminalWrites.delete(tabId);
    }

    if (mainAPI && !createdTabs.has(tabId)) {
      createdTabs.add(tabId);
      tabSpawnConfig.set(tabId, { cwd: projectPathRef.current, shell: shellRef.current });
      mainAPI.createTerminal(tabId, projectPathRef.current, shellRef.current);

      terminal.onData((data) => {
        if (deadTabs.has(tabId)) {
          // Nothing is listening on the other end. Enter restarts the shell;
          // everything else would vanish silently, so drop it.
          if (data === '\r' || data === '\n') respawnTerminal(tabId);
          return;
        }
        mainAPI.sendTerminalInput(tabId, data);
      });
    } else if (!mainAPI) {
      terminal.writeln('\x1b[1;35m  Claude Code \x1b[0m');
      terminal.writeln('');
      terminal.writeln('\x1b[33mRunning in browser preview mode.\x1b[0m');
      terminal.writeln('');
      terminal.write('\x1b[32m$ \x1b[0m');
    }
  }, []);

  // Create new tab
  const createNewTab = useCallback(() => {
    const newCounter = tabCounter + 1;
    const newTabId = `${sessionId}-${newCounter}`;
    const newTab: TerminalTab = {
      id: newTabId,
      name: `Terminal ${newCounter}`,
    };
    onTabsChange([...tabs, newTab], newTabId, newCounter);
  }, [sessionId, tabs, tabCounter, onTabsChange]);

  // Close tab
  const closeTab = useCallback((tabId: string) => {
    const mainAPI = getMainAPI();
    const instance = terminalInstances.get(tabId);

    if (instance) {
      instance.terminal.dispose();
      instance.containerEl.remove();
      terminalInstances.delete(tabId);
    }

    if (mainAPI) {
      mainAPI.destroyTerminal(tabId);
    }
    createdTabs.delete(tabId);
    deadTabs.delete(tabId);
    tabSpawnConfig.delete(tabId);

    const filtered = tabs.filter(t => t.id !== tabId);
    if (filtered.length === 0) {
      // Create a new tab if all are closed
      const newCounter = tabCounter + 1;
      const newTabId = `${sessionId}-${newCounter}`;
      onTabsChange([{ id: newTabId, name: `Terminal ${newCounter}` }], newTabId, newCounter);
    } else {
      // Switch to another tab if closing active
      let newActiveId = activeTabId;
      if (tabId === activeTabId) {
        const index = tabs.findIndex(t => t.id === tabId);
        const newActiveIndex = Math.max(0, index - 1);
        newActiveId = filtered[newActiveIndex]?.id || filtered[0].id;
      }
      onTabsChange(filtered, newActiveId, tabCounter);
    }
  }, [tabs, activeTabId, sessionId, tabCounter, onTabsChange]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+T or Ctrl+T: New tab
      if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        createNewTab();
      }
      // Close tab: Cmd+W on macOS, Ctrl+Shift+W elsewhere (plain Ctrl+W
      // belongs to the shell — readline's delete-word). Only when focus is
      // inside the terminal pane, so the shortcut can't kill a running PTY
      // from the URL bar, and confirmed like the tab close button.
      const isMac = navigator.platform.includes('Mac');
      const closeCombo = isMac
        ? e.metaKey && !e.shiftKey && e.key === 'w'
        : e.ctrlKey && e.shiftKey && (e.key === 'w' || e.key === 'W');
      if (closeCombo) {
        if (!rootRef.current?.contains(document.activeElement)) return;
        e.preventDefault();
        const tab = tabs.find(t => t.id === activeTabId);
        appConfirm({ title: `Close "${tab?.name || 'terminal'}"?`, confirmLabel: 'Close' }).then((ok) => {
          if (ok) closeTab(activeTabId);
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createNewTab, closeTab, activeTabId, tabs]);

  // Create and manage terminal instances for tabs
  useEffect(() => {
    if (!wrapperRef.current) return;

    const mainAPI = getMainAPI();

    // Create terminals for all tabs (not just active) so background tabs work
    for (const tab of tabs) {
      createTerminalForTab(tab.id);
    }

    const instance = terminalInstances.get(activeTabId);
    if (!instance) return;

    // Ensure all terminal containers are in the wrapper
    for (const [id, inst] of terminalInstances) {
      if (!wrapperRef.current.contains(inst.containerEl)) {
        wrapperRef.current.appendChild(inst.containerEl);
      }
      inst.containerEl.style.display = id === activeTabId ? 'block' : 'none';
    }

    // Fit and signal ready
    const initTimeout = setTimeout(() => {
      try {
        if (instance.containerEl.offsetWidth > 0 && instance.containerEl.offsetHeight > 0) {
          instance.fitAddon.fit();
          instance.terminal.scrollToBottom();
          if (mainAPI) {
            mainAPI.resizeTerminal(activeTabId, instance.terminal.cols, instance.terminal.rows);
            mainAPI.terminalReady(activeTabId);
          }
        }
      } catch {
        // Ignore fit errors
      }
    }, 50);

    // Handle resize (debounced to avoid fitting during CSS transitions)
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          if (instance.containerEl.offsetWidth > 0 && instance.containerEl.offsetHeight > 0) {
            instance.fitAddon.fit();
            instance.terminal.scrollToBottom();
            if (mainAPI) {
              mainAPI.resizeTerminal(activeTabId, instance.terminal.cols, instance.terminal.rows);
            }
          }
        } catch {
          // Ignore fit errors
        }
      }, 150);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(wrapperRef.current);
    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(initTimeout);
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [activeTabId, tabs, createTerminalForTab]);

  // Focus terminal when tab changes
  useEffect(() => {
    currentActiveTabId = activeTabId;
    const instance = terminalInstances.get(activeTabId);
    if (instance) {
      setTimeout(() => instance.terminal.focus(), 100);
    }
  }, [activeTabId]);

  // Refit terminal when collapsed state or todo section changes
  useEffect(() => {
    if (collapsed) return;
    const instance = terminalInstances.get(activeTabId);
    if (!instance) return;
    const mainAPI = getMainAPI();

    const fitTerminal = () => {
      try {
        if (instance.containerEl.offsetWidth > 0 && instance.containerEl.offsetHeight > 0) {
          instance.fitAddon.fit();
          instance.terminal.scrollToBottom();
          if (mainAPI) {
            mainAPI.resizeTerminal(activeTabId, instance.terminal.cols, instance.terminal.rows);
          }
        }
      } catch { /* ignore */ }
    };

    // Wait for CSS transition (200ms) to complete, then fit
    const timer1 = setTimeout(fitTerminal, 250);
    // Second fit as safety net after everything has settled
    const timer2 = setTimeout(fitTerminal, 500);
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [collapsed, hasTodoItems, activeTabId]);

  // Handle drag and drop for files - use capture phase to intercept before xterm
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      wrapper.classList.add('drag-over');
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Only remove class if we're actually leaving the wrapper
      const rect = wrapper.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        wrapper.classList.remove('drag-over');
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      wrapper.classList.remove('drag-over');

      const mainAPI = getMainAPI();
      if (!mainAPI || !e.dataTransfer?.files.length) return;

      const imagePaths: string[] = [];
      const otherPaths: string[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        const filePath = mainAPI.getPathForFile?.(file);
        if (!filePath) continue;
        if (file.type.startsWith('image/')) {
          imagePaths.push(filePath);
        } else {
          otherPaths.push(filePath);
        }
      }

      // Image files: write each to the OS clipboard and trigger the CLI's
      // Ctrl+V image paste so it attaches as "[Image #N]" instead of a raw
      // path. Run sequentially so each Ctrl+V reads its own clipboard image.
      if (imagePaths.length > 0) {
        (async () => {
          for (const p of imagePaths) {
            await mainAPI.pasteImageToTerminal?.(activeTabId, p);
          }
        })();
      }

      // Non-image files: paste paths as text, space-separated and shell-escaped.
      if (otherPaths.length > 0) {
        const escaped = otherPaths.map(p => p.includes(' ') ? `"${p}"` : p).join(' ');
        mainAPI.sendTerminalInput(activeTabId, escaped);
      }
    };

    // Use capture phase to intercept events before xterm handles them
    wrapper.addEventListener('dragover', handleDragOver, true);
    wrapper.addEventListener('dragleave', handleDragLeave, true);
    wrapper.addEventListener('drop', handleDrop, true);

    return () => {
      wrapper.removeEventListener('dragover', handleDragOver, true);
      wrapper.removeEventListener('dragleave', handleDragLeave, true);
      wrapper.removeEventListener('drop', handleDrop, true);
    };
  }, [activeTabId]);

  // Terminal font size zoom
  const handleTerminalZoom = useCallback((direction: string) => {
    setFontSize((prev) => {
      let next: number;
      if (direction === 'reset') {
        next = DEFAULT_FONT_SIZE;
      } else if (direction === 'in') {
        next = Math.min(MAX_FONT_SIZE, prev + 1);
      } else {
        next = Math.max(MIN_FONT_SIZE, prev - 1);
      }
      const mainAPI = getMainAPI();
      for (const [tabId, inst] of terminalInstances) {
        inst.terminal.options.fontSize = next;
        try {
          if (inst.containerEl.offsetWidth > 0 && inst.containerEl.offsetHeight > 0) {
            inst.fitAddon.fit();
            if (mainAPI) {
              mainAPI.resizeTerminal(tabId, inst.terminal.cols, inst.terminal.rows);
            }
          }
        } catch { /* ignore fit errors */ }
      }
      return next;
    });
  }, []);

  // Expose zoom handler to parent via ref
  useEffect(() => {
    if (onZoom) {
      onZoom.current = handleTerminalZoom;
    }
    return () => {
      if (onZoom) onZoom.current = null;
    };
  }, [onZoom, handleTerminalZoom]);

  return (
    <div className="terminal-container" ref={rootRef}>
      {hasTodoItems && (
        <div className="todo-section">
          <div className="todo-header">Todo</div>
          {children}
        </div>
      )}
      <div className="terminal-tabs-bar">
        <div className="terminal-tabs">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`terminal-tab ${tab.id === activeTabId ? 'active' : ''}`}
              onClick={() => onTabsChange(tabs, tab.id, tabCounter)}
            >
              {tab.id === cliToolTabId && cliToolRunning && <span className="cli-spinner" />}
              {editingTabId === tab.id ? (
                <input
                  className="terminal-tab-rename-input"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => {
                    const trimmed = editingName.trim();
                    if (trimmed && trimmed !== tab.name) {
                      const updatedTabs = tabs.map(t => t.id === tab.id ? { ...t, name: trimmed } : t);
                      onTabsChange(updatedTabs, activeTabId, tabCounter);
                    }
                    setEditingTabId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                    } else if (e.key === 'Escape') {
                      setEditingTabId(null);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span
                  className="terminal-tab-name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingTabId(tab.id);
                    setEditingName(tab.name);
                  }}
                >
                  {tab.name}
                </span>
              )}
              <button
                className="terminal-tab-close"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (await appConfirm({ title: `Close "${tab.name}"?`, confirmLabel: 'Close' })) {
                    closeTab(tab.id);
                  }
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          ))}
        </div>
        <button className="terminal-new-tab" onClick={createNewTab} title="New tab (⌘T)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </div>
      <div
        ref={wrapperRef}
        className="terminal-content"
      />
    </div>
  );
}

// Cleanup function for when sessions are closed
export function destroyTerminalSession(sessionId: string) {
  const mainAPI = getMainAPI();

  // Destroy all tabs for this session
  for (const [tabId, instance] of terminalInstances) {
    if (tabId.startsWith(sessionId)) {
      instance.terminal.dispose();
      instance.containerEl.remove();
      terminalInstances.delete(tabId);

      if (mainAPI) {
        mainAPI.destroyTerminal(tabId);
      }
      createdTabs.delete(tabId);
      deadTabs.delete(tabId);
      tabSpawnConfig.delete(tabId);
    }
  }
}
