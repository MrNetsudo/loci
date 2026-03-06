# Hereya — You have to be here.
> *Venue-based real-time social chat. You have to be there.*

**⚠️ Hereya is a working placeholder name. **


---

## What Is Hereya?

Hereya is a venue-anchored, presence-required social chat platform. Users physically at a venue are automatically placed into that venue's live chat room. Rooms exist only while people are on-site.

**Core principle:** You can't fake presence. The room opens when you arrive.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | Node.js (Express) |
| Database | PostgreSQL via Supabase |
| Real-time | Supabase Realtime + WebSockets |
| Auth | Supabase Auth (anonymous + named) |
| Venue Data | Foursquare Places API |
| Geofencing | Google Maps Geofencing API |
| Moderation | OpenAI Moderation API |
| Hosting | Railway / Render (dev) → AWS / GCP (prod) |
| Mobile | React Native (separate repo, Phase 2) |

---

## Repository Structure

```
hereya/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── routes/          # Express route handlers
│   │   │   └── middleware/      # Auth, moderation, rate limiting
│   │   ├── services/            # Core business logic
│   │   ├── db/
│   │   │   ├── migrations/      # SQL migration files
│   │   │   └── models/          # DB model helpers
│   │   ├── config/              # Environment + constants
│   │   └── utils/               # Shared utilities
│   ├── tests/                   # Unit + integration tests
│   ├── package.json
│   ├── .env.example
│   └── server.js
├── supabase/
│   └── migrations/              # Supabase-specific migrations
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── DATABASE.md
│   ├── SECURITY.md
│   └── DEPLOYMENT.md
└── README.md
```

---

## Quick Start (Local Dev)

```bash
# 1. Clone
git clone https://github.com/MrNetsudo/hereya.git
cd hereya//backend

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Fill in all values in .env

# 4. Run DB migrations
npm run migrate

# 5. Start dev server
npm run dev
```

---

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Database Schema](docs/DATABASE.md)
- [Security Model](docs/SECURITY.md)
- [Deployment Guide](docs/DEPLOYMENT.md)

---

## Development Standards

- All routes must have input validation (Joi/Zod)
- All endpoints must be authenticated unless explicitly public
- All user-generated content passes moderation before persistence
- No secrets in code — environment variables only
- Every service function must have a corresponding test
- PRs require passing tests before merge

---

## IP Notice

**CONFIDENTIAL — PROPRIETARY**
This codebase and all associated intellectual property is owned by [COMPANY NAME].
Patent pending. Unauthorized use, copying, or distribution is prohibited.
© 2026 [COMPANY NAME]. All rights reserved.
