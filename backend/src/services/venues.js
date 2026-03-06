'use strict';

const axios = require('axios');
const { supabaseAdmin } = require('../utils/supabase');
const config = require('../config');
const logger = require('../utils/logger');

// OpenStreetMap Overpass API — free, no key required
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CACHE_TTL_HOURS = 24;

// OSM amenity/leisure tags that map to real social venues
const OSM_VENUE_TAGS = [
  'bar', 'pub', 'nightclub', 'restaurant', 'cafe', 'fast_food',
  'food_court', 'cinema', 'theatre', 'arts_centre',
  'stadium', 'sports_centre', 'arena', 'concert_hall',
  'casino', 'marketplace', 'events_venue',
];

const OSM_LEISURE_TAGS = ['stadium', 'sports_centre', 'arena', 'pitch'];

/**
 * VenueService
 * Sources venue data from OpenStreetMap via Overpass API.
 * Results cached in Postgres for 24 hours.
 *
 * When Foursquare enterprise credentials are available, set HEREYA_FOURSQUARE_API_KEY
 * and this service will prefer FSQ data automatically (future upgrade path).
 */
class VenueService {
  /**
   * Get venues near a lat/lng coordinate.
   */
  async getNearbyVenues({ latitude, longitude, radiusM = 500, limit = 20 }) {
    // 1. Try DB cache first
    const cached = await this._getCachedNearby(latitude, longitude, radiusM);
    if (cached.length > 0) {
      logger.debug('Venue cache hit', { count: cached.length });
      return cached.slice(0, limit);
    }

    // 2. Fetch from OpenStreetMap Overpass
    const osmVenues = await this._fetchFromOSM({ latitude, longitude, radiusM });
    if (!osmVenues.length) {
      logger.warn('No venues found from OSM', { latitude, longitude, radiusM });
      return [];
    }

    // 3. Upsert into DB cache
    const upserted = await this._upsertVenues(osmVenues);
    logger.info('OSM venues cached', { count: upserted.length });
    return upserted.slice(0, limit);
  }

  /**
   * Get a single venue by internal ID.
   */
  async getVenueById(venueId) {
    if (!venueId) return null;
    // Try UUID first
    const { data } = await supabaseAdmin
      .from('venues')
      .select('*')
      .eq('id', venueId)
      .single();
    if (data) return data;
    // Fallback: try osm_id (for venues not yet upserted with DB UUID)
    const { data: byOsm } = await supabaseAdmin
      .from('venues')
      .select('*')
      .eq('osm_id', String(venueId))
      .single();
    return byOsm || null;
  }

  // ── Private helpers ──────────────────────────────────────

  async _getCachedNearby(lat, lng, radiusM) {
    // Simple bounding box query — works without PostGIS
    // 1 degree lat ≈ 111km, 1 degree lng ≈ 111km * cos(lat)
    const latDelta = radiusM / 111000;
    const lngDelta = radiusM / (111000 * Math.cos((lat * Math.PI) / 180));

    const { data } = await supabaseAdmin
      .from('venues')
      .select('*')
      .eq('is_active', true)
      .gte('latitude', lat - latDelta)
      .lte('latitude', lat + latDelta)
      .gte('longitude', lng - lngDelta)
      .lte('longitude', lng + lngDelta)
      .limit(50);

    if (!data?.length) return [];

    // Sort by actual distance
    const sorted = data
      .map((v) => {
        const dLat = v.latitude - lat;
        const dLng = v.longitude - lng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng) * 111000;
        return { ...v, _dist: dist };
      })
      .filter((v) => v._dist <= radiusM)
      .sort((a, b) => a._dist - b._dist);

    const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();
    return sorted.filter((v) => !v.osm_synced_at || v.osm_synced_at > cutoff);
  }

  async _fetchFromOSM({ latitude, longitude, radiusM }) {
    const amenityFilter = OSM_VENUE_TAGS.join('|');
    const leisureFilter = OSM_LEISURE_TAGS.join('|');

    // Overpass QL — nodes and ways matching venue tags within radius
    const query = `
[out:json][timeout:15];
(
  node["amenity"~"^(${amenityFilter})$"](around:${radiusM},${latitude},${longitude});
  way["amenity"~"^(${amenityFilter})$"](around:${radiusM},${latitude},${longitude});
  node["leisure"~"^(${leisureFilter})$"](around:${radiusM},${latitude},${longitude});
  way["leisure"~"^(${leisureFilter})$"](around:${radiusM},${latitude},${longitude});
);
out center;
`.trim();

    try {
      const { data } = await axios.post(OVERPASS_URL, query, {
        headers: { 'Content-Type': 'text/plain' },
        timeout: 18000,
      });

      return (data.elements || [])
        .filter((el) => el.tags?.name)         // must have a name
        .map((el) => this._mapOSMElement(el));
    } catch (err) {
      logger.error('Overpass API error', { err: err.message });
      return [];
    }
  }

  _mapOSMElement(el) {
    // Ways have a `center` object; nodes have lat/lon directly
    const lat = el.lat ?? el.center?.lat ?? 0;
    const lon = el.lon ?? el.center?.lon ?? 0;
    const tags = el.tags || {};
    const amenity = tags.amenity || tags.leisure || 'venue';

    return {
      osm_id: String(el.id),
      name: tags.name,
      address: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || null,
      city: tags['addr:city'] || null,
      state: tags['addr:state'] || null,
      country: tags['addr:country'] || 'US',
      category: amenity,
      latitude: lat,
      longitude: lon,
      geofence_radius_m: this._getRadiusForCategory(amenity),
      is_active: true,
      osm_synced_at: new Date().toISOString(),
    };
  }

  async _upsertVenues(venues) {
    const { data, error } = await supabaseAdmin
      .from('venues')
      .upsert(venues, { onConflict: 'osm_id', ignoreDuplicates: false })
      .select();

    if (error) {
      logger.error('Failed to upsert venues', { error: error.message });
      return [];
    }
    return data || [];
  }

  _getRadiusForCategory(category = '') {
    const c = category.toLowerCase();
    if (['stadium', 'arena', 'ballpark', 'sports_centre'].some((k) => c.includes(k))) {
      return config.geofence.stadiumRadiusM;
    }
    if (['park', 'airport', 'mall', 'marketplace'].some((k) => c.includes(k))) {
      return 200;
    }
    return config.geofence.defaultRadiusM;
  }
}

module.exports = new VenueService();
