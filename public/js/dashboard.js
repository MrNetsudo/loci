/* ─── Dashboard ─────────────────────────────── */
async function loadDashboard() {
  try {
    const [stats, activity] = await Promise.all([
      API.get('/admin/api/stats'),
      API.get('/admin/api/activity'),
    ]);
    renderStats(stats);
    renderPipelineSummary(stats.byStage, stats.total);
    renderActivity(activity.slice(0, 10));
    renderRecentContacts(stats.recent || []);
  } catch (e) {
    Toast.error('Failed to load dashboard: ' + e.message);
  }
}

function renderStats(s) {
  document.getElementById('stat-total').textContent   = s.total;
  document.getElementById('stat-week').textContent    = s.thisWeek;
  document.getElementById('stat-month').textContent   = s.thisMonth;
  document.getElementById('stat-won').textContent     = s.closedWon;
}

function renderPipelineSummary(byStage, total) {
  const cont = document.getElementById('pipeline-summary');
  if (!cont) return;
  if (!byStage || !byStage.length) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">No contacts yet</div></div>`;
    return;
  }
  const max = Math.max(...byStage.map(s => s.count), 1);
  cont.innerHTML = byStage.map(s => {
    const clr = STAGE_COLOR[s.stage] || '#6b7280';
    const pct = Math.round((s.count / max) * 100);
    return `
      <div class="pipeline-row">
        <div class="pipeline-lbl" title="${escHtml(s.stage)}">${escHtml(s.stage)}</div>
        <div class="pipeline-track">
          <div class="pipeline-fill" style="width:${pct}%;background:${clr}"></div>
        </div>
        <div class="pipeline-num">${s.count}</div>
      </div>`;
  }).join('');
}

function renderActivity(items) {
  const cont = document.getElementById('activity-feed');
  if (!cont) return;
  if (!items.length) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No activity yet</div></div>`;
    return;
  }
  cont.innerHTML = items.map(a => `
    <div class="activity-item">
      <div class="activity-line">
        <div class="activity-dot ${escHtml(a.action)}"></div>
      </div>
      <div class="activity-content">
        <div class="activity-text">
          <b>${escHtml(a.admin_user || 'system')}</b>
          ${actionLabel(a.action)}
          ${a.contact_name ? `— <a href="/admin/contacts/${a.contact_id}" style="color:var(--accent)">${escHtml(a.contact_name)}</a>` : ''}
          ${a.action === 'stage_changed' || a.action === 'note' ? `<br><span class="text-secondary" style="font-size:12px">${escHtml(a.detail||'')}</span>` : ''}
        </div>
        <div class="activity-meta">
          <span>${timeAgo(a.created_at)}</span>
          ${a.contact_email ? `<span>${escHtml(a.contact_email)}</span>` : ''}
        </div>
      </div>
    </div>`).join('');
}

function renderRecentContacts(contacts) {
  const tbody = document.getElementById('recent-tbody');
  if (!tbody) return;
  if (!contacts.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state" style="padding:32px;text-align:center"><div class="empty-icon">👥</div><div class="empty-text">No contacts yet</div></td></tr>`;
    return;
  }
  tbody.innerHTML = contacts.map(c => `
    <tr onclick="window.location='/admin/contacts/${c.id}'">
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="user-avatar" style="width:28px;height:28px;font-size:10px">${initials(c.name)}</div>
          <div>
            <div style="font-weight:500">${escHtml(c.name||'—')}</div>
            <div class="td-muted">${escHtml(c.email)}</div>
          </div>
        </div>
      </td>
      <td class="td-muted">${escHtml(c.company||'—')}</td>
      <td>${stageBadge(c.stage||'New')}</td>
      <td>${tagBadge(c.tag)}</td>
      <td class="td-muted">${fmtDate(c.created_at)}</td>
    </tr>`).join('');
}

// ── Init ──────────────────────────────────────
initLayout({ page: 'dashboard', title: 'Dashboard' }).then(() => {
  loadDashboard();
});
