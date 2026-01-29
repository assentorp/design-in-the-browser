# Claude Context for Design In The Browser

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
- `ipc.ts` - IPC handlers for terminals, annotations, settings, WSL, VS Code
- `menu.ts` - App menu with Settings, Check for Updates, version display
- `updater.ts` - GitHub release auto-update with electron-updater
- `settings.ts` - App settings storage (screenshot cleanup time)

### Renderer (`src/renderer/`)
- `App.tsx` - Main app with sessions, modals, update banner
- `components/ProjectConfigModal.tsx` - Project configuration with WSL support
- `components/SettingsModal.tsx` - Settings UI (screenshot cleanup time)
- `components/Terminal.tsx` - Terminal tabs with shell type support

### Shared (`src/shared/`)
- `types.ts` - TypeScript interfaces for Session, ProjectPreset, AppSettings, etc.

### Preload (`src/preload/`)
- `main-preload.ts` - Context bridge exposing mainAPI to renderer

## Recent Changes (v1.1.0 - v1.2.1)

### Auto-Updates (electron-updater)
- Replaced manual GitHub API check with electron-updater
- Update banner shows: available → downloading (with %) → ready to install
- "Check for Updates" in menu (macOS: app menu, Windows: Help menu)
- Version displayed in Help menu
- Fixed Windows auto-update by ensuring `latest.yml` is uploaded in releases
- Fixed artifact naming: `Design-In-The-Browser-Setup-{version}.exe`

### Windows Support
- Disabled GPU hardware acceleration on Windows (`app.disableHardwareAcceleration()`)
- Fixed renderer path using `app.getAppPath()` instead of `__dirname` for ASAR compatibility
- Added WSL support:
  - Detects WSL availability (`wsl --status`)
  - Shell selector in project config (PowerShell / WSL)
  - Converts Windows paths to WSL paths (`C:\foo` → `/mnt/c/foo`)

### Settings System
- Settings stored in `app.getPath('userData')/settings.json`
- Screenshot cleanup time configurable: 1 min, 5 min (default), 10 min, 30 min, 1 hour, never
- Settings modal: File → Settings (Cmd/Ctrl + ,)

### UI Changes
- New app icon (orange D on dark background)
- Removed "Update saved preset" checkbox - editing always saves
- Version shown in Help menu

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
# 1. Bump version in package.json
# 2. Commit changes
# 3. Tag and push
git tag v1.2.1
git push origin main
git push origin v1.2.1
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
      "repo": "ditb"
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
  screenshotCleanupMinutes: number; // 0 = never, default = 5
}
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
- `toggle-annotate` - Toggle annotation mode
- `terminal:data` - Terminal output

### Renderer → Main
- `terminal:create` - Create terminal (with shell type)
- `terminal:input` - Send input to terminal
- `settings:get` / `settings:save` - App settings
- `wsl:check` - Check WSL availability
- `app:download-update` / `app:install-update` - Update actions
