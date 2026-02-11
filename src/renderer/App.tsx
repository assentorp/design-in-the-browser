import { useState, useCallback, useRef, useEffect } from 'react';
import { initAnalytics, disableAnalytics } from './analytics';
import Browser, { type PendingEdit, type EditActions } from './components/Browser';
import Terminal, { destroyTerminalSession, scrollTerminalToBottom } from './components/Terminal';
import Resizer from './components/Resizer';
import TabBar from './components/TabBar';
import EditQueuePanel from './components/EditQueuePanel';
import ProjectConfigModal from './components/ProjectConfigModal';
import SettingsModal from './components/SettingsModal';
import WhatsNewModal from './components/WhatsNewModal';
import { changelog } from './changelog';
import type { Session, ProjectPreset, CliTool, ShellType, AnnotationData } from '../shared/types';
import { createSession } from '../shared/session';

// Prevent Electron from navigating when files are dragged onto the window
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

const generateId = () => Math.random().toString(36).substr(2, 9);

const CLI_COMMANDS: Record<CliTool, string> = {
  claude: 'claude',
  cursor: 'cursor',
  gemini: 'gemini',
  codex: 'codex',
};

interface UpdateInfo {
  version: string;
  url: string;
  downloading?: boolean;
  progress?: number;
  downloaded?: boolean;
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [annotateMode, setAnnotateMode] = useState(true);
  const [sessionCounter, setSessionCounter] = useState(0);
  const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);
  const [editActions, setEditActions] = useState<EditActions | null>(null);
  const editActionsRef = useRef<EditActions | null>(null);
  editActionsRef.current = editActions;
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showWhatsNewModal, setShowWhatsNewModal] = useState(false);
  const [hasUnseenChanges, setHasUnseenChanges] = useState(false);
  const [projectPresets, setProjectPresets] = useState<ProjectPreset[]>([]);
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const browserWidthRef = useRef(60);
  const savedBrowserWidthRef = useRef<number | null>(null);
  const saveWidthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommandsRef = useRef<{ sessionId: string; tabId: string; command: string }[]>([]);
  const sessionsRef = useRef<Session[]>(sessions);
  sessionsRef.current = sessions;
  const cliRunningRef = useRef<Set<string>>(new Set());
  const cliTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Load presets from disk on mount (with migration from localStorage)
  useEffect(() => {
    window.mainAPI?.getPresets().then((presets) => {
      // Migrate from localStorage if we have presets there but not in file
      const LEGACY_KEY = 'claudedesign-project-presets';
      const legacyData = localStorage.getItem(LEGACY_KEY);
      if (legacyData && presets.length === 0) {
        try {
          const legacyPresets = JSON.parse(legacyData) as ProjectPreset[];
          if (legacyPresets.length > 0) {
            window.mainAPI?.savePresets(legacyPresets);
            setProjectPresets(legacyPresets);
            localStorage.removeItem(LEGACY_KEY);
            console.log('[App] Migrated', legacyPresets.length, 'presets from localStorage');
          }
        } catch {
          // Ignore parse errors
        }
      } else {
        setProjectPresets(presets);
      }
      setPresetsLoaded(true);
    });
  }, []);

  // Show config modal on launch
  useEffect(() => {
    if (!presetsLoaded || sessions.length > 0) return;
    setShowConfigModal(true);
  }, [presetsLoaded]);

  // Listen for settings menu trigger
  useEffect(() => {
    const onSettingsOpen = (window as unknown as { onSettingsOpen?: (cb: () => void) => void }).onSettingsOpen;
    if (onSettingsOpen) {
      onSettingsOpen(() => setShowSettingsModal(true));
    }
  }, []);

  // Listen for What's New menu trigger
  useEffect(() => {
    const onWhatsNewOpen = (window as unknown as { onWhatsNewOpen?: (cb: () => void) => void }).onWhatsNewOpen;
    if (onWhatsNewOpen) {
      onWhatsNewOpen(() => handleOpenWhatsNew());
    }
  }, []);

  // Listen for Send Queued Edits shortcut (Cmd+E)
  useEffect(() => {
    const onSendQueuedEdits = (window as unknown as { onSendQueuedEdits?: (cb: () => void) => void }).onSendQueuedEdits;
    if (onSendQueuedEdits) {
      onSendQueuedEdits(() => {
        editActionsRef.current?.sendAll();
      });
    }
  }, []);


  // Check for unseen changelog on mount
  useEffect(() => {
    window.mainAPI?.getAppVersion().then((version) => {
      const lastSeen = localStorage.getItem('ditb-last-seen-version');
      if (lastSeen !== version) {
        setHasUnseenChanges(true);
      }
    });
  }, []);

  // Initialize PostHog conditionally based on analytics setting, and load saved browser width
  useEffect(() => {
    window.mainAPI?.getSettings().then((s) => {
      if (s.analyticsEnabled) {
        initAnalytics();
      } else {
        disableAnalytics();
      }
      if (s.browserWidthPercent != null) {
        savedBrowserWidthRef.current = s.browserWidthPercent;
        browserWidthRef.current = s.browserWidthPercent;
      }
    });
  }, []);

  // Detect CLI tool activity from terminal data
  useEffect(() => {
    if (!window.mainAPI?.onTerminalData) return;

    window.mainAPI.onTerminalData((tabId: string, data: string) => {
      const session = sessionsRef.current.find((s) => s.cliToolTabId === tabId);
      if (!session) return;

      const sid = session.id;

      // Ignore tiny data chunks (cursor blinks, TUI redraws) — these
      // shouldn't keep the "running" state alive after Claude finishes
      if (data.length <= 8) {
        // Still start the idle timer if we're currently marked as running
        // but don't reset an existing one for small chunks
        if (cliRunningRef.current.has(sid) && !cliTimersRef.current.has(sid)) {
          cliTimersRef.current.set(
            sid,
            setTimeout(() => {
              cliRunningRef.current.delete(sid);
              cliTimersRef.current.delete(sid);
              setSessions((prev) =>
                prev.map((s) => (s.id === sid ? { ...s, cliToolRunning: false } : s))
              );
            }, 1500)
          );
        }
        return;
      }

      // Clear existing idle timer for substantial output
      const existing = cliTimersRef.current.get(sid);
      if (existing) clearTimeout(existing);

      // Mark as running if not already
      if (!cliRunningRef.current.has(sid)) {
        cliRunningRef.current.add(sid);
        setSessions((prev) =>
          prev.map((s) => (s.id === sid ? { ...s, cliToolRunning: true } : s))
        );
      }

      // Set 1.5s idle timer (spinner only — queue is flushed manually via "Send Now")
      cliTimersRef.current.set(
        sid,
        setTimeout(() => {
          cliRunningRef.current.delete(sid);
          cliTimersRef.current.delete(sid);
          setSessions((prev) =>
            prev.map((s) => (s.id === sid ? { ...s, cliToolRunning: false } : s))
          );
        }, 1500)
      );
    });
  }, []);

  // Listen for update notifications
  useEffect(() => {
    if (window.mainAPI?.onUpdateAvailable) {
      window.mainAPI.onUpdateAvailable((info) => {
        setUpdateInfo(info);
      });
    }
    if (window.mainAPI?.onUpdateProgress) {
      window.mainAPI.onUpdateProgress((info) => {
        setUpdateInfo((prev) => prev ? { ...prev, downloading: true, progress: info.percent } : null);
      });
    }
    if (window.mainAPI?.onUpdateDownloaded) {
      window.mainAPI.onUpdateDownloaded(() => {
        setUpdateInfo((prev) => prev ? { ...prev, downloading: false, downloaded: true } : null);
      });
    }
  }, []);

  // Handle running queued commands after terminals are ready
  useEffect(() => {
    if (pendingCommandsRef.current.length === 0) return;

    const remaining: typeof pendingCommandsRef.current = [];

    for (const cmd of pendingCommandsRef.current) {
      const session = sessions.find((s) => s.id === cmd.sessionId);
      if (session && session.terminalTabs.some((t) => t.id === cmd.tabId)) {
        // Terminal tab exists, schedule the command
        setTimeout(() => {
          if (window.mainAPI && cmd.command) {
            window.mainAPI.runCommand(cmd.tabId, cmd.command);
          }
        }, 500);
      } else {
        remaining.push(cmd);
      }
    }

    pendingCommandsRef.current = remaining;
  }, [sessions]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  if (activeSession) {
    browserWidthRef.current = activeSession.browserWidth;
  }

  const updateSession = useCallback((sessionId: string, updates: Partial<Session>) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, ...updates } : s))
    );
  }, []);

  const handleAnnotation = useCallback((data: AnnotationData) => {
    window.mainAPI?.sendAnnotation(data);
    // Scroll terminal to bottom so the user sees the new prompt
    const session = sessionsRef.current.find((s) => s.id === activeSessionId);
    if (session?.cliToolTabId) {
      setTimeout(() => scrollTerminalToBottom(session.cliToolTabId!), 100);
    }
  }, [activeSessionId]);

  const handleResize = useCallback(
    (delta: number) => {
      const newWidth = Math.max(
        30,
        Math.min(70, browserWidthRef.current + (delta / window.innerWidth) * 100)
      );
      browserWidthRef.current = newWidth;
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSessionId ? { ...s, browserWidth: newWidth } : s))
      );
      // Debounce saving to settings
      if (saveWidthTimerRef.current) clearTimeout(saveWidthTimerRef.current);
      saveWidthTimerRef.current = setTimeout(() => {
        window.mainAPI?.saveSettings({ browserWidthPercent: newWidth });
      }, 500);
    },
    [activeSessionId]
  );

  const handleUrlChange = useCallback(
    (url: string) => {
      updateSession(activeSessionId, { url });
    },
    [activeSessionId, updateSession]
  );

  const handlePendingEditsChange = useCallback((edits: PendingEdit[], actions: EditActions) => {
    setPendingEdits(edits);
    setEditActions(actions);
    // Persist to session so edits survive tab switches
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSessionId ? { ...s, pendingEdits: edits.map((e) => ({ note: e.note, selector: e.selector, tagName: e.tagName, text: e.text, attributes: e.attributes })) } : s))
    );
  }, [activeSessionId]);

  const handleAnnotateModeChange = useCallback((enabled: boolean) => {
    setAnnotateMode(enabled);
  }, []);


  const toggleTerminal = useCallback(() => {
    if (!activeSession) return;
    updateSession(activeSessionId, {
      terminalCollapsed: !activeSession.terminalCollapsed,
    });
  }, [activeSessionId, activeSession, updateSession]);

  const handleTerminalTabsChange = useCallback(
    (tabs: Session['terminalTabs'], activeTabId: string, tabCounter: number) => {
      updateSession(activeSessionId, {
        terminalTabs: tabs,
        activeTerminalTabId: activeTabId,
        terminalTabCounter: tabCounter,
      });
    },
    [activeSessionId, updateSession]
  );

  const handleOpenWhatsNew = useCallback(() => {
    setShowWhatsNewModal(true);
    setHasUnseenChanges(false);
    window.mainAPI?.getAppVersion().then((version) => {
      localStorage.setItem('ditb-last-seen-version', version);
    });
  }, []);

  const handleNewSession = useCallback(() => {
    setShowConfigModal(true);
  }, []);

  const handleCreateProject = useCallback(
    (config: { name: string; path: string; startCommand: string; url: string; cliTool: CliTool; shell: ShellType; saveAsPreset: boolean; claudeModel: string; dangerouslySkipPermissions: boolean }) => {
      const newIndex = sessionCounter + 1;
      const newSession = createSession(
        { name: config.name, path: config.path, startCommand: config.startCommand, shell: config.shell },
        newIndex
      );
      newSession.url = config.url || 'http://localhost:3000';
      if (savedBrowserWidthRef.current != null) {
        newSession.browserWidth = savedBrowserWidthRef.current;
      }

      // Create two terminal tabs: Dev Server and CLI tool
      const devServerTabId = newSession.terminalTabs[0].id;
      const cliTabId = `${newSession.id}-2`;
      const cliLabel = config.cliTool.charAt(0).toUpperCase() + config.cliTool.slice(1);

      // Rename the first tab to Dev Server
      newSession.terminalTabs[0].name = 'Dev Server';

      // Add second tab for CLI tool
      newSession.terminalTabs.push({ id: cliTabId, name: cliLabel });
      newSession.terminalTabCounter = 2;

      // Mark dev server tab, CLI tab, and set CLI tab as active
      newSession.devServerTabId = devServerTabId;
      newSession.cliToolTabId = cliTabId;
      newSession.cliTool = config.cliTool;
      newSession.activeTerminalTabId = cliTabId;

      setSessions((prev) => [...prev, newSession]);
      setActiveSessionId(newSession.id);
      setSessionCounter(newIndex);
      setShowConfigModal(false);

      // Save as preset if requested
      if (config.saveAsPreset) {
        const newPreset: ProjectPreset = {
          id: generateId(),
          name: config.name,
          path: config.path,
          startCommand: config.startCommand,
          url: config.url,
          cliTool: config.cliTool,
          shell: config.shell,
          claudeModel: config.claudeModel || undefined,
          dangerouslySkipPermissions: config.dangerouslySkipPermissions || undefined,
        };
        setProjectPresets((prev) => {
          const updated = [...prev, newPreset];
          window.mainAPI?.savePresets(updated);
          return updated;
        });
      }

      // Queue commands to run after terminals are ready
      const commands: typeof pendingCommandsRef.current = [];

      if (config.startCommand) {
        commands.push({
          sessionId: newSession.id,
          tabId: devServerTabId,
          command: config.startCommand,
        });
      }

      let cliCommand = CLI_COMMANDS[config.cliTool];
      if (config.cliTool === 'claude') {
        if (config.claudeModel) cliCommand += ` --model ${config.claudeModel}`;
        if (config.dangerouslySkipPermissions) cliCommand += ' --dangerously-skip-permissions';
      }

      commands.push({
        sessionId: newSession.id,
        tabId: cliTabId,
        command: cliCommand,
      });

      pendingCommandsRef.current = [...pendingCommandsRef.current, ...commands];
    },
    [sessionCounter]
  );

  const handleDeletePreset = useCallback((presetId: string) => {
    setProjectPresets((prev) => {
      const updated = prev.filter((p) => p.id !== presetId);
      window.mainAPI?.savePresets(updated);
      return updated;
    });
  }, []);

  const handleUpdatePreset = useCallback((preset: ProjectPreset) => {
    setProjectPresets((prev) => {
      const updated = prev.map((p) => (p.id === preset.id ? preset : p));
      window.mainAPI?.savePresets(updated);
      return updated;
    });
  }, []);

  const handleCloseSession = useCallback(
    (sessionId: string) => {
      // Clean up CLI activity timer
      const timer = cliTimersRef.current.get(sessionId);
      if (timer) clearTimeout(timer);
      cliTimersRef.current.delete(sessionId);
      cliRunningRef.current.delete(sessionId);

      // Clear UI state if closing the active session
      if (sessionId === activeSessionId) {
        setPendingEdits([]);
        setEditActions(null);
        setAnnotateMode(true);
      }

      // Destroy the terminal for this session
      destroyTerminalSession(sessionId);

      // Remove saved session config
      setSessions((prev) => {
        const filtered = prev.filter((s) => s.id !== sessionId);
        if (filtered.length === 0) {
          // Show modal to create a new project instead of auto-creating
          setShowConfigModal(true);
          return filtered;
        }
        if (sessionId === activeSessionId) {
          const index = prev.findIndex((s) => s.id === sessionId);
          const newActiveIndex = Math.max(0, index - 1);
          setActiveSessionId(filtered[newActiveIndex]?.id || filtered[0].id);
        }
        return filtered;
      });
    },
    [activeSessionId, sessions]
  );

  const handleSelectSession = useCallback((sessionId: string) => {
    if (sessionId !== activeSessionId) {
      // Edit actions will be re-created by the Browser component when it mounts
      setEditActions(null);
      // Restore pending edits from the target session
      const targetSession = sessionsRef.current.find((s) => s.id === sessionId);
      setPendingEdits(targetSession?.pendingEdits || []);
    }
    setActiveSessionId(sessionId);
  }, [activeSessionId]);

  const updateBanner = updateInfo && (
    <div className="update-banner">
      <span>
        {updateInfo.downloaded ? (
          <>
            Version {updateInfo.version} ready.{' '}
            <button className="update-banner-action" onClick={() => window.mainAPI?.installUpdate()}>
              Restart to update
            </button>
          </>
        ) : updateInfo.downloading ? (
          <>Downloading update... {Math.round(updateInfo.progress || 0)}%</>
        ) : (
          <>
            Version {updateInfo.version} is available.{' '}
            <button className="update-banner-action" onClick={() => window.mainAPI?.downloadUpdate()}>
              Download update
            </button>
          </>
        )}
      </span>
      {!updateInfo.downloading && (
        <button className="update-banner-close" onClick={() => setUpdateInfo(null)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );

  // Handle case when no active session yet — show full-page config
  if (sessions.length === 0 || !activeSession) {
    return (
      <div className="app">
        {updateBanner}
        {presetsLoaded ? (
          <ProjectConfigModal
            presets={projectPresets}
            canClose={false}
            onClose={() => {}}
            onCreate={handleCreateProject}
            onDeletePreset={handleDeletePreset}
            onUpdatePreset={handleUpdatePreset}
          />
        ) : (
          <div className="app-loading">
            <div className="app-loading-spinner" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      {updateBanner}
      {showConfigModal && (
        <ProjectConfigModal
          presets={projectPresets}
          canClose={true}
          onClose={() => setShowConfigModal(false)}
          onCreate={handleCreateProject}
          onDeletePreset={handleDeletePreset}
          onUpdatePreset={handleUpdatePreset}
        />
      )}
      {showSettingsModal && (
        <SettingsModal onClose={() => setShowSettingsModal(false)} />
      )}
      {showWhatsNewModal && (
        <WhatsNewModal changelog={changelog} onClose={() => setShowWhatsNewModal(false)} />
      )}
      <TabBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onCloseSession={handleCloseSession}
        terminalCollapsed={activeSession.terminalCollapsed}
        onToggleTerminal={toggleTerminal}
        onOpenSettings={() => setShowSettingsModal(true)}
        onOpenWhatsNew={handleOpenWhatsNew}
        hasUnseenChanges={hasUnseenChanges}
      />
      <div className="panes">
        <div
          className="pane browser-pane"
          style={{
            width: activeSession.terminalCollapsed ? '100%' : `${activeSession.browserWidth}%`,
          }}
        >
          <Browser
            key={activeSessionId}
            sessionId={activeSessionId}
            url={activeSession.url}
            onUrlChange={handleUrlChange}
            annotateMode={annotateMode}
            onAnnotateModeChange={handleAnnotateModeChange}
            onPendingEditsChange={handlePendingEditsChange}
            activeTerminalTabId={activeSession.cliToolTabId || activeSession.activeTerminalTabId}
            projectPath={activeSession.projectPath}
            onAnnotation={handleAnnotation}
            cliRunning={activeSession.cliToolRunning}
            initialEdits={activeSession.pendingEdits}
          />
        </div>
        {!activeSession.terminalCollapsed && <Resizer onResize={handleResize} />}
        <div
          className={`pane terminal-pane ${activeSession.terminalCollapsed ? 'collapsed' : ''}`}
          style={{
            width: activeSession.terminalCollapsed ? '0%' : `${100 - activeSession.browserWidth}%`,
          }}
        >
          <Terminal
            key={activeSessionId}
            sessionId={activeSessionId}
            collapsed={activeSession.terminalCollapsed}
            tabs={activeSession.terminalTabs}
            activeTabId={activeSession.activeTerminalTabId}
            tabCounter={activeSession.terminalTabCounter}
            onTabsChange={handleTerminalTabsChange}
            projectPath={activeSession.projectPath}
            shell={activeSession.shell}
            cliToolTabId={activeSession.cliToolTabId}
            cliToolRunning={activeSession.cliToolRunning}
            hasTodoItems={pendingEdits.length > 0}
          >
            {pendingEdits.length > 0 && (
              <EditQueuePanel edits={pendingEdits} actions={editActions} cliRunning={activeSession.cliToolRunning} />
            )}
          </Terminal>
        </div>
      </div>
    </div>
  );
}