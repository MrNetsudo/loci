'use strict';

const express = require('express');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const moderationService = require('../../services/moderation');
const { supabaseAdmin } = require('../../utils/supabase');
const config = require('../../config');

const router = express.Router();

const messageLimiter = rateLimit({
  windowMs: 60_000,
  max: config.rateLimits.messages,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'RATE_LIMITED', message: 'Message rate limit exceeded' },
});

const messageSchema = Joi.object({
  content: Joi.string().trim().min(1).max(1000).required(),
  content_type: Joi.string().valid('text').default('text'), // 'image' added in Phase 2
});

// GET /messages/:room_id — get message history
router.get('/:room_id', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const before = req.query.before;

    let query = supabaseAdmin
      .from('messages')
      .select(`
        id, content, content_type, created_at, moderation_status,
        users!inner ( id, display_name, is_anonymous )
      `)
      .eq('room_id', req.params.room_id)
      .eq('is_visible', true)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: messages, error } = await query;
    if (error) return next(error);

    return res.json({ messages: messages.reverse(), has_more: messages.length === limit });
  } catch (err) {
    return next(err);
  }
});

// POST /messages/:room_id — send message
router.post('/:room_id', requireAuth, messageLimiter, async (req, res, next) => {
  try {
    // Check if user is muted
    if (req.user.muted_until && new Date(req.user.muted_until) > new Date()) {
      return res.status(403).json({
        error: 'USER_MUTED',
        message: 'You are temporarily muted',
        muted_until: req.user.muted_until,
      });
    }

    const { error: valError, value } = messageSchema.validate(req.body);
    if (valError) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: valError.message });
    }

    // Verify user is present in this room
    const { data: member } = await supabaseAdmin
      .from('room_members')
      .select('id')
      .eq('room_id', req.params.room_id)
      .eq('user_id', req.user.id)
      .eq('is_present', true)
      .single();

    if (!member) {
      return res.status(403).json({ error: 'NOT_PRESENT', message: 'You must be at the venue to send messages' });
    }

    // Moderate content before saving
    const modResult = await moderationService.moderateMessage({
      content: value.content,
      userId: req.user.id,
      roomId: req.params.room_id,
    });

    if (!modResult.allowed) {
      return res.status(422).json({
        error: 'CONTENT_BLOCKED',
        message: 'Message violates community guidelines',
      });
    }

    // Save message
    const { data: message, error: insertError } = await supabaseAdmin
      .from('messages')
      .insert({
        room_id: req.params.room_id,
        user_id: req.user.id,
        content: value.content,
        content_type: value.content_type,
        moderation_status: modResult.status,
        moderation_score: modResult.maxScore || null,
        is_visible: true,
      })
      .select()
      .single();

    if (insertError) return next(insertError);

    return res.status(201).json({
      id: message.id,
      content: message.content,
      created_at: message.created_at,
      moderation_status: message.moderation_status,
    });
  } catch (err) {
    return next(err);
  }
});

// DELETE /messages/:room_id/:message_id — delete own message
router.delete('/:room_id/:message_id', requireAuth, async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('messages')
      .update({ is_visible: false })
      .eq('id', req.params.message_id)
      .eq('user_id', req.user.id);

    if (error) return next(error);
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// POST /messages/:room_id/:message_id/report — report a message
router.post('/:room_id/:message_id/report', requireAuth, async (req, res, next) => {
  try {
    const validReasons = ['harassment', 'spam', 'hate', 'other'];
    const { reason } = req.body;

    if (!validReasons.includes(reason)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: `reason must be one of: ${validReasons.join(', ')}` });
    }

    await moderationService.processReport({
      reporterUserId: req.user.id,
      messageId: req.params.message_id,
      roomId: req.params.room_id,
      reason,
    });

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
