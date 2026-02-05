import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { ProjectPreset } from '../shared/types';

const presetsPath = path.join(app.getPath('userData'), 'presets.json');

let cachedPresets: ProjectPreset[] = [];
let loaded = false;

export function getPresets(): ProjectPreset[] {
  if (loaded) return cachedPresets;

  try {
    if (fs.existsSync(presetsPath)) {
      const data = fs.readFileSync(presetsPath, 'utf-8');
      cachedPresets = JSON.parse(data);
    }
  } catch (err) {
    console.error('[Presets] Failed to load presets:', err);
  }

  loaded = true;
  return cachedPresets;
}

export function savePresets(presets: ProjectPreset[]): ProjectPreset[] {
  try {
    fs.writeFileSync(presetsPath, JSON.stringify(presets, null, 2));
    cachedPresets = presets;
    console.log('[Presets] Saved:', presets.length, 'presets');
  } catch (err) {
    console.error('[Presets] Failed to save presets:', err);
  }

  return cachedPresets;
}
