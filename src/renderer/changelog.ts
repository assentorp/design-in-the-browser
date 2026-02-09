export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: '1.3.2',
    date: 'February 9, 2026',
    changes: [
      'Shortcut hints: entering annotate mode now shows available keyboard shortcuts (ALT, G)',
      'Design token trigger changed from @@ to > for quicker autocomplete',
    ],
  },
  {
    version: '1.3.0',
    date: 'February 8, 2026',
    changes: [
      'Design token autocomplete: type > in the annotation textarea to search and insert Tailwind tokens with color swatches and "applied" badges',
      'Ruler guides: hold G in annotate mode to show crosshair lines that follow your cursor for checking alignment',
      'CSS Inspector now follows your cursor and delays switching when hovering between elements',
      'Clear Cache & Reload (Cmd+Shift+R) clears webview cache and hard-reloads the page',
      'Send All shortcut (Cmd+E) now shown as keyboard hint on the Send button',
      'App no longer restores previous sessions on launch — always starts fresh with project picker',
      'Reload button now ignores cache for faster iteration',
    ],
  },
  {
    version: '1.2.31',
    date: 'February 6, 2026',
    changes: [
      'CSS Inspector: hold ALT to inspect any element — shows classes, computed styles, and colors',
      'Click to copy class names, style values, or colors from the inspector',
      'Toggle color formats between hex, rgb, and hsl',
      'Fix terminal rendering gaps after collapsing and expanding the terminal panel',
    ],
  },
  {
    version: '1.2.30',
    date: 'February 5, 2026',
    changes: [
      'Projects now persist across app updates',
      'Fix terminal auto-scroll issue after many exchanges',
      'Edit mode toggle no longer auto-collapses terminal',
      'New annotation while Claude is busy adds to todo list instead of queuing',
      'Todo panel: simplified Send/Cancel buttons, larger text, dotted circles',
      'Show saved projects on launch instead of new project form',
    ],
  },
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
