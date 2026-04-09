/**
 * Idle detector — uses a persistent PowerShell process with P/Invoke
 * to call the Windows GetLastInputInfo API without any native Node addon.
 */
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

// 10 minutes of no mouse/keyboard = idle
export const IDLE_THRESHOLD_SECONDS = 600;

const PS_DELIMITER = '<<<DONE>>>';
const PS_INIT_SCRIPT = `
$code = @'
using System;
using System.Runtime.InteropServices;
public class IdleDetector {
    [StructLayout(LayoutKind.Sequential)]
    struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")]
    static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    public static double GetIdleSeconds() {
        var lii = new LASTINPUTINFO();
        lii.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(lii);
        GetLastInputInfo(ref lii);
        return Math.Max(0, (Environment.TickCount - (int)lii.dwTime) / 1000.0);
    }
}
'@
Add-Type -TypeDefinition $code -Language CSharp -ErrorAction SilentlyContinue
Write-Host '${PS_DELIMITER}'
`;

let psProcess: ChildProcessWithoutNullStreams | null = null;
let psBuffer = '';
let psReady = false;
const psQueue: Array<(value: string) => void> = [];

function ensurePsProcess(): void {
  if (psProcess || process.platform !== 'win32') return;
  psProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
    windowsHide: true,
  });
  psProcess.stdout.on('data', (chunk: Buffer) => {
    psBuffer += chunk.toString();
    let idx: number;
    while ((idx = psBuffer.indexOf(PS_DELIMITER)) !== -1) {
      const result = psBuffer.slice(0, idx).trim();
      psBuffer = psBuffer.slice(idx + PS_DELIMITER.length);
      if (!psReady) {
        psReady = true;
      } else {
        const resolve = psQueue.shift();
        if (resolve) resolve(result);
      }
    }
  });
  psProcess.on('exit', () => {
    psProcess = null;
    psReady = false;
  });
  psProcess.stdin.write(PS_INIT_SCRIPT.replace('${PS_DELIMITER}', PS_DELIMITER) + '\n');
}

// Non-Windows fallback: approximate idle via timestamp
let lastActivityTime = Date.now();
if (process.platform !== 'win32') {
  try {
    const { app } = require('electron');
    app.on('browser-window-focus', () => { lastActivityTime = Date.now(); });
  } catch { /* ignore if called before app is ready */ }
}

export function startIdleDetector(): void {
  if (process.platform === 'win32') ensurePsProcess();
}

export function stopIdleDetector(): void {
  if (psProcess) {
    try { psProcess.stdin.end(); } catch { /* ignore */ }
    psProcess = null;
    psReady = false;
  }
}

export async function getIdleSeconds(): Promise<number> {
  if (process.platform === 'win32') {
    if (!psProcess || !psReady) ensurePsProcess();
    return new Promise((resolve) => {
      if (!psProcess || !psReady) { resolve(0); return; }
      psQueue.push((val) => {
        const n = parseFloat(val);
        resolve(isNaN(n) ? 0 : n);
      });
      psProcess.stdin.write(
        `Write-Host ([IdleDetector]::GetIdleSeconds()); Write-Host '${PS_DELIMITER}'\n`
      );
    });
  }
  return (Date.now() - lastActivityTime) / 1000;
}

export async function isIdle(): Promise<boolean> {
  return (await getIdleSeconds()) >= IDLE_THRESHOLD_SECONDS;
}
