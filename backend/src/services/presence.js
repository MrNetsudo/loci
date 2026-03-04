'use strict';

const axios = require('axios');
const { supabaseAdmin } = require('../utils/supabase');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * PresenceService
 * Verifies a user is physically at a venue using multi-signal detection.
 * Priority: QR code > WiFi fingerprint > GPS geofence
 */
class PresenceService {
  /**
   * Check if user coordinates are within any venue geofence.
   * Returns the matched venue and confidence score.
   */
  async checkPresence({ latitude, longitude, accuracyMeters, wifiBssid, userId }) {
    // 1. Find candidate venues near the coordinates
    const candidates = await this._getNearbyVenues(latitude, longitude, 500);

    if (!candidates.length) {
      return { isPresent: false, venue: null, confidence: 0 };
    }

    let bestMatch = null;
    let bestConfidence = 0;

    for (const venue of candidates) {
      const distance = this._haversineDistance(
        latitude, longitude,
        venue.latitude, venue.longitude
      );

      const radius = this._getVenueRadius(venue);
      if (distance > radius) continue;

      // GPS confidence: higher when closer to center and higher GPS accuracy
      const distanceRatio = distance / radius;
      let confidence = 1 - (distanceRatio * 0.5); // 0.5–1.0

      // Accuracy penalty: reduce confidence if GPS accuracy is poor
      if (accuracyMeters && accuracyMeters > 50) {
        confidence *= Math.max(0.5, 1 - ((accuracyMeters - 50) / 200));
      }

      // WiFi boost: if BSSID matches known venue SSID, boost confidence
      if (wifiBssid && venue.known_bssids?.includes(wifiBssid)) {
        confidence = Math.min(0.99, confidence + 0.15);
      }

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestMatch = venue;
      }
    }

    if (!bestMatch || bestConfidence < 0.5) {
      return { isPresent: false, venue: null, confidence: bestConfidence };
    }

    // Record presence
    await this._recordPresence({ userId, venueId: bestMatch.id, confidence, method: 'gps' });

    // Ensure room exists and is active for this venue
    const room = await this._ensureActiveRoom(bestMatch.id);

    return {
      isPresent: true,
      venue: bestMatch,
      confidence: Math.round(bestConfidence * 100) / 100,
      verificationMethod: 'gps',
      roomId: room.id,
    };
  }

  /**
   * Verify a venue QR code token (signed by our server, time-limited).
   */
  async verifyQrToken({ token, userId }) {
    // QR tokens are JWT-signed with venue_id + expiry
    // Validate signature and expiry, then return venue
    try {
      // TODO: implement JWT verification for QR tokens
      // const { venueId, expiresAt } = verifyJwt(token, process.env.LOCI_JWT_SECRET);
      // For now, placeholder
      throw new Error('QR verification not yet implemented');
    } catch (err) {
      logger.warn('Invalid QR token', { userId, err: err.message });
      return { isValid: false };
    }
  }

  /**
   * Record user departure from venue.
   */
  async recordDeparture({ userId, venueId }) {
    await supabaseAdmin
      .from('user_presence')
      .update({ status: 'departed', departed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('venue_id', venueId)
      .eq('status', 'present');

    await this._updateRoomOccupancy(venueId);
  }

  // ── Private helpers ──────────────────────────────────────

  async _getNearbyVenues(lat, lng, radiusM) {
    // PostGIS query via Supabase RPC (requires PostGIS extension)
    const { data, error } = await supabaseAdmin.rpc('get_nearby_venues', {
      p_lat: lat,
      p_lng: lng,
      p_radius_m: radiusM,
    });

    if (error) {
      logger.error('Error fetching nearby venues', { error });
      return [];
    }
    return data || [];
  }

  async _ensureActiveRoom(venueId) {
    // Check for existing active/warming room
    const { data: existing } = await supabaseAdmin
      .from('rooms')
      .select('*')
      .eq('venue_id', venueId)
      .in('status', ['warming', 'active'])
      .single();

    if (existing) return existing;

    // Create new room
    const { data: newRoom, error } = await supabaseAdmin
      .from('rooms')
      .insert({ venue_id: venueId, status: 'warming', activated_at: new Date().toISOString() })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create room', { venueId, error });
      throw new Error('Failed to create venue room');
    }

    logger.info('New room created', { venueId, roomId: newRoom.id });
    return newRoom;
  }

  async _recordPresence({ userId, venueId, confidence, method }) {
    await supabaseAdmin.from('user_presence').insert({
      user_id: userId,
      venue_id: venueId,
      confidence,
      verification_method: method,
      status: 'present',
    });
  }

  async _updateRoomOccupancy(venueId) {
    // Recalculate occupancy for venue's active room
    const { data: room } = await supabaseAdmin
      .from('rooms')
      .select('id')
      .eq('venue_id', venueId)
      .in('status', ['warming', 'active'])
      .single();

    if (!room) return;

    const { count } = await supabaseAdmin
      .from('room_members')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', room.id)
      .eq('is_present', true);

    // If occupancy hits 0, start cooling timer
    if (count === 0) {
      await supabaseAdmin
        .from('rooms')
        .update({ status: 'cooling', cooled_at: new Date().toISOString() })
        .eq('id', room.id);

      logger.info('Room cooling — no occupants', { roomId: room.id });
    }
  }

  _getVenueRadius(venue) {
    if (venue.geofence_radius_m) return venue.geofence_radius_m;
    if (venue.category === 'stadium' || venue.category === 'arena') {
      return config.geofence.stadiumRadiusM;
    }
    return config.geofence.defaultRadiusM;
  }

  /**
   * Haversine formula — distance between two lat/lng points in meters.
   */
  _haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

module.exports = new PresenceService();
