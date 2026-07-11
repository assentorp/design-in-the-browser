import { useState, useMemo, useEffect, useRef } from 'react';
import { initAnalytics } from '../analytics';
import type { ProjectPreset, CliTool, ShellType, CodeEditor } from '../../shared/types';
// 128px copy of build/icon.png — the full 1024px app icon is 726 KB and was
// getting bundled into the renderer just to render at 56–64px.
import appIcon from '../assets/icon-128.png';

interface ProjectConfigModalProps {
  presets: ProjectPreset[];
  canClose: boolean;
  onClose: () => void;
  onCreate: (config: {
    name: string;
    path: string;
    startCommand: string;
    url: string;
    cliTool: CliTool;
    shell: ShellType;
    saveAsPreset: boolean;
    claudeModel: string;
    dangerouslySkipPermissions: boolean;
    customCliCommand: string;
    usesStaticServer?: boolean;
  }) => void;
  onDeletePreset: (presetId: string) => void;
  onUpdatePreset: (preset: ProjectPreset) => void;
}

type View = 'list' | 'new' | 'edit';
type ProjectType = 'existing' | 'starter';

const presetInitials = (name: string): string => {
  const words = name.trim().split(/[\s\-_./]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

const cliToolLabel = (preset: ProjectPreset): string => {
  const tool = preset.cliTool || 'claude';
  if (tool === 'custom') {
    const firstToken = (preset.customCliCommand || '').trim().split(/\s+/)[0] || '';
    const base = firstToken.split(/[/\\]/).pop();
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Custom';
  }
  return tool.charAt(0).toUpperCase() + tool.slice(1);
};

const timeAgo = (ts: number): string => {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
};

const timeGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

export default function ProjectConfigModal({
  presets,
  canClose,
  onClose,
  onCreate,
  onDeletePreset,
  onUpdatePreset,
}: ProjectConfigModalProps) {
  const hasPresets = presets.length > 0;

  const [view, setView] = useState<View>(hasPresets ? 'list' : 'new');
  const [name, setName] = useState('');

  // Update view when presets become available
  useEffect(() => {
    if (hasPresets && view === 'new') {
      setView('list');
    }
  }, [hasPresets]);
  const [path, setPath] = useState('');
  const [startCommand, setStartCommand] = useState('npm run dev');
  const [url, setUrl] = useState('http://localhost:3000');
  const [cliTool, setCliTool] = useState<CliTool>('claude');
  const [shell, setShell] = useState<ShellType>('default');
  const [saveAsPreset, setSaveAsPreset] = useState(true);
  const [claudeModel, setClaudeModel] = useState('');
  const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(false);
  const [customCliCommand, setCustomCliCommand] = useState('');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [isWindows, setIsWindows] = useState(false);
  const [wslAvailable, setWslAvailable] = useState(false);

  // Onboarding + analytics consent: null = loading, true = done, false = not yet
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const [analyticsConsentGiven, setAnalyticsConsentGiven] = useState<boolean | null>(null);

  useEffect(() => {
    window.mainAPI?.getSettings().then((s) => {
      setOnboardingCompleted(s.onboardingCompleted);
      setAnalyticsConsentGiven(s.analyticsConsentGiven);
      setDiscordDismissed(s.discordDismissed);
    });
  }, []);

  const handleOnboardingContinue = () => {
    setOnboardingCompleted(true);
    window.mainAPI?.saveSettings({ onboardingCompleted: true });
  };

  const [discordDismissed, setDiscordDismissed] = useState<boolean | null>(null);

  const handleAnalyticsChoice = (enabled: boolean) => {
    setAnalyticsConsentGiven(true);
    window.mainAPI?.saveSettings({ analyticsEnabled: enabled, analyticsConsentGiven: true });
    if (enabled) {
      initAnalytics();
    }
  };

  // Editor selection during onboarding
  const [editorChosen, setEditorChosen] = useState<boolean | null>(null);
  const [availableEditors, setAvailableEditors] = useState<CodeEditor[]>([]);
  const [selectedEditor, setSelectedEditor] = useState<CodeEditor>('builtin');

  const EDITOR_LABELS: Record<CodeEditor, string> = {
    builtin: 'Built In (Recommended)',
    vscode: 'VS Code',
    cursor: 'Cursor',
    zed: 'Zed',
    sublime: 'Sublime Text',
    webstorm: 'WebStorm',
    nova: 'Nova',
  };

  useEffect(() => {
    window.mainAPI?.detectEditors().then((editors) => {
      setAvailableEditors(editors);
      if (editors.length > 0) setSelectedEditor(editors[0]);
    });
    window.mainAPI?.getSettings().then((s) => {
      // Existing users who already completed onboarding skip the editor screen
      setEditorChosen(s.editorChosen || s.onboardingCompleted);
      if (s.editor) setSelectedEditor(s.editor as CodeEditor);
    });
  }, []);

  const handleEditorContinue = () => {
    setEditorChosen(true);
    window.mainAPI?.saveSettings({ editor: selectedEditor, editorChosen: true });
  };

  // Check platform and WSL availability
  useEffect(() => {
    const platform = window.mainAPI?.getPlatform?.();
    const isWin = platform === 'win32';
    setIsWindows(isWin);

    if (isWin && window.mainAPI?.checkWslAvailable) {
      window.mainAPI.checkWslAvailable().then(setWslAvailable);
    }
  }, []);

  const filteredPresets = useMemo(() => {
    if (!search.trim()) return presets;
    const q = search.toLowerCase();
    return presets.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
    );
  }, [presets, search]);

  // Project favicons and preview thumbnails, resolved by the main process.
  // Map value: undefined = not requested yet, null = none found.
  const [favicons, setFavicons] = useState<Record<string, string | null>>({});
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const requestedArtRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const api = window.mainAPI;
    let cancelled = false;
    for (const preset of presets) {
      if (requestedArtRef.current.has(preset.id)) continue;
      requestedArtRef.current.add(preset.id);
      api?.getProjectFavicon?.(preset.path)
        .then((dataUrl) => {
          if (!cancelled) setFavicons((prev) => ({ ...prev, [preset.id]: dataUrl }));
        })
        .catch(() => {
          if (!cancelled) setFavicons((prev) => ({ ...prev, [preset.id]: null }));
        });
      api?.getProjectPreview?.(preset.path)
        .then((dataUrl) => {
          if (!cancelled) setPreviews((prev) => ({ ...prev, [preset.id]: dataUrl }));
        })
        .catch(() => {
          if (!cancelled) setPreviews((prev) => ({ ...prev, [preset.id]: null }));
        });
    }
    return () => { cancelled = true; };
  }, [presets]);

  // Most recently opened first; never-opened presets keep their saved order.
  const sortedPresets = useMemo(
    () => [...filteredPresets].sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0)),
    [filteredPresets]
  );

  const handleOpenPreset = async (preset: ProjectPreset) => {
    // Stamp last-opened so the cards can sort and show recency
    onUpdatePreset({ ...preset, lastOpenedAt: Date.now() });
    let url = preset.url || 'http://localhost:3000';
    if (preset.usesStaticServer) {
      try {
        const port = await window.mainAPI.startStaticServer(preset.path);
        url = `http://localhost:${port}/`;
      } catch (err) {
        console.error('Failed to start static server for preset:', err);
      }
    }
    onCreate({
      name: preset.name,
      path: preset.path,
      startCommand: preset.startCommand,
      url,
      cliTool: preset.cliTool || 'claude',
      shell: preset.shell || 'default',
      saveAsPreset: false,
      claudeModel: preset.claudeModel || '',
      dangerouslySkipPermissions: preset.dangerouslySkipPermissions || false,
      customCliCommand: preset.customCliCommand || '',
      usesStaticServer: preset.usesStaticServer,
    });
  };

  const handleEditPreset = (preset: ProjectPreset) => {
    setEditingPresetId(preset.id);
    setName(preset.name);
    setPath(preset.path);
    setStartCommand(preset.startCommand);
    setUrl(preset.url || 'http://localhost:3000');
    setCliTool(preset.cliTool || 'claude');
    setShell(preset.shell || 'default');
    setClaudeModel(preset.claudeModel || '');
    setDangerouslySkipPermissions(preset.dangerouslySkipPermissions || false);
    setCustomCliCommand(preset.customCliCommand || '');
    setView('edit');
  };

  const handleNewProject = () => {
    setEditingPresetId(null);
    setName('');
    setPath('');
    setStartCommand('npm run dev');
    setUrl('http://localhost:3000');
    setCliTool('claude');
    setShell('default');
    setClaudeModel('');
    setDangerouslySkipPermissions(false);
    setCustomCliCommand('');
    setSaveAsPreset(true);
    setProjectType('existing');
    setStarterError(null);
    setStarterBusy(false);
    setView('new');
  };

  const [projectType, setProjectType] = useState<ProjectType>('existing');
  const [starterError, setStarterError] = useState<string | null>(null);
  const [starterBusy, setStarterBusy] = useState(false);

  const handleBack = () => {
    setView('list');
    setEditingPresetId(null);
  };

  const handleBrowse = async () => {
    try {
      const selectedPath = await window.mainAPI.showOpenDialog();
      if (selectedPath) {
        setPath(selectedPath);
        if (!name) {
          const folderName = selectedPath.split('/').pop() || '';
          setName(folderName);
        }
      }
    } catch (err) {
      console.error('Failed to open folder dialog:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (cliTool === 'custom' && !customCliCommand.trim()) return;

    // Starter Project (only available when creating, not editing)
    if (view === 'new' && projectType === 'starter') {
      if (starterBusy) return;
      setStarterError(null);
      setStarterBusy(true);
      try {
        const result = await window.mainAPI.createNewWebpage(name.trim());
        if ('cancelled' in result) {
          setStarterBusy(false);
          return;
        }
        const port = await window.mainAPI.startStaticServer(result.path);
        onCreate({
          name: name.trim(),
          path: result.path,
          startCommand: '',
          url: `http://localhost:${port}/`,
          cliTool,
          shell,
          saveAsPreset,
          claudeModel: cliTool === 'claude' ? claudeModel : '',
          dangerouslySkipPermissions: cliTool === 'claude' ? dangerouslySkipPermissions : false,
          customCliCommand: cliTool === 'custom' ? customCliCommand.trim() : '',
          usesStaticServer: true,
        });
      } catch (err) {
        setStarterError(err instanceof Error ? err.message : String(err));
        setStarterBusy(false);
      }
      return;
    }

    // Existing Project flow (requires path)
    if (!path.trim()) return;

    // Update existing preset if editing
    if (editingPresetId) {
      onUpdatePreset({
        id: editingPresetId,
        name: name.trim(),
        path: path.trim(),
        startCommand: startCommand.trim(),
        url: url.trim() || 'http://localhost:3000',
        cliTool,
        shell,
        claudeModel: cliTool === 'claude' ? claudeModel : undefined,
        dangerouslySkipPermissions: cliTool === 'claude' ? dangerouslySkipPermissions : undefined,
        customCliCommand: cliTool === 'custom' ? customCliCommand.trim() : undefined,
      });
    }

    onCreate({
      name: name.trim(),
      path: path.trim(),
      startCommand: startCommand.trim(),
      url: url.trim() || 'http://localhost:3000',
      cliTool,
      shell,
      saveAsPreset: !editingPresetId && saveAsPreset,
      claudeModel: cliTool === 'claude' ? claudeModel : '',
      dangerouslySkipPermissions: cliTool === 'claude' ? dangerouslySkipPermissions : false,
      customCliCommand: cliTool === 'custom' ? customCliCommand.trim() : '',
    });
  };

  const isStarter = view === 'new' && projectType === 'starter';
  const isValid = name.trim()
    && (isStarter || path.trim())
    && (cliTool !== 'custom' || customCliCommand.trim());
  const canFilter = presets.length > 3;

  const toggleSearch = () => {
    setSearchOpen((open) => {
      if (open) setSearch('');
      return !open;
    });
  };

  // Cmd/Ctrl+F opens the project filter while the list is showing
  useEffect(() => {
    if (view !== 'list' || !canFilter) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F') && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, canFilter]);

  // --- Shared header ---
  const title = view === 'edit' ? 'Edit Project'
    : hasPresets ? 'New Project'
    : 'Create your first project';

  const showBack = view !== 'list' && hasPresets;

  // The project list carries its actions in a toolbar inside the body, so it
  // gets no title bar — just a close button when shown as a modal. Form views
  // keep the classic back/title/close header.
  const panelHeader = view === 'list' ? (
    canClose ? (
      <div className="modal-header modal-header-bare">
        <span className="modal-header-spacer" />
        <button className="modal-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    ) : null
  ) : (
    <div className="modal-header">
      {showBack ? (
        <button type="button" className="btn-back" onClick={handleBack}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          Back
        </button>
      ) : <span className="modal-header-spacer" />}
      <h2>{title}</h2>
      {canClose ? (
        <button className="modal-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      ) : <span className="modal-header-spacer" />}
    </div>
  );

  // --- List body ---
  const listBody = (
    <div className="project-config">
      <div className="project-config-section">
        <div className="preset-toolbar">
          <span className="preset-count">
            {search.trim()
              ? `${filteredPresets.length} of ${presets.length}`
              : presets.length === 1 ? '1 project' : `${presets.length} projects`}
          </span>
          <div className="preset-toolbar-actions">
            {canFilter && (
              <button
                type="button"
                className={`preset-filter-btn${searchOpen ? ' active' : ''}`}
                onClick={toggleSearch}
                title="Filter projects (⌘F)"
                aria-label="Filter projects"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7"></circle>
                  <line x1="21" y1="21" x2="16.5" y2="16.5"></line>
                </svg>
              </button>
            )}
            <button type="button" className="btn btn-primary btn-new-project" onClick={handleNewProject}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              New Project
            </button>
          </div>
        </div>
        {searchOpen && (
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                if (search) setSearch('');
                else setSearchOpen(false);
              }
            }}
            placeholder="Filter by name or path…"
            className="form-input preset-search"
            autoFocus
          />
        )}
        <div className="preset-card-grid">
          {sortedPresets.map((preset, index) => {
            const favicon = favicons[preset.id];
            const preview = previews[preset.id];
            const sub = preset.lastOpenedAt
              ? `${cliToolLabel(preset)} · ${timeAgo(preset.lastOpenedAt)}`
              : cliToolLabel(preset);
            return (
              <div
                key={preset.id}
                className="preset-card"
                style={{ '--stagger': index } as React.CSSProperties}
                onClick={() => handleOpenPreset(preset)}
                title={preset.path}
              >
                <div className="preset-card-thumb">
                  {preview ? (
                    <img className="preset-card-preview" src={preview} alt="" />
                  ) : favicon ? (
                    <img className="preset-card-thumb-favicon" src={favicon} alt="" />
                  ) : (
                    <span className="preset-card-thumb-initials">{presetInitials(preset.name)}</span>
                  )}
                  <div className="preset-card-actions">
                    <button
                      type="button"
                      className="preset-item-btn preset-item-edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditPreset(preset);
                      }}
                      title="Edit"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="preset-item-btn preset-item-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeletePreset(preset.id);
                      }}
                      title="Remove"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="preset-card-meta">
                  <div className="preset-card-favicon-tile">
                    {favicon ? <img src={favicon} alt="" /> : presetInitials(preset.name)}
                  </div>
                  <div className="preset-card-text">
                    <span className="preset-card-name">{preset.name}</span>
                    <span className="preset-card-sub">{sub}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {filteredPresets.length === 0 && search && (
          <div className="preset-empty">
            <span>No projects match &ldquo;{search}&rdquo;</span>
            <button type="button" className="preset-empty-clear" onClick={() => setSearch('')}>
              Clear filter
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // --- Form body ---
  const formBody = (
    <div className="project-config">
      <div className="project-config-section">
        <form onSubmit={handleSubmit}>
          <div className="project-config-form">
            {view === 'new' && (
              <div className="form-group">
                <label>Type</label>
                <div className="project-type-toggle" role="radiogroup" aria-label="Project type">
                  <label className={`project-type-option${projectType === 'existing' ? ' active' : ''}`}>
                    <input
                      type="radio"
                      name="project-type"
                      value="existing"
                      checked={projectType === 'existing'}
                      onChange={() => setProjectType('existing')}
                    />
                    <span className="project-type-option-title">Existing Project</span>
                    <span className="project-type-option-desc">Point at a folder you already have.</span>
                  </label>
                  <label className={`project-type-option${projectType === 'starter' ? ' active' : ''}`}>
                    <input
                      type="radio"
                      name="project-type"
                      value="starter"
                      checked={projectType === 'starter'}
                      onChange={() => setProjectType('starter')}
                    />
                    <span className="project-type-option-title">Starter Project</span>
                    <span className="project-type-option-desc">Create a new folder with a ready-to-edit webpage.</span>
                  </label>
                </div>
              </div>
            )}
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isStarter ? 'my-first-page' : 'My Project'}
                className="form-input"
                autoFocus
                disabled={starterBusy}
              />
              {isStarter && (
                <span className="form-hint">
                  We'll ask where to save it, then create a folder with this name.
                </span>
              )}
            </div>
            {!isStarter && (
              <div className="form-group">
                <label>Path</label>
                <div className="path-input-wrapper">
                  <input
                    type="text"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="/path/to/project"
                    className="form-input"
                  />
                  <button type="button" className="browse-btn" onClick={handleBrowse}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                  </button>
                </div>
              </div>
            )}
            {!isStarter && (
              <div className="form-group">
                <label>Start Command</label>
                <input
                  type="text"
                  value={startCommand}
                  onChange={(e) => setStartCommand(e.target.value)}
                  placeholder="npm run dev"
                  className="form-input"
                />
              </div>
            )}
            {!isStarter && (
              <div className="form-group">
                <label>URL</label>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                  className="form-input"
                />
              </div>
            )}
            <div className="form-group">
              <label>CLI Tool</label>
              <select
                value={cliTool}
                onChange={(e) => setCliTool(e.target.value as CliTool)}
                className="form-select"
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
                <option value="cursor">Cursor</option>
                <option value="antigravity">Antigravity</option>
                <option value="qwen">Qwen</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            {cliTool === 'custom' && (
              <div className="form-group">
                <label>Custom Command</label>
                <input
                  type="text"
                  value={customCliCommand}
                  onChange={(e) => setCustomCliCommand(e.target.value)}
                  placeholder="gsd"
                  className="form-input"
                />
                <span className="form-hint">
                  Command to launch your CLI tool (e.g. <code>gsd</code>).
                </span>
              </div>
            )}
            {cliTool === 'claude' && (
              <div className="form-group">
                <label>Model</label>
                <select
                  value={claudeModel}
                  onChange={(e) => setClaudeModel(e.target.value)}
                  className="form-select"
                >
                  <option value="">Default</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="opus">Opus</option>
                  <option value="haiku">Haiku</option>
                </select>
              </div>
            )}
            {cliTool === 'claude' && (
              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    checked={dangerouslySkipPermissions}
                    onChange={(e) => setDangerouslySkipPermissions(e.target.checked)}
                  />
                  Bypass permission prompts
                </label>
                {dangerouslySkipPermissions && (
                  <span className="form-hint form-hint-warning">
                    Skips all permission checks. Only use in trusted projects you fully control.
                  </span>
                )}
              </div>
            )}
            {isWindows && wslAvailable && (
              <div className="form-group">
                <label>Shell</label>
                <select
                  value={shell}
                  onChange={(e) => setShell(e.target.value as ShellType)}
                  className="form-select"
                >
                  <option value="default">PowerShell</option>
                  <option value="wsl">WSL (Linux)</option>
                </select>
              </div>
            )}
            {starterError && (
              <span className="form-hint form-hint-warning">{starterError}</span>
            )}
            <div className="project-config-actions">
              <button type="submit" className="btn btn-primary" disabled={!isValid || starterBusy}>
                {starterBusy
                  ? 'Creating…'
                  : view === 'edit'
                    ? 'Open Project'
                    : isStarter
                      ? 'Choose Location & Create'
                      : 'Create Project'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );

  const body = view === 'list' ? listBody : formBody;

  // Full page on startup
  if (!canClose) {
    // Determine current onboarding step for dot indicators
    const onboardingStep = onboardingCompleted === false ? 0
      : editorChosen === false ? 1
      : analyticsConsentGiven === false ? 2
      : discordDismissed === false ? 3
      : -1;

    const stepDots = (step: number) => (
      <div className="onboarding-dots">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`onboarding-dot${i === step ? ' active' : ''}`} />
        ))}
      </div>
    );

    // Getting started screen
    if (onboardingStep === 0) {
      return (
        <div className="project-config-page">
          <div className="onboarding-card">
            <div className="onboarding-gate">
              <img className="onboarding-gate-appicon" src={appIcon} alt="Design In The Browser" />
              <h2 className="onboarding-gate-title">Let's get started</h2>
              <p className="onboarding-gate-subtitle">Make sure you have the following ready:</p>
              <div className="onboarding-checklist">
                <div className="onboarding-checklist-item">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>A local dev server for your project — or start from a built-in Starter Project</span>
                </div>
                <div className="onboarding-checklist-item">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>An AI coding CLI — Claude Code, Cursor, Codex, Antigravity, or Qwen</span>
                </div>
              </div>
              <button className="btn btn-primary onboarding-continue" onClick={handleOnboardingContinue}>
                Continue
              </button>
            </div>
          </div>
          {stepDots(0)}
        </div>
      );
    }

    // Editor selection screen
    if (onboardingStep === 1) {
      return (
        <div className="project-config-page">
          <div className="onboarding-card">
            <div className="onboarding-gate">
              <svg className="onboarding-gate-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 18l6-6-6-6" />
                <path d="M8 6l-6 6 6 6" />
              </svg>
              <h2 className="onboarding-gate-title">Code Editor</h2>
              <p className="onboarding-gate-text">
                Choose what the Code button opens. <strong>Built In</strong> lets you browse and edit your project right inside this app — no external editor needed. Or pick one you already have installed.
              </p>
              <div className="onboarding-editor-list">
                {availableEditors.map((editor) => (
                  <button
                    key={editor}
                    className={`onboarding-editor-option${selectedEditor === editor ? ' active' : ''}`}
                    onClick={() => setSelectedEditor(editor)}
                  >
                    {EDITOR_LABELS[editor]}
                  </button>
                ))}
                {availableEditors.length === 0 && (
                  <p className="onboarding-editor-empty">No editors detected</p>
                )}
              </div>
              <button className="btn btn-primary onboarding-continue" onClick={handleEditorContinue}>
                Continue
              </button>
            </div>
          </div>
          {stepDots(1)}
        </div>
      );
    }

    // Share analytics screen
    if (onboardingStep === 2) {
      return (
        <div className="project-config-page">
          <div className="onboarding-card">
            <div className="onboarding-gate">
              <svg className="onboarding-gate-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 20V10" />
                <path d="M12 20V4" />
                <path d="M6 20v-6" />
              </svg>
              <h2 className="onboarding-gate-title">Share Analytics</h2>
              <p className="onboarding-gate-text">
                Help improve Design In The Browser by sharing anonymous crash reports and usage events via PostHog (EU servers). No personal data, project content, or file paths are collected. You can change this anytime in Settings.
              </p>
              <button className="btn btn-primary onboarding-continue" onClick={() => handleAnalyticsChoice(true)}>
                Share with Developers
              </button>
              <button className="onboarding-skip" onClick={() => handleAnalyticsChoice(false)}>
                No thanks
              </button>
            </div>
          </div>
          {stepDots(2)}
        </div>
      );
    }

    // Discord screen
    if (onboardingStep === 3) {
      return (
        <div className="project-config-page">
          <div className="onboarding-card">
            <div className="onboarding-gate">
              <svg className="onboarding-gate-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 12a1 1 0 1 0 2 0 1 1 0 0 0-2 0" />
                <path d="M14 12a1 1 0 1 0 2 0 1 1 0 0 0-2 0" />
                <path d="M8.5 17c0 1-1.356 3-1.832 3-.906 0-2.168-3.16-2.668-5.5-.5-2.34-.5-4.5 0-7C4.5 5.5 6.5 4 8.5 3c1.5 1 3 1.5 3.5 1.5s2-0.5 3.5-1.5c2 1 4 2.5 4.5 4.5.5 2.5.5 4.66 0 7-.5 2.34-1.762 5.5-2.668 5.5C16.856 20 15.5 18 15.5 17" />
              </svg>
              <h2 className="onboarding-gate-title">Join the Community</h2>
              <p className="onboarding-gate-text">
                Get help, share feedback, and stay updated on new features in our Discord.
              </p>
              <button
                className="btn btn-primary onboarding-continue"
                onClick={() => {
                  window.open('https://discord.com/invite/dYGPPH6tPC');
                  setDiscordDismissed(true);
                  window.mainAPI?.saveSettings({ discordDismissed: true });
                }}
              >
                Join Discord
              </button>
              <button
                className="onboarding-skip"
                onClick={() => {
                  setDiscordDismissed(true);
                  window.mainAPI?.saveSettings({ discordDismissed: true });
                }}
              >
                No thanks
              </button>
            </div>
          </div>
          {stepDots(3)}
        </div>
      );
    }

    return (
      <div className={`project-config-page${view === 'list' ? ' project-config-page-full' : ''}`}>
        <div className="home-hero">
          <img className="home-hero-icon" src={appIcon} alt="" />
          <h1 className="home-hero-title">{timeGreeting()}</h1>
          <p className="home-hero-subtitle">
            {hasPresets
              ? 'Pick up where you left off, or start something new.'
              : 'Point at a project and start designing in the browser.'}
          </p>
        </div>
        {view === 'list' ? (
          // Full-width dashboard on startup — no panel chrome around the grid
          <div className="home-projects">{body}</div>
        ) : (
          <div className="modal modal-inline">
            {panelHeader}
            <div className="modal-body">{body}</div>
          </div>
        )}
      </div>
    );
  }

  // Modal when adding from tab bar
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal${view === 'list' ? ' modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        {panelHeader}
        <div className="modal-body">{body}</div>
      </div>
    </div>
  );
}
