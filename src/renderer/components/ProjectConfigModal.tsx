import { useState, useMemo, useEffect } from 'react';
import type { ProjectPreset, CliTool, ShellType } from '../../shared/types';

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
  }) => void;
  onDeletePreset: (presetId: string) => void;
  onUpdatePreset: (preset: ProjectPreset) => void;
}

type View = 'list' | 'new' | 'edit';

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
  const [path, setPath] = useState('');
  const [startCommand, setStartCommand] = useState('npm run dev');
  const [url, setUrl] = useState('http://localhost:3000');
  const [cliTool, setCliTool] = useState<CliTool>('claude');
  const [shell, setShell] = useState<ShellType>('default');
  const [saveAsPreset, setSaveAsPreset] = useState(true);
  const [search, setSearch] = useState('');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [isWindows, setIsWindows] = useState(false);
  const [wslAvailable, setWslAvailable] = useState(false);

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

  const handleOpenPreset = (preset: ProjectPreset) => {
    onCreate({
      name: preset.name,
      path: preset.path,
      startCommand: preset.startCommand,
      url: preset.url || 'http://localhost:3000',
      cliTool: preset.cliTool || 'claude',
      shell: preset.shell || 'default',
      saveAsPreset: false,
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
    setSaveAsPreset(true);
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
    setSaveAsPreset(true);
    setView('new');
  };

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;

    // Update existing preset if editing
    if (editingPresetId && saveAsPreset) {
      onUpdatePreset({
        id: editingPresetId,
        name: name.trim(),
        path: path.trim(),
        startCommand: startCommand.trim(),
        url: url.trim() || 'http://localhost:3000',
        cliTool,
        shell,
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
    });
  };

  const isValid = name.trim() && path.trim();
  const showSearch = presets.length > 4;

  // --- List view: saved projects + "New project" button ---
  const listContent = (
    <div className="project-config">
      <div className="project-config-section">
        {showSearch && (
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter projects..."
            className="form-input preset-search"
            autoFocus
          />
        )}
        <div className="preset-grid">
          {filteredPresets.map((preset) => (
            <div
              key={preset.id}
              className="preset-item"
              onClick={() => handleOpenPreset(preset)}
            >
              <div className="preset-item-info">
                <span className="preset-item-name">{preset.name}</span>
                <span className="preset-item-path">{preset.path}</span>
              </div>
              <div className="preset-item-actions">
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
          ))}
          {filteredPresets.length === 0 && search && (
            <div className="preset-empty">No matches</div>
          )}
        </div>
        <button type="button" className="btn btn-new-project" onClick={handleNewProject}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          New Project
        </button>
      </div>
    </div>
  );

  // --- Form view: new or edit ---
  const formContent = (
    <div className="project-config">
      <div className="project-config-section">
        {hasPresets && (
          <button type="button" className="btn-back" onClick={handleBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
            Back
          </button>
        )}
        <h3 className="project-config-section-title">
          {view === 'edit' ? 'Edit Project' : 'New Project'}
        </h3>
        <form onSubmit={handleSubmit}>
          <div className="project-config-form">
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Project"
                className="form-input"
                autoFocus
              />
            </div>
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
            <div className="form-group">
              <label>CLI Tool</label>
              <select
                value={cliTool}
                onChange={(e) => setCliTool(e.target.value as CliTool)}
                className="form-select"
              >
                <option value="claude">Claude</option>
                <option value="cursor">Cursor</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
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
            {view === 'edit' && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={saveAsPreset}
                  onChange={(e) => setSaveAsPreset(e.target.checked)}
                />
                <span>Update saved preset</span>
              </label>
            )}
            <div className="project-config-actions">
              {canClose && (
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Cancel
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={!isValid}>
                {view === 'edit' ? 'Open Project' : 'Create Project'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );

  const content = view === 'list' ? listContent : formContent;

  // Full page on startup
  if (!canClose) {
    return (
      <div className="project-config-page">
        {content}
      </div>
    );
  }

  // Modal when adding from tab bar
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{view === 'list' ? 'Open Project' : view === 'edit' ? 'Edit Project' : 'New Project'}</h2>
          <button className="modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          {content}
        </div>
      </div>
    </div>
  );
}
