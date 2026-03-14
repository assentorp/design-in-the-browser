import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { PersistedSessionState } from '../shared/types';

const sessionStorePath = path.join(app.getPath('userData'), 'sessions.json');

let cachedState: PersistedSessionState | null = null;
let loaded = false;

export function getSessionState(): PersistedSessionState | null {
  if (loaded) return cachedState;

  try {
    if (fs.existsSync(sessionStorePath)) {
      const data = fs.readFileSync(sessionStorePath, 'utf-8');
      cachedState = JSON.parse(data);
    }
  } catch (err) {
    console.error('[SessionStore] Failed to load session state:', err);
  }

  loaded = true;
  return cachedState;
}

export function saveSessionState(state: PersistedSessionState): void {
  try {
    fs.writeFileSync(sessionStorePath, JSON.stringify(state, null, 2));
    cachedState = state;
  } catch (err) {
    console.error('[SessionStore] Failed to save session state:', err);
  }
}

export function clearSessionState(): void {
  try {
    if (fs.existsSync(sessionStorePath)) {
      fs.unlinkSync(sessionStorePath);
    }
    cachedState = null;
  } catch (err) {
    console.error('[SessionStore] Failed to clear session state:', err);
  }
}
