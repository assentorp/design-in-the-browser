import type { ChangelogEntry } from '../changelog';

interface WhatsNewModalProps {
  changelog: ChangelogEntry[];
  onClose: () => void;
}

export default function WhatsNewModal({ changelog, onClose }: WhatsNewModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal whats-new-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>What's New</h2>
          <button className="modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          {changelog.map((entry) => (
            <div key={entry.version} className="whats-new-entry">
              <div className="whats-new-version-row">
                <span className="whats-new-version">v{entry.version}</span>
                <span className="whats-new-date">{entry.date}</span>
              </div>
              <ul className="whats-new-changes">
                {entry.changes.map((change, i) => (
                  <li key={i}>{change}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
