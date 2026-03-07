'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../../utils/supabase');
const venueService = require('../../services/venues');
const config = require('../../config');

const router = express.Router();

// GET /rooms/:room_id
router.get('/:room_id', requireAuth, async (req, res, next) => {
  try {
    const { data: room, error } = await supabaseAdmin
      .from('rooms')
      .select('id, venue_id, status, activated_at, allow_anonymous')
      .eq('id', req.params.room_id)
      .single();

    if (error || !room) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Room not found' });
    }

    const { count } = await supabaseAdmin
      .from('room_members')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', room.id)
      .eq('is_present', true);

    return res.json({ ...room, occupancy: count || 0 });
  } catch (err) {
    return next(err);
  }
});

// POST /rooms/:room_id/join
router.post('/:room_id/join', requireAuth, async (req, res, next) => {
  try {
    const { session_display_name, lat, lng, accuracy_m } = req.body;

    // Check room is active
    const { data: room } = await supabaseAdmin
      .from('rooms')
      .select('id, status, venue_id, allow_anonymous')
      .eq('id', req.params.room_id)
      .in('status', ['warming', 'active'])
      .single();

    if (!room) {
      return res.status(409).json({ error: 'ROOM_INACTIVE', message: 'Room is not currently active' });
    }

    // Anonymous check
    if (!room.allow_anonymous && req.user.is_anonymous) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'This room requires a named account' });
    }

    // Presence verification
    let locationVerified = false;
    if (lat != null && lng != null) {
      const { data: venue } = await supabaseAdmin
        .from('venues')
        .select('latitude, longitude, geofence_radius_m')
        .eq('id', room.venue_id)
        .single();

      if (venue) {
        const distance_m = venueService.haversineM(lat, lng, venue.latitude, venue.longitude);
        const geofenceRadius = venue.geofence_radius_m || config.geofence.defaultRadiusM;
        const acc = accuracy_m || 50;

        if (distance_m > geofenceRadius + Math.min(acc, 50)) {
          return res.status(403).json({
            error: 'OUTSIDE_GEOFENCE',
            message: 'You must be at the venue to join this room',
            distance_m: Math.round(distance_m),
            venue_radius_m: geofenceRadius,
          });
        }

        if (accuracy_m != null && accuracy_m > geofenceRadius * (config.geofence.maxAccuracyMultiplier || 2)) {
          return res.status(403).json({
            error: 'LOW_GPS_ACCURACY',
            message: 'GPS accuracy too low to verify your location. Move to an open area and try again.',
            accuracy_m,
            required_accuracy_m: geofenceRadius,
          });
        }

        locationVerified = true;
      }
    }

    // Upsert room membership
    const displayName = session_display_name || req.user.display_name;
    const upsertData = {
      room_id: room.id,
      user_id: req.user.id,
      is_present: true,
      left_at: null,
      session_display_name: displayName,
    };
    // Include location fields if verified (columns may not exist yet — graceful)
    if (locationVerified) {
      upsertData.last_lat = lat;
      upsertData.last_lng = lng;
      upsertData.last_accuracy_m = accuracy_m || null;
      upsertData.location_verified_at = new Date().toISOString();
    }
    const { data: member, error } = await supabaseAdmin
      .from('room_members')
      .upsert(upsertData, { onConflict: 'room_id,user_id' })
      .select()
      .single();

    if (error) return next(error);

    // Activate warming room
    if (room.status === 'warming') {
      await supabaseAdmin.from('rooms').update({ status: 'active' }).eq('id', room.id);
    }

    return res.json({
      room: { id: room.id, status: 'active' },
      member: { id: member.id, display_name: displayName },
      location_verified: locationVerified,
      realtime_channel: `room:${room.id}`,
      supabase_url: process.env.HEREYA_SUPABASE_URL,
    });
  } catch (err) {
    return next(err);
  }
});

// DELETE /rooms/:room_id/leave
router.delete('/:room_id/leave', requireAuth, async (req, res, next) => {
  try {
    await supabaseAdmin
      .from('room_members')
      .update({ is_present: false, left_at: new Date().toISOString() })
      .eq('room_id', req.params.room_id)
      .eq('user_id', req.user.id);

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// GET /rooms/:room_id/members
router.get('/:room_id/members', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const { data: members, count, error } = await supabaseAdmin
      .from('room_members')
      .select(`
        id, joined_at, session_display_name,
        users!inner ( id, is_anonymous )
      `, { count: 'exact' })
      .eq('room_id', req.params.room_id)
      .eq('is_present', true)
      .range(offset, offset + limit - 1);

    if (error) return next(error);

    return res.json({
      members: members.map((m) => ({
        id: m.id,
        display_name: m.session_display_name,
        is_anonymous: m.users.is_anonymous,
        joined_at: m.joined_at,
      })),
      total: count || 0,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
