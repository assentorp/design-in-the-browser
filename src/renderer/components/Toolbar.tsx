import { useCallback } from 'react';

interface ToolbarProps {
  url: string;
  onUrlChange: (url: string) => void;
  onUrlSubmit: (e: React.FormEvent) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  annotateMode: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onToggleAnnotate: () => void;
}

export default function Toolbar({
  url,
  onUrlChange,
  onUrlSubmit,
  canGoBack,
  canGoForward,
  isLoading,
  annotateMode,
  onBack,
  onForward,
  onReload,
  onToggleAnnotate,
}: ToolbarProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        (e.target as HTMLInputElement).blur();
      }
    },
    []
  );

  return (
    <div className="toolbar">
      <div className="toolbar-nav">
        <button
          className="toolbar-btn"
          onClick={onBack}
          disabled={!canGoBack}
          title="Go back"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 12L6 8L10 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          className="toolbar-btn"
          onClick={onForward}
          disabled={!canGoForward}
          title="Go forward"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 12L10 8L6 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          className="toolbar-btn"
          onClick={onReload}
          title={isLoading ? 'Stop' : 'Reload'}
        >
          {isLoading ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4L12 12M4 12L12 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M13.5 8C13.5 11.0376 11.0376 13.5 8 13.5C4.96243 13.5 2.5 11.0376 2.5 8C2.5 4.96243 4.96243 2.5 8 2.5C10.1564 2.5 12.0233 3.73291 12.9 5.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M13 2.5V5.5H10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>

      <form className="toolbar-url-form" onSubmit={onUrlSubmit}>
        <input
          type="text"
          className="toolbar-url-input"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter URL..."
        />
      </form>

      <button
        className={`toolbar-btn toolbar-annotate-btn ${annotateMode ? 'active' : ''}`}
        onClick={onToggleAnnotate}
        title={annotateMode ? 'Exit Annotate Mode (Esc)' : 'Enter Annotate Mode'}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle
            cx="8"
            cy="8"
            r="6"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="8" cy="8" r="2" fill="currentColor" />
          <path
            d="M8 2V4M8 12V14M2 8H4M12 8H14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <span>{annotateMode ? 'Editing' : 'Edit'}</span>
      </button>
    </div>
  );
}
