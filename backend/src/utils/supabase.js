'use strict';

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

// Public client — respects RLS (use for user-scoped operations)
const supabase = createClient(config.supabase.url, config.supabase.anonKey);

// Service client — bypasses RLS (use for admin/server operations ONLY)
const supabaseAdmin = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

module.exports = { supabase, supabaseAdmin };
