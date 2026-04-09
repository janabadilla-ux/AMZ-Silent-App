import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

interface Snapshot {
  id: string;
  user_id: string;
  timestamp: string; // ISO string
  app_name: string | null;
  window_title: string | null;
  category: string;
  is_idle: boolean;
  idle_seconds: number;
  duration_secs: number;
}

interface ScreenshotQueueRow {
  id: string;
  user_id: string;
  timestamp: string;
  local_path: string;
}

interface DailyStats {
  activeSeconds: number;
  idleSeconds: number;
  totalSeconds: number;
  productivityScore: number; // 0-100
  topApps: Array<{ appName: string; seconds: number }>;
  productiveSeconds: number;
  neutralSeconds: number;
  unproductiveSeconds: number;
}

let db: Database.Database | null = null;

export function initDatabase(): void {
  const dbPath = path.join(app.getPath('userData'), 'allstars.db');
  db = new Database(dbPath);

  // Enable WAL mode for concurrent reads during writes
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      timestamp     TEXT NOT NULL,
      app_name      TEXT,
      window_title  TEXT,
      category      TEXT NOT NULL DEFAULT 'uncategorized',
      is_idle       INTEGER NOT NULL DEFAULT 0,
      idle_seconds  INTEGER NOT NULL DEFAULT 0,
      duration_secs INTEGER NOT NULL DEFAULT 30,
      synced        INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_sync
      ON snapshots (synced, created_at);

    CREATE INDEX IF NOT EXISTS idx_snapshots_user_date
      ON snapshots (user_id, timestamp);

    CREATE TABLE IF NOT EXISTS screenshots_queue (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      timestamp  TEXT NOT NULL,
      local_path TEXT NOT NULL,
      synced     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_screenshots_sync
      ON screenshots_queue (synced, created_at);
  `);
}

export function insertSnapshot(snapshot: Snapshot): void {
  if (!db) return;
  db.prepare(`
    INSERT OR IGNORE INTO snapshots
      (id, user_id, timestamp, app_name, window_title, category, is_idle, idle_seconds, duration_secs, synced)
    VALUES
      (@id, @user_id, @timestamp, @app_name, @window_title, @category, @is_idle, @idle_seconds, @duration_secs, 0)
  `).run({
    ...snapshot,
    is_idle: snapshot.is_idle ? 1 : 0,
  });
}

export function getUnsyncedSnapshots(limit = 200): Snapshot[] {
  if (!db) return [];
  type RawSnapshot = Omit<Snapshot, 'is_idle'> & { is_idle: number };
  const rows = db.prepare(
    'SELECT * FROM snapshots WHERE synced = 0 ORDER BY created_at ASC LIMIT ?'
  ).all(limit) as RawSnapshot[];
  return rows.map((r) => ({
    ...r,
    is_idle: r.is_idle === 1,
  }));
}

export function markSnapshotsSynced(ids: string[]): void {
  if (!db || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  const stmt = db.prepare(`UPDATE snapshots SET synced = 1 WHERE id IN (${placeholders})`);
  const tx = db.transaction(() => stmt.run(...ids));
  tx();
}

export function queueScreenshot(id: string, userId: string, timestamp: string, localPath: string): void {
  if (!db) return;
  db.prepare(`
    INSERT OR IGNORE INTO screenshots_queue (id, user_id, timestamp, local_path, synced)
    VALUES (?, ?, ?, ?, 0)
  `).run(id, userId, timestamp, localPath);
}

export function getUnsyncedScreenshots(limit = 10): ScreenshotQueueRow[] {
  if (!db) return [];
  return db.prepare(
    'SELECT * FROM screenshots_queue WHERE synced = 0 ORDER BY created_at ASC LIMIT ?'
  ).all(limit) as ScreenshotQueueRow[];
}

export function markScreenshotSynced(id: string): void {
  if (!db) return;
  db.prepare('UPDATE screenshots_queue SET synced = 1 WHERE id = ?').run(id);
}

export function computeDailyStats(userId: string, date: string): DailyStats {
  if (!db) {
    return { activeSeconds: 0, idleSeconds: 0, totalSeconds: 0, productivityScore: 0, topApps: [], productiveSeconds: 0, neutralSeconds: 0, unproductiveSeconds: 0 };
  }

  const rows = db.prepare(`
    SELECT category, is_idle, idle_seconds, duration_secs, app_name
    FROM snapshots
    WHERE user_id = ? AND DATE(timestamp) = ?
  `).all(userId, date) as Array<{
    category: string;
    is_idle: number;
    idle_seconds: number;
    duration_secs: number;
    app_name: string | null;
  }>;

  let activeSeconds = 0;
  let idleSeconds = 0;
  let productiveSeconds = 0;
  let neutralSeconds = 0;
  let unproductiveSeconds = 0;
  const appTime: Record<string, number> = {};

  for (const row of rows) {
    const dur = row.duration_secs || 30;
    if (row.is_idle) {
      idleSeconds += dur;
    } else {
      activeSeconds += dur;
      if (row.category === 'productive') productiveSeconds += dur;
      else if (row.category === 'neutral') neutralSeconds += dur;
      else if (row.category === 'unproductive') unproductiveSeconds += dur;
      if (row.app_name) {
        appTime[row.app_name] = (appTime[row.app_name] || 0) + dur;
      }
    }
  }

  const totalSeconds = activeSeconds + idleSeconds;
  const productivityScore = activeSeconds > 0
    ? Math.round((productiveSeconds / activeSeconds) * 100)
    : 0;

  const topApps = Object.entries(appTime)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([appName, seconds]) => ({ appName, seconds }));

  return { activeSeconds, idleSeconds, totalSeconds, productivityScore, topApps, productiveSeconds, neutralSeconds, unproductiveSeconds };
}

export function cleanOldData(daysToKeep: number): void {
  if (!db) return;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);
  const cutoffStr = cutoff.toISOString();
  db.prepare("DELETE FROM snapshots WHERE synced = 1 AND created_at < ?").run(cutoffStr);
  db.prepare("DELETE FROM screenshots_queue WHERE synced = 1 AND created_at < ?").run(cutoffStr);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
