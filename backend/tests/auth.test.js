'use strict';

jest.mock('../src/utils/supabase');
jest.mock('openai');

const request = require('supertest');
const app = require('../src/app');
const { supabase, supabaseAdmin } = require('../src/utils/supabase');

const BASE = '/api/v1/auth';

const mockLociUser = {
  id: 'user-uuid-123',
  auth_id: 'auth-uuid-123',
  is_anonymous: false,
  display_name: 'TestUser',
  is_banned: false,
  is_premium: false,
  created_at: new Date().toISOString(),
};

const mockAnonLociUser = {
  ...mockLociUser,
  id: 'anon-uuid-456',
  auth_id: 'anon-auth-456',
  is_anonymous: true,
  display_name: 'User4512',
};

beforeEach(() => jest.clearAllMocks());

// ── POST /auth/anonymous ──────────────────────────────────
describe('POST /auth/anonymous', () => {
  it('creates an anonymous session', async () => {
    supabase.auth.signInAnonymously.mockResolvedValueOnce({
      data: {
        user: { id: 'anon-auth-456' },
        session: { access_token: 'anon-token', refresh_token: 'anon-refresh' },
      },
      error: null,
    });

    supabaseAdmin.from.mockImplementationOnce(() => ({
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValueOnce({ data: mockAnonLociUser, error: null }),
    }));

    const res = await request(app)
      .post(`${BASE}/anonymous`)
      .send({ device_id: 'device-001' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBe('anon-token');
    expect(res.body.user.is_anonymous).toBe(true);
    expect(res.body.user.display_name).toBeDefined();
  });

  it('handles Supabase auth failure gracefully', async () => {
    supabase.auth.signInAnonymously.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Anonymous sign-ins are disabled' },
    });

    const res = await request(app).post(`${BASE}/anonymous`).send({});
    expect(res.status).toBe(500);
  });
});

// ── POST /auth/register ───────────────────────────────────
describe('POST /auth/register', () => {
  it('registers a named user successfully', async () => {
    supabase.auth.signUp.mockResolvedValueOnce({
      data: {
        user: { id: 'auth-uuid-123' },
        session: { access_token: 'reg-token' },
      },
      error: null,
    });

    supabaseAdmin.from.mockImplementationOnce(() => ({
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValueOnce({ data: mockLociUser, error: null }),
    }));

    const res = await request(app).post(`${BASE}/register`).send({
      email: 'test@hereya.app',
      password: 'SecurePass123!',
      display_name: 'TestUser',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.is_anonymous).toBe(false);
    expect(res.body.user.display_name).toBe('TestUser');
  });

  it('rejects invalid email', async () => {
    const res = await request(app)
      .post(`${BASE}/register`)
      .send({ email: 'not-an-email', password: 'SecurePass123!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.message).toContain('email');
  });

  it('rejects password shorter than 8 chars', async () => {
    const res = await request(app)
      .post(`${BASE}/register`)
      .send({ email: 'test@hereya.app', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('rejects missing email', async () => {
    const res = await request(app)
      .post(`${BASE}/register`)
      .send({ password: 'SecurePass123!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when Supabase auth rejects signup', async () => {
    supabase.auth.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Email already registered' },
    });

    const res = await request(app).post(`${BASE}/register`).send({
      email: 'taken@hereya.app',
      password: 'SecurePass123!',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('AUTH_ERROR');
  });
});

// ── POST /auth/login ──────────────────────────────────────
describe('POST /auth/login', () => {
  it('logs in with valid credentials', async () => {
    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: {
        user: { id: 'auth-uuid-123' },
        session: { access_token: 'login-token', refresh_token: 'login-refresh' },
      },
      error: null,
    });

    supabaseAdmin.from.mockImplementationOnce(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValueOnce({ data: mockLociUser, error: null }),
    }));

    const res = await request(app).post(`${BASE}/login`).send({
      email: 'test@hereya.app',
      password: 'SecurePass123!',
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBe('login-token');
    expect(res.body.refresh_token).toBe('login-refresh');
    expect(res.body.user.display_name).toBe('TestUser');
  });

  it('rejects invalid credentials', async () => {
    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });

    const res = await request(app).post(`${BASE}/login`).send({
      email: 'test@hereya.app',
      password: 'WrongPass!',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('rejects missing password', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: 'test@hereya.app' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('rejects missing email', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ password: 'SomePass123!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});

// ── Auth middleware ───────────────────────────────────────
describe('Auth middleware', () => {
  it('rejects requests with no token', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('rejects requests with malformed bearer token', async () => {
    supabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Invalid token' },
    });
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer bad.token.here');
    expect(res.status).toBe(401);
  });

  it('rejects banned users', async () => {
    supabase.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'auth-uuid-123' } },
      error: null,
    });
    // auth.js uses supabase (public client) for user lookup
    supabase.from.mockImplementationOnce(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValueOnce({
        data: { ...mockLociUser, is_banned: true },
        error: null,
      }),
    }));

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer some-token');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('USER_BANNED');
  });
});
