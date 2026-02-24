# Design In The Browser

![icon](https://github.com/user-attachments/assets/b57c4c81-f109-427f-b6e7-454dea817203)

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Contributing](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)

![mockup](https://github.com/user-attachments/assets/81f81ec8-4fd6-4e5c-8e0c-cdbce3e42824)

No more tab-switching, screenshot-pasting, and explaining which button you mean. Just click it.

A desktop app for visually annotating elements in a live browser and sending edit instructions directly to an AI coding assistant running in a side-by-side terminal. Point at what you want changed, describe the change, and let the AI handle the code.

**[Download for macOS](https://github.com/assentorp/ditb-releases/releases/download/v1.4.0/Design-In-The-Browser-1.4.0-arm64.dmg)** | **[Download for Windows](https://github.com/assentorp/ditb-releases/releases/download/v1.4.0/Design-In-The-Browser-Setup-1.4.0.exe)**

Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor](https://cursor.sh), [Codex](https://github.com/openai/codex), or [Gemini CLI](https://github.com/google-gemini/gemini-cli) · v1.4.0 · macOS 13+ / Windows 10+

## How it works

1. **Open a project** — configure your project path, dev server command, and URL
2. **Browse your app** — a built-in browser loads your running dev server
3. **Annotate** — click elements, select areas, or multi-select to describe changes
4. **AI edits** — annotations are sent as prompts to your CLI tool in the integrated terminal
5. **See results** — the browser reloads with changes applied

## Features

- **Point & Click** — click any element to tell AI what to change, no screenshots needed
- **Area Select** — drag a box around any area to give AI the visual context it needs
- **Jump to Code** — click any element and jump straight to its source code
- **Multi-Edit** — select multiple elements, queue up changes, send them all at once
- **CSS Inspector** — hold `ALT` to inspect styles and copy values between elements instantly
- **Reference Images** — drop in a design screenshot and AI matches it
- **Design Tokens** — reference your CSS variables and Tailwind tokens directly in prompts to stay on-brand
- **Integrated Terminal** — browser and terminal in one window with multi-tab support
- **Responsive Testing** — switch between desktop, tablet, and mobile viewports instantly
- **Project Presets** — save and switch between project configurations
- **Session Tabs** — work on multiple projects simultaneously
- **Update Notifications** — automatic check for new releases on startup

## Getting started

```bash
npm install
npm run dev
```

This starts the Vite dev server and Electron concurrently.

### Prerequisites

- Node.js 20+
- A running dev server for your project (e.g. `npm run dev` in your project)
- An AI CLI tool installed: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor](https://cursor.sh), [Codex](https://github.com/openai/codex), or [Gemini CLI](https://github.com/google-gemini/gemini-cli)

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
