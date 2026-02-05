export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: '1.2.29',
    date: 'February 5, 2026',
    changes: [
      'Edit queue no longer auto-sends when CLI goes idle',
      'Use Cmd+E (Ctrl+E on Windows/Linux) to send all queued edits',
      'Fix edit queue flushing immediately after annotation is queued',
    ],
  },
  {
    version: '1.2.28',
    date: 'February 4, 2026',
    changes: [
      'Double-click terminal tab names to rename them',
      'Confirmation dialog when closing project or terminal tabs',
      'Close buttons moved to far right of tabs to prevent accidental clicks',
      'Fix annotations not auto-submitting to Claude Code',
      'Faster CLI idle detection — spinner clears sooner, queued edits send faster',
      'Session state (todos, edits) now clears when switching or closing projects',
      'Opening code editor now shows the file explorer sidebar',
      'Disable Cmd+R app reload to prevent losing session state',
      'Move Settings to app name menu on macOS',
      'Screenshot cleanup: 5 minutes marked as recommended, removed "Never" option',
    ],
  },
  {
    version: '1.2.26',
    date: 'February 3, 2026',
    changes: [
      'Fix file drag-and-drop into terminal',
      'Add "Create your first project" title to first-launch screen',
      'Remove unused dependencies and fix build config',
      'Add What\'s New modal, settings cog, and notification bell to tab bar',
      'Format terminal annotations as markdown lists and add screenshot cleanup hint',
      'Add @-mention file autocomplete in annotation textarea',
      'Type @ to search project files, arrow keys to navigate, Enter to select',
      'Shows filename in prompt, expands to full path when sent',
    ],
  },
];
