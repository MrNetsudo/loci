/**
 * Hereya — Settings Screen
 * Profile info, display name edit, logout
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  StatusBar,
  Switch,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../lib/api';
import { useLayout } from '../lib/useLayout';

const TOKEN_KEY = '@hereya_token';
const USER_KEY = '@hereya_user';

export default function SettingsScreen() {
  const [user, setUser] = useState<api.LociUser | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const { contentPaddingH, isTablet } = useLayout();

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      if (!token) { router.replace('/auth'); return; }
      api.setToken(token);
      const u = await api.me.get();
      setUser(u);
      setDisplayName(u.display_name || '');
    } catch {
      // use cached
      const raw = await AsyncStorage.getItem(USER_KEY);
      if (raw) {
        try {
          const u = JSON.parse(raw);
          setUser(u);
          setDisplayName(u.display_name || '');
        } catch {}
      }
    } finally {
      setLoading(false);
    }
  };

  const saveName = async () => {
    if (!displayName.trim() || displayName.trim() === user?.display_name) {
      setEditingName(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await api.me.update({ display_name: displayName.trim() });
      setUser(updated);
      setDisplayName(updated.display_name);
      const raw = await AsyncStorage.getItem(USER_KEY);
      if (raw) {
        try {
          const u = JSON.parse(raw);
          await AsyncStorage.setItem(USER_KEY, JSON.stringify({ ...u, display_name: updated.display_name }));
        } catch {}
      }
      setEditingName(false);
    } catch {
      Alert.alert('Error', 'Could not update display name. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const confirmLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: logout },
      ]
    );
  };

  const logout = async () => {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, '@hereya_recent_searches']);
    router.replace('/auth');
  };

  if (loading) {
    return (
      <View style={s.center}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  const initials = (displayName || 'U').slice(0, 2).toUpperCase();
  const isAnon = user?.is_anonymous;

  return (
    <ScrollView style={s.container} contentContainerStyle={[s.content, isTablet && { paddingHorizontal: contentPaddingH }]}>
      <StatusBar barStyle="light-content" />

      {/* Avatar */}
      <View style={s.avatarSection}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{initials}</Text>
        </View>
        <Text style={s.userName}>{displayName || 'Anonymous'}</Text>
        {isAnon && <View style={s.anonBadge}><Text style={s.anonBadgeText}>Anonymous</Text></View>}
        {!isAnon && user?.email_verified && (
          <View style={s.verifiedBadge}><Text style={s.verifiedBadgeText}>✓ Verified</Text></View>
        )}
      </View>

      {/* Profile Section */}
      <View style={s.section}>
        <Text style={s.sectionLabel}>PROFILE</Text>

        <View style={s.card}>
          {/* Display Name */}
          <View style={s.row}>
            <View style={s.rowLeft}>
              <Text style={s.rowIcon}>👤</Text>
              <View>
                <Text style={s.rowLabel}>Display Name</Text>
                {editingName ? (
                  <TextInput
                    style={s.nameInput}
                    value={displayName}
                    onChangeText={setDisplayName}
                    autoFocus
                    maxLength={32}
                    placeholderTextColor="#555"
                    returnKeyType="done"
                    onSubmitEditing={saveName}
                  />
                ) : (
                  <Text style={s.rowValue}>{displayName || '—'}</Text>
                )}
              </View>
            </View>
            {editingName ? (
              <View style={s.editActions}>
                <TouchableOpacity onPress={() => { setEditingName(false); setDisplayName(user?.display_name || ''); }}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.saveBtn} onPress={saveName} disabled={saving}>
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.saveBtnText}>Save</Text>}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setEditingName(true)}>
                <Text style={s.editText}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={s.divider} />

          {/* Account Type */}
          <View style={s.row}>
            <View style={s.rowLeft}>
              <Text style={s.rowIcon}>🔒</Text>
              <View>
                <Text style={s.rowLabel}>Account Type</Text>
                <Text style={s.rowValue}>{isAnon ? 'Anonymous' : 'Verified'}</Text>
              </View>
            </View>
            {isAnon && (
              <TouchableOpacity onPress={() => router.replace('/auth')}>
                <Text style={s.editText}>Upgrade</Text>
              </TouchableOpacity>
            )}
          </View>

          {!isAnon && (
            <>
              <View style={s.divider} />
              <View style={s.row}>
                <View style={s.rowLeft}>
                  <Text style={s.rowIcon}>✉️</Text>
                  <View>
                    <Text style={s.rowLabel}>Member Since</Text>
                    <Text style={s.rowValue}>
                      {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—'}
                    </Text>
                  </View>
                </View>
              </View>
            </>
          )}
        </View>
      </View>

      {/* App Section */}
      <View style={s.section}>
        <Text style={s.sectionLabel}>APP</Text>
        <View style={s.card}>
          <View style={s.row}>
            <View style={s.rowLeft}>
              <Text style={s.rowIcon}>📍</Text>
              <View>
                <Text style={s.rowLabel}>Launch Area</Text>
                <Text style={s.rowValue}>Rhode Island · MA · CT</Text>
              </View>
            </View>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <View style={s.rowLeft}>
              <Text style={s.rowIcon}>🏟️</Text>
              <View>
                <Text style={s.rowLabel}>Venues Available</Text>
                <Text style={s.rowValue}>11,000+ locations</Text>
              </View>
            </View>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <View style={s.rowLeft}>
              <Text style={s.rowIcon}>⚡</Text>
              <View>
                <Text style={s.rowLabel}>Version</Text>
                <Text style={s.rowValue}>0.1.0 · Beta</Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* Sign Out */}
      <View style={s.section}>
        <TouchableOpacity style={s.logoutBtn} onPress={confirmLogout} activeOpacity={0.8}>
          <Text style={s.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.footer}>Hereya · You have to be here ⚡</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080810' },
  content: { paddingBottom: 48 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#080810' },

  avatarSection: { alignItems: 'center', paddingTop: 32, paddingBottom: 24 },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(108,99,255,0.2)',
    borderWidth: 2, borderColor: '#6C63FF',
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  avatarText: { color: '#6C63FF', fontSize: 32, fontWeight: '800' },
  userName: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 8 },
  anonBadge: {
    backgroundColor: 'rgba(255,255,255,0.07)', paddingHorizontal: 14,
    paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: '#2a2a3a',
  },
  anonBadgeText: { color: '#666', fontSize: 12, fontWeight: '600' },
  verifiedBadge: {
    backgroundColor: 'rgba(34,197,94,0.1)', paddingHorizontal: 14,
    paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)',
  },
  verifiedBadgeText: { color: '#22C55E', fontSize: 12, fontWeight: '600' },

  section: { paddingHorizontal: 16, marginBottom: 24 },
  sectionLabel: {
    color: '#444', fontSize: 11, fontWeight: '700',
    letterSpacing: 1.5, marginBottom: 10, paddingLeft: 4,
  },

  card: {
    backgroundColor: '#0d0d18', borderRadius: 18,
    borderWidth: 1, borderColor: '#1a1a28', overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 16,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  rowIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  rowLabel: { color: '#666', fontSize: 12, fontWeight: '600', marginBottom: 3 },
  rowValue: { color: '#ccc', fontSize: 15, fontWeight: '500' },
  divider: { height: 1, backgroundColor: '#1a1a28', marginLeft: 60 },

  nameInput: {
    color: '#fff', fontSize: 15, fontWeight: '500',
    borderBottomWidth: 1, borderBottomColor: '#6C63FF',
    paddingBottom: 2, minWidth: 140,
  },
  editActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  editText: { color: '#6C63FF', fontSize: 14, fontWeight: '600' },
  cancelText: { color: '#555', fontSize: 14 },
  saveBtn: {
    backgroundColor: '#6C63FF', paddingHorizontal: 14,
    paddingVertical: 7, borderRadius: 12,
  },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  logoutBtn: {
    backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)', borderRadius: 16,
    paddingVertical: 16, alignItems: 'center',
  },
  logoutText: { color: '#EF4444', fontSize: 16, fontWeight: '700' },

  footer: { color: '#222', fontSize: 12, textAlign: 'center', marginTop: 8 },
});
