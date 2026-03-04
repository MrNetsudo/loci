-- LOCI — Initial Schema
-- Migration: 20260304_000001_initial_schema.sql
-- Run via: npm run migrate

-- Enable PostGIS for geospatial queries
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  auth_id         UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  is_anonymous    BOOLEAN NOT NULL DEFAULT true,
  display_name    TEXT,
  avatar_url      TEXT,
  is_banned       BOOLEAN NOT NULL DEFAULT false,
  ban_reason      TEXT,
  banned_at       TIMESTAMPTZ,
  muted_until     TIMESTAMPTZ,
  is_premium      BOOLEAN NOT NULL DEFAULT false,
  premium_until   TIMESTAMPTZ,
  device_id       TEXT,
  last_seen_at    TIMESTAMPTZ
);

-- ── Venues ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS venues (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  foursquare_id     TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  address           TEXT,
  city              TEXT,
  state             TEXT,
  country           TEXT DEFAULT 'US',
  category          TEXT,
  latitude          DECIMAL(10, 8) NOT NULL,
  longitude         DECIMAL(11, 8) NOT NULL,
  geofence_radius_m INTEGER NOT NULL DEFAULT 100,
  geofence_polygon  JSONB,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  is_partner        BOOLEAN NOT NULL DEFAULT false,
  partner_tier      TEXT,
  custom_room_name  TEXT,
  welcome_message   TEXT,
  max_occupancy     INTEGER DEFAULT 1000,
  foursquare_synced_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_venues_geo
  ON venues USING GIST (ST_MakePoint(longitude::float, latitude::float)::geography);

-- ── Rooms ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  venue_id      UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'inactive'
                  CHECK (status IN ('inactive','warming','active','cooling','archived')),
  activated_at  TIMESTAMPTZ,
  cooled_at     TIMESTAMPTZ,
  archived_at   TIMESTAMPTZ,
  peak_occupancy    INTEGER DEFAULT 0,
  total_messages    INTEGER DEFAULT 0,
  total_members     INTEGER DEFAULT 0,
  is_moderated      BOOLEAN NOT NULL DEFAULT true,
  allow_anonymous   BOOLEAN NOT NULL DEFAULT true,
  allow_media       BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_one_active_per_venue
  ON rooms(venue_id) WHERE status IN ('warming', 'active', 'cooling');

-- ── Room Members ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  left_at       TIMESTAMPTZ,
  room_id       UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_present    BOOLEAN NOT NULL DEFAULT true,
  session_display_name TEXT,
  is_muted      BOOLEAN NOT NULL DEFAULT false,
  muted_until   TIMESTAMPTZ,
  is_kicked     BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_members_active
  ON room_members(room_id) WHERE is_present = true;

-- ── Messages ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  content         TEXT NOT NULL,
  content_type    TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text','image','reaction')),
  media_url       TEXT,
  is_visible      BOOLEAN NOT NULL DEFAULT true,
  moderation_status TEXT DEFAULT 'passed',
  moderation_score  DECIMAL(5,4),
  reaction_counts JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room_id, created_at DESC);

-- ── User Presence ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_presence (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at   TIMESTAMPTZ DEFAULT NOW(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venue_id      UUID REFERENCES venues(id) ON DELETE SET NULL,
  accuracy_m    INTEGER,
  verification_method TEXT CHECK (verification_method IN ('gps','wifi','qr')),
  confidence    DECIMAL(3,2),
  status        TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present','departed')),
  departed_at   TIMESTAMPTZ
);

-- ── Moderation Log ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS moderation_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL,
  message_id      UUID REFERENCES messages(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  reason          TEXT,
  triggered_by    TEXT,
  ai_scores       JSONB,
  duration_mins   INTEGER
);

-- ── Venue Partners ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS venue_partners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  venue_id        UUID UNIQUE NOT NULL REFERENCES venues(id),
  contact_name    TEXT NOT NULL,
  contact_email   TEXT NOT NULL,
  billing_email   TEXT,
  tier            TEXT NOT NULL DEFAULT 'basic',
  monthly_rate    INTEGER,
  billing_cycle_start TIMESTAMPTZ,
  next_billing_at TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  brand_color     TEXT,
  logo_url        TEXT,
  custom_rules    JSONB
);

-- ── Geospatial RPC: get nearby venues ─────────────────────
CREATE OR REPLACE FUNCTION get_nearby_venues(p_lat float, p_lng float, p_radius_m float)
RETURNS SETOF venues AS $$
  SELECT * FROM venues
  WHERE is_active = true
    AND ST_DWithin(
      ST_MakePoint(longitude::float, latitude::float)::geography,
      ST_MakePoint(p_lng, p_lat)::geography,
      p_radius_m
    )
  ORDER BY ST_Distance(
    ST_MakePoint(longitude::float, latitude::float)::geography,
    ST_MakePoint(p_lng, p_lat)::geography
  ) ASC
  LIMIT 20;
$$ LANGUAGE sql STABLE;

-- ── RLS Policies ───────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_own ON users FOR ALL USING (auth.uid() = auth_id);
CREATE POLICY venues_public ON venues FOR SELECT USING (is_active = true);
CREATE POLICY presence_own ON user_presence FOR ALL
  USING (user_id = (SELECT id FROM users WHERE auth_id = auth.uid()));
