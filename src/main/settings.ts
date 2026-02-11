import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface AppSettings {
  screenshotCleanupMinutes: number;
  editor: string;
  editorChosen: boolean;
  analyticsEnabled: boolean;
  analyticsConsentGiven: boolean;
  onboardingCompleted: boolean;
  discordDismissed: boolean;
  windowBounds?: WindowBounds;
  browserWidthPercent?: number;
}

const defaultSettings: AppSettings = {
  screenshotCleanupMinutes: 5,
  editor: 'vscode',
  editorChosen: false,
  analyticsEnabled: false,
  analyticsConsentGiven: false,
  onboardingCompleted: false,
  discordDismissed: false,
};

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

let cachedSettings: AppSettings = { ...defaultSettings };
let loaded = false;

export function getSettings(): AppSettings {
  if (loaded) return cachedSettings;

  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(data);
      cachedSettings = { ...defaultSettings, ...parsed };
    }
  } catch (err) {
    console.error('[Settings] Failed to load settings:', err);
  }

  loaded = true;
  return cachedSettings;
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const updated = { ...current, ...settings };

  try {
    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2));
    cachedSettings = updated;
    console.log('[Settings] Saved:', updated);
  } catch (err) {
    console.error('[Settings] Failed to save settings:', err);
  }

  return updated;
}

export function getScreenshotCleanupMs(): number {
  const settings = getSettings();
  return settings.screenshotCleanupMinutes * 60 * 1000;
}
