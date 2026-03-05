/**
 * LOCI API client
 * All calls go through https://loci.netsudo.com/api/v1
 */

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://loci.netsudo.com/api/v1';

let _token: string | null = null;

export function setToken(token: string) {
  _token = token;
}

async function request<T>(
  method: string,
  path: string,
  body?: object
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) throw { status: res.status, ...data };
  return data as T;
}

// ── Auth ─────────────────────────────────────────────────
export const auth = {
  anonymous: (deviceId: string) =>
    request<{ token: string; refresh_token: string; user: LociUser }>(
      'POST', '/auth/anonymous', { device_id: deviceId }
    ),
  register: (email: string, password: string, displayName?: string) =>
    request<{ token: string; user: LociUser }>(
      'POST', '/auth/register', { email, password, display_name: displayName }
    ),
  login: (email: string, password: string) =>
    request<{ token: string; refresh_token: string; user: LociUser }>(
      'POST', '/auth/login', { email, password }
    ),
};

// ── Presence ─────────────────────────────────────────────
export const presence = {
  check: (lat: number, lng: number, accuracyM?: number) =>
    request<PresenceResult>('POST', '/presence/check', {
      latitude: lat,
      longitude: lng,
      accuracy_meters: accuracyM,
    }),
  leave: (venueId: string) =>
    request<{ success: boolean }>('DELETE', '/presence/leave', { venue_id: venueId }),
};

// ── Venues ───────────────────────────────────────────────
export const venues = {
  nearby: (lat: number, lng: number, radius = 500) =>
    request<{ venues: Venue[] }>('GET', `/venues/nearby?lat=${lat}&lng=${lng}&radius=${radius}`),
  get: (id: string) =>
    request<Venue>('GET', `/venues/${id}`),
};

// ── Rooms ────────────────────────────────────────────────
export const rooms = {
  get: (roomId: string) =>
    request<Room>('GET', `/rooms/${roomId}`),
  join: (roomId: string, displayName?: string) =>
    request<JoinResult>('POST', `/rooms/${roomId}/join`, { session_display_name: displayName }),
  leave: (roomId: string) =>
    request<{ success: boolean }>('DELETE', `/rooms/${roomId}/leave`),
  members: (roomId: string) =>
    request<{ members: RoomMember[]; total: number }>('GET', `/rooms/${roomId}/members`),
};

// ── Messages ─────────────────────────────────────────────
export const messages = {
  list: (roomId: string, limit = 50) =>
    request<{ messages: Message[]; has_more: boolean }>(
      'GET', `/messages/${roomId}?limit=${limit}`
    ),
  send: (roomId: string, content: string) =>
    request<Message>('POST', `/messages/${roomId}`, { content }),
  report: (roomId: string, messageId: string, reason: string) =>
    request<{ success: boolean }>('POST', `/messages/${roomId}/${messageId}/report`, { reason }),
};

// ── Users ────────────────────────────────────────────────
export const me = {
  get: () => request<LociUser>('GET', '/users/me'),
  update: (data: { display_name?: string }) => request<LociUser>('PATCH', '/users/me', data),
};

// ── Types ────────────────────────────────────────────────
export interface LociUser {
  id: string;
  display_name: string;
  is_anonymous: boolean;
  is_premium: boolean;
  created_at: string;
}

export interface Venue {
  id: string;
  name: string;
  address: string;
  category: string;
  is_partner: boolean;
  room_status: 'inactive' | 'warming' | 'active' | 'cooling';
  occupancy: number;
  welcome_message?: string;
}

export interface Room {
  id: string;
  venue_id: string;
  status: string;
  occupancy: number;
  activated_at: string;
}

export interface JoinResult {
  room: Room;
  member: { id: string; display_name: string };
  realtime_channel: string;
  supabase_url: string;
}

export interface Message {
  id: string;
  content: string;
  created_at: string;
  moderation_status: string;
  user?: { id: string; display_name: string; is_anonymous: boolean };
}

export interface RoomMember {
  id: string;
  display_name: string;
  is_anonymous: boolean;
  joined_at: string;
}

export interface PresenceResult {
  is_present: boolean;
  venue: Venue | null;
  confidence: number;
  verification_method: string;
  room_id: string | null;
}
