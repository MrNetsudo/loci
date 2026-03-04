'use strict';

const express = require('express');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const presenceService = require('../../services/presence');
const config = require('../../config');

const router = express.Router();

// Strict rate limit for presence checks (1 per minute per user)
const presenceLimiter = rateLimit({
  windowMs: 60_000,
  max: config.rateLimits.presence,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'RATE_LIMITED', message: 'Presence check limited to once per minute' },
});

const checkSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  accuracy_meters: Joi.number().positive().max(5000).optional(),
  wifi_bssid: Joi.string().optional(),
});

// POST /presence/check
router.post('/check', requireAuth, presenceLimiter, async (req, res, next) => {
  try {
    const { error, value } = checkSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: error.message });
    }

    const result = await presenceService.checkPresence({
      latitude: value.latitude,
      longitude: value.longitude,
      accuracyMeters: value.accuracy_meters,
      wifiBssid: value.wifi_bssid,
      userId: req.user.id,
    });

    return res.json({
      is_present: result.isPresent,
      venue: result.venue,
      confidence: result.confidence,
      verification_method: result.verificationMethod,
      room_id: result.roomId || null,
    });
  } catch (err) {
    return next(err);
  }
});

// POST /presence/qr-checkin
router.post('/qr-checkin', requireAuth, async (req, res, next) => {
  try {
    const { qr_token } = req.body;
    if (!qr_token) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'qr_token is required' });
    }

    const result = await presenceService.verifyQrToken({
      token: qr_token,
      userId: req.user.id,
    });

    if (!result.isValid) {
      return res.status(422).json({ error: 'INVALID_QR', message: 'Invalid or expired QR code' });
    }

    return res.json({
      is_present: true,
      venue: result.venue,
      room_id: result.roomId,
      valid_until: result.validUntil,
    });
  } catch (err) {
    return next(err);
  }
});

// DELETE /presence/leave
router.delete('/leave', requireAuth, async (req, res, next) => {
  try {
    const { venue_id } = req.body;
    if (!venue_id) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'venue_id is required' });
    }

    await presenceService.recordDeparture({ userId: req.user.id, venueId: venue_id });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
