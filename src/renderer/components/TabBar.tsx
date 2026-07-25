import type { Session } from '../../shared/types';
import { appConfirm } from './ConfirmDialog';

interface TabBarProps {
  sessions: Session[];
  activeSessionId: string;
  homeActive: boolean;
  // Transient "New" tab (projects screen opened via +). Selecting it goes
  // through onNewSession, which focuses the existing New tab or opens one.
  newTabOpen: boolean;
  newTabActive: boolean;
  onCloseNewTab: () => void;
  onSelectHome: () => void;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onCloseSession: (sessionId: string) => void;
  terminalCollapsed: boolean;
  // Absent when the Home tab is active (there's no terminal to toggle)
  onToggleTerminal?: () => void;
  onOpenSettings: () => void;
  onOpenWhatsNew: () => void;
  hasUnseenChanges: boolean;
}

export default function TabBar({
  sessions,
  activeSessionId,
  homeActive,
  newTabOpen,
  newTabActive,
  onCloseNewTab,
  onSelectHome,
  onSelectSession,
  onNewSession,
  onCloseSession,
  terminalCollapsed,
  onToggleTerminal,
  onOpenSettings,
  onOpenWhatsNew,
  hasUnseenChanges,
}: TabBarProps) {
  return (
    <div className="tab-bar">
      <button
        className={`tab-home ${homeActive ? 'active' : ''}`}
        onClick={onSelectHome}
        title="Home"
        aria-label="Home"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </button>
      <div className="tabs">
        {sessions.map((session, index) => (
          <div
            key={session.id}
            className={`tab ${session.id === activeSessionId ? 'active' : ''}`}
            onClick={() => onSelectSession(session.id)}
            title={index < 9 ? `${session.name} (${navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl+'}${index + 1})` : session.name}
          >
            <div className="tab-content">
              <span className="tab-name">{session.name}</span>
            </div>
            <button
              className="tab-close"
              onClick={async (e) => {
                e.stopPropagation();
                if (await appConfirm({ title: `Close "${session.name}"?`, confirmLabel: 'Close' })) {
                  onCloseSession(session.id);
                }
              }}
              title="Close project"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        ))}
        {newTabOpen && (
          <div
            className={`tab ${newTabActive ? 'active' : ''}`}
            onClick={onNewSession}
            title="New project"
          >
            <div className="tab-content">
              <span className="tab-name">New</span>
            </div>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseNewTab();
              }}
              title="Close"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        )}
      </div>
      <button className="new-tab-btn" onClick={onNewSession} title="New project">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
      <div className="tab-bar-spacer" />
      <button
        className="tab-bar-icon-btn"
        onClick={onOpenWhatsNew}
        title="What's New"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        {hasUnseenChanges && <span className="notification-dot" />}
      </button>
      <button
        className="tab-bar-icon-btn"
        onClick={onOpenSettings}
        title="Settings"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
      {onToggleTerminal && (
      <button
        className="tab-bar-collapse-btn"
        onClick={onToggleTerminal}
        title={terminalCollapsed ? 'Expand terminal' : 'Collapse terminal'}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: terminalCollapsed ? 'rotate(180deg)' : 'none' }}
        >
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
      )}
    </div>
  );
}
