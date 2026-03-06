/**
 * Hereya — Home Screen
 * Detects location → checks presence → shows nearby venues or drops you into a room.
 */

import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Animated,
  Platform,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocation } from '../lib/useLocation';
import * as api from '../lib/api';
import type { Venue, PresenceResult } from '../lib/api';
import { VenueIcon } from './components/VenueIcon';
import { WelcomeCard } from './components/WelcomeCard';

const TOKEN_KEY = '@hereya_token';
const USER_KEY = '@hereya_user';

type VenueWithDistance = Venue & { distance_meters?: number; _dist?: number };

// ── Category config ──────────────────────────────────────
const CATEGORY_CONFIG: Record<string, { label: string; color: string; emoji: string }> = {
  bar:           { label: 'Bar',          color: '#F59E0B', emoji: '🍺' },
  pub:           { label: 'Pub',          color: '#D97706', emoji: '🍺' },
  restaurant:    { label: 'Restaurant',   color: '#F43F5E', emoji: '🍽️' },
  fast_food:     { label: 'Fast Food',    color: '#EAB308', emoji: '🍔' },
  cafe:          { label: 'Café',         color: '#A78BFA', emoji: '☕' },
  coffee_shop:   { label: 'Coffee',       color: '#A78BFA', emoji: '☕' },
  stadium:       { label: 'Stadium',      color: '#22C55E', emoji: '🏟️' },
  arena:         { label: 'Arena',        color: '#22C55E', emoji: '🏟️' },
  sports_centre: { label: 'Sports',       color: '#10B981', emoji: '⚽' },
  nightclub:     { label: 'Nightclub',    color: '#8B5CF6', emoji: '🎵' },
  club:          { label: 'Club',         color: '#8B5CF6', emoji: '🎵' },
  music_venue:   { label: 'Live Music',   color: '#8B5CF6', emoji: '🎤' },
  concert_hall:  { label: 'Concert',      color: '#8B5CF6', emoji: '🎶' },
  theatre:       { label: 'Theater',      color: '#EC4899', emoji: '🎭' },
  cinema:        { label: 'Cinema',       color: '#EC4899', emoji: '🎬' },
  library:       { label: 'Library',      color: '#60A5FA', emoji: '📚' },
  gym:           { label: 'Gym',          color: '#34D399', emoji: '💪' },
  park:          { label: 'Park',         color: '#4ADE80', emoji: '🌳' },
  hotel:         { label: 'Hotel',        color: '#38BDF8', emoji: '🏨' },
  mall:          { label: 'Mall',         color: '#FB923C', emoji: '🛍️' },
  venue:         { label: 'Venue',        color: '#6C63FF', emoji: '📍' },
};

function getCategoryConfig(cat?: string) {
  if (!cat) return CATEGORY_CONFIG.venue;
  const key = cat.toLowerCase().replace(/ /g, '_');
  return CATEGORY_CONFIG[key] || {
    label: cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    color: '#6C63FF',
    emoji: '📍',
  };
}

function formatDistance(meters: number): string {
  if (meters < 100) return `${Math.round(meters)}m`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

// ── Home Screen ──────────────────────────────────────────
export default function HomeScreen() {
  const location = useLocation(30_000);
  const [initialized, setInitialized] = useState(false);
  const [venues, setVenues] = useState<VenueWithDistance[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [statusText, setStatusText] = useState('Finding your location…');
  const [atVenue, setAtVenue] = useState<{ name: string; roomId: string } | null>(null);
  const [liveCount, setLiveCount] = useState(0);

  const scanPulse = useRef(new Animated.Value(1)).current;
  const bannerSlide = useRef(new Animated.Value(-80)).current;

  const [welcomeVenue, setWelcomeVenue] = useState<{
    venueId: string; venueName: string; venueCategory: string;
    venueAddress?: string; occupancy: number; welcomeMessage?: string; roomId: string;
  } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<VenueWithDistance[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanPulse, { toValue: 0.2, duration: 1100, useNativeDriver: true }),
        Animated.timing(scanPulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    if (atVenue) {
      Animated.spring(bannerSlide, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }).start();
    }
  }, [atVenue]);

  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem(TOKEN_KEY);
        const userJson = await AsyncStorage.getItem(USER_KEY);
        if (!token || !userJson) { router.replace('/auth'); return; }
        let user: any;
        try { user = JSON.parse(userJson); } catch { router.replace('/auth'); return; }
        if (!user?.email_verified) { router.replace('/auth'); return; }
        api.setToken(token);
        setInitialized(true);
        AsyncStorage.getItem('@hereya_recent_searches').then((raw) => {
          if (raw) try { setRecentSearches(JSON.parse(raw)); } catch {}
        });
      } catch { router.replace('/auth'); }
    })();
  }, []);

  useEffect(() => {
    if (!initialized || !location.latitude || !location.longitude) return;
    checkPresence();
  }, [initialized, location.latitude, location.longitude]);

  const checkPresence = async () => {
    if (!location.latitude || !location.longitude) return;
    try {
      setStatusText('Scanning…');
      const result = await api.presence.check(location.latitude, location.longitude, location.accuracy ?? undefined);
      if (result.is_present && result.room_id && result.venue) {
        setAtVenue({ name: result.venue.name, roomId: result.room_id });
        handlePresenceConfirmed(result);
      } else {
        setAtVenue(null);
        loadNearbyVenues();
      }
    } catch { loadNearbyVenues(); }
  };

  const handlePresenceConfirmed = async (result: PresenceResult) => {
    if (!result.room_id || !result.venue) return;
    try {
      const detail = await api.venues.getById(result.venue.id);
      setWelcomeVenue({
        venueId: result.venue.id, venueName: result.venue.name,
        venueCategory: result.venue.category || 'venue', venueAddress: detail.address,
        occupancy: detail.occupancy, welcomeMessage: detail.welcome_message, roomId: result.room_id,
      });
    } catch {
      setWelcomeVenue({
        venueId: result.venue.id, venueName: result.venue.name,
        venueCategory: result.venue.category || 'venue', occupancy: 0, roomId: result.room_id,
      });
    }
  };

  const saveRecentSearch = async (q: string) => {
    const updated = [q, ...recentSearches.filter((r) => r !== q)].slice(0, 5);
    setRecentSearches(updated);
    await AsyncStorage.setItem('@hereya_recent_searches', JSON.stringify(updated));
  };

  const handleSearch = (text: string) => {
    setSearchQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.length < 2) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await api.venues.search(text, location.latitude ?? undefined, location.longitude ?? undefined);
        setSearchResults(res.venues as VenueWithDistance[]);
        saveRecentSearch(text);
      } catch { setSearchResults([]); }
    }, 300);
  };

  const loadNearbyVenues = async () => {
    if (!location.latitude || !location.longitude) return;
    try {
      const res = await api.venues.nearby(location.latitude, location.longitude, 2000);
      const v = res.venues as VenueWithDistance[];
      setVenues(v);
      const live = v.filter((x) => ['active', 'warming'].includes(x.room_status || '')).length;
      setLiveCount(live);
      setStatusText(v.length > 0 ? `${v.length} venues nearby` : 'No venues found nearby');
    } catch { setStatusText('Could not load venues'); }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await checkPresence();
    setRefreshing(false);
  };

  const joinVenueRoom = (venue: VenueWithDistance) => {
    router.push(`/venue/${venue.id}`);
  };

  // ── Loading ──
  if (location.loading || !initialized) {
    return (
      <View style={s.center}>
        <StatusBar barStyle="light-content" />
        <View style={s.scanWrap}>
          <ActivityIndicator size="large" color="#6C63FF" />
          <Animated.View style={[s.scanRing, { opacity: scanPulse }]} />
          <Animated.View style={[s.scanRing2, { opacity: scanPulse, transform: [{ scale: scanPulse }] }]} />
        </View>
        <Text style={s.loadTitle}>Scanning nearby venues…</Text>
        <Text style={s.loadSub}>Make sure location is enabled</Text>
      </View>
    );
  }

  if (location.error) {
    return (
      <View style={s.center}>
        <StatusBar barStyle="light-content" />
        <Text style={s.errIcon}>📍</Text>
        <Text style={s.errTitle}>Location Required</Text>
        <Text style={s.errSub}>{location.error}</Text>
        <TouchableOpacity style={s.btn} onPress={checkPresence}>
          <Text style={s.btnText}>Enable Location</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const displayVenues = searchQuery.length >= 2 ? searchResults : venues;
  const showSearch = searchQuery.length >= 2;

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" />

      {/* At-venue banner */}
      {atVenue && (
        <Animated.View style={[s.banner, { transform: [{ translateY: bannerSlide }] }]}>
          <LinearGradient
            colors={['rgba(108,99,255,0.2)', 'rgba(108,99,255,0.08)']}
            style={s.bannerGrad}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          >
            <Text style={s.bannerIcon}>📍</Text>
            <View style={s.bannerInfo}>
              <Text style={s.bannerTitle}>You're at {atVenue.name}</Text>
              <Text style={s.bannerSub}>Tap to join the conversation</Text>
            </View>
            <TouchableOpacity style={s.joinBtn} onPress={() => router.push(`/room/${atVenue.roomId}`)}>
              <Text style={s.joinBtnText}>Join</Text>
            </TouchableOpacity>
          </LinearGradient>
        </Animated.View>
      )}

      {/* Stats strip */}
      <View style={s.statsStrip}>
        <View style={s.statItem}>
          <Animated.View style={[s.statDot, { opacity: scanPulse }]} />
          <Text style={s.statLabel}>{venues.length} nearby</Text>
        </View>
        {liveCount > 0 && (
          <>
            <View style={s.statDivider} />
            <View style={s.statItem}>
              <View style={[s.statDot, { backgroundColor: '#22C55E' }]} />
              <Text style={[s.statLabel, { color: '#22C55E' }]}>{liveCount} live now</Text>
            </View>
          </>
        )}
        {location.accuracy && (
          <>
            <View style={s.statDivider} />
            <Text style={s.statLabel}>±{Math.round(location.accuracy)}m</Text>
          </>
        )}
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <View style={[s.searchBox, searchFocused && s.searchBoxFocused]}>
          <Text style={s.searchIco}>🔍</Text>
          <TextInput
            style={s.searchInput}
            value={searchQuery}
            onChangeText={handleSearch}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search venues, bars, stadiums…"
            placeholderTextColor="#3a3a4a"
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
              <Text style={s.searchClear}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {!showSearch && recentSearches.length > 0 && (
          <View style={s.recentRow}>
            <Text style={s.recentLabel}>Recent</Text>
            {recentSearches.map((r) => (
              <TouchableOpacity key={r} style={s.recentChip} onPress={() => handleSearch(r)}>
                <Text style={s.recentChipText}>🕐 {r}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Section header */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>
          {showSearch ? `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}` : 'Nearby Venues'}
        </Text>
        {!showSearch && <Text style={s.sectionSub}>Join the conversation around you</Text>}
      </View>

      {/* List */}
      {displayVenues.length > 0 ? (
        <FlatList
          data={displayVenues}
          keyExtractor={(v) => v.id}
          renderItem={({ item, index }) => (
            <VenueCard venue={item} onPress={() => joinVenueRoom(item)} index={index} />
          )}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            !showSearch ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6C63FF" colors={['#6C63FF']} />
            ) : undefined
          }
        />
      ) : (
        <View style={s.empty}>
          <Text style={s.emptyIco}>📍</Text>
          <Text style={s.emptyTitle}>{showSearch ? 'No results' : 'No venues nearby'}</Text>
          <Text style={s.emptySub}>
            {showSearch
              ? `Nothing found for "${searchQuery}"`
              : 'Walk to a bar, stadium, or event\nto join a live chat room'}
          </Text>
          {!showSearch && (
            <TouchableOpacity style={s.btn} onPress={onRefresh}>
              <Text style={s.btnText}>{refreshing ? 'Searching…' : 'Refresh'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Welcome card */}
      {welcomeVenue && (
        <WelcomeCard
          {...welcomeVenue}
          onEnter={() => { setWelcomeVenue(null); router.push(`/room/${welcomeVenue.roomId}`); }}
          onDismiss={() => { setWelcomeVenue(null); setAtVenue(null); loadNearbyVenues(); }}
        />
      )}
    </View>
  );
}

// ── Venue Card ───────────────────────────────────────────
interface CardProps { venue: VenueWithDistance; onPress: () => void; index: number; }

function VenueCard({ venue, onPress, index }: CardProps) {
  const cat = getCategoryConfig(venue.category);
  const isActive = venue.room_status === 'active';
  const isWarming = venue.room_status === 'warming';
  const isEmpty = !isActive && !isWarming;
  const dist = venue.distance_meters ?? venue._dist;

  const scaleAnim = useRef(new Animated.Value(0.97)).current;
  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1, tension: 80, friction: 8,
      delay: index * 40,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[s.card, isActive && s.cardLive, isWarming && s.cardWarm]}
        onPress={onPress}
        activeOpacity={0.78}
      >
        {/* Left color accent bar */}
        <View style={[s.accentBar, { backgroundColor: cat.color }]} />

        {/* Category icon */}
        <View style={[s.iconWrap, { backgroundColor: cat.color + '22' }]}>
          <Text style={s.iconEmoji}>{cat.emoji}</Text>
        </View>

        {/* Info */}
        <View style={s.cardInfo}>
          <Text style={s.cardName} numberOfLines={1}>{venue.name}</Text>
          <View style={s.cardMeta}>
            <Text style={[s.cardCat, { color: cat.color }]}>{cat.label}</Text>
            {dist !== undefined && (
              <>
                <Text style={s.cardMetaDot}>·</Text>
                <Text style={s.cardDist}>{formatDistance(dist)}</Text>
              </>
            )}
          </View>
        </View>

        {/* Status badge */}
        <View style={s.cardBadgeWrap}>
          {isActive ? (
            <View style={s.badgeLive}>
              <View style={s.badgeLiveDot} />
              <Text style={s.badgeLiveText}>{venue.occupancy || '+'} here</Text>
            </View>
          ) : isWarming ? (
            <View style={s.badgeWarm}>
              <Text style={s.badgeWarmText}>🔥 {venue.occupancy || 'few'}</Text>
            </View>
          ) : (
            <View style={s.badgeQuiet}>
              <Text style={s.badgeQuietText}>Quiet</Text>
            </View>
          )}
          <Text style={s.chevron}>›</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Styles ───────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080810' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#080810' },

  // Loading
  scanWrap: { width: 88, height: 88, justifyContent: 'center', alignItems: 'center', marginBottom: 28 },
  scanRing: { position: 'absolute', width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: '#6C63FF' },
  scanRing2: { position: 'absolute', width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: 'rgba(108,99,255,0.4)' },
  loadTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  loadSub: { color: '#555', fontSize: 14, textAlign: 'center' },

  // Error
  errIcon: { fontSize: 56, marginBottom: 20 },
  errTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  errSub: { color: '#777', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 28 },

  // Banner
  banner: { overflow: 'hidden' },
  bannerGrad: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(108,99,255,0.2)',
  },
  bannerIcon: { fontSize: 22, marginRight: 12 },
  bannerInfo: { flex: 1 },
  bannerTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  bannerSub: { color: '#6C63FF', fontSize: 12, marginTop: 1 },
  joinBtn: { backgroundColor: '#6C63FF', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginLeft: 12 },
  joinBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Stats strip
  statsStrip: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#0f0f1a',
  },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#6C63FF' },
  statLabel: { color: '#555', fontSize: 12, fontWeight: '600' },
  statDivider: { width: 1, height: 12, backgroundColor: '#1e1e2e', marginHorizontal: 12 },

  // Search
  searchWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f0f1a',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: '#1a1a2a', gap: 10,
  },
  searchBoxFocused: { borderColor: '#6C63FF', shadowColor: '#6C63FF', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  searchIco: { fontSize: 15 },
  searchInput: { flex: 1, color: '#fff', fontSize: 14 },
  searchClear: { color: '#444', fontSize: 14, paddingHorizontal: 4 },
  recentRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10, paddingLeft: 4 },
  recentLabel: { color: '#333', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  recentChip: { backgroundColor: '#0f0f1a', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#1e1e2e' },
  recentChipText: { color: '#666', fontSize: 12 },

  // Section header
  sectionHeader: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.2 },
  sectionSub: { color: '#444', fontSize: 13, marginTop: 2 },

  // List
  list: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 40, gap: 10 },

  // Card
  card: {
    backgroundColor: '#0d0d18', borderRadius: 18, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#1a1a28',
  },
  cardLive: {
    borderColor: 'rgba(34,197,94,0.25)',
    shadowColor: '#22C55E', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 5,
  },
  cardWarm: {
    borderColor: 'rgba(245,158,11,0.2)',
    shadowColor: '#F59E0B', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  accentBar: { width: 4, alignSelf: 'stretch' },
  iconWrap: { width: 46, height: 46, borderRadius: 13, justifyContent: 'center', alignItems: 'center', marginLeft: 12 },
  iconEmoji: { fontSize: 22 },
  cardInfo: { flex: 1, paddingHorizontal: 12, paddingVertical: 14, minWidth: 0 },
  cardName: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardCat: { fontSize: 12, fontWeight: '600' },
  cardMetaDot: { color: '#333', fontSize: 12 },
  cardDist: { color: '#555', fontSize: 12 },

  // Badges
  cardBadgeWrap: { flexDirection: 'row', alignItems: 'center', paddingRight: 14, gap: 8 },
  badgeLive: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(34,197,94,0.12)', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(34,197,94,0.25)',
  },
  badgeLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E' },
  badgeLiveText: { color: '#22C55E', fontSize: 12, fontWeight: '700' },
  badgeWarm: {
    backgroundColor: 'rgba(245,158,11,0.12)', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)',
  },
  badgeWarmText: { color: '#F59E0B', fontSize: 12, fontWeight: '700' },
  badgeQuiet: {
    backgroundColor: '#0f0f1a', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1, borderColor: '#1e1e2e',
  },
  badgeQuietText: { color: '#333', fontSize: 12, fontWeight: '500' },
  chevron: { color: '#2a2a3a', fontSize: 20, fontWeight: '700' },

  // Empty
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyIco: { fontSize: 60, marginBottom: 20 },
  emptyTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  emptySub: { color: '#555', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 32 },

  // Button
  btn: {
    backgroundColor: '#6C63FF', paddingHorizontal: 28, paddingVertical: 14,
    borderRadius: 24, shadowColor: '#6C63FF', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15, letterSpacing: 0.3 },
});
