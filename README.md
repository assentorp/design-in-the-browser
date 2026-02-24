# Design In The Browser

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Contributing](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)

A desktop app for visually annotating elements in a live browser and sending edit instructions directly to an AI coding assistant running in a side-by-side terminal.

Point at what you want changed, describe the change, and let the AI handle the code.

## How it works

1. **Open a project** — configure your project path, dev server command, and URL
2. **Browse your app** — a built-in browser loads your running dev server
3. **Annotate** — click elements, select text, or multi-select to describe changes
4. **AI edits** — annotations are sent as prompts to your CLI tool (Claude, Cursor, or Gemini) in the terminal
5. **See results** — the browser reloads with changes applied

## Features

- **Visual annotations** — click any element, select text, or batch-select multiple elements
- **Screenshot context** — element screenshots are automatically attached to prompts
- **Reference images** — drop in a design reference for the AI to match
- **Multi-terminal tabs** — dev server + AI CLI + extra terminals in one panel
- **Project presets** — save and switch between project configurations
- **Session tabs** — work on multiple projects simultaneously
- **Viewport sizing** — test responsive layouts with custom widths
- **Update notifications** — automatic check for new releases on startup

## Getting started

```bash
npm install
npm run dev
```

This starts the Vite dev server and Electron concurrently.

### Prerequisites

- Node.js 20+
- A running dev server for your project (e.g. `npm run dev` in your project)
- An AI CLI tool installed: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor](https://cursor.sh), or [Gemini CLI](https://github.com/google-gemini/gemini-cli)

## Building

```bash
npm run build          # Build for current platform
npm run build:mac      # macOS
npm run build:win      # Windows
npm run build:linux    # Linux
```

Output goes to the `release/` directory.

### Releases

Releases are handled by the maintainer. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute.

## Project structure

```
src/
  main/           # Electron main process
    index.ts      # Window creation, app lifecycle
    ipc.ts        # IPC handlers (terminal, annotations)
    updater.ts    # GitHub release update checker
    menu.ts       # App menu
  preload/        # Context bridge
  renderer/       # React UI (Vite)
    components/   # Browser, Terminal, Toolbar, TabBar, etc.
    styles/       # CSS
  annotation/     # Injected script for element selection in webview
  shared/         # Shared types
```

## License

[MIT](LICENSE)

## Privacy

See [PRIVACY.md](PRIVACY.md) for details on analytics and data collection.
