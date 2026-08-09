import { useState, useEffect, useRef } from 'react';
import { initAnalytics, disableAnalytics } from '../analytics';
import type { AppSettings, CodeEditor } from '../../shared/types';

interface SettingsModalProps {
  onClose: () => void;
}

const CLEANUP_OPTIONS = [
  { value: 1, label: '1 minute' },
  { value: 5, label: '5 minutes (recommended)' },
  { value: 10, label: '10 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
];

function clampGridSize(raw: string, fallback: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 200);
}

const EDITOR_LABELS: Record<CodeEditor, string> = {
  builtin: 'Built In (Recommended)',
  vscode: 'VS Code',
  cursor: 'Cursor',
  zed: 'Zed',
  sublime: 'Sublime Text',
  webstorm: 'WebStorm',
  nova: 'Nova',
};

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [availableEditors, setAvailableEditors] = useState<CodeEditor[]>([]);
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    window.mainAPI?.getSettings().then(setSettings);
    window.mainAPI?.detectEditors().then(setAvailableEditors);
    window.mainAPI?.getAppVersion().then(setAppVersion);
  }, []);

  // Escape closes the modal wherever focus happens to be. Capture phase so it
  // wins over the shortcuts underneath, and the event stops here.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  // Pull focus out of the webview, otherwise key presses never reach this
  // window at all. Runs again when the real body replaces the loading state.
  useEffect(() => {
    modalRef.current?.focus();
  }, [settings]);

  const handleChange = async (key: keyof AppSettings, value: number | string | boolean) => {
    if (!settings) return;

    setSaving(true);
    const updated = await window.mainAPI?.saveSettings({ [key]: value });
    if (updated) {
      setSettings(updated);

      // Push grid sizes to any open browser webview so the change applies live
      if (key === 'gridSpatialSize' || key === 'gridBaselineSize') {
        window.dispatchEvent(
          new CustomEvent('claude-design-grid-sizes', {
            detail: {
              spatial: updated.gridSpatialSize,
              baseline: updated.gridBaselineSize,
            },
          })
        );
      }

      if (key === 'persistentDesignPanel') {
        window.dispatchEvent(
          new CustomEvent('claude-design-panel-persistent', {
            detail: { persistent: !!updated.persistentDesignPanel },
          })
        );
      }
    }

    // Toggle PostHog capturing at runtime
    if (key === 'analyticsEnabled') {
      if (value) {
        initAnalytics();
      } else {
        disableAnalytics();
      }
    }

    setSaving(false);
  };

  if (!settings) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal modal-settings" ref={modalRef} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Settings</h2>
            <button className="modal-close" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div className="modal-body">
            <div className="settings-loading">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-settings" ref={modalRef} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="settings-section">
            <div className="settings-group">
              <label className="settings-label">
                Code Editor
                <span className="settings-description">
                  Which editor the Code button opens. "Built In" edits files inside this app; the others launch your installed editor.
                </span>
              </label>
              <select
                value={settings.editor || 'builtin'}
                onChange={(e) => handleChange('editor', e.target.value)}
                className="form-select"
                disabled={saving}
              >
                {availableEditors.map((editor) => (
                  <option key={editor} value={editor}>
                    {EDITOR_LABELS[editor]}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-group">
              <label className="settings-label">
                Screenshot Cleanup
                <span className="settings-description">
                  How long to keep screenshot files before deleting them
                </span>
              </label>
              <select
                value={settings.screenshotCleanupMinutes}
                onChange={(e) => handleChange('screenshotCleanupMinutes', Number(e.target.value))}
                className="form-select"
                disabled={saving}
              >
                {CLEANUP_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <span className="settings-hint">
                Screenshots are stored in your system's temp folder and won't fill up your disk. They're cleaned up automatically by the OS even if the app closes before the timer runs.
              </span>
            </div>
            <div className="settings-group">
              <label className="settings-label">
                Grid Overlay Size
                <span className="settings-description">
                  Pixel sizes for the grid you toggle with Shift+G in the browser
                </span>
              </label>
              <div className="settings-grid-sizes">
                <label className="settings-number-field">
                  <span>Spatial grid</span>
                  <div className="settings-number-input">
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={settings.gridSpatialSize ?? 8}
                      onChange={(e) =>
                        handleChange('gridSpatialSize', clampGridSize(e.target.value, 8))
                      }
                      className="form-input"
                      disabled={saving}
                    />
                    <span className="settings-unit">px</span>
                  </div>
                </label>
                <label className="settings-number-field">
                  <span>Baseline grid</span>
                  <div className="settings-number-input">
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={settings.gridBaselineSize ?? 4}
                      onChange={(e) =>
                        handleChange('gridBaselineSize', clampGridSize(e.target.value, 4))
                      }
                      className="form-input"
                      disabled={saving}
                    />
                    <span className="settings-unit">px</span>
                  </div>
                </label>
              </div>
            </div>
            <div className="settings-group">
              <label className="settings-label settings-label-row">
                <input
                  type="checkbox"
                  checked={settings.persistentDesignPanel ?? false}
                  onChange={(e) => handleChange('persistentDesignPanel', e.target.checked)}
                  disabled={saving}
                />
                Persistent design panel
              </label>
              <span className="settings-hint">
                Keep the design panel open when you select another element. Off by default: the panel closes with each new selection, and you reopen it with the sliders button in the prompt box.
              </span>
            </div>
            <div className="settings-group">
              <label className="settings-label settings-label-row">
                <input
                  type="checkbox"
                  checked={settings.analyticsEnabled}
                  onChange={(e) => handleChange('analyticsEnabled', e.target.checked)}
                  disabled={saving}
                />
                Share anonymous usage data
              </label>
              <span className="settings-hint">
                Crash reports and basic usage events are sent to PostHog (EU servers). No personal data, project content, or file paths are collected.
              </span>
            </div>
          </div>
          {appVersion && (
            <div className="settings-version">Dosmos v{appVersion}</div>
          )}
        </div>
      </div>
    </div>
  );
}
