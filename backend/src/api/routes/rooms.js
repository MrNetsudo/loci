'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../../utils/supabase');

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
    const { session_display_name } = req.body;

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

    // Upsert room membership
    const displayName = session_display_name || req.user.display_name;
    const { data: member, error } = await supabaseAdmin
      .from('room_members')
      .upsert({
        room_id: room.id,
        user_id: req.user.id,
        is_present: true,
        left_at: null,
        session_display_name: displayName,
      }, { onConflict: 'room_id,user_id' })
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
      realtime_channel: `room:${room.id}`,
      supabase_url: process.env.LOCI_SUPABASE_URL,
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
