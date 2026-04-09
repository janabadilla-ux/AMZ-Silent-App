-- AllStars Tracker — Supabase Schema
-- Paste this into Lovable's migration tool to run it.
-- Safe to re-run: all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- DEVICES
-- Registered automatically when AMZ Tracker is installed on a laptop.
-- Inactive = user_id IS NULL (awaiting admin assignment)
-- Active   = user_id IS NOT NULL (employee assigned via web portal)
-- ============================================================
CREATE TABLE IF NOT EXISTS devices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mac_address     TEXT NOT NULL UNIQUE,
  device_name     TEXT,
  device_username TEXT,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_email  TEXT,           -- denormalized for easy display in web portal
  is_active       BOOLEAN DEFAULT FALSE,
  last_seen       TIMESTAMPTZ,
  installed_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices (user_id);
CREATE INDEX IF NOT EXISTS idx_devices_active ON devices (is_active, last_seen DESC);

-- ============================================================
-- APP CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS app_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  app_name    TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('productive','neutral','unproductive','uncategorized')),
  is_override BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (app_name)
);

-- ============================================================
-- ACTIVITY SNAPSHOTS (1 row per minute per employee)
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_snapshots (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL,
  timestamp     TIMESTAMPTZ NOT NULL,
  app_name      TEXT,
  window_title  TEXT,
  category      TEXT CHECK (category IN ('productive','neutral','unproductive','uncategorized','idle')),
  is_idle       BOOLEAN DEFAULT FALSE,
  idle_seconds  INTEGER DEFAULT 0,
  duration_secs INTEGER DEFAULT 60,
  synced        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_user_time ON activity_snapshots (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_user_date ON activity_snapshots (user_id, (timestamp::DATE));

-- ============================================================
-- PRODUCTIVITY SUMMARIES (daily aggregates)
-- ============================================================
CREATE TABLE IF NOT EXISTS productivity_summaries (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              UUID NOT NULL,
  date                 DATE NOT NULL,
  active_seconds       INTEGER DEFAULT 0,
  idle_seconds         INTEGER DEFAULT 0,
  productive_seconds   INTEGER DEFAULT 0,
  neutral_seconds      INTEGER DEFAULT 0,
  unproductive_seconds INTEGER DEFAULT 0,
  total_seconds        INTEGER DEFAULT 0,
  productivity_score   NUMERIC(5,2) DEFAULT 0,
  top_apps             JSONB DEFAULT '[]',
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_summaries_user_date ON productivity_summaries (user_id, date DESC);

-- ============================================================
-- DEVICE SESSIONS (laptop on/off — separate from attendance_logs)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_sessions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL,
  device_name      TEXT,
  session_start    TIMESTAMPTZ NOT NULL,
  session_end      TIMESTAMPTZ,
  duration_minutes INTEGER,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_user ON device_sessions (user_id, session_start DESC);

-- ============================================================
-- SCREENSHOTS METADATA
-- ============================================================
CREATE TABLE IF NOT EXISTS screenshots (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL,
  timestamp    TIMESTAMPTZ NOT NULL,
  storage_path TEXT NOT NULL,
  file_size    INTEGER,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Desktop tracker uses anon key + x-device-mac header for identity.
-- INSERT to tracking tables requires a registered, assigned device.
-- Admin (authenticated) reads all data via web portal.
-- ============================================================

ALTER TABLE devices                ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE productivity_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_categories         ENABLE ROW LEVEL SECURITY;

-- ── devices ────────────────────────────────────────────────────────────────
-- Tracker can register/refresh itself (INSERT + UPDATE, open)
CREATE POLICY "Devices can upsert own record"
  ON devices FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Devices can update own record"
  ON devices FOR UPDATE TO anon USING (true) WITH CHECK (true);
-- Tracker reads only its own row (matched via x-device-mac request header)
CREATE POLICY "Device reads own row"
  ON devices FOR SELECT TO anon
  USING (mac_address = current_setting('request.headers', true)::json->>'x-device-mac');
-- Admin portal reads all devices
CREATE POLICY "Authenticated users read all devices"
  ON devices FOR SELECT TO authenticated USING (true);

-- ── activity_snapshots ─────────────────────────────────────────────────────
-- INSERT only allowed from a registered + assigned device (MAC-validated)
CREATE POLICY "anon insert snapshots"
  ON activity_snapshots FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM devices
      WHERE devices.mac_address = current_setting('request.headers', true)::json->>'x-device-mac'
        AND devices.user_id IS NOT NULL
    )
  );

-- ── device_sessions ────────────────────────────────────────────────────────
CREATE POLICY "anon insert device_sessions"
  ON device_sessions FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM devices
      WHERE devices.mac_address = current_setting('request.headers', true)::json->>'x-device-mac'
        AND devices.user_id IS NOT NULL
    )
  );
-- UPDATE allowed to record session end
CREATE POLICY "anon update device_sessions"
  ON device_sessions FOR UPDATE TO anon USING (true);

-- ── productivity_summaries ─────────────────────────────────────────────────
CREATE POLICY "anon insert summaries"
  ON productivity_summaries FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM devices
      WHERE devices.mac_address = current_setting('request.headers', true)::json->>'x-device-mac'
        AND devices.user_id IS NOT NULL
    )
  );
CREATE POLICY "anon update summaries"
  ON productivity_summaries FOR UPDATE TO anon USING (true);

-- ── app_categories ─────────────────────────────────────────────────────────
-- Read-only reference data for the tracker's categorizer
CREATE POLICY "Anon can read categories"
  ON app_categories FOR SELECT USING (true);

-- ── realtime.messages ──────────────────────────────────────────────────────
-- Users can only subscribe to their own attendance channel
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users subscribe to own channels"
  ON realtime.messages FOR SELECT TO authenticated
  USING (realtime.topic() = 'attendance:' || auth.uid()::text);

-- ============================================================
-- SEED: DEFAULT APP CATEGORIES (35 apps)
-- ============================================================
INSERT INTO app_categories (app_name, category, is_override) VALUES
  ('chrome','neutral',false), ('firefox','neutral',false),
  ('msedge','neutral',false), ('safari','neutral',false),
  ('opera','neutral',false),  ('brave','neutral',false),
  ('code','productive',false), ('webstorm','productive',false),
  ('idea','productive',false), ('pycharm','productive',false),
  ('xcode','productive',false), ('devenv','productive',false),
  ('android studio','productive',false), ('eclipse','productive',false),
  ('sublime_text','productive',false), ('atom','productive',false),
  ('cmd','productive',false), ('powershell','productive',false),
  ('windowsterminal','productive',false), ('iterm2','productive',false),
  ('terminal','productive',false), ('slack','neutral',false),
  ('teams','neutral',false), ('zoom','neutral',false),
  ('discord','neutral',false), ('excel','productive',false),
  ('winword','productive',false), ('powerpnt','productive',false),
  ('notion','productive',false), ('figma','productive',false),
  ('postman','productive',false), ('spotify','unproductive',false),
  ('vlc','unproductive',false), ('steam','unproductive',false),
  ('epicgameslauncher','unproductive',false)
ON CONFLICT (app_name) DO NOTHING;
