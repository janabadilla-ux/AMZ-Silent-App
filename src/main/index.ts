// Load .env before anything else reads process.env
import path from 'path';
import fs from 'fs';
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
}

import { app } from 'electron';
import AutoLaunch from 'auto-launch';
import { initDatabase, closeDatabase } from './local-db';
import { registerDevice } from './device-registry';
import { recordSessionStart, recordSessionEnd } from './device-session';
import { startTracking, stopTracking } from './tracker';
import { startSyncEngine, stopSyncEngine, forceSyncNow } from './sync-engine';

// ── Single instance lock ───────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

const autoLauncher = new AutoLaunch({ name: 'AllStars Tracker', isHidden: true });

app.on('window-all-closed', (e: Event) => e.preventDefault());

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  initDatabase();

  // Register device by MAC address — appears in "Inactive Computers" in web portal
  // Reads back user_id if admin has already assigned an employee
  await registerDevice();

  await recordSessionStart();
  startTracking();
  startSyncEngine();

  autoLauncher.isEnabled().then((enabled: boolean) => {
    if (!enabled) autoLauncher.enable().catch(() => { /* non-fatal */ });
  }).catch(() => { /* non-fatal */ });

  console.log('[app] AllStars Tracker running silently');
});

app.on('before-quit', async () => {
  stopTracking();
  await recordSessionEnd();
  await forceSyncNow().catch(() => { /* non-fatal */ });
  stopSyncEngine();
  closeDatabase();
});
