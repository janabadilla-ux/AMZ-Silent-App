import fs from 'fs';
import { getSupabase } from './supabase-client';
import { getAssignedUserId, updateLastSeen, refreshAssignment } from './device-registry';
import { recordSessionStart } from './device-session';
import {
  getUnsyncedSnapshots, markSnapshotsSynced,
  getUnsyncedScreenshots, markScreenshotSynced,
  computeDailyStats, cleanOldData,
} from './local-db';
import { refreshCategories } from './categorizer';

const SYNC_INTERVAL_MS    = 5 * 60 * 1000; // 5 minutes
const FIRST_SYNC_DELAY_MS = 30_000;         // 30 seconds after start
const BATCH_SIZE          = 200;
const DAYS_TO_KEEP        = 14;

let syncInterval: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;

async function runSync(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;
  try { await syncCycle(); }
  catch (e) { console.warn('[sync] Cycle error:', e); }
  finally { isSyncing = false; }
}

async function syncCycle(): Promise<void> {
  // Always update last_seen so the web portal knows the device is online
  await updateLastSeen();

  // Re-check assignment in case admin assigned an employee since last startup
  const justAssigned = await refreshAssignment();
  if (justAssigned) {
    // First time we have a user_id — start the session retroactively
    await recordSessionStart().catch(() => { /* non-fatal */ });
  }

  const userId = getAssignedUserId();
  if (!userId) return; // No employee assigned yet — don't sync tracking data

  const supabase = getSupabase();

  // 1. Refresh app categories
  await refreshCategories().catch(() => { /* non-fatal */ });

  // 2. Upload activity snapshots (batch 200)
  const snapshots = getUnsyncedSnapshots(BATCH_SIZE);
  if (snapshots.length > 0) {
    const { error } = await supabase
      .from('activity_snapshots')
      .upsert(snapshots, { onConflict: 'user_id,timestamp' });
    if (!error) {
      markSnapshotsSynced(snapshots.map((s) => s.id));
      console.log(`[sync] Uploaded ${snapshots.length} snapshots`);
    } else {
      console.warn('[sync] Snapshot upload error:', error.message);
    }
  }

  // 3. Upload screenshots (if any)
  const pending = getUnsyncedScreenshots(10);
  for (const row of pending) {
    try {
      if (!fs.existsSync(row.local_path)) { markScreenshotSynced(row.id); continue; }
      const fileBuffer = fs.readFileSync(row.local_path);
      const storagePath = `${userId}/${row.id}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('screenshots')
        .upload(storagePath, fileBuffer, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) { console.warn('[sync] Screenshot upload error:', uploadError.message); continue; }
      await supabase.from('screenshots').upsert({ id: row.id, user_id: userId, timestamp: row.timestamp, storage_path: storagePath, file_size: fileBuffer.length });
      markScreenshotSynced(row.id);
    } catch (e) { console.warn('[sync] Screenshot error:', e); }
  }

  // 4. Upsert today's productivity summary
  const today = new Date().toISOString().slice(0, 10);
  const stats = computeDailyStats(userId, today);
  if (stats.totalSeconds > 0) {
    await supabase.from('productivity_summaries').upsert({
      user_id:              userId,
      date:                 today,
      active_seconds:       stats.activeSeconds,
      idle_seconds:         stats.idleSeconds,
      productive_seconds:   stats.productiveSeconds,
      neutral_seconds:      stats.neutralSeconds,
      unproductive_seconds: stats.unproductiveSeconds,
      total_seconds:        stats.totalSeconds,
      productivity_score:   stats.productivityScore,
      top_apps:             stats.topApps,
      updated_at:           new Date().toISOString(),
    }, { onConflict: 'user_id,date' });
  }

  // 5. Clean old local data
  cleanOldData(DAYS_TO_KEEP);
}

export function startSyncEngine(): void {
  if (syncInterval) return;
  setTimeout(() => runSync(), FIRST_SYNC_DELAY_MS);
  syncInterval = setInterval(() => runSync(), SYNC_INTERVAL_MS);
  console.log('[sync] Engine started');
}

export function stopSyncEngine(): void {
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
}

export async function forceSyncNow(): Promise<void> {
  console.log('[sync] Force sync...');
  await runSync();
}
