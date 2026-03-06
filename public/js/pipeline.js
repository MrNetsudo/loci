/* ─── Pipeline (Kanban) ─────────────────────── */
let allContacts = [];

async function loadPipeline() {
  const board = document.getElementById('kanban-board');
  if (!board) return;

  // Build column scaffolding with skeletons
  board.innerHTML = STAGES.map(s => `
    <div class="kanban-col" data-stage="${escHtml(s.name)}">
      <div class="kanban-col-head">
        <div class="kanban-col-name">
          <div class="kanban-dot" style="background:${s.color}"></div>
          ${escHtml(s.name)}
        </div>
        <span class="kanban-count" id="kcnt-${s.name.replace(/ /g,'_')}">…</span>
      </div>
      <div class="kanban-cards" id="kcol-${s.name.replace(/ /g,'_')}">
        <div class="skeleton skeleton-text" style="margin:6px 4px"></div>
        <div class="skeleton skeleton-text short" style="margin:6px 4px"></div>
      </div>
    </div>`).join('');

  try {
    allContacts = await API.get('/admin/api/contacts');
    renderBoard();
  } catch (e) {
    Toast.error('Failed to load pipeline: ' + e.message);
  }
}

function renderBoard() {
  STAGES.forEach(s => {
    const colId  = `kcol-${s.name.replace(/ /g,'_')}`;
    const cntId  = `kcnt-${s.name.replace(/ /g,'_')}`;
    const col    = document.getElementById(colId);
    const cntEl  = document.getElementById(cntId);
    const cards  = allContacts.filter(c => (c.stage || 'New') === s.name);

    if (cntEl) cntEl.textContent = cards.length;
    if (!col)  return;

    if (!cards.length) {
      col.innerHTML = `<div style="padding:20px 12px;text-align:center;color:var(--text-muted);font-size:12px">Empty</div>`;
    } else {
      col.innerHTML = cards.map(c => `
        <div class="kanban-card" data-id="${c.id}" style="--stage-clr:${s.color}"
             onclick="openCardModal(${c.id}, event)">
          <div class="kanban-card-name">${escHtml(c.name || 'Unnamed')}</div>
          <div class="kanban-card-email">${escHtml(c.email)}</div>
          ${c.company ? `<div style="font-size:11.5px;color:var(--text-secondary);margin-bottom:6px">🏢 ${escHtml(c.company)}</div>` : ''}
          <div class="kanban-card-foot">
            ${tagBadge(c.tag)}
            <span class="kanban-card-date">${fmtDate(c.created_at)}</span>
          </div>
        </div>`).join('');
    }

    // Init SortableJS
    if (window.Sortable) {
      Sortable.create(col, {
        group:      'kanban',
        animation:  150,
        ghostClass: 'sortable-ghost',
        onEnd(evt) {
          const id  = evt.item.dataset.id;
          const raw = evt.to.id; // kcol-In_Conversation
          const stage = raw.replace('kcol-','').replace(/_/g,' ');
          handleMove(id, stage);
        }
      });
    }
  });
}

async function handleMove(id, stage) {
  try {
    await API.patch(`/admin/api/contacts/${id}/stage`, { stage });
    const c = allContacts.find(x => String(x.id) === String(id));
    if (c) c.stage = stage;
    // update all count badges
    STAGES.forEach(s => {
      const el = document.getElementById(`kcnt-${s.name.replace(/ /g,'_')}`);
      if (el) el.textContent = allContacts.filter(x => (x.stage||'New') === s.name).length;
    });
    if (stage === 'Closed Won') Toast.success('🎉 Marked as Closed Won!');
    else Toast.success(`Moved to "${stage}"`);
  } catch (e) {
    Toast.error('Failed to update stage: ' + e.message);
    loadPipeline();
  }
}

async function openCardModal(id, e) {
  if (e) e.stopPropagation();
  try {
    const c = await API.get(`/admin/api/contacts/${id}`);
    let overlay = document.getElementById('card-modal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.id = 'card-modal';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', ev => { if (ev.target === overlay) overlay.classList.remove('show'); });
    }
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">Contact Preview</div>
          <button class="modal-close" onclick="document.getElementById('card-modal').classList.remove('show')">✕</button>
        </div>
        <div class="modal-body">
          <div class="contact-hero" style="margin-bottom:20px">
            <div class="contact-avatar-lg">${initials(c.name)}</div>
            <div>
              <div class="contact-hero-name">${escHtml(c.name || 'Unnamed')}</div>
              <div class="contact-hero-email">${escHtml(c.email)}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
            <div><div class="form-label">Stage</div>${stageBadge(c.stage||'New')}</div>
            <div><div class="form-label">Tag</div>${tagBadge(c.tag)}</div>
            <div><div class="form-label">Company</div><div style="font-size:13.5px">${escHtml(c.company||'—')}</div></div>
            <div><div class="form-label">Phone</div><div style="font-size:13.5px">${escHtml(c.phone||'—')}</div></div>
            <div><div class="form-label">Source</div><div style="font-size:13.5px">${escHtml(c.source||'—')}</div></div>
            <div><div class="form-label">Added</div><div style="font-size:13.5px">${fmtDate(c.created_at)}</div></div>
          </div>
          ${c.notes ? `<div><div class="form-label">Notes</div><div style="font-size:13.5px;color:var(--text-secondary);line-height:1.6;padding:10px;background:var(--bg);border-radius:6px;border:1px solid var(--border)">${escHtml(c.notes)}</div></div>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('card-modal').classList.remove('show')">Close</button>
          <a href="/admin/contacts/${c.id}" class="btn btn-primary">Full Details →</a>
        </div>
      </div>`;
    requestAnimationFrame(() => overlay.classList.add('show'));
  } catch (e) {
    Toast.error('Failed to load contact');
  }
}

// ── Init ──────────────────────────────────────
initLayout({ page: 'pipeline', title: 'Pipeline' }).then(() => {
  loadPipeline();
});
