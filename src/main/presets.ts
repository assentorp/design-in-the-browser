import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { ProjectPreset } from '../shared/types';

const presetsPath = path.join(app.getPath('userData'), 'presets.json');
const presetsBackupPath = `${presetsPath}.bak`;
const presetsTempPath = `${presetsPath}.tmp`;

let cachedPresets: ProjectPreset[] = [];
let loaded = false;
let lastLoadFailed = false;

function readPresetsFile(file: string): ProjectPreset[] | null {
  if (!fs.existsSync(file)) return null;
  const data = fs.readFileSync(file, 'utf-8');
  if (!data.trim()) return null;
  const parsed = JSON.parse(data);
  if (!Array.isArray(parsed)) return null;
  return parsed as ProjectPreset[];
}

export function getPresets(): ProjectPreset[] {
  if (loaded) return cachedPresets;

  try {
    const main = readPresetsFile(presetsPath);
    if (main !== null) {
      cachedPresets = main;
      loaded = true;
      return cachedPresets;
    }
  } catch (err) {
    console.error('[Presets] Failed to load presets.json, trying backup:', err);
    lastLoadFailed = true;
  }

  try {
    const backup = readPresetsFile(presetsBackupPath);
    if (backup !== null) {
      console.warn('[Presets] Recovered', backup.length, 'presets from backup');
      cachedPresets = backup;
      loaded = true;
      return cachedPresets;
    }
  } catch (err) {
    console.error('[Presets] Failed to load presets.json.bak:', err);
    lastLoadFailed = true;
  }

  loaded = true;
  return cachedPresets;
}

export function savePresets(presets: ProjectPreset[]): ProjectPreset[] {
  // Refuse to wipe the on-disk file if we couldn't read it earlier — a save of
  // [] over an unreadable file would turn a recoverable corruption into
  // permanent data loss. The user can still add/delete normally once at least
  // one preset is in memory.
  if (lastLoadFailed && presets.length === 0 && fs.existsSync(presetsPath)) {
    console.warn('[Presets] Refusing to save empty list while previous load failed');
    return cachedPresets;
  }

  try {
    // Rotate current file to .bak before overwriting, so we always have one
    // good prior version on disk.
    if (fs.existsSync(presetsPath)) {
      try {
        fs.copyFileSync(presetsPath, presetsBackupPath);
      } catch (err) {
        console.warn('[Presets] Failed to write backup (continuing):', err);
      }
    }

    // Atomic write: tmp + rename. rename is atomic on POSIX; on Windows
    // Node's fs.renameSync uses MoveFileEx with replace semantics.
    fs.writeFileSync(presetsTempPath, JSON.stringify(presets, null, 2));
    fs.renameSync(presetsTempPath, presetsPath);

    cachedPresets = presets;
    lastLoadFailed = false;
    console.log('[Presets] Saved:', presets.length, 'presets');
  } catch (err) {
    console.error('[Presets] Failed to save presets:', err);
    // Clean up partial tmp file if it's still hanging around.
    try {
      if (fs.existsSync(presetsTempPath)) fs.unlinkSync(presetsTempPath);
    } catch {
      // best effort
    }
  }

  return cachedPresets;
}
