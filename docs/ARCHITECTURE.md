# LOCI — Architecture Overview

## System Design

LOCI is built around three core problems:
1. **Presence verification** — is the user actually at this venue?
2. **Room lifecycle** — when does a room open, stay alive, and close?
3. **Real-time messaging** — chat that works at venue scale

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MOBILE CLIENT                           │
│              (React Native — iOS / Android)                     │
└────────────┬───────────────────────────────┬────────────────────┘
             │ REST API                       │ WebSocket
             ▼                               ▼
┌─────────────────────┐         ┌────────────────────────┐
│    LOCI API SERVER  │         │  SUPABASE REALTIME     │
│    (Node/Express)   │         │  (WebSocket Channels)  │
└──────┬──────────────┘         └────────────┬───────────┘
       │                                     │
       ▼                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SUPABASE                                 │
│         PostgreSQL · Auth · Realtime · Storage                  │
└──────┬──────────────────────┬────────────────────────────────────┘
       │                      │
       ▼                      ▼
┌──────────────┐    ┌──────────────────────┐
│  FOURSQUARE  │    │  GOOGLE MAPS API     │
│  Places API  │    │  Geofencing          │
└──────────────┘    └──────────────────────┘
       │
       ▼
┌──────────────┐
│  OPENAI      │
│  Moderation  │
└──────────────┘
```

---

## Core Services

### 1. Presence Service (`services/presence.js`)
The most critical service. Determines if a user is physically at a venue.

**Multi-signal verification approach:**
- Primary: GPS coordinates vs venue geofence polygon (Google Maps)
- Secondary: WiFi network fingerprint match (venue SSID)
- Optional: Venue QR code scan (manual check-in fallback)

**Signal priority:**
```
QR Scan > WiFi Match > GPS Geofence
```

**Geofence precision:**
- Indoor venues (bars, restaurants): 50m radius
- Large venues (stadiums, arenas): 200m radius
- Outdoor events: Custom polygon

**Presence state machine:**
```
UNKNOWN → ENTERING (GPS edge) → PRESENT → LEAVING → ABSENT
                                    ↓
                               ROOM ACCESS GRANTED
```

---

### 2. Room Lifecycle Service (`services/rooms.js`)
Manages the creation, activity, and expiration of venue chat rooms.

**Room states:**
```
INACTIVE → WARMING (1+ user present) → ACTIVE → COOLING → ARCHIVED
```

**Rules:**
- Room becomes ACTIVE when ≥1 verified-present user joins
- Room stays ACTIVE as long as ≥1 user remains present
- Room enters COOLING state when last user leaves (15-min grace period)
- Room is ARCHIVED after cooling (messages preserved, room closed)
- A new ACTIVE room is created fresh on next user arrival

**Message retention:**
- Active room messages: real-time only (no persistence by default)
- ARCHIVED rooms: messages stored for 30 days (configurable)
- User's own sent messages: retrievable for 7 days

---

### 3. Venue Service (`services/venues.js`)
Integrates with Foursquare to manage the venue database.

**Data flow:**
1. User's GPS coordinates sent to Venue Service
2. Venue Service queries Foursquare for nearby places
3. Returns venue candidates with geofence polygon
4. Results cached in PostgreSQL (TTL: 24 hours)
5. Presence Service validates against selected venue

**Venue data stored locally:**
- Foursquare venue ID
- Name, address, category
- Geofence polygon (lat/lng bounds)
- Room status + current occupancy
- Venue partner status (paid/free)

---

### 4. Moderation Service (`services/moderation.js`)
Every message passes moderation before being broadcast.

**Pipeline:**
```
Message submitted
    ↓
Rate limit check (max 30 msg/min per user)
    ↓
OpenAI Moderation API (hate, harassment, sexual, violence, self-harm)
    ↓
Custom LOCI rules (venue-specific filters, keyword blocks)
    ↓
Pass → broadcast to room
Fail → reject with error code, log for review
    ↓
Repeat violations → auto-mute (15min) → ban escalation
```

**Moderation levels:**
- `PASS` — message broadcast normally
- `REVIEW` — message held, flagged for human review
- `BLOCK` — message rejected, user warned
- `MUTE` — user muted for duration
- `BAN` — user removed from room, account flagged

---

### 5. Auth Service (`services/auth.js`)
Dual-identity system — anonymous or named.

**Anonymous mode:**
- UUID generated on device install
- No PII collected or stored
- Session-scoped display name (auto-generated or user-set)
- Cannot be traced across sessions by design

**Named mode:**
- Email/phone verification via Supabase Auth
- Display name + optional avatar
- Persistent identity across venue visits
- Can follow venues for return room access

---

## Database Design (Overview)

See [DATABASE.md](DATABASE.md) for full schema.

**Core tables:**
```
users           — user identities (anon and named)
venues          — venue registry (from Foursquare)
rooms           — venue room instances (one per venue, per session)
room_members    — who is currently in which room (presence tracking)
messages        — message log
user_presence   — real-time GPS/geofence records
moderation_log  — all moderation actions
venue_partners  — paid venue partner accounts
```

---

## Real-Time Strategy

LOCI uses **Supabase Realtime** for WebSocket connections.

- One channel per room: `room:{room_id}`
- Presence tracking via Supabase Presence (who's online in channel)
- Message broadcast via Supabase Broadcast
- DB changes via Supabase postgres_changes

**Connection lifecycle:**
1. User arrives at venue → presence verified
2. Client subscribes to `room:{room_id}` channel
3. Messages broadcast to all channel subscribers
4. User departure → unsubscribe + presence removed
5. Last departure → room enters cooling state

---

## Security Model

See [SECURITY.md](SECURITY.md) for full details.

Key principles:
- All API endpoints authenticated (JWT via Supabase)
- Rate limiting on all routes (express-rate-limit)
- GPS coordinates never stored permanently
- Anonymous users cannot be de-anonymized
- All content moderated before broadcast
- Row-level security (RLS) enforced at database level
- No admin backdoor to user messages

---

## Scalability Path

| Stage | Users | Infrastructure |
|-------|-------|---------------|
| MVP | 0–10K MAU | Single Railway/Render instance, Supabase free/pro |
| Growth | 10K–100K MAU | Auto-scaling containers, Supabase Pro |
| Scale | 100K–1M MAU | AWS ECS/EKS, RDS PostgreSQL, ElastiCache Redis |
| Enterprise | 1M+ MAU | Multi-region, CDN, dedicated DB clusters |
