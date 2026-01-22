import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// Check if running in Electron (must be called at runtime, not module load time)
const getMainAPI = () => typeof window !== 'undefined' ? window.mainAPI : undefined;

export default function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return;

    // Create terminal
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

    terminal.open(containerRef.current);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Safe fit function that checks dimensions
    const safeFit = () => {
      try {
        const container = containerRef.current;
        if (!container || !fitAddonRef.current || !terminalRef.current) return;

        // Only fit if container has dimensions
        if (container.offsetWidth > 0 && container.offsetHeight > 0) {
          fitAddonRef.current.fit();
          return true;
        }
        return false;
      } catch {
        // Ignore fit errors
        return false;
      }
    };

    const mainAPI = getMainAPI();
    console.log('[Terminal] mainAPI available:', !!mainAPI);

    // Delay initial fit to ensure container has dimensions
    const initTimeout = setTimeout(() => {
      console.log('[Terminal] Fitting terminal...');
      if (safeFit() && mainAPI && terminalRef.current) {
        console.log('[Terminal] Resizing:', terminalRef.current.cols, terminalRef.current.rows);
        mainAPI.resizeTerminal(terminalRef.current.cols, terminalRef.current.rows);
      }
    }, 50);

    if (mainAPI) {
      console.log('[Terminal] Setting up IPC handlers');
      // Handle user input
      terminal.onData((data) => {
        console.log('[Terminal] Sending input:', data.length, 'chars');
        mainAPI.sendTerminalInput(data);
      });

      // Handle output from main process
      mainAPI.onTerminalData((data) => {
        console.log('[Terminal] Received data:', data.length, 'chars');
        terminal.write(data);
      });

      // Signal that terminal is ready to receive data
      console.log('[Terminal] Signaling ready');
      mainAPI.terminalReady();
    } else {
      console.log('[Terminal] No mainAPI - running in demo mode');
      // Demo mode for browser testing
      terminal.writeln('\x1b[1;35m  Claude Design \x1b[0m');
      terminal.writeln('');
      terminal.writeln('\x1b[33mRunning in browser preview mode.\x1b[0m');
      terminal.writeln('Run with Electron to connect to Claude Code.');
      terminal.writeln('');
      terminal.write('\x1b[32m$ \x1b[0m');
    }

    // Handle resize
    const handleResize = () => {
      if (safeFit() && mainAPI && terminalRef.current) {
        mainAPI.resizeTerminal(
          terminalRef.current.cols,
          terminalRef.current.rows
        );
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);
    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(initTimeout);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  return (
    <div className="terminal-container">
      <div className="terminal-header">
        <span className="terminal-title">Claude Code</span>
      </div>
      <div ref={containerRef} className="terminal-content" />
    </div>
  );
}
