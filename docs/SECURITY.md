# Hereya — Security Model

## Principles

1. **Minimal data collection** — only collect what's needed to run the service
2. **No permanent location storage** — GPS data purged after 1 hour
3. **Anonymous-by-default** — users never required to identify themselves
4. **Zero-knowledge anonymity** — anonymous users cannot be de-anonymized even by admins
5. **Defense in depth** — multiple security layers, no single point of failure

---

## Authentication

- JWT tokens issued by Supabase Auth
- Token expiry: 1 hour (access) / 7 days (refresh)
- Anonymous sessions use device fingerprint (hashed, one-way)
- Named sessions require email verification
- Passwords stored as bcrypt hashes (min 12 rounds) by Supabase

---

## Authorization

- Row-level security (RLS) enforced at database level — not just application level
- Users can only access data for rooms they are currently present in
- No user can read another user's presence history
- Moderation logs only accessible to admin roles

---

## Location Privacy

- Raw GPS coordinates NEVER stored permanently
- Presence records auto-purge after 1 hour (database job)
- Only venue proximity (true/false) stored in room_members
- WiFi BSSID hashed before any storage
- No location history queryable by any user, including admins

---

## Content Security

- All messages pass OpenAI Moderation API before storage/broadcast
- Custom keyword filter layer (venue-specific rules)
- Rate limiting prevents spam (30 messages/minute per user)
- Users can report content — reports trigger human review queue
- Escalating moderation: warn → mute → kick → ban

---

## Infrastructure Security

- All traffic over HTTPS/WSS (TLS 1.3)
- API keys stored in environment variables only — never in code
- Secrets managed via Railway/Render secret management (dev) → AWS Secrets Manager (prod)
- Dependencies audited via `npm audit` on every CI run
- No admin backdoor to user messages or location data

---

## Rate Limiting

- express-rate-limit on all routes
- Stricter limits on auth and presence endpoints
- IP-level blocking for repeated violations
- Redis-backed rate limiting in production

---

## Incident Response

1. Security issues → report to security@hereya.app (private disclosure)
2. 24-hour acknowledgment SLA
3. Critical vulnerabilities patched within 72 hours
4. Users notified of data incidents per GDPR/CCPA requirements

---

## Compliance

- GDPR: Users can request data export and deletion
- CCPA: California users can opt out of any data sharing
- COPPA: Age gate — 13+ required
- All user data deletable within 30 days of request
