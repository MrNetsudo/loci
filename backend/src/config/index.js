'use strict';

module.exports = {
  app: {
    name: process.env.LOCI_APP_NAME || 'LOCI',
    env: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT) || 3000,
    version: process.env.LOCI_API_VERSION || 'v1',
  },
  supabase: {
    url: process.env.LOCI_SUPABASE_URL,
    anonKey: process.env.LOCI_SUPABASE_ANON_KEY,
    serviceKey: process.env.LOCI_SUPABASE_SERVICE_KEY,
  },
  database: {
    url: process.env.LOCI_DATABASE_URL,
  },
  google: {
    mapsApiKey: process.env.LOCI_GOOGLE_MAPS_API_KEY,
  },
  foursquare: {
    apiKey: process.env.LOCI_FOURSQUARE_API_KEY,
    clientId: process.env.LOCI_FOURSQUARE_CLIENT_ID,
    clientSecret: process.env.LOCI_FOURSQUARE_CLIENT_SECRET,
  },
  openai: {
    apiKey: process.env.LOCI_OPENAI_API_KEY,
    moderationThreshold: Number(process.env.LOCI_MODERATION_THRESHOLD) || 0.85,
  },
  rooms: {
    coolingMinutes: Number(process.env.LOCI_ROOM_COOLING_MINUTES) || 15,
    messageRetentionDays: Number(process.env.LOCI_MESSAGE_RETENTION_DAYS) || 30,
    presenceTtlHours: Number(process.env.LOCI_PRESENCE_TTL_HOURS) || 1,
  },
  geofence: {
    defaultRadiusM: Number(process.env.LOCI_DEFAULT_GEOFENCE_RADIUS_M) || 100,
    stadiumRadiusM: Number(process.env.LOCI_STADIUM_GEOFENCE_RADIUS_M) || 300,
  },
  rateLimits: {
    windowMs: Number(process.env.LOCI_RATE_LIMIT_WINDOW_MS) || 60_000,
    global: Number(process.env.LOCI_RATE_LIMIT_MAX) || 120,
    auth: Number(process.env.LOCI_AUTH_RATE_LIMIT_MAX) || 10,
    presence: Number(process.env.LOCI_PRESENCE_RATE_LIMIT_MAX) || 1,
    messages: Number(process.env.LOCI_MESSAGE_RATE_LIMIT_MAX) || 30,
  },
  logging: {
    level: process.env.LOCI_LOG_LEVEL || 'info',
  },
};
