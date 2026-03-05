'use strict';

const axios = require('axios');
const { supabaseAdmin } = require('../utils/supabase');
const config = require('../config');
const logger = require('../utils/logger');

const FSQ_BASE = 'https://api.foursquare.com/v3';
const CACHE_TTL_HOURS = 24;

/**
 * VenueService
 * Wraps the Foursquare Places API v3.
 * Venues are cached in PostgreSQL — Foursquare is only hit when cache is stale.
 */
class VenueService {
  /**
   * Get venues near a lat/lng coordinate.
   * Returns cached results when fresh, otherwise fetches from Foursquare.
   */
  async getNearbyVenues({ latitude, longitude, radiusM = 500, limit = 20 }) {
    // 1. Try cache first
    const cached = await this._getCachedNearby(latitude, longitude, radiusM);
    if (cached.length > 0) {
      logger.debug('Venue cache hit', { count: cached.length });
      return cached;
    }

    // 2. Fetch from Foursquare
    if (!config.foursquare.apiKey) {
      logger.warn('Foursquare API key not configured — returning empty venues');
      return [];
    }

    const fsqVenues = await this._fetchFromFoursquare({ latitude, longitude, radiusM, limit });
    if (!fsqVenues.length) return [];

    // 3. Upsert into DB cache
    const upserted = await this._upsertVenues(fsqVenues);
    logger.info('Foursquare venues cached', { count: upserted.length });
    return upserted;
  }

  /**
   * Get or create a single venue by Foursquare ID.
   */
  async getVenueById(venueId) {
    const { data } = await supabaseAdmin
      .from('venues')
      .select('*')
      .eq('id', venueId)
      .single();
    return data;
  }

  /**
   * Sync a single venue from Foursquare (refresh cache).
   */
  async syncVenue(foursquareId) {
    if (!config.foursquare.apiKey) return null;

    try {
      const { data } = await axios.get(`${FSQ_BASE}/places/${foursquareId}`, {
        headers: { Authorization: config.foursquare.apiKey },
        params: { fields: 'fsq_id,name,location,categories,geocodes' },
      });

      const mapped = this._mapFsqVenue(data);
      const { data: venue } = await supabaseAdmin
        .from('venues')
        .upsert(mapped, { onConflict: 'foursquare_id' })
        .select()
        .single();

      return venue;
    } catch (err) {
      logger.error('Failed to sync venue from Foursquare', { foursquareId, err: err.message });
      return null;
    }
  }

  // ── Private helpers ──────────────────────────────────────

  async _getCachedNearby(lat, lng, radiusM) {
    const { data } = await supabaseAdmin.rpc('get_nearby_venues', {
      p_lat: lat,
      p_lng: lng,
      p_radius_m: radiusM,
    });

    if (!data?.length) return [];

    // Filter out stale entries (older than TTL)
    const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const fresh = data.filter((v) => !v.foursquare_synced_at || v.foursquare_synced_at > cutoff);
    return fresh;
  }

  async _fetchFromFoursquare({ latitude, longitude, radiusM, limit }) {
    try {
      const { data } = await axios.get(`${FSQ_BASE}/places/search`, {
        headers: { Authorization: config.foursquare.apiKey },
        params: {
          ll: `${latitude},${longitude}`,
          radius: radiusM,
          limit,
          fields: 'fsq_id,name,location,categories,geocodes,rating,hours',
          // Exclude categories that aren't venue-like
          exclude_all_chains: false,
        },
      });

      return (data.results || []).map(this._mapFsqVenue.bind(this));
    } catch (err) {
      logger.error('Foursquare API error', { err: err.response?.data || err.message });
      return [];
    }
  }

  _mapFsqVenue(fsqPlace) {
    const geocode = fsqPlace.geocodes?.main;
    const location = fsqPlace.location || {};
    const primaryCategory = fsqPlace.categories?.[0];

    return {
      foursquare_id: fsqPlace.fsq_id,
      name: fsqPlace.name,
      address: location.address || null,
      city: location.locality || location.city || null,
      state: location.region || null,
      country: location.country || 'US',
      category: primaryCategory?.short_name?.toLowerCase() || 'venue',
      latitude: geocode?.latitude ?? location.lat ?? 0,
      longitude: geocode?.longitude ?? location.lng ?? 0,
      geofence_radius_m: this._getRadiusForCategory(primaryCategory?.name),
      is_active: true,
      foursquare_synced_at: new Date().toISOString(),
    };
  }

  async _upsertVenues(venues) {
    const { data, error } = await supabaseAdmin
      .from('venues')
      .upsert(venues, { onConflict: 'foursquare_id' })
      .select();

    if (error) {
      logger.error('Failed to upsert venues', { error });
      return [];
    }
    return data || [];
  }

  _getRadiusForCategory(categoryName = '') {
    const name = categoryName.toLowerCase();
    if (name.includes('stadium') || name.includes('arena') || name.includes('ballpark')) {
      return config.geofence.stadiumRadiusM;
    }
    if (name.includes('park') || name.includes('airport') || name.includes('mall')) {
      return 200;
    }
    return config.geofence.defaultRadiusM;
  }
}

module.exports = new VenueService();
