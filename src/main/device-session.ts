/**
 * Device session tracker — records when this laptop was turned on/off.
 * Writes to `device_sessions` (NOT `attendance_logs`).
 * attendance_logs is owned by the AMZ Attendance web portal.
 */
import { getSupabase } from './supabase-client';
import { getAssignedUserId, getDeviceName } from './device-registry';

interface SessionState {
  sessionId: string | null;
  sessionStart: Date | null;
}

const state: SessionState = { sessionId: null, sessionStart: null };

export async function recordSessionStart(): Promise<void> {
  const userId = getAssignedUserId();
  if (!userId) {
    console.log('[session] No employee assigned yet — session not recorded');
    return;
  }

  try {
    const now = new Date();
    const { data, error } = await getSupabase()
      .from('device_sessions')
      .insert({
        user_id:       userId,
        device_name:   getDeviceName(),
        session_start: now.toISOString(),
      })
      .select('id')
      .single();

    if (error) throw error;
    state.sessionId    = data.id;
    state.sessionStart = now;
    console.log('[session] Laptop session started at', now.toTimeString().slice(0, 8));
  } catch (e) {
    console.warn('[session] Could not record session start:', e);
  }
}

export async function recordSessionEnd(): Promise<void> {
  if (!state.sessionId || !state.sessionStart) return;

  try {
    const now = new Date();
    const durationMinutes = Math.round(
      (now.getTime() - state.sessionStart.getTime()) / 60_000
    );
    await getSupabase()
      .from('device_sessions')
      .update({ session_end: now.toISOString(), duration_minutes: durationMinutes })
      .eq('id', state.sessionId);

    console.log('[session] Session ended:', durationMinutes, 'minutes');
  } catch (e) {
    console.warn('[session] Could not record session end:', e);
  }
}
