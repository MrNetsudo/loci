/* ─── Contacts Page ─────────────────────────── */
let allContacts = [];
let filtered    = [];
let sortKey     = 'created_at';
let sortDir     = -1; // -1 = desc, 1 = asc

async function loadContacts() {
  showTableSkeleton();
  try {
    allContacts = await API.get('/admin/api/contacts');
    applyFilters();
  } catch (e) {
    Toast.error('Failed to load contacts: ' + e.message);
  }
}

function showTableSkeleton() {
  const tbody = document.getElementById('contacts-tbody');
  if (!tbody) return;
  tbody.innerHTML = Array(6).fill(`
    <tr><td colspan="8"><div class="skeleton skeleton-row"></div></td></tr>`).join('');
}

function applyFilters() {
  const search = (document.getElementById('search')?.value || '').toLowerCase();
  const stage  = document.getElementById('filter-stage')?.value || '';
  const tag    = document.getElementById('filter-tag')?.value || '';

  filtered = allContacts.filter(c => {
    if (stage && (c.stage||'New') !== stage) return false;
    if (tag   && (c.tag||'') !== tag)        return false;
    if (search) {
      const hay = `${c.name||''} ${c.email||''} ${c.company||''} ${c.phone||''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    let va = a[sortKey] ?? '', vb = b[sortKey] ?? '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return -sortDir;
    if (va > vb) return  sortDir;
    return 0;
  });

  renderTable();
  document.getElementById('count-label').textContent = `${filtered.length} contact${filtered.length !== 1 ? 's' : ''}`;
}

function renderTable() {
  const tbody = document.getElementById('contacts-tbody');
  if (!tbody) return;
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8">
      <div class="empty-state">
        <div class="empty-icon">👥</div>
        <div class="empty-text">No contacts found</div>
        <div class="empty-sub">Try adjusting your search or filters</div>
      </div></td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(c => `
    <tr onclick="window.location='/admin/contacts/${c.id}'">
      <td>
        <div style="display:flex;align-items:center;gap:9px">
          <div class="user-avatar" style="width:28px;height:28px;font-size:10px;flex-shrink:0">${initials(c.name)}</div>
          <div>
            <div style="font-weight:500;font-size:13.5px">${escHtml(c.name||'—')}</div>
            <div class="td-muted">${escHtml(c.email)}</div>
          </div>
        </div>
      </td>
      <td class="td-muted">${escHtml(c.company||'—')}</td>
      <td class="td-muted">${escHtml(c.phone||'—')}</td>
      <td>${stageBadge(c.stage||'New')}</td>
      <td>${tagBadge(c.tag)}</td>
      <td class="td-muted">${escHtml(c.source||'—')}</td>
      <td class="td-muted">${fmtDate(c.created_at)}</td>
      <td onclick="event.stopPropagation()">
        <div style="display:flex;gap:4px">
          <a href="/admin/contacts/${c.id}" class="btn btn-ghost btn-xs" title="View">→</a>
          <button class="btn btn-ghost btn-xs text-red" onclick="deleteContact(${c.id},'${escHtml(c.name||c.email)}')" title="Delete">✕</button>
        </div>
      </td>
    </tr>`).join('');
}

function setSortKey(key) {
  if (sortKey === key) { sortDir *= -1; }
  else { sortKey = key; sortDir = -1; }
  // update header indicators
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    if (th.dataset.sort === key) th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
  });
  applyFilters();
}

async function deleteContact(id, name) {
  showConfirm({
    title: 'Delete Contact',
    text: `Remove "${name}" permanently? This cannot be undone.`,
    confirmText: 'Delete',
    danger: true,
    onConfirm: async () => {
      try {
        await API.del(`/admin/api/contacts/${id}`);
        allContacts = allContacts.filter(c => c.id !== id);
        applyFilters();
        Toast.success('Contact deleted');
      } catch (e) {
        Toast.error(e.message);
      }
    }
  });
}

// ── Add Contact Modal ─────────────────────────
function openAddModal() {
  document.getElementById('add-form')?.reset();
  openModal('add-modal');
}

document.addEventListener('DOMContentLoaded', () => {
  initModal('add-modal');

  document.getElementById('add-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    const btn  = e.target.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const c = await API.post('/admin/api/contacts', data);
      allContacts.unshift(c);
      applyFilters();
      closeModal('add-modal');
      Toast.success('Contact added');
    } catch (err) {
      Toast.error(err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Add Contact';
    }
  });

  // search & filter live update
  document.getElementById('search')?.addEventListener('input', () => applyFilters());
  document.getElementById('filter-stage')?.addEventListener('change', () => applyFilters());
  document.getElementById('filter-tag')?.addEventListener('change', () => applyFilters());

  // sortable headers
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => setSortKey(th.dataset.sort));
  });

  loadContacts();
});

// ── CSV Export ────────────────────────────────
function exportCsv() {
  window.location = '/admin/api/contacts/export/csv';
}

// ── Init ──────────────────────────────────────
initLayout({ page: 'contacts', title: 'Contacts' });
