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
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        className="edit-queue-send"
        onClick={() => actions?.sendAll()}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 12V4M8 4L4 8M8 4L12 8" />
        </svg>
        Send {edits.length} edit{edits.length !== 1 ? 's' : ''}
      </button>
    </div>
  );
}
