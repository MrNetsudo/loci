# Hereya — API Reference

**Base URL:** `https://api.hereya.app/v1`
**Auth:** Bearer token (Supabase JWT) in `Authorization` header
**Content-Type:** `application/json`

---

## Authentication

### POST `/auth/anonymous`
Create an anonymous session. No PII required.
```json
// Request
{ "device_id": "hashed-device-fingerprint" }

// Response 200
{
  "token": "eyJ...",
  "user": { "id": "uuid", "is_anonymous": true, "display_name": "RedFox421" }
}
```

### POST `/auth/register`
Create a named account.
```json
// Request
{ "email": "user@example.com", "password": "...", "display_name": "Miguel" }

// Response 201
{ "token": "eyJ...", "user": { "id": "uuid", "is_anonymous": false } }
```

### POST `/auth/login`
```json
// Request
{ "email": "user@example.com", "password": "..." }

// Response 200
{ "token": "eyJ...", "user": { ... } }
```

### POST `/auth/upgrade`
Upgrade anonymous session to named account.
```json
// Request (authenticated as anon user)
{ "email": "user@example.com", "password": "..." }

// Response 200
{ "user": { "id": "same-uuid", "is_anonymous": false } }
```

---

## Presence & Venues

### POST `/presence/check`
Verify user is physically present at a venue. **Called every 60 seconds while in room.**
```json
// Request
{
  "latitude": 42.3467,
  "longitude": -71.0972,
  "accuracy_meters": 15,
  "wifi_bssid": "aa:bb:cc:dd:ee:ff"  // optional
}

// Response 200
{
  "is_present": true,
  "venue": {
    "id": "uuid",
    "name": "Fenway Park",
    "category": "stadium"
  },
  "confidence": 0.97,
  "verification_method": "gps",
  "room_id": "uuid"
}

// Response 200 (not at venue)
{ "is_present": false, "venue": null, "room_id": null }
```

### POST `/presence/qr-checkin`
Manual QR code check-in at venue entry.
```json
// Request
{ "qr_token": "venue-signed-token-string" }

// Response 200
{ "is_present": true, "venue": { ... }, "room_id": "uuid", "valid_until": "ISO8601" }
```

### DELETE `/presence/leave`
Explicitly signal departure from venue.
```json
// Response 200
{ "success": true }
```

### GET `/venues/nearby`
Get venues near coordinates.
```
GET /venues/nearby?lat=42.3467&lng=-71.0972&radius=500
```
```json
// Response 200
{
  "venues": [
    {
      "id": "uuid",
      "name": "Fenway Park",
      "category": "stadium",
      "distance_m": 45,
      "is_active": true,
      "room_status": "active",
      "occupancy": 312
    }
  ]
}
```

### GET `/venues/:id`
Get venue details.
```json
// Response 200
{
  "id": "uuid",
  "name": "Fenway Park",
  "address": "4 Jersey St, Boston, MA",
  "category": "stadium",
  "is_partner": true,
  "room_status": "active",
  "occupancy": 312,
  "welcome_message": "Welcome to Fenway — Go Sox! ⚾"
}
```

---

## Rooms

### GET `/rooms/:room_id`
Get room info. User must be present at venue.
```json
// Response 200
{
  "id": "uuid",
  "venue_id": "uuid",
  "status": "active",
  "occupancy": 312,
  "activated_at": "ISO8601",
  "allow_anonymous": true
}
```

### POST `/rooms/:room_id/join`
Join a room (must have valid presence token).
```json
// Request
{ "session_display_name": "SoxFan99" }  // optional override

// Response 200
{
  "room": { "id": "uuid", "status": "active" },
  "member": { "id": "uuid", "display_name": "SoxFan99" },
  "realtime_channel": "room:uuid",
  "supabase_url": "wss://..."
}
```

### DELETE `/rooms/:room_id/leave`
Leave a room.
```json
// Response 200
{ "success": true }
```

### GET `/rooms/:room_id/members`
Get current room members (paginated).
```
GET /rooms/:room_id/members?limit=50&offset=0
```
```json
// Response 200
{
  "members": [
    { "id": "uuid", "display_name": "SoxFan99", "is_anonymous": true, "joined_at": "ISO8601" }
  ],
  "total": 312
}
```

---

## Messages

### GET `/rooms/:room_id/messages`
Get message history (most recent first).
```
GET /rooms/:room_id/messages?limit=50&before=message_uuid
```
```json
// Response 200
{
  "messages": [
    {
      "id": "uuid",
      "content": "That home run was insane!!",
      "user": { "id": "uuid", "display_name": "SoxFan99" },
      "created_at": "ISO8601"
    }
  ],
  "has_more": true
}
```

### POST `/rooms/:room_id/messages`
Send a message. Content is moderated before broadcast.
```json
// Request
{ "content": "Let's go Red Sox!", "content_type": "text" }

// Response 201
{
  "id": "uuid",
  "content": "Let's go Red Sox!",
  "created_at": "ISO8601",
  "moderation_status": "passed"
}

// Response 422 (moderated)
{ "error": "CONTENT_BLOCKED", "reason": "Message violates community guidelines" }

// Response 429 (rate limited)
{ "error": "RATE_LIMITED", "retry_after_seconds": 30 }
```

### DELETE `/rooms/:room_id/messages/:message_id`
Delete own message.
```json
// Response 200
{ "success": true }
```

### POST `/rooms/:room_id/messages/:message_id/report`
Report a message for moderation.
```json
// Request
{ "reason": "harassment" }  // harassment | spam | hate | other

// Response 200
{ "success": true, "report_id": "uuid" }
```

---

## Users

### GET `/users/me`
Get current user profile.
```json
// Response 200
{
  "id": "uuid",
  "display_name": "Miguel",
  "is_anonymous": false,
  "is_premium": false,
  "created_at": "ISO8601"
}
```

### PATCH `/users/me`
Update profile.
```json
// Request
{ "display_name": "MiguelJ" }

// Response 200
{ "id": "uuid", "display_name": "MiguelJ" }
```

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Action not allowed for this user |
| `NOT_FOUND` | 404 | Resource does not exist |
| `NOT_PRESENT` | 403 | User not verified at venue |
| `ROOM_INACTIVE` | 409 | Room is not currently active |
| `CONTENT_BLOCKED` | 422 | Message failed moderation |
| `RATE_LIMITED` | 429 | Too many requests |
| `USER_MUTED` | 403 | User is temporarily muted |
| `USER_BANNED` | 403 | User is banned from this room/app |
| `VENUE_NOT_FOUND` | 404 | No venue found at coordinates |
| `SERVER_ERROR` | 500 | Internal server error |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /auth/*` | 10/minute per IP |
| `POST /presence/check` | 1/minute per user |
| `POST /rooms/*/messages` | 30/minute per user |
| `GET /venues/nearby` | 60/minute per user |
| All others | 120/minute per user |
