import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import Store from 'electron-store';
import { queueScreenshot } from './local-db';
import { getAssignedUserId } from './device-registry';

const store = new Store<{ screenshotsEnabled: boolean }>({
  name: 'allstars-config',
  defaults: { screenshotsEnabled: false },
});

const CAPTURE_PROBABILITY = 0.05; // ~5% chance per 30s tick ≈ 1 per 10 min
const SCREENSHOT_QUALITY = 60;    // JPEG quality

function getScreenshotsDir(): string {
  const dir = path.join(app.getPath('userData'), 'screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function maybeCaptureScreenshot(): Promise<void> {
  if (!isScreenshotEnabled()) return;
  if (Math.random() >= CAPTURE_PROBABILITY) return;

  const userId = getAssignedUserId();
  if (!userId) return;

  try {
    // Lazy-require screenshot-desktop so it only loads when needed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const screenshot = require('screenshot-desktop') as (opts: { format: string }) => Promise<Buffer>;
    const imgBuffer = await screenshot({ format: 'jpg' });

    const id = uuidv4();
    const timestamp = new Date().toISOString();
    const filename = `${timestamp.replace(/[:.]/g, '-')}.jpg`;
    const localPath = path.join(getScreenshotsDir(), filename);

    fs.writeFileSync(localPath, imgBuffer);
    queueScreenshot(id, userId, timestamp, localPath);
    console.log('[screenshot] Captured:', filename);
  } catch (e) {
    console.warn('[screenshot] Capture failed:', e);
  }
}

export function isScreenshotEnabled(): boolean {
  return store.get('screenshotsEnabled') as boolean;
}

export function setScreenshotsEnabled(enabled: boolean): void {
  store.set('screenshotsEnabled', enabled);
}

export function cleanLocalScreenshots(): void {
  try {
    const dir = getScreenshotsDir();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    }
  } catch { /* non-fatal */ }
}
