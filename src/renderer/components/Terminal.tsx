import { useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalTab, ShellType } from '../../shared/types';

const getMainAPI = () => (typeof window !== 'undefined' ? window.mainAPI : undefined);

interface TerminalInstance {
  terminal: XTerm;
  fitAddon: FitAddon;
  containerEl: HTMLDivElement;
}

// Global state for terminal instances (keyed by tab ID)
const terminalInstances = new Map<string, TerminalInstance>();
const createdTabs = new Set<string>();
let dataListenerSetup = false;

export function scrollTerminalToBottom(tabId: string) {
  const instance = terminalInstances.get(tabId);
  if (instance) {
    instance.terminal.scrollToBottom();
  }
}

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
}

export default function Terminal({ sessionId, collapsed, tabs, activeTabId, tabCounter, onTabsChange, children, projectPath, shell, cliToolTabId, cliToolRunning, hasTodoItems }: TerminalProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const projectPathRef = useRef(projectPath);
  const shellRef = useRef(shell);
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
      }
    });
  }, []);

  // Create terminal for a tab
  const createTerminalForTab = useCallback((tabId: string) => {
    if (terminalInstances.has(tabId)) return;

    const mainAPI = getMainAPI();

    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 13,
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
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    const containerEl = document.createElement('div');
    containerEl.className = 'terminal-tab-content';
    containerEl.style.cssText = 'width: 100%; height: 100%; display: none;';

    terminalInstances.set(tabId, { terminal, fitAddon, containerEl });
    terminal.open(containerEl);

    if (mainAPI && !createdTabs.has(tabId)) {
      createdTabs.add(tabId);
      mainAPI.createTerminal(tabId, projectPathRef.current, shellRef.current);

      terminal.onData((data) => {
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
      // Cmd+W or Ctrl+W: Close tab
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        closeTab(activeTabId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createNewTab, closeTab, activeTabId]);

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
          if (mainAPI) {
            mainAPI.resizeTerminal(activeTabId, instance.terminal.cols, instance.terminal.rows);
            mainAPI.terminalReady(activeTabId);
          }
        }
      } catch {
        // Ignore fit errors
      }
    }, 50);

    // Handle resize
    const handleResize = () => {
      try {
        if (instance.containerEl.offsetWidth > 0 && instance.containerEl.offsetHeight > 0) {
          instance.fitAddon.fit();
          if (mainAPI) {
            mainAPI.resizeTerminal(activeTabId, instance.terminal.cols, instance.terminal.rows);
          }
        }
      } catch {
        // Ignore fit errors
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(wrapperRef.current);
    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(initTimeout);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [activeTabId, tabs, createTerminalForTab]);

  // Focus terminal when tab changes
  useEffect(() => {
    const instance = terminalInstances.get(activeTabId);
    if (instance) {
      setTimeout(() => instance.terminal.focus(), 100);
    }
  }, [activeTabId]);

  // Refit terminal when todo section appears/disappears
  useEffect(() => {
    const instance = terminalInstances.get(activeTabId);
    if (!instance) return;
    const mainAPI = getMainAPI();
    const timer = setTimeout(() => {
      try {
        if (instance.containerEl.offsetWidth > 0 && instance.containerEl.offsetHeight > 0) {
          instance.fitAddon.fit();
          if (mainAPI) {
            mainAPI.resizeTerminal(activeTabId, instance.terminal.cols, instance.terminal.rows);
          }
        }
      } catch { /* ignore */ }
    }, 50);
    return () => clearTimeout(timer);
  }, [hasTodoItems, activeTabId]);

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

      const paths: string[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        const filePath = mainAPI.getPathForFile?.(file);
        if (filePath) {
          paths.push(filePath);
        }
      }

      if (paths.length > 0) {
        // Paste file paths into the terminal, space-separated and shell-escaped
        const escaped = paths.map(p => p.includes(' ') ? `"${p}"` : p).join(' ');
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

  return (
    <div className="terminal-container">
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
              <span className="terminal-tab-name">{tab.name}</span>
              <button
                className="terminal-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
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
    }
  }
}
