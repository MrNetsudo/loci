# LOCI — Database Schema

## Overview

PostgreSQL via Supabase. Row-level security (RLS) enforced on all tables.
All timestamps are UTC. All IDs are UUIDs.

---

## Schema

### `users`
```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Identity
  auth_id         UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  is_anonymous    BOOLEAN NOT NULL DEFAULT true,
  display_name    TEXT,                          -- user-set or auto-generated
  avatar_url      TEXT,

  -- Status
  is_banned       BOOLEAN NOT NULL DEFAULT false,
  ban_reason      TEXT,
  banned_at       TIMESTAMPTZ,
  muted_until     TIMESTAMPTZ,

  -- Premium
  is_premium      BOOLEAN NOT NULL DEFAULT false,
  premium_until   TIMESTAMPTZ,

  -- Metadata
  device_id       TEXT,                          -- hashed, for anonymous tracking
  last_seen_at    TIMESTAMPTZ
);
```

---

### `venues`
```sql
CREATE TABLE venues (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  -- Identity
  foursquare_id     TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  address           TEXT,
  city              TEXT,
  state             TEXT,
  country           TEXT DEFAULT 'US',
  category          TEXT,                        -- bar, stadium, restaurant, etc.

  -- Geofence
  latitude          DECIMAL(10, 8) NOT NULL,
  longitude         DECIMAL(11, 8) NOT NULL,
  geofence_radius_m INTEGER NOT NULL DEFAULT 100, -- meters
  geofence_polygon  JSONB,                        -- [{lat, lng}, ...] for irregular shapes

  -- Status
  is_active         BOOLEAN NOT NULL DEFAULT true,
  is_partner        BOOLEAN NOT NULL DEFAULT false,
  partner_tier      TEXT,                         -- 'basic', 'pro', 'enterprise'

  -- Room settings (partner-customizable)
  custom_room_name  TEXT,
  welcome_message   TEXT,
  max_occupancy     INTEGER DEFAULT 1000,

  -- Cache control
  foursquare_synced_at TIMESTAMPTZ
);

CREATE INDEX idx_venues_location ON venues USING GIST (
  ST_MakePoint(longitude, latitude)::geography
);
```

---

### `rooms`
```sql
CREATE TABLE rooms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  -- Relationship
  venue_id      UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,

  -- State machine: inactive | warming | active | cooling | archived
  status        TEXT NOT NULL DEFAULT 'inactive',
  activated_at  TIMESTAMPTZ,
  cooled_at     TIMESTAMPTZ,
  archived_at   TIMESTAMPTZ,

  -- Stats
  peak_occupancy    INTEGER DEFAULT 0,
  total_messages    INTEGER DEFAULT 0,
  total_members     INTEGER DEFAULT 0,

  -- Config
  is_moderated      BOOLEAN NOT NULL DEFAULT true,
  allow_anonymous   BOOLEAN NOT NULL DEFAULT true,
  allow_media       BOOLEAN NOT NULL DEFAULT false  -- Phase 2
);

-- Only one active room per venue at a time
CREATE UNIQUE INDEX idx_rooms_venue_active
  ON rooms(venue_id)
  WHERE status IN ('warming', 'active', 'cooling');
```

---

### `room_members`
```sql
CREATE TABLE room_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  left_at       TIMESTAMPTZ,

  -- Relationships
  room_id       UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Session
  is_present    BOOLEAN NOT NULL DEFAULT true,   -- false = left room
  session_display_name TEXT,                     -- name used in this session (anon)

  -- Moderation
  is_muted      BOOLEAN NOT NULL DEFAULT false,
  muted_until   TIMESTAMPTZ,
  is_kicked     BOOLEAN NOT NULL DEFAULT false,

  UNIQUE(room_id, user_id)
);

CREATE INDEX idx_room_members_room ON room_members(room_id) WHERE is_present = true;
CREATE INDEX idx_room_members_user ON room_members(user_id);
```

---

### `messages`
```sql
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Relationships
  room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,

  -- Content
  content         TEXT NOT NULL,
  content_type    TEXT NOT NULL DEFAULT 'text',  -- 'text' | 'image' | 'reaction'
  media_url       TEXT,                           -- Phase 2

  -- Moderation
  is_visible      BOOLEAN NOT NULL DEFAULT true,
  moderation_status TEXT DEFAULT 'passed',        -- 'passed' | 'flagged' | 'removed'
  moderation_score  DECIMAL(5,4),                 -- 0.0000 to 1.0000

  -- Reactions (Phase 2)
  reaction_counts JSONB DEFAULT '{}'              -- {"👍": 3, "🔥": 1}
);

-- Expire messages after 30 days
CREATE INDEX idx_messages_room_time ON messages(room_id, created_at DESC);
CREATE INDEX idx_messages_cleanup ON messages(created_at)
  WHERE created_at < NOW() - INTERVAL '30 days';
```

---

### `user_presence`
```sql
CREATE TABLE user_presence (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at   TIMESTAMPTZ DEFAULT NOW(),

  -- Relationships
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venue_id      UUID REFERENCES venues(id) ON DELETE SET NULL,

  -- Location (never stored permanently — 1hr TTL)
  accuracy_m    INTEGER,                          -- GPS accuracy in meters
  verification_method TEXT,                       -- 'gps' | 'wifi' | 'qr'
  confidence    DECIMAL(3,2),                     -- 0.00 to 1.00

  -- State
  status        TEXT NOT NULL DEFAULT 'present', -- 'present' | 'departed'
  departed_at   TIMESTAMPTZ
);

-- Auto-purge location data after 1 hour (privacy)
CREATE INDEX idx_presence_cleanup ON user_presence(recorded_at)
  WHERE recorded_at < NOW() - INTERVAL '1 hour';
```

---

### `moderation_log`
```sql
CREATE TABLE moderation_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Context
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL,
  message_id      UUID REFERENCES messages(id) ON DELETE SET NULL,

  -- Action
  action          TEXT NOT NULL,  -- 'warn' | 'mute' | 'kick' | 'ban' | 'message_removed'
  reason          TEXT,
  triggered_by    TEXT,           -- 'ai' | 'user_report' | 'admin'
  ai_scores       JSONB,          -- OpenAI moderation category scores
  duration_mins   INTEGER         -- for mutes
);
```

---

### `venue_partners`
```sql
CREATE TABLE venue_partners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Relationship
  venue_id        UUID UNIQUE NOT NULL REFERENCES venues(id),

  -- Account
  contact_name    TEXT NOT NULL,
  contact_email   TEXT NOT NULL,
  billing_email   TEXT,

  -- Subscription
  tier            TEXT NOT NULL DEFAULT 'basic',  -- 'basic' | 'pro' | 'enterprise'
  monthly_rate    INTEGER,                         -- cents
  billing_cycle_start TIMESTAMPTZ,
  next_billing_at TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT true,

  -- Customization
  brand_color     TEXT,
  logo_url        TEXT,
  custom_rules    JSONB                            -- venue-specific moderation rules
);
```

---

## Row-Level Security (RLS) Policies

```sql
-- Users can only read their own user record
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_own ON users
  FOR ALL USING (auth.uid() = auth_id);

-- Anyone can read venue info
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
CREATE POLICY venues_public_read ON venues
  FOR SELECT USING (is_active = true);

-- Room members can read rooms they're in
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY rooms_member_read ON rooms
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM room_members
      WHERE room_members.room_id = rooms.id
      AND room_members.user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
      AND room_members.is_present = true
    )
  );

-- Users can only read messages from rooms they're present in
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_room_member ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM room_members rm
      JOIN users u ON u.id = rm.user_id
      WHERE rm.room_id = messages.room_id
      AND rm.is_present = true
      AND u.auth_id = auth.uid()
    )
  );

-- Users can insert their own messages
CREATE POLICY messages_insert_own ON messages
  FOR INSERT WITH CHECK (
    user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
  );

-- Presence data: users see only their own
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;
CREATE POLICY presence_own ON user_presence
  FOR ALL USING (
    user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
  );
```

---

## Migration Naming Convention

```
YYYYMMDD_HHMMSS_description.sql
Example: 20260304_000001_initial_schema.sql
         20260304_000002_add_venue_partners.sql
         20260304_000003_add_message_reactions.sql
```

---

## Indexes Summary

| Table | Index | Purpose |
|-------|-------|---------|
| venues | GIST on lat/lng | Geospatial proximity queries |
| rooms | venue_id WHERE active | One active room per venue enforcement |
| room_members | room_id WHERE present | Fast occupancy count |
| messages | room_id + created_at | Message feed pagination |
| messages | created_at cleanup | 30-day TTL purge |
| user_presence | recorded_at cleanup | 1-hour TTL purge (privacy) |
