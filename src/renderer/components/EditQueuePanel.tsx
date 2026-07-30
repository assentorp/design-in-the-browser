import { sendAllEditsToActiveWebview, type PendingEdit, type EditActions } from './Browser';

interface EditQueuePanelProps {
  edits: PendingEdit[];
  actions: EditActions | null;
  cliRunning?: boolean;
}

export default function EditQueuePanel({ edits, actions, cliRunning }: EditQueuePanelProps) {
  if (edits.length === 0) return null;

  return (
    <div className="edit-queue-panel">
      <div className="edit-queue-list">
        {edits.map((edit, index) => (
          <div key={index} className="edit-queue-item">
            <span className="edit-queue-circle" />
            <span className="edit-queue-text">
              {edit.note.length > 40 ? edit.note.substring(0, 40) + '...' : edit.note}
            </span>
            <button
              className="edit-queue-remove"
              onClick={(e) => {
                e.stopPropagation();
                actions?.removeItem(index);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <div className="edit-queue-actions">
        <button
          className={`edit-queue-send${cliRunning ? ' edit-queue-send-waiting' : ''}`}
          onClick={() => sendAllEditsToActiveWebview()}
          title={cliRunning ? 'Claude is busy — click to send anyway' : undefined}
        >
          {cliRunning ? 'Waiting...' : 'Send'}
          <kbd className="edit-queue-kbd">{navigator.platform.includes('Mac') ? '⌘⇧' : 'Ctrl+Shift+'}S</kbd>
        </button>
        <button
          className="edit-queue-cancel"
          onClick={() => actions?.clearAll()}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
