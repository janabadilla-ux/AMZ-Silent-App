/**
 * Window watcher — detects the currently focused foreground application.
 * Uses a persistent PowerShell process on Windows (P/Invoke, no native addon).
 * Returns null gracefully on any failure.
 */
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

export interface WindowInfo {
  appName: string;
  windowTitle: string;
  pid: number;
}

// ── PowerShell persistent process ─────────────────────────────────────────
const PS_DELIMITER = '<<<WIN_DONE>>>';
const PS_INIT_SCRIPT = `
$code = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class WinWatcher {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
    public static string GetForegroundInfo() {
        try {
            IntPtr hwnd = GetForegroundWindow();
            int pid = 0;
            GetWindowThreadProcessId(hwnd, out pid);
            var proc = Process.GetProcessById(pid);
            return proc.ProcessName + "|||" + (proc.MainWindowTitle ?? "") + "|||" + pid.ToString();
        } catch {
            return "|||0";
        }
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
        psReady = true; // Init complete
      } else {
        const resolve = psQueue.shift();
        if (resolve) resolve(result);
      }
    }
  });
  psProcess.on('exit', () => {
    psProcess = null;
    psReady = false;
    psBuffer = '';
  });
  // Compile C# and signal ready
  psProcess.stdin.write(PS_INIT_SCRIPT.replace('${PS_DELIMITER}', PS_DELIMITER) + '\n');
}

function queryForegroundWindow(): Promise<string> {
  return new Promise((resolve) => {
    if (!psProcess || !psReady) {
      resolve('');
      return;
    }
    // Timeout guard: if PS hangs, resolve with empty after 5s
    const timer = setTimeout(() => resolve(''), 5000);
    psQueue.push((val) => { clearTimeout(timer); resolve(val); });
    psProcess.stdin.write(
      `Write-Host ([WinWatcher]::GetForegroundInfo()); Write-Host '${PS_DELIMITER}'\n`
    );
  });
}

// ── macOS fallback via osascript ──────────────────────────────────────────
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

async function getMacActiveWindow(): Promise<WindowInfo | null> {
  try {
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      'tell application "System Events" to get name of first application process whose frontmost is true',
    ], { timeout: 3000 });
    const appName = stdout.trim();
    return appName ? { appName, windowTitle: '', pid: 0 } : null;
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────
export function startWindowWatcher(): void {
  if (process.platform === 'win32') {
    ensurePsProcess();
  }
}

export function stopWindowWatcher(): void {
  if (psProcess) {
    try { psProcess.stdin.end(); } catch { /* ignore */ }
    psProcess = null;
    psReady = false;
    psBuffer = '';
  }
}

export async function getActiveWindow(): Promise<WindowInfo | null> {
  try {
    if (process.platform === 'win32') {
      if (!psProcess || !psReady) ensurePsProcess();
      const raw = await queryForegroundWindow();
      if (!raw) return null;
      const parts = raw.split('|||');
      const appName = (parts[0] || '').trim();
      const windowTitle = (parts[1] || '').trim();
      const pid = parseInt(parts[2] || '0', 10);
      if (!appName) return null;
      return { appName, windowTitle, pid };
    } else if (process.platform === 'darwin') {
      return getMacActiveWindow();
    }
    return null;
  } catch {
    return null;
  }
}
