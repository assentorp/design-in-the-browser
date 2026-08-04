export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: '2.0.1',
    date: 'August 4, 2026',
    changes: [
      'Projects now stay live when you switch tabs — the page keeps its scroll position, form state, and open dev tools instead of reloading from scratch, and each project keeps its own queue of pending edits',
      'Queued edits now go to the project they belong to: an edit flushing after a background project\'s CLI goes idle no longer lands in whatever project happens to be on screen',
      'Claude\'s permission mode is now a dropdown under Advanced options — Default, Accept edits, Auto, or Plan — replacing the old "Start in auto mode" checkbox. Existing projects using auto mode keep behaving the same',
      'The app shows as "Dosmos" in the macOS menu bar during development',
    ],
  },
  {
    version: '2.0.0',
    date: 'July 26, 2026',
    changes: [
      'New name: Design In The Browser is now Dosmos — same app, shorter name. Auto-updates, your settings, and your projects all carry over unchanged',
      'A new Home: projects live on a full-width dashboard in a persistent first tab instead of a floating dialog — with Figma-style cards showing live page previews and favicons, a filter that expands from the toolbar (Cmd+F), and a + tab for new projects',
      'The window chrome is gone: the native macOS title bar is hidden so the slim tab bar is the top of the app, and native system popups have been replaced with in-app dialogs',
      'New look: the whole app uses the Inter typeface with refined rendering, and buttons have a subtle top-lit, pressed-in feel',
      'Creating a project is now a short guided flow instead of one big form — pick Existing or Starter, point at the folder (the name fills itself in), confirm how it starts, choose your AI tool. Enter advances each step, and rarely-used options (model, auto mode, permissions, shell) live under Advanced options',
      'Cmd+P (Ctrl+P on Windows) in the code editor opens a go-to-file palette, VS Code style: type to filter, matched text highlights, arrow keys + Enter to open',
      'File tree upgrades: a search box to filter files, and file-type icons (TS, JS, JSON, images, and more) in the tree, search results, and the Cmd+P palette',
      'Annotations can now include multiple reference images',
      'Fix screenshots not reaching the CLI in WSL sessions — paths now translate to /mnt form',
      'Fix the app staying dead after closing and reopening the window on macOS',
      'Fix project card edit/remove buttons becoming invisible on hover over light page previews',
      'Fix opening the editor for project paths containing spaces',
    ],
  },
  {
    version: '1.8.0',
    date: 'July 9, 2026',
    changes: [
      'Built-in code editor: clicking an element\'s "Edit code" button now opens its source file right beside the page — no external editor needed. Syntax highlighting for JS/TS/JSX/HTML/CSS, Cmd/Ctrl+S to save, drag the panel edge to resize, or expand it to the full window',
      'The Code button in the toolbar opens the whole project in the built-in editor with a file tree sidebar. The built-in editor is now the default; VS Code, Cursor, Zed, Sublime, WebStorm, and Nova remain available under Settings',
      'Smarter element-to-source matching: component names, data attributes, headings, text, and the page URL are searched in parallel and cross-checked, so the right file opens far more often. When the match is a close call, a "wrong file?" picker lists the other likely locations',
      'Unsaved changes in the built-in editor are protected — closing the panel or opening another file asks for confirmation instead of silently discarding edits',
    ],
  },
  {
    version: '1.7.3',
    date: 'June 23, 2026',
    changes: [
      'Set custom pixel sizes for the spatial and baseline grid overlays (toggled with Shift+G in the browser) under Settings — defaults stay 8px and 4px. Changes apply live to an open browser without a reload',
      'Fix the Code button on Windows not opening the editor when VS Code, Cursor, or Sublime is installed in a path containing spaces (e.g. "Microsoft VS Code") — the editor and project paths are now quoted correctly for the shell',
    ],
  },
  {
    version: '1.7.2',
    date: 'June 18, 2026',
    changes: [
      'Dragging an image file into the terminal now attaches it as an image (e.g. "[Image #1]") in Claude Code, Cursor, and other CLI tools, instead of pasting the raw file path — the image is written to the clipboard and pasted with Ctrl+V automatically. Non-image files still paste their path as before',
    ],
  },
  {
    version: '1.7.1',
    date: 'June 15, 2026',
    changes: [
      'Fix local HTML files (and HTMX pages) not loading in the built-in browser on Windows — a path like `C:\\Users\\you\\index.html` was being rewritten to an `https://` URL and never loaded. Local file paths now open as proper `file://` URLs (framework dev servers were unaffected)',
      'Antigravity CLI replaces Gemini CLI as a built-in tool option — Google is retiring Gemini CLI for unpaid and Google One users on June 18 in favour of Antigravity CLI. Existing Gemini presets are migrated to Antigravity automatically',
      'Qwen added as a CLI tool option, alongside Claude, Cursor, Antigravity, and Codex',
      'Updated the Starter Project template',
    ],
  },
  {
    version: '1.7.0',
    date: 'May 25, 2026',
    changes: [
      'Starter Project: create a new project from a polished boilerplate landing page — no folder, framework, or dev server required. Pick a parent directory, give it a name, and start editing',
      'Built-in static server for Starter Projects with file-watch hot reload — when Claude Code (or any editor) saves a change, the browser refreshes automatically',
      'Fix presets being wiped on disk if `presets.json` failed to read once — saves are now atomic (tmp + rename) with an auto-recovering `.bak`, and an empty save is refused while the on-disk file is unreadable',
      'Fix first character of typed CLI commands occasionally being eaten by shell init banners (e.g. "laude" instead of "claude") — commands now wait for the prompt to stabilise before sending',
      'Fix crash when terminal output arrived after the window was closed',
    ],
  },
  {
    version: '1.6.1',
    date: 'May 11, 2026',
    changes: [
      'Fix Code button on Windows: VS Code, Cursor, and Sublime are now detected in their standard install locations and launch correctly via their `.cmd` shims',
      'Fix UI freezes after dev-server restarts and git branch switches: the project file walk for @-mention autocomplete is now async, cached for 30s, and debounced so reload storms no longer trigger repeated full-tree scans',
      'Code button is now disabled with an explanatory tooltip when no supported editor (VS Code, Cursor, Zed, Sublime, WebStorm, Nova) is installed, instead of failing silently or showing a system error dialog',
    ],
  },
  {
    version: '1.6.0',
    date: 'April 9, 2026',
    changes: [
      'Web inspector: Chrome DevTools now docks inside the app — toggle with Alt+Cmd+I (Ctrl+Shift+I on Windows) or F12, drag the top edge to resize',
      'Custom CLI option: launch any CLI tool by command (e.g. `gsd`) from the project config, not just Claude/Cursor/Gemini/Codex',
      'Fix PowerShell users on Windows: login shell flag (`-l`) is no longer passed to PowerShell, which was causing terminals to exit immediately with a parse error',
      'Fix terminal losing focus on HMR reloads: switching branches or triggering a hot reload in the dev server no longer steals focus from the terminal back to the browser',
      'Fix custom CLI tab label when the command is a full path (e.g. `/usr/local/bin/foo` now shows as "Foo" instead of the whole path)',
      'Fix terminal resize crash on Windows when the PTY has already exited',
      'Fix session cleanup on PTY exit — disposables and output buffers are now properly released',
    ],
  },
  {
    version: '1.5.3',
    date: 'April 5, 2026',
    changes: [
      'Right-click context menu in the browser — copy link, open in external browser, copy text',
      'External links now open in your default browser with a toast notification',
    ],
  },
  {
    version: '1.5.2',
    date: 'March 26, 2026',
    changes: [
      'Cmd+R (Ctrl+R on Windows) now reloads the browser — shortcut shown in reload button tooltip',
      'Shift+Enter inserts a newline in the annotation prompt (previously it submitted)',
      'Loading spinner stays visible until the page has actually rendered content, instead of briefly flashing',
    ],
  },
  {
    version: '1.5.1',
    date: 'March 9, 2026',
    changes: [
      'Clear cache & reload button added to the browser toolbar — clears cache, cookies, and localStorage in one click',
      'Tooltips on all toolbar buttons for better discoverability',
      'Fix editor (VS Code, Cursor) failing to open projects with special characters in the path on macOS',
    ],
  },
  {
    version: '1.5.0',
    date: 'February 25, 2026',
    changes: [
      'Open source: Design In The Browser is now open source under the MIT license',
      'Fix Escape key in annotate mode no longer exits edit mode unexpectedly',
      'Fix todo items duplicating during webview re-injection',
      'Fix pending annotations being lost on page navigation — highlights now restore automatically',
      'Fix webview message bridge dropping messages that arrived during an in-flight fetch',
      'Fix pending edits not re-injecting after in-page navigation',
    ],
  },
  {
    version: '1.4.0',
    date: 'February 18, 2026',
    changes: [
      'Area selection: click and drag to select a region of the page and annotate it',
      'Cmd+L toggles the terminal panel open/closed',
      'Context-aware zoom: Cmd+=/- zooms the browser or terminal depending on which pane has focus',
      'Terminal zoom: adjust terminal font size (8–24px) with Cmd+=/-, Cmd+0 resets to default',
      'Shortcut hints moved to bottom-left and now show the Drag hint',
      'Fix native image drag interfering with area selection in annotate mode',
      'Fix Alt inspect activating while the annotation prompt is open',
      'Fix annotation prompt box overflowing when text is long — now scrolls at max height',
    ],
  },
  {
    version: '1.3.8',
    date: 'February 14, 2026',
    changes: [
      'Fix terminal spawning as non-login shell: MCP tools, nvm, homebrew, and git credentials now work correctly',
      'Fix high CPU usage: replace constant webview polling with event-driven messaging (119% → near 0% at idle)',
    ],
  },
  {
    version: '1.3.7',
    date: 'February 13, 2026',
    changes: [
      'Fix massive memory leak: cap terminal output buffer in main process (was growing unbounded)',
      'Fix memory leak: guard webview message polling against queuing and reduce poll rate',
      'Fix memory leak: dispose PTY event listeners when terminal sessions are destroyed',
      'Fix memory leak: release base64 screenshot data from memory after writing to disk',
      'Fix memory leak: clear DOM element references from pending annotations on page unload',
    ],
  },
  {
    version: '1.3.6',
    date: 'February 13, 2026',
    changes: [
      'Browser zoom: Cmd+=/- zooms only the webpage, not the app UI. Cmd+0 resets.',
      'Cmd+E now toggles edit mode on and off',
      'Cmd+1 through Cmd+9 switches between project tabs',
      'Tab names fade out gracefully when truncated instead of hard ellipsis',
      'Edit button shows Cmd+E keyboard hint in the toolbar',
      'Send Queued Edits shortcut changed to Cmd+Shift+S',
      'Shift+G cycles grid overlay: 8px spatial grid, 4px baseline grid, off',
      'Fix selecting SVG elements causing a crash',
      'Fix Send button for queued edits not working',
      'Fix Enter key not submitting annotations when todo list was cleared',
      'Suppress macOS local network permission prompt',
    ],
  },
  {
    version: '1.3.5',
    date: 'February 11, 2026',
    changes: [
      'Freeze animations: press F in annotate mode to pause all CSS animations and transitions',
      'Wider resize range: browser/terminal split can now go from 10% to 90%',
      'Fix resize handle getting stuck when dragging over the webview',
      'Fix code button disappearing after CSS hardening',
      'Fix todo items being doubled on first add',
      'File autocomplete: breadcrumb tree panel shows full folder path on hover',
      'File autocomplete: filename no longer gets squeezed by long directory paths',
      'Fix annotation prompt box appearing far from the selected element near the bottom of the page',
    ],
  },
  {
    version: '1.3.4',
    date: 'February 11, 2026',
    changes: [
      'Remember window size & sidebar position across app restarts',
      'Codex CLI support: added as a CLI tool option alongside Claude, Cursor, and Gemini',
      'Queued edits (todo list) now persist when switching between projects',
      'Option+Arrow word jumping now works in the terminal on macOS',
      'Fix browser flashing/blinking on every URL change',
      'Fix page CSS bleeding into the annotation prompt box and buttons',
    ],
  },
  {
    version: '1.3.3',
    date: 'February 10, 2026',
    changes: [
      'Onboarding flow: getting started screen, code editor selection, analytics consent, and Discord invite',
      'Analytics opt-in: PostHog analytics is now off by default (GDPR compliant) with toggle in Settings',
      'Design token autocomplete now includes max-w, min-w, max-h, and min-h utilities',
      'Fix: G key ruler shortcut no longer triggers when typing in textarea or input fields',
    ],
  },
  {
    version: '1.3.2',
    date: 'February 9, 2026',
    changes: [
      'Shortcut hints: entering annotate mode now shows available keyboard shortcuts (ALT, G)',
      'Design token trigger changed from @@ to >',
      'Click a todo item to edit its prompt',
      'Fix: cancelling the todo list now exits list mode',
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
      'Send All shortcut (Cmd+Shift+E) now shown as keyboard hint on the Send button',
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
      'Use Cmd+Shift+E (Ctrl+Shift+E on Windows/Linux) to send all queued edits',
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
