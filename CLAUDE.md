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

## Reference (IPC channels + v1.2.2–v1.2.28 changelog)

The IPC channel catalog and the full feature changelog live in the `ditb-reference` skill (`.claude/skills/ditb-reference/SKILL.md`) so they load on demand instead of every session. Consult it when you need exact IPC channel names/payloads or the history of a shipped feature.

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

The full Main↔Renderer IPC channel catalog lives in the `ditb-reference` skill (`.claude/skills/ditb-reference/SKILL.md`).
