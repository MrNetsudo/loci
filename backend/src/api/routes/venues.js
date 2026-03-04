'use strict';

const express = require('express');
const Joi = require('joi');
const { optionalAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../../utils/supabase');

const router = express.Router();

const nearbySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  radius: Joi.number().positive().max(5000).default(500),
});

// GET /venues/nearby
router.get('/nearby', optionalAuth, async (req, res, next) => {
  try {
    const { error, value } = nearbySchema.validate(req.query);
    if (error) return res.status(400).json({ error: 'VALIDATION_ERROR', message: error.message });

    const { data: venues, error: dbError } = await supabaseAdmin.rpc('get_nearby_venues', {
      p_lat: value.lat,
      p_lng: value.lng,
      p_radius_m: value.radius,
    });

    if (dbError) return next(dbError);

    return res.json({ venues: venues || [] });
  } catch (err) {
    return next(err);
  }
});

// GET /venues/:id
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
