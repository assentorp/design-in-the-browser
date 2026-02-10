import { useState, useEffect } from 'react';
import posthog from 'posthog-js';
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

const EDITOR_LABELS: Record<CodeEditor, string> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  zed: 'Zed',
  sublime: 'Sublime Text',
  webstorm: 'WebStorm',
  nova: 'Nova',
};

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [availableEditors, setAvailableEditors] = useState<CodeEditor[]>([]);

  useEffect(() => {
    window.mainAPI?.getSettings().then(setSettings);
    window.mainAPI?.detectEditors().then(setAvailableEditors);
  }, []);

  const handleChange = async (key: keyof AppSettings, value: number | string | boolean) => {
    if (!settings) return;

    setSaving(true);
    const updated = await window.mainAPI?.saveSettings({ [key]: value });
    if (updated) {
      setSettings(updated);
    }

    // Toggle PostHog capturing at runtime
    if (key === 'analyticsEnabled') {
      if (value) {
        if (posthog.__loaded) {
          posthog.opt_in_capturing();
        } else {
          posthog.init('phc_GvJ6Ja6MY05KTmtD3Wj7QF3rCbczJwUQhLN8jPU8qqe', {
            api_host: 'https://eu.i.posthog.com',
            capture_exceptions: true,
            debug: import.meta.env.MODE === 'development',
          });
        }
      } else if (posthog.__loaded) {
        posthog.opt_out_capturing();
      }
    }

    setSaving(false);
  };

  if (!settings) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal modal-settings" onClick={(e) => e.stopPropagation()}>
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
      <div className="modal modal-settings" onClick={(e) => e.stopPropagation()}>
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
                  Which editor to open when clicking the Code button
                </span>
              </label>
              <select
                value={settings.editor || 'vscode'}
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
                Help improve Design In The Browser by sharing anonymous crash reports and basic usage data. No personal data or project content is ever collected.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
