/* ═══════════════════════════════════════════
   NetSudo Admin — Shared App Utilities
   ═══════════════════════════════════════════ */

// ── Theme Manager ─────────────────────────────
const ThemeManager = {
  init() {
    const saved = localStorage.getItem('ns-theme') || 'dark';
    this.apply(saved, false);
  },
  apply(theme, animate = true) {
    if (!animate) document.documentElement.style.transition = 'none';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ns-theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    if (!animate) requestAnimationFrame(() => { document.documentElement.style.transition = ''; });
  },
  toggle() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    this.apply(cur === 'dark' ? 'light' : 'dark');
  },
  get() { return document.documentElement.getAttribute('data-theme') || 'dark'; }
};

// ── Toast ─────────────────────────────────────
const Toast = {
  _ensure() {
    if (!document.getElementById('toast-container')) {
      const el = document.createElement('div');
      el.id = 'toast-container';
      document.body.appendChild(el);
    }
    return document.getElementById('toast-container');
  },
  show(msg, type = 'success', ms = 3500) {
    const icons = { success: '✓', error: '✕', info: 'i', warning: '!' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<div class="toast-icon">${icons[type]||'•'}</div><div class="toast-msg">${msg}</div>`;
    this._ensure().appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, ms);
  },
  success(m) { this.show(m, 'success'); },
  error(m)   { this.show(m, 'error');   },
  info(m)    { this.show(m, 'info');    },
  warn(m)    { this.show(m, 'warning'); },
};

// ── API Wrapper ───────────────────────────────
const API = {
  async _req(method, url, data) {
    const opts = { method, headers: {}, credentials: 'include' };
    if (data) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(data); }
    const res = await fetch(url, opts);
    if (res.status === 401) { window.location = '/admin/login'; return; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  },
  get(url)          { return this._req('GET', url); },
  post(url, data)   { return this._req('POST', url, data); },
  put(url, data)    { return this._req('PUT', url, data); },
  patch(url, data)  { return this._req('PATCH', url, data); },
  del(url)          { return this._req('DELETE', url); },
};

// ── Helpers ───────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function timeAgo(d) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(d);
}
function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Stage config
const STAGES = [
  { name: 'New',             color: '#6366f1' },
  { name: 'Contacted',       color: '#3b82f6' },
  { name: 'In Conversation', color: '#06b6d4' },
  { name: 'Proposal Sent',   color: '#f59e0b' },
  { name: 'Closed Won',      color: '#10b981' },
  { name: 'Closed Lost',     color: '#ef4444' },
];
const STAGE_COLOR = Object.fromEntries(STAGES.map(s => [s.name, s.color]));

const TAGS = ['lead','prospect','client','cold','partner'];
const TAG_COLOR = {
  lead: '#6366f1', prospect: '#3b82f6', client: '#10b981', cold: '#6b7280', partner: '#f59e0b'
};

function stageBadge(stage) {
  const c = STAGE_COLOR[stage] || '#6b7280';
  return `<span class="badge" style="background:${c}18;color:${c};border:1px solid ${c}30">${escHtml(stage) || '—'}</span>`;
}
function tagBadge(tag) {
  const t = (tag||'').toLowerCase();
  const c = TAG_COLOR[t] || '#6b7280';
  const lbl = tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : '—';
  return `<span class="badge" style="background:${c}18;color:${c};border:1px solid ${c}30">${escHtml(lbl)}</span>`;
}
function actionLabel(action) {
  const map = { created:'created contact', updated:'updated details', stage_changed:'changed stage', note:'added note', email:'sent email' };
  return map[action] || action;
}

// ── Confirm Dialog ────────────────────────────
function showConfirm({ title, text, confirmText = 'Confirm', danger = false, onConfirm }) {
  let overlay = document.getElementById('confirm-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'confirm-overlay';
    overlay.className = 'confirm-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="confirm-box">
      <div class="confirm-icon">${danger ? '⚠️' : 'ℹ️'}</div>
      <div class="confirm-title">${escHtml(title)}</div>
      <div class="confirm-text">${escHtml(text)}</div>
      <div class="confirm-btns">
        <button class="btn btn-secondary" id="confirm-cancel">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok">${escHtml(confirmText)}</button>
      </div>
    </div>`;
  requestAnimationFrame(() => overlay.classList.add('show'));
  const close = () => { overlay.classList.remove('show'); };
  overlay.querySelector('#confirm-cancel').onclick = close;
  overlay.querySelector('#confirm-ok').onclick = () => { close(); onConfirm(); };
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
}

// ── Modal helpers ─────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('show'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('show'); }
function initModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.querySelectorAll('.modal-close, [data-close-modal]').forEach(btn => {
    btn.onclick = () => closeModal(id);
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(id); });
}

// ── Sidebar toggle ────────────────────────────
function initSidebarToggle() {
  const layout = document.getElementById('app-layout');
  const toggle = document.querySelector('.sidebar-toggle');
  if (!toggle || !layout) return;
  // overlay
  let overlay = document.querySelector('.sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
  }
  toggle.onclick = () => { layout.classList.toggle('sidebar-open'); };
  overlay.onclick = () => { layout.classList.remove('sidebar-open'); };
}

// ── Layout Init ───────────────────────────────
async function initLayout({ page, title }) {
  ThemeManager.init();

  let user = { username: '…', role: 'admin' };
  try { user = await API.get('/admin/api/me'); } catch (e) { /* will redirect */ }

  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    const superadmin = user.role === 'superadmin';
    sidebar.innerHTML = `
      <div class="sidebar-brand">
        <div class="brand-icon">⚙</div>
        <div>
          <div class="brand-text">NetSudo</div>
          <div class="brand-sub">Admin Panel</div>
        </div>
      </div>
      <nav class="sidebar-nav">
        <a href="/admin/dashboard" class="nav-item ${page==='dashboard'?'active':''}">
          <span class="nav-icon">📊</span><span class="nav-text">Dashboard</span>
        </a>
        <a href="/admin/pipeline" class="nav-item ${page==='pipeline'?'active':''}">
          <span class="nav-icon">🔀</span><span class="nav-text">Pipeline</span>
        </a>
        <a href="/admin/contacts" class="nav-item ${page==='contacts'?'active':''}">
          <span class="nav-icon">👥</span><span class="nav-text">Contacts</span>
        </a>
        ${superadmin ? `
        <a href="/admin/users" class="nav-item ${page==='users'?'active':''}">
          <span class="nav-icon">👤</span><span class="nav-text">Users</span>
        </a>` : ''}
        <a href="/admin/ceo" class="nav-item ${page==='ceo'?'active':''}">
          <span class="nav-icon">📈</span><span class="nav-text">CEO View</span>
        </a>
        <a href="/admin/settings" class="nav-item ${page==='settings'?'active':''}">
          <span class="nav-icon">⚙️</span><span class="nav-text">Settings</span>
        </a>
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="user-avatar">${initials(user.username)}</div>
          <div class="user-info">
            <div class="user-name">${escHtml(user.username)}</div>
            <div class="user-role">${escHtml(user.role)}</div>
          </div>
        </div>
      </div>`;
  }

  const topbar = document.getElementById('topbar');
  if (topbar) {
    topbar.innerHTML = `
      <div class="topbar-left">
        <button class="sidebar-toggle" aria-label="Toggle menu">☰</button>
        <h1 class="page-title">${escHtml(title)}</h1>
      </div>
      <div class="topbar-right">
        <button class="theme-toggle" id="theme-toggle" onclick="ThemeManager.toggle()" title="Toggle theme"></button>
        <a href="/admin/logout" class="logout-btn">Logout</a>
      </div>`;
    const t = document.getElementById('theme-toggle');
    if (t) t.textContent = ThemeManager.get() === 'dark' ? '☀️' : '🌙';
  }

  initSidebarToggle();
  return user;
}
