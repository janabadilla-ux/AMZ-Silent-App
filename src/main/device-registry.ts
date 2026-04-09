/**
 * Device registry — identifies this laptop by MAC address and registers it
 * in the `devices` Supabase table.
 *
 * Flow:
 *   1. App starts → upsert MAC + hostname + Windows username into `devices`
 *   2. Row appears in "Inactive Computers" in the web portal (user_id = null)
 *   3. Admin assigns an employee to this device in the web portal
 *   4. Next startup → reads back user_id → tracking data is attributed correctly
 *
 * The assigned user_id is cached in memory for the lifetime of the process.
 */
import os from 'os';
import { getSupabase } from './supabase-client';

// ── Device fingerprint ─────────────────────────────────────────────────────

function getMacAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const info of iface) {
      if (!info.internal && info.mac && info.mac !== '00:00:00:00:00:00') {
        return info.mac.toUpperCase();
      }
    }
  }
  // Fallback: use hostname hash if no MAC found
  return `NOHW-${os.hostname().toUpperCase()}`;
}

const MAC_ADDRESS   = getMacAddress();
const DEVICE_NAME   = os.hostname().toUpperCase();
const DEVICE_USER   = os.userInfo().username;

// Cached result from last registerDevice() / refreshAssignment() call
let assignedUserId: string | null = null;
let assignedEmail: string | null = null;

let onAssignedCallback: (() => void) | null = null;

/** Called by index.ts so the registry can update the tray when assignment changes. */
export function setOnAssigned(cb: () => void): void {
  onAssignedCallback = cb;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Upserts this device into `devices` table and reads back the assigned user_id.
 * Call once on app startup.
 */
export async function registerDevice(): Promise<void> {
  console.log(`[device] MAC_ADDRESS = ${MAC_ADDRESS}, DEVICE_NAME = ${DEVICE_NAME}, DEVICE_USER = ${DEVICE_USER}`);
  try {
    const supabase = getSupabase();

    // Upsert: register or refresh the device record
    const { error: upsertError } = await supabase
      .from('devices')
      .upsert({
        mac_address:     MAC_ADDRESS,
        device_name:     DEVICE_NAME,
        device_username: DEVICE_USER,
        last_seen:       new Date().toISOString(),
      }, { onConflict: 'mac_address' });

    if (upsertError) {
      console.warn('[device] Upsert failed:', upsertError.message);
      return;
    }

    // Read back the full row to get assigned user_id (set by admin via web portal)
    const { data, error: selectError } = await supabase
      .from('devices')
      .select('user_id, assigned_email')
      .eq('mac_address', MAC_ADDRESS)
      .maybeSingle();

    if (selectError) {
      console.warn('[device] Could not read device row:', selectError.message);
      return;
    }

    assignedUserId  = data?.user_id ?? null;
    assignedEmail   = data?.assigned_email ?? null;

    if (assignedUserId) {
      console.log(`[device] Registered: ${DEVICE_NAME} — assigned to ${assignedEmail ?? assignedUserId}`);
    } else {
      console.log(`[device] Registered: ${DEVICE_NAME} (${MAC_ADDRESS}) — awaiting employee assignment in web portal`);
    }
  } catch (e) {
    console.warn('[device] Registration failed (offline?):', e);
  }
}

/**
 * Called every sync cycle to keep `last_seen` fresh.
 * This is what powers the "active/inactive" status in the web portal.
 */
export async function updateLastSeen(): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from('devices')
      .update({ last_seen: new Date().toISOString() })
      .eq('mac_address', MAC_ADDRESS);
    if (error) console.warn('[device] updateLastSeen error:', error.message);
  } catch (e) { console.warn('[device] updateLastSeen threw:', e); }
}

/**
 * Re-checks the `devices` table for this MAC address.
 * Called every sync cycle so assignment is picked up without a restart.
 * Returns true the first time a user_id is detected (triggers session start + tray refresh).
 */
export async function refreshAssignment(): Promise<boolean> {
  try {
    const { data, error } = await getSupabase()
      .from('devices')
      .select('user_id, assigned_email')
      .eq('mac_address', MAC_ADDRESS)
      .maybeSingle();

    console.log('[device] refreshAssignment result:', JSON.stringify({ data, error }));

    if (error) {
      console.warn('[device] refreshAssignment error:', error.message, error.details, error.hint);
      return false;
    }

    const newUserId = data?.user_id ?? null;
    const wasUnassigned = assignedUserId === null;

    assignedUserId = newUserId;
    assignedEmail  = data?.assigned_email ?? null;

    if (wasUnassigned && newUserId) {
      console.log(`[device] Employee assigned: ${assignedEmail ?? newUserId} — tracking activated`);
      onAssignedCallback?.(); // update tray
      return true;
    }
  } catch (e) { console.warn('[device] refreshAssignment threw:', e); }
  return false;
}

/** Returns the user_id assigned to this device by admin. Null if not yet assigned. */
export function getAssignedUserId(): string | null {
  return assignedUserId;
}

export function getDeviceName(): string {
  return DEVICE_NAME;
}

export function getMac(): string {
  return MAC_ADDRESS;
}
