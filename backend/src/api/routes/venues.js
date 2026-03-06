'use strict';

const express = require('express');
const Joi = require('joi');
const OpenAI = require('openai');
const { optionalAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../../utils/supabase');
const venueService = require('../../services/venues');
const config = require('../../config');

const router = express.Router();

// Lazy OpenAI client (reuse key already used by moderation service)
let _openai = null;
const getOpenAI = () => {
  if (!_openai && config.openai?.apiKey) _openai = new OpenAI({ apiKey: config.openai.apiKey });
  return _openai;
};

// In-memory vibe cache: key = venueId-hourOfDay
const vibeCache = new Map();

const nearbySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  radius: Joi.number().positive().max(5000).default(500),
});

// GET /venues/nearby — fetch from Foursquare (cached in DB)
router.get('/nearby', optionalAuth, async (req, res, next) => {
  try {
    const { error, value } = nearbySchema.validate(req.query);
    if (error) return res.status(400).json({ error: 'VALIDATION_ERROR', message: error.message });

    const venues = await venueService.getNearbyVenues({
      latitude: value.lat,
      longitude: value.lng,
      radiusM: value.radius,
    });

    return res.json({ venues });
  } catch (err) {
    return next(err);
  }
});

// In-memory vibe tag store: roomId → { tagKey → count }
// Tags are ephemeral — scoped to each room session
const vibeTagStore = new Map();
const VALID_TAGS = new Set(['loud', 'chill', 'packed', 'music', 'sports', 'good-energy']);

// ── GET /venues/search ────────────────────────────────────────────────────────
const searchSchema = Joi.object({
  q:     Joi.string().min(2).max(100).required(),
  lat:   Joi.number().min(-90).max(90),
  lng:   Joi.number().min(-180).max(180),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

router.get('/search', optionalAuth, async (req, res, next) => {
  try {
    const { error, value } = searchSchema.validate(req.query);
    if (error) return res.status(400).json({ error: 'VALIDATION_ERROR', message: error.message });

    // 1. DB search by name
    let { data: dbVenues } = await supabaseAdmin
      .from('venues')
      .select('id, name, address, city, state, category, latitude, longitude, geofence_radius_m, is_partner, welcome_message')
      .ilike('name', `%${value.q}%`)
      .eq('is_active', true)
      .limit(value.limit);
    dbVenues = dbVenues || [];

    // 2. Enrich with live room occupancy
    const enriched = await Promise.all(
      dbVenues.map(async (v) => {
        const { data: rooms } = await supabaseAdmin
          .from('rooms')
          .select('status, total_members')
          .eq('venue_id', v.id)
          .in('status', ['warming', 'active'])
          .limit(1);
        const room = rooms?.[0];
        return { ...v, room_status: room?.status || 'inactive', occupancy: room?.total_members || 0 };
      })
    );

    // 3. If sparse results and location given, fall back to OSM
    if (enriched.length < 3 && value.lat && value.lng) {
      const osmVenues = await venueService.getNearbyVenues({
        latitude: value.lat,
        longitude: value.lng,
        radiusM: 1000,
      });
      osmVenues
        .filter((v) => v.name.toLowerCase().includes(value.q.toLowerCase()))
        .forEach((v) => {
          if (!enriched.find((e) => e.id === v.id)) {
            enriched.push({ ...v, room_status: 'inactive', occupancy: 0 });
          }
        });
    }

    return res.json({ venues: enriched, query: value.q, total: enriched.length });
  } catch (err) {
    return next(err);
  }
});

// ── GET /venues/:id/profile ───────────────────────────────────────────────────
router.get('/:id/profile', optionalAuth, async (req, res, next) => {
  try {
    const venue = await venueService.getVenueById(req.params.id);
    if (!venue) return res.status(404).json({ error: 'NOT_FOUND', message: 'Venue not found' });

    // Active room
    const { data: activeRooms } = await supabaseAdmin
      .from('rooms')
      .select('id, status, total_members, total_messages, peak_occupancy, activated_at')
      .eq('venue_id', venue.id)
      .in('status', ['warming', 'active'])
      .limit(1);
    const activeRoom = activeRooms?.[0] || null;

    // Historical rooms for popular times + stats
    const { data: allRooms } = await supabaseAdmin
      .from('rooms')
      .select('activated_at, peak_occupancy, total_messages, total_members')
      .eq('venue_id', venue.id)
      .not('activated_at', 'is', null)
      .order('activated_at', { ascending: false })
      .limit(200);

    // Popular times — aggregate by hour of day (0–23)
    const hourBuckets = Array.from({ length: 24 }, () => ({ count: 0, totalOccupancy: 0 }));
    (allRooms || []).forEach((r) => {
      const hour = new Date(r.activated_at).getHours();
      hourBuckets[hour].count++;
      hourBuckets[hour].totalOccupancy += r.peak_occupancy || 0;
    });
    const popularTimes = hourBuckets.map((b, hour) => ({
      hour,
      activity: b.count,
      avgOccupancy: b.count > 0 ? Math.round(b.totalOccupancy / b.count) : 0,
    }));

    // Stats
    const totalConversations = (allRooms || []).length;
    const peakRoom = (allRooms || []).reduce(
      (max, r) => (!max || (r.peak_occupancy || 0) > (max.peak_occupancy || 0) ? r : max),
      null
    );
    const totalMessages = (allRooms || []).reduce((s, r) => s + (r.total_messages || 0), 0);

    // Current vibe tags from in-memory store
    const vibeTags = activeRoom ? (vibeTagStore.get(activeRoom.id) || {}) : {};

    return res.json({
      id: venue.id,
      name: venue.name,
      address: [venue.address, venue.city, venue.state].filter(Boolean).join(', '),
      category: venue.category || 'venue',
      is_partner: venue.is_partner,
      welcome_message: venue.welcome_message || null,
      room: activeRoom
        ? { id: activeRoom.id, status: activeRoom.status, occupancy: activeRoom.total_members || 0 }
        : null,
      popular_times: popularTimes,
      stats: {
        total_conversations: totalConversations,
        peak_occupancy: peakRoom?.peak_occupancy || 0,
        peak_at: peakRoom?.activated_at || null,
        total_messages_all_time: totalMessages,
      },
      vibe_tags: vibeTags,
    });
  } catch (err) {
    return next(err);
  }
});

// ── POST /venues/:id/vibe-tag ─────────────────────────────────────────────────
router.post('/:id/vibe-tag', optionalAuth, async (req, res, next) => {
  try {
    const { tag } = req.body || {};
    if (!tag || !VALID_TAGS.has(tag)) {
      return res.status(400).json({ error: 'INVALID_TAG', message: `Tag must be one of: ${[...VALID_TAGS].join(', ')}` });
    }

    const { data: rooms } = await supabaseAdmin
      .from('rooms')
      .select('id')
      .eq('venue_id', req.params.id)
      .in('status', ['warming', 'active'])
      .limit(1);

    if (!rooms?.[0]) {
      return res.status(409).json({ error: 'NO_ACTIVE_ROOM', message: 'No active room at this venue' });
    }

    const roomId = rooms[0].id;
    const tags = vibeTagStore.get(roomId) || {};
    tags[tag] = (tags[tag] || 0) + 1;
    vibeTagStore.set(roomId, tags);

    return res.json({ tags, tag, count: tags[tag] });
  } catch (err) {
    return next(err);
  }
});

// ── GET /venues/:id/vibe ──────────────────────────────────────────────────────
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const VIBE_FALLBACKS = [
  'The energy here is what you make it.',
  'Something is always happening in a place like this.',
  'Show up and find out.',
  'Whatever tonight is, this is the place for it.',
];

router.get('/:id/vibe', optionalAuth, async (req, res, next) => {
  try {
    const venue = await venueService.getVenueById(req.params.id);
    if (!venue) return res.status(404).json({ error: 'NOT_FOUND', message: 'Venue not found' });

    // Get live occupancy
    const { data: rooms } = await supabaseAdmin
      .from('rooms')
      .select('total_members')
      .eq('venue_id', venue.id)
      .in('status', ['warming', 'active'])
      .limit(1);
    const occupancy = rooms?.[0]?.total_members || 0;

    // Cache by venue + hour of day (changes vibe throughout the day)
    const now = new Date();
    const cacheKey = `${venue.id}-${now.getUTCHours()}`;
    const cached = vibeCache.get(cacheKey);
    if (cached) return res.json({ vibe: cached, cached: true });

    const openai = getOpenAI();
    if (!openai) {
      const fallback = VIBE_FALLBACKS[Math.floor(Math.random() * VIBE_FALLBACKS.length)];
      return res.json({ vibe: fallback, cached: false });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 80,
      temperature: 0.85,
      messages: [
        {
          role: 'system',
          content:
            'You write dry, witty 1–2 sentence vibe checks for venues. Keep it under 120 characters. No hashtags. No emojis. Describe the energy of the place — never reference or identify specific people. Anonymous and atmospheric.',
        },
        {
          role: 'user',
          content: `Venue: ${venue.name}. Type: ${venue.category}. Time: ${now.getUTCHours()}:00. Day: ${DAYS[now.getDay()]}. People here: ${occupancy}.`,
        },
      ],
    });

    const vibe = completion.choices[0]?.message?.content?.trim() || VIBE_FALLBACKS[0];
    vibeCache.set(cacheKey, vibe);
    // Auto-expire after 1 hour
    setTimeout(() => vibeCache.delete(cacheKey), 60 * 60 * 1000);

    return res.json({ vibe, cached: false });
  } catch (err) {
    return next(err);
  }
});

// ── GET /venues/:id ───────────────────────────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const { data: venue, error } = await supabaseAdmin
      .from('venues')
      .select(`
        id, name, address, city, state, category,
        latitude, longitude, geofence_radius_m,
        is_active, is_partner, welcome_message,
        rooms ( id, status, total_members )
      `)
      .eq('id', req.params.id)
      .eq('is_active', true)
      .single();

    if (error || !venue) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Venue not found' });
    }

    const activeRoom = venue.rooms?.find((r) => ['warming', 'active'].includes(r.status));

    return res.json({
      id: venue.id,
      name: venue.name,
      address: `${venue.address}, ${venue.city}, ${venue.state}`,
      category: venue.category,
      is_partner: venue.is_partner,
      welcome_message: venue.welcome_message,
      room_status: activeRoom?.status || 'inactive',
      occupancy: activeRoom?.total_members || 0,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
