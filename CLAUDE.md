# Claude Context for Design In The Browser

## IMPORTANT: Instructions for Claude

**Releases**: Do NOT automatically create releases. Always ask the user "Should I release this?" and wait for explicit confirmation before bumping version, tagging, and pushing.

⚠️ **NO EXCEPTIONS** - Even for bug fixes, crash fixes, or "urgent" issues, ALWAYS ask first. Never assume a release is okay without explicit user approval.

---

This file documents the codebase structure and recent changes for future reference.

## Project Overview

Electron desktop app for visually annotating elements in a browser and sending edit instructions to AI coding assistants (Claude Code, Cursor, Gemini CLI).

## Tech Stack

- **Electron** - Desktop framework
- **React** - UI framework
- **Vite** - Build tool for renderer
- **TypeScript** - Language
- **node-pty** - Terminal emulation
- **electron-updater** - Auto-updates
- **electron-builder** - Packaging

## Key Files

### Main Process (`src/main/`)
- `index.ts` - Window creation, app lifecycle, GPU acceleration disabled on Windows
- `ipc.ts` - IPC handlers for terminals, annotations, settings, editor launching, element search
- `menu.ts` - App menu (Settings under app name on macOS, File on Windows), no reload shortcuts
- `updater.ts` - GitHub release auto-update with electron-updater
- `settings.ts` - App settings storage (screenshot cleanup time, editor preference)

### Renderer (`src/renderer/`)
- `App.tsx` - Main app with sessions, modals, update banner, CLI idle detection, edit queue
- `components/Browser.tsx` - Webview with annotation mode, element inspector, editor integration
- `components/Terminal.tsx` - Terminal tabs with rename-on-double-click, close confirmation
- `components/TabBar.tsx` - Project tabs with centered names, close confirmation
- `components/ProjectConfigModal.tsx` - Project configuration with WSL support, CLI tool selection
- `components/SettingsModal.tsx` - Settings UI (screenshot cleanup, editor selection)
- `components/WhatsNewModal.tsx` - Changelog modal
- `components/EditQueuePanel.tsx` - Pending edits (todos) panel
- `components/QueuedEditsPanel.tsx` - Queued edits waiting for CLI idle
- `changelog.ts` - Release notes data for What's New modal

### Shared (`src/shared/`)
- `types.ts` - TypeScript interfaces for Session, ProjectPreset, AppSettings, AnnotationData, etc.

### Preload (`src/preload/`)
- `main-preload.ts` - Context bridge exposing mainAPI to renderer

### Annotation (`src/annotation/`)
- `injected-script.ts` - Script injected into webview for element selection, annotation UI, @-mention file autocomplete

## Recent Changes (v1.2.2 - v1.2.28)

### Editor Integration (v1.2.24+)
- Replaced embedded VS Code with configurable external editor support
- Supported editors: VS Code, Cursor, Zed, Sublime Text, WebStorm, Nova
- Editor auto-detection on startup
- Editor setting stored in app settings
- "Code" button in toolbar opens project in selected editor
- Element inspector can open source files at specific lines
- Editor opens with file explorer sidebar visible (passes project path as first arg)

### Annotation System
- Annotations formatted as markdown lists for CLI parsing
- Multi-edit mode: annotate multiple elements, sent as a single prompt
- @-mention file autocomplete in annotation textarea (type `@` to search project files)
- Screenshot captured per annotation, stored in OS temp folder
- Reference image support (paste/attach design reference)
- Text selection annotations (select text on page, annotate it)

### Terminal & Session Management
- Double-click terminal tab names to rename inline (Enter saves, Escape cancels)
- Confirmation dialog when closing project or terminal tabs
- Close buttons positioned at far right of tabs (absolute positioned, won't shift centered names)
- Session state (pendingEdits, editActions, annotateMode) clears when switching or closing projects
- File drag-and-drop into terminal pastes file paths

### CLI Tool Integration
- CLI tool activity detection via terminal data monitoring
- Spinner indicator on CLI tool tab when active
- Edit queue: annotations sent while CLI is busy are queued, auto-flushed when idle
- Idle detection ignores small data chunks (≤8 bytes: cursor blinks, TUI redraws)
- Idle timeout: 1.5 seconds of no substantial output
- Annotation auto-submit: PTY text and `\r` sent as separate writes with 100ms delay for TUI compatibility

### UI/UX
- What's New modal with changelog, notification dot for unseen changes
- Settings cog and notification bell in tab bar
- Project tab names centered with close button at far right
- Terminal tab names centered with close button at far right
- Cmd+R/Ctrl+R reload disabled to prevent accidental session loss
- Settings moved to app name menu on macOS (standard Mac convention)
- Claude model selection and `--dangerously-skip-permissions` option in project config
- Loading bar with instant visual feedback

### Settings
- Settings stored in `app.getPath('userData')/settings.json`
- Screenshot cleanup: 1 min, 5 min (recommended/default), 10 min, 30 min, 1 hour
- Screenshots stored in OS temp folder (won't fill up disk, OS handles cleanup)
- Settings modal: Cmd/Ctrl + , (macOS: app menu, Windows: File menu)
- Editor preference: configurable via settings

### Auto-Updates
- electron-updater with GitHub releases
- Update banner: available → downloading (with %) → ready to install
- "Check for Updates" in menu (macOS: app menu, Windows: Help menu)
- macOS code signing and notarization

### Windows Support
- GPU hardware acceleration disabled on Windows
- ASAR-compatible renderer path resolution
- WSL support: shell selector, path conversion (`C:\foo` → `/mnt/c/foo`)

## Build & Release

### Local Development
```bash
npm install
npm run dev
```

### Building
```bash
npm run build          # Current platform
npm run build:mac      # macOS
npm run build:win      # Windows
npm run build:linux    # Linux
```

### Creating a Release
```bash
# 1. Bump version in package.json and changelog.ts
# 2. Commit changes
# 3. Tag and push
git tag v1.2.28
git push origin main
git push origin v1.2.28
```

GitHub Actions builds macOS (arm64 + x64) and Windows, uploads:
- `.dmg`, `.zip` for macOS
- `.exe` for Windows
- `latest.yml`, `latest-mac.yml` for auto-updates
- `.blockmap` files for delta updates

## Configuration

### electron-builder (`package.json`)
```json
{
  "build": {
    "appId": "com.designinthebrowser.app",
    "productName": "Design In The Browser",
    "publish": {
      "provider": "github",
      "owner": "assentorp",
      "repo": "design-in-the-browser"
    },
    "win": {
      "artifactName": "Design-In-The-Browser-Setup-${version}.${ext}"
    }
  }
}
```

### App Settings Interface
```typescript
interface AppSettings {
  screenshotCleanupMinutes: number; // default = 5
  editor: CodeEditor;               // default = 'vscode'
}
```

### Supported Editors
```typescript
type CodeEditor = 'vscode' | 'cursor' | 'zed' | 'sublime' | 'webstorm' | 'nova';
```

### Session/Preset Shell Type
```typescript
type ShellType = 'default' | 'wsl';
```

## IPC Channels

### Main → Renderer
- `app:update-available` - New version available
- `app:update-progress` - Download progress
- `app:update-downloaded` - Ready to install
- `open-settings` - Open settings modal
- `open-whats-new` - Open What's New modal
- `toggle-annotate` - Toggle annotation mode
- `terminal:data` - Terminal output (sessionId + data)

### Renderer → Main
- `terminal:create` - Create terminal (with shell type)
- `terminal:input` - Send input to terminal
- `terminal:ready` - Signal terminal is ready for output
- `terminal:run-command` - Run command in terminal
- `annotation:send` - Send annotation to CLI tool (writes prompt + Enter to PTY)
- `editor:open-file` - Open file/folder in external editor (with optional projectPath for sidebar)
- `editor:detect` - Detect installed editors
- `settings:get` / `settings:save` - App settings
- `wsl:check` - Check WSL availability
- `app:download-update` / `app:install-update` - Update actions
