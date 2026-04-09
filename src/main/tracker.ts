import { v4 as uuidv4 } from 'uuid';
import { insertSnapshot } from './local-db';
import { getIdleSeconds, isIdle, startIdleDetector, stopIdleDetector } from './idle-detector';
import { getActiveWindow, startWindowWatcher, stopWindowWatcher } from './window-watcher';
import { categorize, refreshCategories } from './categorizer';
import { getAssignedUserId } from './device-registry';

const TICK_INTERVAL_MS = 60_000; // 1 minute

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let tracking = false;

async function tick(): Promise<void> {
  const userId = getAssignedUserId();
  if (!userId) return; // Employee not yet assigned to this device — skip tick silently

  const idleSecs = await getIdleSeconds();
  const idle     = await isIdle(); // true if >= 10 minutes idle

  const windowInfo  = idle ? null : await getActiveWindow();
  const appName     = windowInfo?.appName ?? null;
  const windowTitle = windowInfo?.windowTitle ?? null;
  const category    = idle ? 'idle' : categorize(appName ?? '');

  insertSnapshot({
    id:            uuidv4(),
    user_id:       userId,
    timestamp:     new Date().toISOString(),
    app_name:      appName,
    window_title:  windowTitle,
    category,
    is_idle:       idle,
    idle_seconds:  Math.round(idleSecs),
    duration_secs: 60,
  });
}

export function startTracking(): void {
  if (tracking) return;
  tracking = true;
  startIdleDetector();
  startWindowWatcher();
  refreshCategories().catch(() => { /* non-fatal */ });
  tick().catch(console.warn);
  intervalHandle = setInterval(() => tick().catch(console.warn), TICK_INTERVAL_MS);
  console.log('[tracker] Started (1-min ticks, 10-min idle threshold)');
}

export function stopTracking(): void {
  if (!tracking) return;
  tracking = false;
  if (intervalHandle !== null) { clearInterval(intervalHandle); intervalHandle = null; }
  stopIdleDetector();
  stopWindowWatcher();
  console.log('[tracker] Stopped');
}

export function isCurrentlyTracking(): boolean {
  return tracking && intervalHandle !== null;
}
