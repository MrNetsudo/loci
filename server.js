'use strict';
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = 3000;
app.set('trust proxy', 1);

const pool = new Pool({
  host: process.env.DB_HOST || 'netsudo-postgres',
  database: process.env.DB_NAME || 'netsudo',
  user: process.env.DB_USER || 'netsudo',
  password: process.env.DB_PASSWORD || 'NetSudo2026!',
  port: 5432,
});

// ── DB Init ───────────────────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP`);
  await pool.query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255)`);
  await pool.query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false`);
  await pool.query(`CREATE TABLE IF NOT EXISTS login_attempts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255),
    ip VARCHAR(45),
    success BOOLEAN,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  console.log('✓ DB schema ready');
}
initDB().catch(e => console.error('DB init error:', e.message));

// ── Telegram ──────────────────────────────────────────────────────────────────
async function sendTelegram(message) {
  const token = '8756428509:AAFKeyQFaEVfOHJO0fM7fz-7t7EFvI9JCaA';
  const chatId = '7067505491';
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.error('Telegram failed:', e.message);
  }
}

// ── Rate Limiters ─────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Helmet ────────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    }
  },
  crossOriginEmbedderPolicy: false
}));

// ── Middleware ────────────────────────────────────────────────────────────────
app.use('/admin', express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-in-production-32-char-min',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

// ── Auth Guards ───────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.path.startsWith('/admin/api')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/admin/login');
}
function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'superadmin') return next();
  if (req.path.startsWith('/admin/api')) return res.status(403).json({ error: 'Forbidden' });
  res.redirect('/admin/dashboard');
}

// ── HTML Routes ───────────────────────────────────────────────────────────────
const v = (f) => path.join(__dirname, 'views', f);

app.get('/admin', (req, res) => res.redirect(req.session?.user ? '/admin/dashboard' : '/admin/login'));

app.get('/admin/login', (req, res) => {
  if (req.session?.user) return res.redirect('/admin/dashboard');
  res.sendFile(v('login.html'));
});

app.post('/admin/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || '';

  try {
    const r = await pool.query('SELECT * FROM admin_users WHERE username=$1', [username]);
    if (!r.rows.length) {
      await pool.query(
        'INSERT INTO login_attempts (username, ip, success, user_agent) VALUES ($1,$2,$3,$4)',
        [username, ip, false, userAgent]
      );
      return res.redirect('/admin/login?error=1');
    }

    const user = r.rows[0];

    // Check lockout
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remaining = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      await pool.query(
        'INSERT INTO login_attempts (username, ip, success, user_agent) VALUES ($1,$2,$3,$4)',
        [username, ip, false, userAgent]
      );
      return res.redirect(`/admin/login?error=locked&remaining=${remaining}`);
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      const newAttempts = (user.failed_attempts || 0) + 1;
      if (newAttempts >= 5) {
        await pool.query(
          `UPDATE admin_users SET failed_attempts=$1, locked_until=NOW()+interval '15 minutes' WHERE id=$2`,
          [newAttempts, user.id]
        );
        await sendTelegram(`🚨 Admin lockout: ${username} locked after 5 failed attempts from IP ${ip}`);
      } else {
        await pool.query('UPDATE admin_users SET failed_attempts=$1 WHERE id=$2', [newAttempts, user.id]);
      }
      await pool.query(
        'INSERT INTO login_attempts (username, ip, success, user_agent) VALUES ($1,$2,$3,$4)',
        [username, ip, false, userAgent]
      );
      return res.redirect('/admin/login?error=1');
    }

    // Password OK — reset lockout counters
    await pool.query(
      'UPDATE admin_users SET last_login=NOW(), failed_attempts=0, locked_until=NULL WHERE id=$1',
      [user.id]
    );
    await pool.query(
      'INSERT INTO login_attempts (username, ip, success, user_agent) VALUES ($1,$2,$3,$4)',
      [username, ip, true, userAgent]
    );

    // 2FA check
    if (user.totp_enabled && user.totp_secret) {
      req.session.pendingUser = { id: user.id, username: user.username, role: user.role };
      req.session.twoFactorAttempts = 0;
      return res.redirect('/admin/2fa');
    }

    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.redirect('/admin/dashboard');
  } catch (e) {
    console.error(e);
    res.redirect('/admin/login?error=1');
  }
});

// ── 2FA Routes ────────────────────────────────────────────────────────────────
app.get('/admin/2fa', (req, res) => {
  if (!req.session.pendingUser) return res.redirect('/admin/login');
  res.sendFile(path.join(__dirname, 'public', '2fa.html'));
});

app.post('/admin/2fa', async (req, res) => {
  if (!req.session.pendingUser) return res.redirect('/admin/login');
  const { token } = req.body;
  const { id } = req.session.pendingUser;

  try {
    const r = await pool.query('SELECT totp_secret, totp_enabled FROM admin_users WHERE id=$1', [id]);
    if (!r.rows.length) {
      req.session.destroy();
      return res.redirect('/admin/login');
    }
    const { totp_secret, totp_enabled } = r.rows[0];

    const verified = speakeasy.totp.verify({
      secret: totp_secret,
      encoding: 'base32',
      token: (token || '').trim(),
      window: 1,
    });

    if (!verified) {
      req.session.twoFactorAttempts = (req.session.twoFactorAttempts || 0) + 1;
      if (req.session.twoFactorAttempts >= 3) {
        req.session.destroy();
        return res.redirect('/admin/login?error=2fa_exceeded');
      }
      return res.redirect('/admin/2fa?error=1');
    }

    // Promote to full session
    req.session.user = req.session.pendingUser;
    delete req.session.pendingUser;
    delete req.session.twoFactorAttempts;
    res.redirect('/admin/dashboard');
  } catch (e) {
    console.error(e);
    res.redirect('/admin/2fa?error=1');
  }
});

app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });
app.get('/admin/dashboard', requireAuth, (req, res) => res.sendFile(v('dashboard.html')));
app.get('/admin/pipeline', requireAuth, (req, res) => res.sendFile(v('pipeline.html')));
app.get('/admin/contacts', requireAuth, (req, res) => res.sendFile(v('contacts.html')));
app.get('/admin/contacts/:id', requireAuth, (req, res) => res.sendFile(v('contact-detail.html')));
app.get('/admin/users', requireAuth, requireSuperAdmin, (req, res) => res.sendFile(v('users.html')));
app.get('/admin/settings', requireAuth, (req, res) => res.sendFile(v('settings.html')));

// ── API: Me ───────────────────────────────────────────────────────────────────
app.get('/admin/api/me', requireAuth, (req, res) => res.json(req.session.user));

// ── API: Stats ────────────────────────────────────────────────────────────────
app.get('/admin/api/stats', requireAuth, async (req, res) => {
  try {
    const [total, week, month, won, byStage, recent] = await Promise.all([
      pool.query('SELECT COUNT(*)::int FROM contacts'),
      pool.query("SELECT COUNT(*)::int FROM contacts WHERE created_at>=NOW()-INTERVAL '7 days'"),
      pool.query("SELECT COUNT(*)::int FROM contacts WHERE created_at>=NOW()-INTERVAL '30 days'"),
      pool.query("SELECT COUNT(*)::int FROM contacts WHERE stage='Closed Won'"),
      pool.query("SELECT COALESCE(stage,'New') AS stage, COUNT(*)::int AS count FROM contacts GROUP BY stage ORDER BY count DESC"),
      pool.query('SELECT id,name,email,company,stage,tag,created_at FROM contacts ORDER BY created_at DESC LIMIT 5'),
    ]);
    res.json({
      total: total.rows[0].count,
      thisWeek: week.rows[0].count,
      thisMonth: month.rows[0].count,
      closedWon: won.rows[0].count,
      byStage: byStage.rows,
      recent: recent.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Activity ─────────────────────────────────────────────────────────────
app.get('/admin/api/activity', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT al.*, c.name AS contact_name, c.email AS contact_email
      FROM activity_log al LEFT JOIN contacts c ON al.contact_id=c.id
      ORDER BY al.created_at DESC LIMIT 50`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Contacts ─────────────────────────────────────────────────────────────
app.get('/admin/api/contacts', requireAuth, async (req, res) => {
  const { stage, tag, search, limit = 500, offset = 0 } = req.query;
  let q = 'SELECT * FROM contacts WHERE 1=1';
  const p = [];
  if (stage) { p.push(stage); q += ` AND stage=$${p.length}`; }
  if (tag)   { p.push(tag);   q += ` AND tag=$${p.length}`; }
  if (search) {
    p.push(`%${search}%`);
    const n = p.length;
    q += ` AND (name ILIKE $${n} OR email ILIKE $${n} OR company ILIKE $${n})`;
  }
  q += ` ORDER BY created_at DESC LIMIT $${p.length+1} OFFSET $${p.length+2}`;
  p.push(limit, offset);
  try {
    const r = await pool.query(q, p);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /admin/api/contacts — public endpoint (website form) or authed
app.post('/admin/api/contacts', async (req, res) => {
  const { name, email, company, phone, stage = 'New', tag = 'lead', notes, source = 'manual', message } = req.body;
  const notesVal = notes || message || null;
  try {
    const r = await pool.query(
      `INSERT INTO contacts (name,email,company,phone,stage,tag,notes,source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name||null, email, company||null, phone||null, stage, tag, notesVal, source]
    );
    const contact = r.rows[0];
    const actor = req.session?.user?.username || 'website';
    await pool.query(
      `INSERT INTO activity_log (contact_id,admin_user,action,detail) VALUES ($1,$2,$3,$4)`,
      [contact.id, actor, 'created', `Contact created from ${source}`]
    );
    if (source === 'website') {
      const msg = `🔔 <b>New Lead — NetSudo</b>\n\n👤 <b>Name:</b> ${name||'N/A'}\n📧 <b>Email:</b> ${email}\n🏢 <b>Company:</b> ${company||'N/A'}\n📝 <b>Message:</b> ${notesVal||'N/A'}\n\nView: https://netsudo.com/admin/contacts/${contact.id}`;
      await sendTelegram(msg);
      return res.json({ success: true, contact });
    }
    res.json(contact);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

// Export CSV — MUST be before /:id
app.get('/admin/api/contacts/export/csv', requireAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT id,name,email,company,phone,stage,tag,source,notes,created_at FROM contacts ORDER BY created_at DESC');
    const hdr = ['ID','Name','Email','Company','Phone','Stage','Tag','Source','Notes','Created'];
    const rows = r.rows.map(c => [
      c.id, c.name||'', c.email, c.company||'', c.phone||'',
      c.stage||'', c.tag||'', c.source||'',
      (c.notes||'').replace(/[\r\n,]/g,' '),
      c.created_at ? new Date(c.created_at).toISOString() : ''
    ]);
    const csv = [hdr, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/api/contacts/:id', requireAuth, async (req, res) => {
  try {
    const c = await pool.query('SELECT * FROM contacts WHERE id=$1', [req.params.id]);
    if (!c.rows.length) return res.status(404).json({ error: 'Not found' });
    const a = await pool.query('SELECT * FROM activity_log WHERE contact_id=$1 ORDER BY created_at DESC LIMIT 50', [req.params.id]);
    res.json({ ...c.rows[0], activity: a.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/admin/api/contacts/:id', requireAuth, async (req, res) => {
  const { name, email, company, phone, stage, tag, notes } = req.body;
  try {
    const old = await pool.query('SELECT stage FROM contacts WHERE id=$1', [req.params.id]);
    const r = await pool.query(
      `UPDATE contacts SET name=$1,email=$2,company=$3,phone=$4,stage=$5,tag=$6,notes=$7,updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [name||null, email, company||null, phone||null, stage, tag, notes||null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    await pool.query(
      `INSERT INTO activity_log (contact_id,admin_user,action,detail) VALUES ($1,$2,$3,$4)`,
      [req.params.id, req.session.user.username, 'updated', 'Contact details updated']
    );
    if (stage === 'Closed Won' && old.rows[0]?.stage !== 'Closed Won') {
      const c = r.rows[0];
      await sendTelegram(`🎉 <b>Closed Won — NetSudo</b>\n\n👤 <b>Name:</b> ${c.name}\n📧 <b>Email:</b> ${c.email}\n🏢 <b>Company:</b> ${c.company||'N/A'}\n\nView: https://netsudo.com/admin/contacts/${c.id}`);
    }
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/admin/api/contacts/:id', requireAuth, async (req, res) => {
  try {
    const c = await pool.query('SELECT name, email FROM contacts WHERE id=$1', [req.params.id]);
    await pool.query('DELETE FROM contacts WHERE id=$1', [req.params.id]);
    await pool.query(
      `INSERT INTO activity_log (contact_id,admin_user,action,detail) VALUES ($1,$2,$3,$4)`,
      [req.params.id, req.session.user.username, 'deleted', `Contact deleted: ${c.rows[0]?.name || 'unknown'}`]
    ).catch(() => {}); // contact is gone, log may fail FK — that's ok
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/admin/api/contacts/:id/stage', requireAuth, async (req, res) => {
  const { stage } = req.body;
  try {
    const old = await pool.query('SELECT stage FROM contacts WHERE id=$1', [req.params.id]);
    const r = await pool.query(`UPDATE contacts SET stage=$1,updated_at=NOW() WHERE id=$2 RETURNING *`, [stage, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    await pool.query(
      `INSERT INTO activity_log (contact_id,admin_user,action,detail) VALUES ($1,$2,$3,$4)`,
      [req.params.id, req.session.user.username, 'stage_changed', `Stage → ${stage}`]
    );
    if (stage === 'Closed Won' && old.rows[0]?.stage !== 'Closed Won') {
      const c = r.rows[0];
      await sendTelegram(`🎉 <b>Closed Won — NetSudo</b>\n\n👤 <b>Name:</b> ${c.name}\n📧 <b>Email:</b> ${c.email}\n🏢 <b>Company:</b> ${c.company||'N/A'}\n\nView: https://netsudo.com/admin/contacts/${c.id}`);
    }
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/api/contacts/:id/note', requireAuth, async (req, res) => {
  const { note } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: 'Note cannot be empty' });
  try {
    await pool.query(
      `INSERT INTO activity_log (contact_id,admin_user,action,detail) VALUES ($1,$2,$3,$4)`,
      [req.params.id, req.session.user.username, 'note', note.trim()]
    );
    const r = await pool.query('SELECT * FROM activity_log WHERE contact_id=$1 ORDER BY created_at DESC LIMIT 50', [req.params.id]);
    res.json({ success: true, activity: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/api/contacts/:id/email', requireAuth, async (req, res) => {
  const { subject } = req.body;
  try {
    await pool.query(
      `INSERT INTO activity_log (contact_id,admin_user,action,detail) VALUES ($1,$2,$3,$4)`,
      [req.params.id, req.session.user.username, 'email', `Email stub: ${subject||'(no subject)'}`]
    );
    res.json({ success: true, message: 'Email feature coming soon — action logged.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Users ────────────────────────────────────────────────────────────────
app.get('/admin/api/users', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT id,username,role,created_at,last_login FROM admin_users ORDER BY created_at DESC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/api/users', requireAuth, requireSuperAdmin, async (req, res) => {
  const { username, password, role = 'admin' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO admin_users (username,password_hash,role) VALUES ($1,$2,$3) RETURNING id,username,role,created_at`,
      [username, hash, role]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/admin/api/users/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const { username, role, password } = req.body;
  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE admin_users SET username=$1,role=$2,password_hash=$3 WHERE id=$4', [username, role, hash, req.params.id]);
    } else {
      await pool.query('UPDATE admin_users SET username=$1,role=$2 WHERE id=$3', [username, role, req.params.id]);
    }
    const r = await pool.query('SELECT id,username,role,created_at,last_login FROM admin_users WHERE id=$1', [req.params.id]);
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/admin/api/users/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) return res.status(400).json({ error: "Can't delete your own account" });
  try {
    await pool.query('DELETE FROM admin_users WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Settings ─────────────────────────────────────────────────────────────
app.post('/admin/api/settings/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const r = await pool.query('SELECT password_hash FROM admin_users WHERE id=$1', [req.session.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    const ok = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE admin_users SET password_hash=$1 WHERE id=$2', [hash, req.session.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: 2FA Settings ─────────────────────────────────────────────────────────
app.get('/admin/settings/2fa', requireAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT totp_enabled, totp_secret FROM admin_users WHERE id=$1', [req.session.user.id]);
    const user = r.rows[0];

    if (user.totp_enabled) {
      return res.json({ enabled: true });
    }

    // Generate a new temp secret and store it temporarily in session
    const secret = speakeasy.generateSecret({ name: `NetSudo (${req.session.user.username})`, length: 20 });
    req.session.pendingTotpSecret = secret.base32;

    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ enabled: false, secret: secret.base32, qr: qrDataUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/settings/2fa/enable', requireAuth, async (req, res) => {
  const { token } = req.body;
  const secret = req.session.pendingTotpSecret;
  if (!secret) return res.status(400).json({ error: 'No pending 2FA setup. Please refresh.' });

  const verified = speakeasy.totp.verify({ secret, encoding: 'base32', token: (token || '').trim(), window: 1 });
  if (!verified) return res.status(400).json({ error: 'Invalid code. Try again.' });

  try {
    await pool.query('UPDATE admin_users SET totp_secret=$1, totp_enabled=true WHERE id=$2', [secret, req.session.user.id]);
    delete req.session.pendingTotpSecret;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/settings/2fa/disable', requireAuth, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required to disable 2FA' });

  try {
    const r = await pool.query('SELECT password_hash FROM admin_users WHERE id=$1', [req.session.user.id]);
    const ok = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!ok) return res.status(400).json({ error: 'Incorrect password' });

    await pool.query('UPDATE admin_users SET totp_secret=NULL, totp_enabled=false WHERE id=$1', [req.session.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Login Attempts (audit) ────────────────────────────────────────────────
app.get('/admin/api/login-attempts', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM login_attempts ORDER BY created_at DESC LIMIT 100');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Loci Beta Signups ─────────────────────────────────────────────────────────
app.post("/admin/loci/signup", async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: "Name and email required" });
  try {
    const result = await pool.query(
      `INSERT INTO contacts (name, email, source, tag, stage, notes)
       VALUES ($1, $2, 'loci-beta', 'lead', 'New', 'Loci beta signup')
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()
       RETURNING id`,
      [name.trim(), email.trim().toLowerCase()]
    );
    const id = result.rows[0].id;
    await sendTelegram(`🚀 New Loci Beta Signup!\n\n👤 ${name}\n📧 ${email}\n\nhttps://netsudo.com/admin/contacts/${id}`);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Signup failed" });
  }
});

// ── Loci QR URL storage ───────────────────────────────────────────────────────
let lociQrUrl = null;

app.post("/admin/loci/qr", (req, res) => {
  const { url, secret } = req.body;
  if (secret !== "LociQR2026!") return res.status(401).json({ error: "Unauthorized" });
  lociQrUrl = url;
  console.log("Loci QR URL updated:", url);
  res.json({ ok: true, url });
});

app.get("/admin/loci/qr", (req, res) => {
  res.json({ url: lociQrUrl });
});


// ── CEO Dashboard Route ───────────────────────────────────────────────────────
app.get('/admin/ceo', requireAuth, (req, res) => res.sendFile(v('ceo.html')));

// ── API: CEO Stats ────────────────────────────────────────────────────────────
app.get('/admin/api/ceo/stats', requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
    const [monthRev, lastMonthRev, mrr, pipeline, dailyRev, clients] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(amount),0)::float AS total FROM revenue WHERE date >= $1 AND status='paid'`, [monthStart]),
      pool.query(`SELECT COALESCE(SUM(amount),0)::float AS total FROM revenue WHERE date >= $1 AND date <= $2 AND status='paid'`, [lastMonthStart, lastMonthEnd]),
      pool.query(`SELECT COALESCE(SUM(amount),0)::float AS total FROM revenue WHERE type='recurring' AND status='paid'`),
      pool.query(`SELECT COALESCE(SUM(COALESCE(value,0)),0)::float AS total, COUNT(*)::int AS count FROM contacts WHERE stage IN ('Contacted','In Conversation','Proposal Sent') AND value > 0`),
      pool.query(`SELECT date::text, COALESCE(SUM(amount),0)::float AS total FROM revenue WHERE date >= $1 AND status='paid' GROUP BY date ORDER BY date`, [monthStart]),
      pool.query(`SELECT c.id, c.name, c.company, c.stage, c.updated_at, al.created_at AS last_activity FROM contacts c LEFT JOIN LATERAL (SELECT created_at FROM activity_log WHERE contact_id=c.id ORDER BY created_at DESC LIMIT 1) al ON true WHERE c.stage IN ('Closed Won','Active Client','Client') ORDER BY al.created_at DESC NULLS LAST LIMIT 20`),
    ]);
    const monthTotal = parseFloat(monthRev.rows[0].total);
    const lastMonthTotal = parseFloat(lastMonthRev.rows[0].total);
    const mrrTotal = parseFloat(mrr.rows[0].total);
    const pipelineTotal = parseFloat(pipeline.rows[0].total);
    const pipelineCount = pipeline.rows[0].count;
    const goal = 50000;
    const pctChange = lastMonthTotal === 0 ? null : ((monthTotal - lastMonthTotal) / lastMonthTotal * 100).toFixed(1);
    res.json({
      monthRevenue: monthTotal, lastMonthRevenue: lastMonthTotal, pctChange,
      mrr: mrrTotal, pipeline: pipelineTotal, pipelineCount, goal,
      goalProgress: goal > 0 ? Math.min(100, (mrrTotal / goal * 100)).toFixed(1) : 0,
      dailyRevenue: dailyRev.rows, activeClients: clients.rows,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── API: Revenue CRUD ─────────────────────────────────────────────────────────
app.get('/admin/api/revenue', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(`SELECT rv.*, c.name AS contact_name, p.name AS project_name FROM revenue rv LEFT JOIN contacts c ON rv.contact_id = c.id LEFT JOIN projects p ON rv.project_id = p.id ORDER BY rv.date DESC, rv.created_at DESC LIMIT 100`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/admin/api/revenue', requireAuth, async (req, res) => {
  const { amount, type = 'one-time', description, date, contact_id, project_id, status = 'pending' } = req.body;
  if (!amount || isNaN(parseFloat(amount))) return res.status(400).json({ error: 'Valid amount required' });
  try {
    const r = await pool.query(`INSERT INTO revenue (amount,type,description,date,contact_id,project_id,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [parseFloat(amount), type, description||null, date||new Date().toISOString().split('T')[0], contact_id||null, project_id||null, status]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/admin/api/revenue/:id', requireAuth, async (req, res) => {
  const { amount, type, description, date, contact_id, project_id, status } = req.body;
  try {
    const r = await pool.query(`UPDATE revenue SET amount=$1,type=$2,description=$3,date=$4,contact_id=$5,project_id=$6,status=$7 WHERE id=$8 RETURNING *`,
      [parseFloat(amount), type, description||null, date, contact_id||null, project_id||null, status, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/admin/api/revenue/:id', requireAuth, async (req, res) => {
  try { await pool.query('DELETE FROM revenue WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Projects CRUD ────────────────────────────────────────────────────────
app.get('/admin/api/projects', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(`SELECT p.*, c.name AS contact_name, c.company AS contact_company FROM projects p LEFT JOIN contacts c ON p.contact_id = c.id ORDER BY p.created_at DESC`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/admin/api/projects', requireAuth, async (req, res) => {
  const { name, contact_id, status = 'active', value = 0, monthly_value = 0, start_date, deadline, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });
  try {
    const r = await pool.query(`INSERT INTO projects (name,contact_id,status,value,monthly_value,start_date,deadline,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, contact_id||null, status, parseFloat(value)||0, parseFloat(monthly_value)||0, start_date||null, deadline||null, notes||null]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/admin/api/projects/:id', requireAuth, async (req, res) => {
  const { name, contact_id, status, value, monthly_value, start_date, deadline, notes } = req.body;
  try {
    const r = await pool.query(`UPDATE projects SET name=$1,contact_id=$2,status=$3,value=$4,monthly_value=$5,start_date=$6,deadline=$7,notes=$8,updated_at=NOW() WHERE id=$9 RETURNING *`,
      [name, contact_id||null, status, parseFloat(value)||0, parseFloat(monthly_value)||0, start_date||null, deadline||null, notes||null, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/admin/api/projects/:id', requireAuth, async (req, res) => {
  try { await pool.query('DELETE FROM projects WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Weekly Telegram Report ────────────────────────────────────────────────────
let lastWeeklyReportSent = null;
async function sendWeeklyReport() {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const [monthRev, mrr, newContacts, pipeline] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(amount),0)::float AS total FROM revenue WHERE date >= $1 AND status='paid'`, [monthStart]),
      pool.query(`SELECT COALESCE(SUM(amount),0)::float AS total FROM revenue WHERE type='recurring' AND status='paid'`),
      pool.query(`SELECT COUNT(*)::int FROM contacts WHERE created_at >= $1`, [weekAgo]),
      pool.query(`SELECT COALESCE(SUM(COALESCE(value,0)),0)::float AS total, COUNT(*)::int AS count FROM contacts WHERE stage IN ('Contacted','In Conversation','Proposal Sent')`),
    ]);
    const month = parseFloat(monthRev.rows[0].total);
    const mrrVal = parseFloat(mrr.rows[0].total);
    const goal = 50000;
    const pct = Math.min(100, (mrrVal / goal * 100)).toFixed(1);
    const needed = Math.max(0, goal - mrrVal);
    const fmt = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    const msg = `📊 <b>NetSudo Weekly Report</b>\n📅 Week of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}\n\n💰 <b>Revenue This Month:</b> ${fmt(month)}\n🔄 <b>MRR:</b> ${fmt(mrrVal)} / ${fmt(goal)} (${pct}%)\n${needed > 0 ? `⚡ <b>Gap to Goal:</b> ${fmt(needed)} more needed` : '🎯 <b>GOAL ACHIEVED!</b> 🎉'}\n\n📋 <b>Pipeline:</b> ${pipeline.rows[0].count} active deals (${fmt(parseFloat(pipeline.rows[0].total))})\n👥 <b>New Contacts This Week:</b> ${newContacts.rows[0].count}\n\n${mrrVal >= goal ? '🏆 You hit $50K MRR! Incredible work, Miguel!' : `Keep pushing, Miguel! ${fmt(needed)} to go. 💪`}\n\n🔗 https://netsudo.com/admin/ceo`;
    await sendTelegram(msg);
    lastWeeklyReportSent = new Date().toISOString();
    console.log('Weekly report sent:', lastWeeklyReportSent);
  } catch (e) { console.error('Weekly report failed:', e.message); }
}
function checkWeeklyReport() {
  const now = new Date();
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  if (est.getDay() === 1 && est.getHours() === 9) {
    const todayKey = est.toISOString().split('T')[0];
    if (lastWeeklyReportSent && lastWeeklyReportSent.startsWith(todayKey)) return;
    sendWeeklyReport();
  }
}
setInterval(checkWeeklyReport, 60 * 60 * 1000);

app.listen(PORT, () => console.log(`✓ NetSudo Admin running on port ${PORT}`));

// ── Resend Email Helper ───────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, replyTo }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer re_4RCa7p9J_MN3A1sZhgqkg1ejJeQPHz2Ue",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "NetSudo <hello@netsudo.com>",
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      reply_to: replyTo || "miguel@netsudo.com"
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Email send failed");
  return data;
}
