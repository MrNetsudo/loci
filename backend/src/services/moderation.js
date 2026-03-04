'use strict';

const OpenAI = require('openai');
const { supabaseAdmin } = require('../utils/supabase');
const config = require('../config');
const logger = require('../utils/logger');

const openai = new OpenAI({ apiKey: config.openai.apiKey });

const MODERATION_ACTIONS = {
  PASS: 'passed',
  REVIEW: 'flagged',
  BLOCK: 'blocked',
};

class ModerationService {
  /**
   * Moderate content before it's stored or broadcast.
   * Returns { allowed: boolean, status: string, scores: object }
   */
  async moderateMessage({ content, userId, roomId }) {
    try {
      const response = await openai.moderations.create({ input: content });
      const result = response.results[0];

      const scores = result.category_scores;
      const maxScore = Math.max(...Object.values(scores));
      const flaggedCategories = Object.entries(result.categories)
        .filter(([, flagged]) => flagged)
        .map(([cat]) => cat);

      let status = MODERATION_ACTIONS.PASS;
      let allowed = true;

      if (result.flagged) {
        if (maxScore >= config.openai.moderationThreshold) {
          status = MODERATION_ACTIONS.BLOCK;
          allowed = false;
        } else {
          status = MODERATION_ACTIONS.REVIEW;
          allowed = true; // allow but flag for human review
        }
      }

      // Log moderation result
      if (status !== MODERATION_ACTIONS.PASS) {
        await this._logModerationAction({
          userId,
          roomId,
          action: status === MODERATION_ACTIONS.BLOCK ? 'message_removed' : 'message_flagged',
          reason: flaggedCategories.join(', '),
          triggeredBy: 'ai',
          aiScores: scores,
        });

        // Escalate repeat offenders
        if (status === MODERATION_ACTIONS.BLOCK) {
          await this._handleRepeatOffender(userId, roomId);
        }
      }

      return { allowed, status, scores, flaggedCategories, maxScore };
    } catch (err) {
      logger.error('Moderation API error', { err: err.message });
      // Fail open in dev, fail closed in production
      if (config.app.env === 'production') {
        return { allowed: false, status: 'error', scores: {}, flaggedCategories: [] };
      }
      return { allowed: true, status: MODERATION_ACTIONS.PASS, scores: {}, flaggedCategories: [] };
    }
  }

  /**
   * Handle user reports of messages.
   */
  async processReport({ reporterUserId, messageId, roomId, reason }) {
    await this._logModerationAction({
      userId: reporterUserId,
      roomId,
      action: 'user_report',
      reason,
      triggeredBy: 'user_report',
    });

    // If a message gets 3+ reports, auto-flag for review
    const { count } = await supabaseAdmin
      .from('moderation_log')
      .select('*', { count: 'exact', head: true })
      .eq('message_id', messageId)
      .eq('action', 'user_report');

    if (count >= 3) {
      await supabaseAdmin
        .from('messages')
        .update({ moderation_status: 'flagged', is_visible: false })
        .eq('id', messageId);

      logger.info('Message auto-hidden after 3 reports', { messageId });
    }
  }

  // ── Private helpers ──────────────────────────────────────

  async _handleRepeatOffender(userId, roomId) {
    const window = new Date(Date.now() - 10 * 60 * 1000); // last 10 minutes

    const { count } = await supabaseAdmin
      .from('moderation_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action', 'message_removed')
      .gte('created_at', window.toISOString());

    if (count >= 3) {
      // Auto-mute for 15 minutes
      const muteUntil = new Date(Date.now() + 15 * 60 * 1000);
      await supabaseAdmin
        .from('users')
        .update({ muted_until: muteUntil.toISOString() })
        .eq('id', userId);

      await this._logModerationAction({
        userId,
        roomId,
        action: 'mute',
        reason: 'Auto-muted: 3+ violations in 10 minutes',
        triggeredBy: 'ai',
        durationMins: 15,
      });

      logger.info('User auto-muted', { userId, muteUntil });
    }
  }

  async _logModerationAction({ userId, roomId, messageId, action, reason, triggeredBy, aiScores, durationMins }) {
    await supabaseAdmin.from('moderation_log').insert({
      user_id: userId,
      room_id: roomId,
      message_id: messageId || null,
      action,
      reason,
      triggered_by: triggeredBy,
      ai_scores: aiScores || null,
      duration_mins: durationMins || null,
    });
  }
}

module.exports = new ModerationService();
