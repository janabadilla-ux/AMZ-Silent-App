/**
 * Auto clock-in/out — tied to laptop startup and shutdown, NOT to idle state.
 *
 * Clock-in  = app starts (laptop boots) → first event of the day
 * Clock-out = app quits (laptop shuts down / user logs off)
 *
 * Writes to the same attendance_logs table used by the web portal.
 * Existing schema: id, user_id, clock_in, clock_out, break_start, break_end,
 *                  status, total_hours, ip_address, notes, created_at, updated_at
 */
import { getSupabase } from './supabase-client';
import { getAssignedUserId } from './device-registry';

const LATE_HOUR = 9;       // After 9:00 AM = 'late'
const EARLY_OUT_HOUR = 17; // Before 5:00 PM = 'early_out' on clock-out

interface ClockState {
  clockedIn: boolean;
  logId: string | null;
  clockInTime: Date | null;
}

const state: ClockState = {
  clockedIn: false,
  logId: null,
  clockInTime: null,
};

function startOfToday(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString();
}
function startOfTomorrow(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); return d.toISOString();
}

async function checkExistingClockIn(userId: string): Promise<boolean> {
  try {
    const { data } = await getSupabase()
      .from('attendance_logs')
      .select('id, clock_in')
      .eq('user_id', userId)
      .gte('clock_in', startOfToday())
      .lt('clock_in', startOfTomorrow())
      .is('clock_out', null)
      .limit(1)
      .maybeSingle();

    if (data) {
      state.clockedIn = true;
      state.logId = data.id;
      state.clockInTime = new Date(data.clock_in);
      console.log('[auto-clock] Found existing open clock-in from web portal');
      return true;
    }
  } catch { /* network down — will retry on sync */ }
  return false;
}

/**
 * Called once on app startup (laptop boot).
 * Does not clock in if already clocked in today via web portal.
 */
export async function clockInOnStartup(): Promise<void> {
  const userId = getAssignedUserId();
  if (!userId) return;

  // Don't create a duplicate if employee already clocked in via web portal
  const existing = await checkExistingClockIn(userId);
  if (existing) return;

  try {
    const now = new Date();
    const status = now.getHours() >= LATE_HOUR ? 'late' : 'on_time';

    const { data, error } = await getSupabase()
      .from('attendance_logs')
      .insert({ user_id: userId, clock_in: now.toISOString(), status })
      .select('id')
      .single();

    if (error) throw error;
    state.clockedIn = true;
    state.logId = data.id;
    state.clockInTime = now;
    console.log('[auto-clock] Clocked in at', now.toTimeString().slice(0, 8), `(${status})`);
  } catch (e) {
    console.warn('[auto-clock] Clock-in failed (will retry on next start):', e);
  }
}

/**
 * Called on app quit (laptop shutdown / logoff).
 * Best-effort — if network is down, the clock-out won't be recorded.
 */
export async function clockOutOnShutdown(): Promise<void> {
  if (!state.clockedIn || !state.logId) return;

  const userId = getAssignedUserId();
  if (!userId) return;

  try {
    const now = new Date();
    const totalHours = state.clockInTime
      ? Math.round(((now.getTime() - state.clockInTime.getTime()) / 3_600_000) * 100) / 100
      : null;
    const status = now.getHours() < EARLY_OUT_HOUR ? 'early_out' : 'on_time';

    await getSupabase()
      .from('attendance_logs')
      .update({
        clock_out: now.toISOString(),
        total_hours: totalHours,
        status,
        updated_at: now.toISOString(),
      })
      .eq('id', state.logId)
      .eq('user_id', userId);

    console.log('[auto-clock] Clocked out at', now.toTimeString().slice(0, 8), `(${totalHours}h)`);
  } catch (e) {
    console.warn('[auto-clock] Clock-out failed (laptop shutting down fast?):', e);
  }
}

export function getClockState(): { clockedIn: boolean; clockInTime: Date | null } {
  return { clockedIn: state.clockedIn, clockInTime: state.clockInTime };
}
