# Dosmos

![icon](https://github.com/user-attachments/assets/b57c4c81-f109-427f-b6e7-454dea817203)

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Contributions](https://img.shields.io/badge/contributions-not%20accepted-lightgrey.svg)](CONTRIBUTING.md)

![mockup](https://github.com/user-attachments/assets/81f81ec8-4fd6-4e5c-8e0c-cdbce3e42824)

No more tab-switching, screenshot-pasting, and explaining which button you mean. Just click it.

A desktop app for visually annotating elements in a live browser and sending edit instructions directly to an AI coding assistant running in a side-by-side terminal. Point at what you want changed, describe the change, and let the AI handle the code.

**[Download for macOS (Apple Silicon)](https://github.com/assentorp/ditb-releases/releases/download/v2.0.0/Dosmos-2.0.0-arm64.dmg)** | **[macOS (Intel)](https://github.com/assentorp/ditb-releases/releases/download/v2.0.0/Dosmos-2.0.0-x64.dmg)** | **[Windows](https://github.com/assentorp/ditb-releases/releases/download/v2.0.0/Dosmos-Setup-2.0.0.exe)**

All releases: [github.com/assentorp/ditb-releases/releases](https://github.com/assentorp/ditb-releases/releases)

Works with [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor](https://cursor.sh), [Codex](https://github.com/openai/codex), Antigravity, Qwen, or any custom CLI command · v2.0.0 · macOS 13+ / Windows 10+

## How it works

1. **Open a project** — a guided flow walks you through pointing at an existing project (folder, dev server command, URL) or spinning up a **Starter Project** from a built-in template with zero setup
2. **Browse your app** — a built-in browser loads your running dev server (Starter Projects get a built-in static server with hot reload)
3. **Annotate** — click elements, drag to select areas, or multi-select to describe changes
4. **AI edits** — annotations are sent as prompts to your CLI tool in the integrated terminal
5. **See results** — the browser reloads with changes applied

## Features

### Annotate & edit
- **Point & Click** — click any element to tell AI what to change, no screenshots needed
- **Area Select** — drag a box around any area to give AI the visual context it needs
- **Multi-Edit** — select multiple elements, queue up changes, send them all at once (`Cmd+Shift+E`)
- **Reference Images** — drop in one or more design screenshots and AI matches them; images dragged into the terminal attach as real images, not file paths
- **Design Tokens** — type `>` in a prompt to search your Tailwind tokens with color swatches and insert them directly
- **File Mentions** — type `@` to autocomplete project file paths into your prompt

### Built-in code editor
- **Edit code in place** — clicking an element's "Edit code" button opens its source file right beside the page, with syntax highlighting for JS/TS/JSX/HTML/CSS, `Cmd+S` to save, and a resizable panel
- **Project editor** — the Code button opens the whole project with a file tree sidebar; prefer an external editor? VS Code, Cursor, Zed, Sublime, WebStorm, and Nova are available in Settings
- **Go to file** — `Cmd+P` opens a VS Code-style file palette: type to filter, matched text highlights, arrow keys and Enter to open
- **File tree** — filter the tree with a search box, with file-type icons (TS, JS, JSON, images, and more) in the tree, search results, and the palette
- **Smart source matching** — component names, data attributes, headings, text, and the URL are cross-checked to find the right file, with a "wrong file?" picker for close calls
- **Unsaved-change protection** — closing the panel or switching files asks before discarding edits

### Inspect & measure
- **CSS Inspector** — hold `Alt` to inspect classes, computed styles, and colors; click to copy values, toggle hex/rgb/hsl
- **Docked DevTools** — full Chrome DevTools inside the app (`F12` or `Alt+Cmd+I`)
- **Grid Overlays** — `Shift+G` cycles a spatial and baseline grid; pixel sizes configurable in Settings
- **Ruler Guides** — hold `G` in annotate mode for crosshair alignment lines
- **Freeze Animations** — press `F` to pause all CSS animations while you inspect
- **Responsive Testing** — switch between desktop, tablet, and mobile viewports instantly

### Workspace
- **Home dashboard** — projects live on a full-width dashboard in a persistent first tab, with cards showing live page previews and favicons, and a filter that expands from the toolbar (`Cmd+F`)
- **Guided project setup** — a short step-by-step flow instead of one big form: pick Existing or Starter, point at the folder (the name fills itself in), confirm how it starts, choose your AI tool; model, auto mode, permissions, and shell live under Advanced options
- **Integrated Terminal** — browser and terminal in one window with multi-tab support, renameable tabs, and zoom
- **Starter Projects** — spin up a boilerplate landing page with a built-in hot-reloading static server, no framework or dev server needed
- **Project Presets** — save and switch between project configurations; WSL supported on Windows
- **Session Tabs** — work on multiple projects simultaneously (`Cmd+1`–`9` to switch), plus a `+` tab for new projects
- **Native-feeling chrome** — the macOS title bar is hidden so the slim tab bar is the top of the app, and system popups are replaced with in-app dialogs
- **Browser niceties** — right-click context menu, external links open in your default browser, clear cache & reload, context-aware zoom
- **Auto-Updates** — automatic check and delta updates on startup

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd+E` | Toggle annotate mode |
| `Alt` (hold) | CSS inspector |
| `G` (hold) | Ruler guides |
| `Shift+G` | Cycle grid overlays |
| `F` | Freeze animations |
| `Cmd+Shift+E` | Send all queued edits |
| `Cmd+L` | Toggle terminal panel |
| `Cmd+R` / `Cmd+Shift+R` | Reload / clear cache & reload |
| `Cmd+=` / `Cmd+-` / `Cmd+0` | Zoom focused pane / reset |
| `F12` or `Alt+Cmd+I` | Docked DevTools |
| `Cmd+P` | Go to file (code editor open) |
| `Cmd+F` | Filter projects (Home) |
| `Cmd+1`–`Cmd+9` | Switch project tabs |

On Windows, use `Ctrl` in place of `Cmd`.

## Prerequisites

- An AI CLI tool installed: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor](https://cursor.sh), [Codex](https://github.com/openai/codex), Antigravity, Qwen, or any custom command
- For existing projects: a running dev server (e.g. `npm run dev`) — Starter Projects need nothing

## Running from source

```bash
git clone https://github.com/assentorp/dosmos.git
cd dosmos
npm install
npm run dev
```

This starts the Vite dev server and Electron concurrently. Requires Node.js 20+.

### Building

```bash
npm run build          # Build for current platform
npm run build:mac      # macOS
npm run build:win      # Windows
npm run build:linux    # Linux
```

Output goes to the `release/` directory.

## Project structure

```
src/
  main/                 # Electron main process
    index.ts            # Window creation, app lifecycle
    ipc.ts              # IPC handlers (terminal, annotations, editor, element search)
    presets.ts          # Project preset storage
    settings.ts         # App settings storage
    tailwind-tokens.ts  # Design token extraction
    updater.ts          # GitHub release auto-updater
    menu.ts             # App menu
  preload/              # Context bridge
  renderer/             # React UI (Vite)
    components/         # Browser, Terminal, CodeEditorPanel, TabBar, etc.
    styles/             # CSS
  annotation/           # Injected script for element selection in webview
  shared/               # Shared types
```

## Contributing

Dosmos is open source but **does not accept external contributions** — see [CONTRIBUTING.md](CONTRIBUTING.md) for the policy, and for what you can do instead (bug reports, feature suggestions, forks).

## License

[MIT](LICENSE)

## Privacy

Analytics are opt-in and off by default. See [PRIVACY.md](PRIVACY.md) for details.
