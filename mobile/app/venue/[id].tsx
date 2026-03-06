/**
 * LOCI — Venue Profile Screen
 * Yelp-style venue info: popular times, vibe tags, stats, AI vibe, live status.
 * Fully anonymous — headcounts only, no user attribution.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Dimensions,
  RefreshControl,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import * as api from '../../lib/api';
import type { VenueProfile } from '../../lib/api';
import { VenueIcon } from '../components/VenueIcon';
import { LiveBadge } from '../components/LiveBadge';

const { width: SCREEN_W } = Dimensions.get('window');

// ── Vibe tag definitions ─────────────────────────────────
const VIBE_TAGS = [
  { key: 'loud',        label: 'Loud',        emoji: '🔊' },
  { key: 'chill',       label: 'Chill',       emoji: '😌' },
  { key: 'packed',      label: 'Packed',      emoji: '🔥' },
  { key: 'music',       label: 'Music',       emoji: '🎵' },
  { key: 'sports',      label: 'Sports',      emoji: '📺' },
  { key: 'good-energy', label: 'Good Energy', emoji: '✨' },
];

const HOUR_LABELS: Record<number, string> = {
  0: '12a', 3: '3a', 6: '6a', 9: '9a', 12: '12p', 15: '3p', 18: '6p', 21: '9p',
};

export default function VenueProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<VenueProfile | null>(null);
  const [vibe, setVibe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myTags, setMyTags] = useState<Set<string>>(new Set());
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({});
  const [tagAnimations] = useState<Record<string, Animated.Value>>(
    () => Object.fromEntries(VIBE_TAGS.map((t) => [t.key, new Animated.Value(1)]))
  );

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const heroScale = useRef(new Animated.Value(0.97)).current;

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [profileData, vibeData] = await Promise.allSettled([
        api.venues.profile(id),
        api.venues.vibe(id),
      ]);
      if (profileData.status === 'fulfilled') {
        setProfile(profileData.value);
        setTagCounts(profileData.value.vibe_tags || {});
      }
      if (vibeData.status === 'fulfilled') {
        setVibe(vibeData.value.vibe);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    load().then(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(heroScale, { toValue: 1, tension: 60, friction: 10, useNativeDriver: true }),
      ]).start();
    });
  }, []);

  const onRefresh = () => { setRefreshing(true); load(); };

  const handleVibeTag = async (tagKey: string) => {
    if (!id || !profile?.room) return;

    // Optimistic update
    const isAdding = !myTags.has(tagKey);
    setMyTags((prev) => {
      const next = new Set(prev);
      isAdding ? next.add(tagKey) : next.delete(tagKey);
      return next;
    });
    setTagCounts((prev) => ({
      ...prev,
      [tagKey]: Math.max(0, (prev[tagKey] || 0) + (isAdding ? 1 : -1)),
    }));

    // Bounce animation
    Animated.sequence([
      Animated.spring(tagAnimations[tagKey], { toValue: 1.2, tension: 200, friction: 5, useNativeDriver: true }),
      Animated.spring(tagAnimations[tagKey], { toValue: 1, tension: 200, friction: 8, useNativeDriver: true }),
    ]).start();

    try {
      const result = await api.venues.vibeTag(id, tagKey);
      setTagCounts(result.tags);
    } catch {
      // Revert on error
      setMyTags((prev) => {
        const next = new Set(prev);
        isAdding ? next.delete(tagKey) : next.add(tagKey);
        return next;
      });
      setTagCounts((prev) => ({
        ...prev,
        [tagKey]: Math.max(0, (prev[tagKey] || 0) + (isAdding ? -1 : 1)),
      }));
    }
  };

  const enterRoom = () => {
    if (!profile?.room?.id) return;
    router.push(`/room/${profile.room.id}`);
  };

  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator size="large" color="#6C63FF" />
        <Text style={s.loadingText}>Loading venue…</Text>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={s.loadingWrap}>
        <Text style={s.emptyIcon}>📍</Text>
        <Text style={s.errorText}>Venue not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>← Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isLive = ['active', 'warming'].includes(profile.room?.status || '');

  return (
    <>
      <Stack.Screen options={{ title: profile.name, headerBackVisible: true }} />
      <ScrollView
        style={s.container}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6C63FF" colors={['#6C63FF']} />
        }
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: heroScale }] }}>

          {/* ── Hero ─────────────────────────────────────── */}
          <View style={s.hero}>
            <View style={s.heroIcon}>
              <VenueIcon category={profile.category} size={44} />
            </View>
            <Text style={s.venueName}>{profile.name}</Text>
            {profile.address ? <Text style={s.address}>{profile.address}</Text> : null}
            <View style={s.heroBadgeRow}>
              <View style={s.categoryPill}>
                <Text style={s.categoryText}>
                  {profile.category.charAt(0).toUpperCase() + profile.category.slice(1)}
                </Text>
              </View>
              {isLive && <LiveBadge count={profile.room?.occupancy ?? 0} size="md" />}
              {!isLive && (
                <View style={s.quietPill}>
                  <Text style={s.quietText}>○  Quiet now</Text>
                </View>
              )}
            </View>

            {/* AI Vibe */}
            {vibe ? (
              <View style={s.vibeRow}>
                <Text style={s.vibeQuote}>"{vibe}"</Text>
              </View>
            ) : null}

            {/* Enter CTA */}
            {isLive ? (
              <TouchableOpacity style={s.enterBtn} onPress={enterRoom} activeOpacity={0.85}>
                <Text style={s.enterText}>Enter the Room →</Text>
                <Text style={s.enterSub}>{profile.room?.occupancy} inside</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.quietCta}>
                <Text style={s.quietCtaText}>No active room right now</Text>
                <Text style={s.quietCtaSub}>Walk in to start one</Text>
              </View>
            )}
          </View>

          {/* ── Popular Times ─────────────────────────────── */}
          <Section title="Popular Times" icon="📊">
            <PopularTimesChart data={profile.popular_times} />
          </Section>

          {/* ── Vibe Tags ────────────────────────────────── */}
          <Section
            title="Vibes Right Now"
            icon="⚡"
            subtitle={isLive ? 'Tap to tag the current energy — anonymous' : 'No active room'}
          >
            <View style={s.tagsGrid}>
              {VIBE_TAGS.map((tag) => {
                const count = tagCounts[tag.key] || 0;
                const isTagged = myTags.has(tag.key);
                return (
                  <Animated.View key={tag.key} style={{ transform: [{ scale: tagAnimations[tag.key] }] }}>
                    <TouchableOpacity
                      style={[s.tagPill, isTagged && s.tagPillActive, !isLive && s.tagPillDisabled]}
                      onPress={() => isLive && handleVibeTag(tag.key)}
                      activeOpacity={isLive ? 0.75 : 1}
                    >
                      <Text style={s.tagEmoji}>{tag.emoji}</Text>
                      <Text style={[s.tagLabel, isTagged && s.tagLabelActive]}>{tag.label}</Text>
                      {count > 0 && (
                        <View style={[s.tagCount, isTagged && s.tagCountActive]}>
                          <Text style={[s.tagCountText, isTagged && s.tagCountTextActive]}>{count}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </Animated.View>
                );
              })}
            </View>
          </Section>

          {/* ── Stats ────────────────────────────────────── */}
          <Section title="By the Numbers" icon="📈">
            <View style={s.statsGrid}>
              <StatBox
                value={profile.stats.total_conversations.toLocaleString()}
                label="Conversations"
                icon="💬"
              />
              <StatBox
                value={profile.stats.peak_occupancy > 0 ? profile.stats.peak_occupancy.toLocaleString() : '—'}
                label="Peak crowd"
                icon="🔝"
              />
              <StatBox
                value={profile.stats.total_messages_all_time > 0
                  ? profile.stats.total_messages_all_time > 1000
                    ? `${(profile.stats.total_messages_all_time / 1000).toFixed(1)}k`
                    : profile.stats.total_messages_all_time.toLocaleString()
                  : '—'}
                label="Messages sent"
                icon="✉️"
              />
              <StatBox
                value={profile.stats.peak_at
                  ? new Date(profile.stats.peak_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : '—'}
                label="Busiest night"
                icon="🌙"
              />
            </View>
          </Section>

          {/* ── Partner welcome message ───────────────────── */}
          {profile.welcome_message ? (
            <Section title="From the Venue" icon="🏠">
              <View style={s.welcomeBox}>
                <Text style={s.welcomeText}>{profile.welcome_message}</Text>
              </View>
            </Section>
          ) : null}

          {/* ── Bottom CTA ───────────────────────────────── */}
          {isLive ? (
            <TouchableOpacity style={s.bottomCta} onPress={enterRoom} activeOpacity={0.85}>
              <Text style={s.bottomCtaText}>Enter the Room →</Text>
            </TouchableOpacity>
          ) : (
            <View style={s.bottomNote}>
              <Text style={s.bottomNoteText}>
                Rooms open when someone walks in. Be the first.
              </Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </Animated.View>
      </ScrollView>
    </>
  );
}

// ── Popular Times Chart ──────────────────────────────────
function PopularTimesChart({ data }: { data: Array<{ hour: number; activity: number; avgOccupancy: number }> }) {
  const now = new Date();
  const currentHour = now.getHours();
  const maxActivity = Math.max(...data.map((d) => d.activity), 1);

  return (
    <View>
      <View style={chart.wrap}>
        {data.map(({ hour, activity }) => {
          const heightPct = activity / maxActivity;
          const isCurrent = hour === currentHour;
          const isPeak = activity === maxActivity && activity > 0;
          return (
            <View key={hour} style={chart.col}>
              <View style={chart.barBg}>
                <View
                  style={[
                    chart.bar,
                    { height: `${Math.max(heightPct * 100, 4)}%` },
                    isCurrent && chart.barCurrent,
                    isPeak && !isCurrent && chart.barPeak,
                  ]}
                />
              </View>
              {HOUR_LABELS[hour] !== undefined ? (
                <Text style={[chart.label, isCurrent && chart.labelCurrent]}>
                  {HOUR_LABELS[hour]}
                </Text>
              ) : (
                <View style={chart.labelSpacer} />
              )}
            </View>
          );
        })}
      </View>
      <Text style={chart.note}>
        {maxActivity === 1 && data.every((d) => d.activity <= 1)
          ? 'Not enough data yet — check back after a few sessions'
          : `Busiest around ${peakHourLabel(data)} · Based on past sessions`}
      </Text>
    </View>
  );
}

function peakHourLabel(data: Array<{ hour: number; activity: number }>) {
  const peak = data.reduce((max, d) => (d.activity > max.activity ? d : max), data[0]);
  const h = peak.hour;
  if (h === 0) return 'midnight';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

// ── Sub-components ───────────────────────────────────────
function Section({ title, icon, subtitle, children }: {
  title: string; icon: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <View style={sec.wrap}>
      <View style={sec.header}>
        <Text style={sec.icon}>{icon}</Text>
        <View>
          <Text style={sec.title}>{title}</Text>
          {subtitle ? <Text style={sec.sub}>{subtitle}</Text> : null}
        </View>
      </View>
      <View style={sec.body}>{children}</View>
    </View>
  );
}

function StatBox({ value, label, icon }: { value: string; label: string; icon: string }) {
  return (
    <View style={stat.box}>
      <Text style={stat.icon}>{icon}</Text>
      <Text style={stat.value}>{value}</Text>
      <Text style={stat.label}>{label}</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────
const PURPLE = '#6C63FF';
const BG     = '#0a0a0a';
const CARD   = '#111111';
const BORDER = '#1e1e2e';

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll:    { paddingBottom: 24 },

  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BG, gap: 16 },
  loadingText: { color: '#666', fontSize: 14 },
  emptyIcon:   { fontSize: 48, marginBottom: 8 },
  errorText:   { color: '#fff', fontSize: 16, fontWeight: '600' },
  backBtn:     { marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, backgroundColor: '#1a1a2e' },
  backBtnText: { color: '#888', fontSize: 14 },

  // Hero
  hero: {
    backgroundColor: CARD, margin: 12, borderRadius: 20, padding: 24,
    alignItems: 'center', borderWidth: 1, borderColor: BORDER,
  },
  heroIcon: { marginBottom: 16 },
  venueName: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center', marginBottom: 6, letterSpacing: 0.2 },
  address:   { color: '#555', fontSize: 13, textAlign: 'center', marginBottom: 14 },
  heroBadgeRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', justifyContent: 'center' },
  categoryPill: { backgroundColor: '#1a1a2e', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: '#2a2a3e' },
  categoryText: { color: '#888', fontSize: 12, fontWeight: '600' },
  quietPill:    { backgroundColor: 'rgba(100,100,100,0.1)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: '#333' },
  quietText:    { color: '#555', fontSize: 12, fontWeight: '600' },

  vibeRow: { marginBottom: 20, paddingHorizontal: 8 },
  vibeQuote: { color: '#777', fontSize: 14, fontStyle: 'italic', textAlign: 'center', lineHeight: 22 },

  enterBtn: {
    backgroundColor: PURPLE, borderRadius: 28, paddingHorizontal: 32, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: PURPLE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  enterText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  enterSub:  { color: 'rgba(255,255,255,0.55)', fontSize: 12 },

  quietCta: { alignItems: 'center', paddingVertical: 8 },
  quietCtaText: { color: '#555', fontSize: 14, fontWeight: '600' },
  quietCtaSub:  { color: '#333', fontSize: 12, marginTop: 2 },

  // Tags
  tagsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tagPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1a1a2e', borderRadius: 24,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: '#2a2a3e',
  },
  tagPillActive: { backgroundColor: 'rgba(108,99,255,0.15)', borderColor: PURPLE },
  tagPillDisabled: { opacity: 0.45 },
  tagEmoji: { fontSize: 16 },
  tagLabel: { color: '#888', fontSize: 13, fontWeight: '600' },
  tagLabelActive: { color: '#fff' },
  tagCount: { backgroundColor: '#2a2a3e', borderRadius: 10, minWidth: 20, paddingHorizontal: 5, paddingVertical: 1, alignItems: 'center' },
  tagCountActive: { backgroundColor: PURPLE },
  tagCountText: { color: '#888', fontSize: 11, fontWeight: '700' },
  tagCountTextActive: { color: '#fff' },

  // Stats
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  // Welcome
  welcomeBox: {
    backgroundColor: 'rgba(108,99,255,0.07)', borderLeftWidth: 3, borderLeftColor: PURPLE,
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8,
  },
  welcomeText: { color: '#999', fontSize: 14, lineHeight: 22, fontStyle: 'italic' },

  // Bottom CTA
  bottomCta: {
    marginHorizontal: 12, marginTop: 8, backgroundColor: PURPLE, borderRadius: 28,
    paddingVertical: 16, alignItems: 'center',
    shadowColor: PURPLE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  bottomCtaText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  bottomNote: { marginHorizontal: 12, marginTop: 8, paddingVertical: 16, alignItems: 'center' },
  bottomNoteText: { color: '#444', fontSize: 13, textAlign: 'center', lineHeight: 20 },
});

const sec = StyleSheet.create({
  wrap: { backgroundColor: CARD, margin: 12, marginTop: 0, borderRadius: 16, borderWidth: 1, borderColor: BORDER },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  icon: { fontSize: 18 },
  title: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  sub:   { color: '#555', fontSize: 11, marginTop: 1 },
  body:  { padding: 16 },
});

const stat = StyleSheet.create({
  box: {
    width: (SCREEN_W - 24 - 32 - 10) / 2,
    backgroundColor: '#0f0f1a', borderRadius: 12,
    padding: 14, alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: BORDER,
  },
  icon:  { fontSize: 20, marginBottom: 2 },
  value: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 0.2 },
  label: { color: '#555', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
});

const chart = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'flex-end', height: 72,
    gap: 2, marginBottom: 8,
  },
  col: { flex: 1, alignItems: 'center', gap: 3 },
  barBg: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: {
    width: '100%', borderRadius: 2,
    backgroundColor: 'rgba(108,99,255,0.25)',
  },
  barCurrent: { backgroundColor: PURPLE },
  barPeak: { backgroundColor: 'rgba(108,99,255,0.55)' },
  label: { color: '#444', fontSize: 8, fontWeight: '600' },
  labelCurrent: { color: PURPLE },
  labelSpacer: { height: 10 },
  note: { color: '#444', fontSize: 11, marginTop: 4, textAlign: 'center', lineHeight: 16 },
});
