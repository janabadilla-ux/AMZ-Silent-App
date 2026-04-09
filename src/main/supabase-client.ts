/**
 * Supabase client — uses the anon key (safe to embed in desktop apps).
 * No passwords, no sessions, no service role key on laptops.
 *
 * All writes use open INSERT RLS policies. The user_id written to each row
 * comes from the `devices` table — assigned by admin via the web portal.
 */
import os from 'os';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL: string =
  process.env.SUPABASE_URL || 'https://varhlvyhvfufuxjqnfwq.supabase.co';
const SUPABASE_ANON_KEY: string =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhcmhsdnlodmZ1ZnV4anFuZndxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0OTg0ODgsImV4cCI6MjA5MTA3NDQ4OH0.lPtEsiKhSU0_ZUITtO-ZMaG71Zi1i3BIqBITy590JEY';

// Computed independently here to avoid a circular import with device-registry
function getDeviceMac(): string {
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface ?? []) {
      if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
        return addr.mac.toUpperCase();
      }
    }
  }
  return `NOHW-${os.hostname().toUpperCase()}`;
}

const DEVICE_MAC = getDeviceMac();

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-device-mac': DEVICE_MAC } },
    });
  }
  return client;
}
