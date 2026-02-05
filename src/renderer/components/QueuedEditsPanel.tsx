interface QueuedEdit {
  sessionId: string;
  data: unknown;
  label: string;
}

interface QueuedEditsPanelProps {
  edits: QueuedEdit[];
  onRemove: (index: number) => void;
  onSendNow: () => void;
  onCancelAll: () => void;
}

export type { QueuedEdit };

export default function QueuedEditsPanel({ edits, onRemove, onSendNow, onCancelAll }: QueuedEditsPanelProps) {
  if (edits.length === 0) return null;

  return (
    <div className="queued-edits-panel">
      <div className="queued-edits-list">
        {edits.map((edit, index) => (
          <div key={index} className="queued-edits-item">
            <span className="edit-queue-circle" />
            <span className="queued-edits-label">{edit.label}</span>
            <button
              className="queued-edits-remove"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(index);
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
      <div className="queued-edits-footer">
        <button className="queued-edits-send" onClick={onSendNow}>
          Send
        </button>
        <button className="queued-edits-cancel" onClick={onCancelAll}>
          Cancel
        </button>
      </div>
    </div>
  );
}
