export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: '1.2.26',
    date: '2025-02-03',
    changes: [
      'Add What\'s New modal, settings cog, and notification bell to tab bar',
      'Format terminal annotations as markdown lists and add screenshot cleanup hint',
      'Add @-mention file autocomplete in annotation textarea',
      'Type @ to search project files, arrow keys to navigate, Enter to select',
      'Shows filename in prompt, expands to full path when sent',
    ],
  },
  {
    version: '1.2.25',
    date: '2025-02-01',
    changes: [
      'Fix file drag-and-drop into terminal',
      'Add "Create your first project" title to first-launch screen',
      'Remove unused dependencies and fix build config',
    ],
  },
  {
    version: '1.2.24',
    date: '2025-01-30',
    changes: [
      'Add Claude model selection and bypass permissions option',
      'Allow closing the last tab',
    ],
  },
];
