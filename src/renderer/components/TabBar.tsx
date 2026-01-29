import type { Session } from '../../shared/types';

interface TabBarProps {
  sessions: Session[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onCloseSession: (sessionId: string) => void;
  terminalCollapsed: boolean;
  onToggleTerminal: () => void;
}

export default function TabBar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onCloseSession,
  terminalCollapsed,
  onToggleTerminal,
}: TabBarProps) {
  return (
    <div className="tab-bar">
      <div className="tabs">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`tab ${session.id === activeSessionId ? 'active' : ''}`}
            onClick={() => onSelectSession(session.id)}
          >
            <span className="tab-name">{session.name}</span>
            {sessions.length > 1 && (
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseSession(session.id);
                }}
                title="Close project"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="new-tab-btn" onClick={onNewSession} title="New project">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
      <div className="tab-bar-spacer" />
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
    </div>
  );
}
