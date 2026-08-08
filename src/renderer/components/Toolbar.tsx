import { useCallback, useState } from 'react';
import type { ViewportType, ViewportSizes } from './Browser';

interface ToolbarProps {
  url: string;
  onUrlChange: (url: string) => void;
  onUrlSubmit: (e: React.FormEvent) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  annotateMode: boolean;
  designMode: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onClearCacheReload: () => void;
  onToggleAnnotate: () => void;
  onToggleDesign: () => void;
  onToggleCodeView: () => void;
  codeViewActive?: boolean;
  hasEditor?: boolean;
  viewport: ViewportType | null;
  viewportSizes: ViewportSizes;
  onViewportChange: (viewport: ViewportType | null) => void;
  onViewportSizeChange: (sizes: ViewportSizes) => void;
  zoomFactor?: number;
  onZoomReset?: () => void;
  devToolsOpen?: boolean;
  onToggleDevTools?: () => void;
}

export default function Toolbar({
  url,
  onUrlChange,
  onUrlSubmit,
  canGoBack,
  canGoForward,
  isLoading,
  annotateMode,
  designMode,
  onBack,
  onForward,
  onReload,
  onStop,
  onClearCacheReload,
  onToggleAnnotate,
  onToggleDesign,
  onToggleCodeView,
  codeViewActive = false,
  hasEditor = true,
  viewport,
  viewportSizes,
  onViewportChange,
  onViewportSizeChange,
  zoomFactor = 1.0,
  onZoomReset,
  devToolsOpen = false,
  onToggleDevTools,
}: ToolbarProps) {
  const [editingViewport, setEditingViewport] = useState<ViewportType | null>(null);
  const [editValue, setEditValue] = useState('');
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
        {onToggleDevTools && (
          <button
            className={`toolbar-btn toolbar-devtools-btn has-tooltip ${devToolsOpen ? 'active' : ''}`}
            onClick={onToggleDevTools}
            data-tooltip={devToolsOpen ? 'Close inspector' : 'Open inspector'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2"/>
              <path d="M3 15h18"/>
            </svg>
          </button>
        )}
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
          className="toolbar-btn has-tooltip"
          onClick={onClearCacheReload}
          data-tooltip="Clear cache & reload (Cmd+Shift+R)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 3V6.5H5.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2.63 9.5A5.5 5.5 0 1 0 3.53 4.5L2 6.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8 5V8.5L10 10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          className="toolbar-btn has-tooltip"
          onClick={isLoading ? onStop : onReload}
          data-tooltip={isLoading ? 'Stop' : `Reload (${navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+R)`}
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

      <div className="toolbar-viewport">
        <button
          className={`toolbar-btn toolbar-viewport-btn has-tooltip ${viewport === 'mobile' ? 'active' : ''}`}
          onClick={() => onViewportChange(viewport === 'mobile' ? null : 'mobile')}
          onDoubleClick={() => {
            setEditingViewport('mobile');
            setEditValue(String(viewportSizes.mobile));
          }}
          data-tooltip={`Mobile (${viewportSizes.mobile}px) - Double-click to edit`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="14" height="20" x="5" y="2" rx="2" ry="2"/>
            <path d="M12 18h.01"/>
          </svg>
        </button>
        <button
          className={`toolbar-btn toolbar-viewport-btn has-tooltip ${viewport === 'tablet' ? 'active' : ''}`}
          onClick={() => onViewportChange(viewport === 'tablet' ? null : 'tablet')}
          onDoubleClick={() => {
            setEditingViewport('tablet');
            setEditValue(String(viewportSizes.tablet));
          }}
          data-tooltip={`Tablet (${viewportSizes.tablet}px) - Double-click to edit`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="16" height="20" x="4" y="2" rx="2" ry="2"/>
            <line x1="12" x2="12.01" y1="18" y2="18"/>
          </svg>
        </button>
        <button
          className={`toolbar-btn toolbar-viewport-btn has-tooltip ${viewport === 'desktop' ? 'active' : ''}`}
          onClick={() => onViewportChange(viewport === 'desktop' ? null : 'desktop')}
          onDoubleClick={() => {
            setEditingViewport('desktop');
            setEditValue(String(viewportSizes.desktop));
          }}
          data-tooltip={`Desktop (${viewportSizes.desktop}px) - Double-click to edit`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="14" x="2" y="3" rx="2"/>
            <line x1="8" x2="16" y1="21" y2="21"/>
            <line x1="12" x2="12" y1="17" y2="21"/>
          </svg>
        </button>
        {editingViewport && (
          <div className="viewport-edit-popup">
            <input
              type="number"
              className="viewport-edit-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const newValue = parseInt(editValue, 10);
                  if (newValue > 0) {
                    onViewportSizeChange({ ...viewportSizes, [editingViewport]: newValue });
                  }
                  setEditingViewport(null);
                } else if (e.key === 'Escape') {
                  setEditingViewport(null);
                }
              }}
              onBlur={() => {
                const newValue = parseInt(editValue, 10);
                if (newValue > 0) {
                  onViewportSizeChange({ ...viewportSizes, [editingViewport]: newValue });
                }
                setEditingViewport(null);
              }}
              autoFocus
            />
            <span className="viewport-edit-unit">px</span>
          </div>
        )}
      </div>

      {Math.abs(zoomFactor - 1.0) > 0.001 && (
        <button
          className="toolbar-btn toolbar-zoom-btn"
          onClick={onZoomReset}
          title="Reset zoom (Cmd+0)"
        >
          {Math.round(zoomFactor * 100)}%
        </button>
      )}

      <button
        className={`toolbar-btn toolbar-code-btn ${codeViewActive ? 'active' : ''}`}
        onClick={onToggleCodeView}
        disabled={!hasEditor}
        title={hasEditor ? 'Open in editor' : 'Install a code editor (VS Code, Cursor, Zed, Sublime, WebStorm, or Nova) to enable'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
        <span>Code</span>
      </button>

      <button
        className={`toolbar-btn toolbar-annotate-btn toolbar-design-btn ${designMode ? 'active' : ''}`}
        onClick={onToggleDesign}
        disabled={devToolsOpen}
        title={
          devToolsOpen
            ? 'Close inspector to design'
            : designMode
              ? 'Exit Design Mode (Cmd+D)'
              : 'Enter Design Mode (Cmd+D) — drag, resize and restyle elements directly'
        }
      >
        <kbd className="toolbar-kbd">&#8984;D</kbd>
        <span>{designMode ? 'Designing' : 'Design'}</span>
      </button>

      <button
        className={`toolbar-btn toolbar-annotate-btn ${annotateMode ? 'active' : ''}`}
        onClick={onToggleAnnotate}
        disabled={devToolsOpen}
        title={
          devToolsOpen
            ? 'Close inspector to edit'
            : annotateMode
              ? 'Exit Edit Mode (Cmd+E)'
              : 'Enter Edit Mode (Cmd+E)'
        }
      >
        <kbd className="toolbar-kbd">&#8984;E</kbd>
        <span>{annotateMode ? 'Editing' : 'Edit'}</span>
      </button>

    </div>
  );
}
