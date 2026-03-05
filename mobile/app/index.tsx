/**
 * LOCI — Home Screen
 * Detects location → checks presence → shows nearby venues or drops you into a room.
 */

import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocation } from '../lib/useLocation';
import * as api from '../lib/api';
import type { Venue, PresenceResult } from '../lib/api';

const TOKEN_KEY = '@loci_token';

export default function HomeScreen() {
  const location = useLocation(30_000);
  const [initialized, setInitialized] = useState(false);
  const [presence, setPresence] = useState<PresenceResult | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [statusText, setStatusText] = useState('Finding your location…');

  // ── Initialize: get or create anonymous session ──────────
  useEffect(() => {
    (async () => {
      try {
        let token = await AsyncStorage.getItem(TOKEN_KEY);
        if (!token) {
          const deviceId = Math.random().toString(36).slice(2);
          const res = await api.auth.anonymous(deviceId);
          token = res.token;
          await AsyncStorage.setItem(TOKEN_KEY, token);
        }
        api.setToken(token);
        setInitialized(true);
      } catch (e) {
        setStatusText('Failed to initialize. Check your connection.');
      }
    })();
  }, []);

  // ── Check presence whenever location updates ─────────────
  useEffect(() => {
    if (!initialized || !location.latitude || !location.longitude) return;
    checkPresence();
  }, [initialized, location.latitude, location.longitude]);

  const checkPresence = async () => {
    if (!location.latitude || !location.longitude) return;
    try {
      setStatusText('Checking venue…');
      const result = await api.presence.check(
        location.latitude,
        location.longitude,
        location.accuracy ?? undefined
      );
      setPresence(result);

      if (result.is_present && result.room_id) {
        // Auto-join room if present at a venue
        setStatusText(`You're at ${result.venue?.name} — joining room…`);
        router.push(`/room/${result.room_id}`);
      } else {
        setStatusText('No active venue nearby');
        loadNearbyVenues();
      }
    } catch {
      setStatusText('Could not check venue. Retrying…');
    }
  };

  const loadNearbyVenues = async () => {
    if (!location.latitude || !location.longitude) return;
    try {
      const res = await api.venues.nearby(location.latitude, location.longitude, 1000);
      setVenues(res.venues);
      if (res.venues.length > 0) {
        setStatusText(`${res.venues.length} venue${res.venues.length > 1 ? 's' : ''} nearby`);
      } else {
        setStatusText('No venues found nearby');
      }
    } catch {
      setStatusText('Could not load venues');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await checkPresence();
    setRefreshing(false);
  };

  if (location.loading || !initialized) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6C63FF" />
        <Text style={styles.statusText}>{statusText}</Text>
      </View>
    );
  }

  if (location.error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>📍 {location.error}</Text>
        <Text style={styles.subText}>Please enable location to use LOCI</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Status bar */}
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>{statusText}</Text>
        {location.accuracy && (
          <Text style={styles.accuracyText}>±{Math.round(location.accuracy)}m</Text>
        )}
      </View>

      {venues.length > 0 ? (
        <FlatList
          data={venues}
          keyExtractor={(v) => v.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6C63FF" />}
          renderItem={({ item }) => <VenueCard venue={item} />}
          contentContainerStyle={styles.list}
        />
      ) : (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📍</Text>
          <Text style={styles.emptyTitle}>No venues nearby</Text>
          <Text style={styles.emptySubtext}>Walk to a bar, stadium, or event to join a live chat</Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
            <Text style={styles.refreshBtnText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function VenueCard({ venue }: { venue: Venue }) {
  const isActive = ['active', 'warming'].includes(venue.room_status);

  return (
    <View style={styles.card}>
      <View style={styles.cardLeft}>
        <Text style={styles.venueName}>{venue.name}</Text>
        <Text style={styles.venueCategory}>{venue.category}</Text>
      </View>
      <View style={styles.cardRight}>
        <View style={[styles.badge, isActive ? styles.badgeActive : styles.badgeInactive]}>
          <Text style={styles.badgeText}>
            {isActive ? `${venue.occupancy} here` : 'Empty'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  statusBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: '#222',
  },
  statusText: { color: '#aaa', fontSize: 13 },
  accuracyText: { color: '#555', fontSize: 12 },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#111', borderRadius: 12, padding: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: '#222',
  },
  cardLeft: { flex: 1 },
  cardRight: { marginLeft: 12 },
  venueName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  venueCategory: { color: '#666', fontSize: 13, marginTop: 2, textTransform: 'capitalize' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeActive: { backgroundColor: '#1a2e1a' },
  badgeInactive: { backgroundColor: '#1a1a1a' },
  badgeText: { fontSize: 12, color: '#4CAF50', fontWeight: '600' },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  emptySubtext: { color: '#666', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  refreshBtn: {
    marginTop: 24, backgroundColor: '#6C63FF',
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24,
  },
  refreshBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  errorText: { color: '#ff4444', fontSize: 16, marginBottom: 8 },
  subText: { color: '#666', fontSize: 14, textAlign: 'center' },
});
