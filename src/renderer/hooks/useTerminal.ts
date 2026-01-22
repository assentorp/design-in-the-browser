import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export function useTerminal(containerRef: React.RefObject<HTMLDivElement | null>) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"SF Mono", Monaco, "Cascadia Code", "Consolas", monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
        cursorAccent: '#1a1a1a',
        selectionBackground: '#444',
      },
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Send initial size
    window.mainAPI.resizeTerminal(terminal.cols, terminal.rows);

    // Handle user input
    terminal.onData((data) => {
      window.mainAPI.sendTerminalInput(data);
    });

    // Handle output
    window.mainAPI.onTerminalData((data) => {
      terminal.write(data);
    });

    return () => {
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [containerRef]);

  const fit = useCallback(() => {
    if (fitAddonRef.current && terminalRef.current) {
      fitAddonRef.current.fit();
      window.mainAPI.resizeTerminal(
        terminalRef.current.cols,
        terminalRef.current.rows
      );
    }
  }, []);

  return { terminal: terminalRef.current, fit };
}
