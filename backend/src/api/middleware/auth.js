'use strict';

const { supabase } = require('../../utils/supabase');
const logger = require('../../utils/logger');

/**
 * requireAuth — Validates Supabase JWT from Authorization header.
 * Attaches req.user (Supabase auth user) and req.lociUser (our users table row).
 */
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing auth token' });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' });
    }

    // Fetch our extended user record
    const { data: lociUser, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', user.id)
      .single();

    if (userError || !lociUser) {
      logger.warn('Auth user has no LOCI user record', { auth_id: user.id });
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'User record not found' });
    }

    if (lociUser.is_banned) {
      return res.status(403).json({ error: 'USER_BANNED', message: 'Account has been banned' });
    }

    req.authUser = user;
    req.user = lociUser;
    return next();
  } catch (err) {
    logger.error('Auth middleware error', { err });
    return next(err);
  }
};

/**
 * optionalAuth — Like requireAuth but doesn't fail if no token present.
 * req.user will be null for unauthenticated requests.
 */
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  return requireAuth(req, res, next);
};

module.exports = { requireAuth, optionalAuth };
