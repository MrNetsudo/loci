'use strict';

const express = require('express');
const Joi = require('joi');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../../utils/supabase');

const router = express.Router();

const updateSchema = Joi.object({
  display_name: Joi.string().min(2).max(30).optional(),
  avatar_url: Joi.string().uri().optional(),
});

// GET /users/me
router.get('/me', requireAuth, (req, res) => {
  const { id, display_name, is_anonymous, is_premium, created_at } = req.user;
  return res.json({ id, display_name, is_anonymous, is_premium, created_at });
});

// PATCH /users/me
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const { error: valError, value } = updateSchema.validate(req.body);
    if (valError) return res.status(400).json({ error: 'VALIDATION_ERROR', message: valError.message });

    if (!Object.keys(value).length) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'No fields to update' });
    }

    const { data: updated, error } = await supabaseAdmin
      .from('users')
      .update({ ...value, updated_at: new Date().toISOString() })
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) return next(error);
    return res.json({ id: updated.id, display_name: updated.display_name });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
