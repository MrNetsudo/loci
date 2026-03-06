'use strict';

const express = require('express');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const { supabase, supabaseAdmin } = require('../../utils/supabase');
const { requireAuth } = require('../middleware/auth');
const config = require('../../config');
const logger = require('../../utils/logger');

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

// ── Email OTP Template ────────────────────────────────────
function buildOtpEmail(name, code) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Hereya verification code</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#111111;border-radius:16px;border:1px solid #1e1e2e;overflow:hidden;">
          <tr>
            <td align="center" style="padding:32px 40px 24px;border-bottom:1px solid #1e1e2e;">
              <p style="margin:0;font-size:28px;font-weight:900;letter-spacing:6px;color:#6C63FF;">HEREYA</p>
              <p style="margin:8px 0 0;font-size:13px;color:#666;letter-spacing:1px;">Walk in. Connect.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">Here's your code</h1>
              <p style="margin:0 0 28px;font-size:14px;color:#888;line-height:1.6;">Hi ${name}, use this 6-digit code to verify your Hereya account.</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:0 0 28px;">
                    <div style="background:#6C63FF;border-radius:12px;padding:20px 32px;display:inline-block;">
                      <span style="font-size:48px;font-weight:900;letter-spacing:12px;color:#ffffff;font-family:'Courier New',Courier,monospace;">${code}</span>
                    </div>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#666;text-align:center;">This code expires in <strong style="color:#ffffff;">10 minutes</strong>.</p>
              <p style="margin:0;font-size:12px;color:#444;text-align:center;">If you didn't request this, you can safely ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 40px;border-top:1px solid #1e1e2e;">
              <p style="margin:0;font-size:12px;color:#444;">Hereya · You have to be here.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// POST /auth/anonymous
router.post('/anonymous', authLimiter, async (req, res, next) => {
  try {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) return next(error);

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

// ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────
// In-memory OTP store: { email → { code, name, expiresAt } }
// Codes expire after 10 minutes. Good enough at this scale.
// ─────────────────────────────────────────────────────────
const otpStore = new Map();

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // always 6 digits
}

function storeOtp(email, code, name) {
  otpStore.set(email.toLowerCase(), {
    code,
    name,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 min TTL
  });
}

function verifyStoredOtp(email, code) {
  const entry = otpStore.get(email.toLowerCase());
  if (!entry) return { valid: false, reason: 'No code found for this email' };
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(email.toLowerCase());
    return { valid: false, reason: 'Code expired. Please request a new one.' };
  }
  if (entry.code !== String(code).trim()) {
    return { valid: false, reason: 'Invalid code' };
  }
  otpStore.delete(email.toLowerCase()); // one-time use
  return { valid: true, name: entry.name };
}

// Purge expired entries every 15 min to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore.entries()) {
    if (now > v.expiresAt) otpStore.delete(k);
  }
}, 15 * 60 * 1000);

// ─────────────────────────────────────────────────────────
// POST /auth/email-signup
// ─────────────────────────────────────────────────────────
router.post('/email-signup', authLimiter, async (req, res, next) => {
  try {
    const { name, email } = req.body;

    // Validate
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Name must be at least 2 characters' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(String(email).trim())) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Please enter a valid email address' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanName = String(name).trim();

    // Generate our own 6-digit code — store in memory, send via Resend
    const code = generateOtp();
    storeOtp(cleanEmail, code, cleanName);

    // Send via Resend
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { error: sendError } = await resend.emails.send({
      from: process.env.RESEND_FROM || 'Hereya <hello@hereya.app>',
      to: cleanEmail,
      subject: 'Your Hereya verification code',
      html: buildOtpEmail(cleanName, code),
    });

    if (sendError) {
      logger.error('Resend error', { error: sendError, email: cleanEmail });
      return res.status(500).json({ error: 'EMAIL_ERROR', message: 'Failed to send verification email' });
    }

    logger.info('OTP sent via Resend', { email: cleanEmail });
    return res.json({ ok: true, message: 'Verification code sent to your email' });
  } catch (err) {
    return next(err);
  }
});

// ─────────────────────────────────────────────────────────
// POST /auth/verify-otp
// Verifies OTP against Supabase Auth internally — no otp_codes table needed!
// ─────────────────────────────────────────────────────────
router.post('/verify-otp', authLimiter, async (req, res, next) => {
  try {
    const { name, email, code } = req.body;

    if (!name || !email || !code) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Name, email, and code are required' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanCode = String(code).trim();
    const cleanName = String(name).trim();

    // 1. Verify OTP against our in-memory store
    const otpResult = verifyStoredOtp(cleanEmail, cleanCode);
    if (!otpResult.valid) {
      logger.warn('OTP verify failed', { email: cleanEmail, reason: otpResult.reason });
      return res.status(400).json({ error: 'INVALID_CODE', message: otpResult.reason });
    }

    // 2. OTP valid — ensure Supabase auth user exists (create if first time)
    let authUserId;
    try {
      const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = users?.find(u => u.email?.toLowerCase() === cleanEmail);
      if (existing) {
        authUserId = existing.id;
      } else {
        const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email: cleanEmail,
          email_confirm: true,
          user_metadata: { display_name: cleanName },
        });
        if (createErr) throw createErr;
        authUserId = created.user.id;
      }
    } catch (err) {
      logger.error('User get/create error', { err: err.message });
      return res.status(500).json({ error: 'AUTH_ERROR', message: 'Failed to create account.' });
    }

    // 3. Generate magic link → extract token_hash → exchange for real session
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: cleanEmail,
    });

    if (linkErr || !linkData?.properties?.action_link) {
      logger.error('generateLink error', { linkErr });
      return res.status(500).json({ error: 'AUTH_ERROR', message: 'Failed to create session.' });
    }

    const actionLink = linkData.properties.action_link;
    const tokenHash = new URL(actionLink).searchParams.get('token');

    // 4. Exchange token_hash for a live session using the JS SDK
    const { data: verifyData, error: verifyErr } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'magiclink',
    });

    if (verifyErr || !verifyData?.session?.access_token) {
      logger.error('Session exchange failed', { verifyErr, session: verifyData?.session });
      return res.status(500).json({ error: 'AUTH_ERROR', message: 'Failed to create session.' });
    }

    const authUserEmail = verifyData.user?.email || cleanEmail;
    const accessToken = verifyData.session.access_token;

    if (!authUserId) {
      logger.error('No user ID in verify response', { session });
      return res.status(500).json({ error: 'AUTH_ERROR', message: 'Authentication failed.' });
    }

    // Upsert Hereya user (display_name only — email stored in Supabase Auth)
    const { data: lociUser, error: upsertError } = await supabaseAdmin
      .from('users')
      .upsert({
        auth_id: authUserId,
        display_name: cleanName,
        is_anonymous: false,
      }, { onConflict: 'auth_id' })
      .select()
      .single();

    if (upsertError) {
      logger.error('User upsert error', { upsertError });
      return res.status(500).json({ error: 'DB_ERROR', message: 'Failed to save user profile' });
    }

    logger.info('User verified via email OTP', { userId: lociUser.id, email: cleanEmail });

    return res.json({
      token: accessToken,
      user: {
        id: lociUser.id,
        display_name: lociUser.display_name,
        email: authUserEmail,
        email_verified: true, // Supabase confirmed the OTP = email is verified
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
