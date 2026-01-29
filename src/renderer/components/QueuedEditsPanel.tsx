interface QueuedEdit {
  sessionId: string;
  data: unknown;
  label: string;
}

interface QueuedEditsPanelProps {
  edits: QueuedEdit[];
  onRemove: (index: number) => void;
  onSendNow: () => void;
}

export type { QueuedEdit };

export default function QueuedEditsPanel({ edits, onRemove, onSendNow }: QueuedEditsPanelProps) {
  if (edits.length === 0) return null;

  return (
    <div className="queued-edits-panel">
      <div className="queued-edits-header">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="7" />
          <path d="M8 4.5V8L10.5 9.5" />
        </svg>
        Queued — sends when idle
      </div>
      <div className="queued-edits-list">
        {edits.map((edit, index) => (
          <div key={index} className="queued-edits-item">
            <span className="queued-edits-dot" />
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
      <button className="queued-edits-send" onClick={onSendNow}>
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
        Send now ({edits.length})
      </button>
    </div>
  );
}
