import type { PendingEdit, EditActions } from './Browser';

interface EditQueuePanelProps {
  edits: PendingEdit[];
  actions: EditActions | null;
}

export default function EditQueuePanel({ edits, actions }: EditQueuePanelProps) {
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
      <button
        className="edit-queue-send"
        onClick={() => actions?.sendAll()}
      >
        Send {edits.length} edit{edits.length !== 1 ? 's' : ''}
      </button>
    </div>
  );
}
