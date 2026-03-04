'use strict';

const express = require('express');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const { supabase, supabaseAdmin } = require('../../utils/supabase');
const { requireAuth } = require('../middleware/auth');
const config = require('../../config');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 60_000,
  max: config.rateLimits.auth,
  message: { error: 'RATE_LIMITED', message: 'Too many auth attempts' },
});

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  display_name: Joi.string().min(2).max(30).optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

// POST /auth/anonymous
router.post('/anonymous', authLimiter, async (req, res, next) => {
  try {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) return next(error);

    // Create LOCI user record
    const displayName = `User${Math.floor(Math.random() * 9000) + 1000}`;
    const { data: lociUser } = await supabaseAdmin
      .from('users')
      .insert({
        auth_id: data.user.id,
        is_anonymous: true,
        display_name: displayName,
        device_id: req.body.device_id || null,
      })
      .select()
      .single();

    return res.status(201).json({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: { id: lociUser.id, is_anonymous: true, display_name: lociUser.display_name },
    });
  } catch (err) {
    return next(err);
  }
});

// POST /auth/register
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { error: valError, value } = registerSchema.validate(req.body);
    if (valError) return res.status(400).json({ error: 'VALIDATION_ERROR', message: valError.message });

    const { data, error } = await supabase.auth.signUp({
      email: value.email,
      password: value.password,
    });

    if (error) return res.status(400).json({ error: 'AUTH_ERROR', message: error.message });

    const { data: lociUser } = await supabaseAdmin
      .from('users')
      .insert({
        auth_id: data.user.id,
        is_anonymous: false,
        display_name: value.display_name || `User${Math.floor(Math.random() * 9000) + 1000}`,
      })
      .select()
      .single();

    return res.status(201).json({
      token: data.session?.access_token,
      user: { id: lociUser.id, is_anonymous: false, display_name: lociUser.display_name },
    });
  } catch (err) {
    return next(err);
  }
});

// POST /auth/login
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { error: valError, value } = loginSchema.validate(req.body);
    if (valError) return res.status(400).json({ error: 'VALIDATION_ERROR', message: valError.message });

    const { data, error } = await supabase.auth.signInWithPassword({
      email: value.email,
      password: value.password,
    });

    if (error) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid credentials' });

    const { data: lociUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('auth_id', data.user.id)
      .single();

    return res.json({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: { id: lociUser.id, is_anonymous: false, display_name: lociUser.display_name },
    });
  } catch (err) {
    return next(err);
  }
});

// POST /auth/upgrade — anonymous → named account
router.post('/upgrade', requireAuth, authLimiter, async (req, res, next) => {
  try {
    if (!req.user.is_anonymous) {
      return res.status(400).json({ error: 'ALREADY_NAMED', message: 'Account is already a named account' });
    }

    const { error: valError, value } = registerSchema.validate(req.body);
    if (valError) return res.status(400).json({ error: 'VALIDATION_ERROR', message: valError.message });

    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.authUser.id, {
      email: value.email,
      password: value.password,
    });

    if (error) return res.status(400).json({ error: 'AUTH_ERROR', message: error.message });

    await supabaseAdmin
      .from('users')
      .update({ is_anonymous: false, display_name: value.display_name || req.user.display_name })
      .eq('id', req.user.id);

    return res.json({ success: true, user: { id: req.user.id, is_anonymous: false } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
