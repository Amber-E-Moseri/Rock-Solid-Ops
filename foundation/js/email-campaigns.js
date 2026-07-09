// Email Campaign Draft / Send Workflow
// Sending always goes server-side: browser → email_queue → edge function → Resend.
// The Resend API key is never accessible here.

let _db = null;
let _profile = null;
let _campaigns = [];
let _fellowships = [];
let _editingId = null;
let _sendingId = null;

const STATUS_LABELS = {
  draft: { label: 'Draft', cls: 'fs-badge-neutral' },
  ready: { label: 'Ready', cls: 'fs-badge-info' },
  sending: { label: 'Sending…', cls: 'fs-badge-warning' },
  sent: { label: 'Sent', cls: 'fs-badge-success' },
  failed: { label: 'Failed', cls: 'fs-badge-danger' },
};

function esc(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[c]));
}

function fmt(v) {
  if (!v) return '—';
  try { return new Date(v).toLocaleString(); } catch { return v; }
}

function statusBadge(s) {
  const info = STATUS_LABELS[s] || { label: s || '—', cls: 'fs-badge-neutral' };
  return `<span class="fs-badge ${info.cls}">${esc(info.label)}</span>`;
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
    background: type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#1e3a8a',
    color: '#fff', padding: '10px 20px', borderRadius: '10px', zIndex: '9999',
    fontSize: '14px', fontWeight: '600', boxShadow: '0 4px 12px rgba(0,0,0,.2)',
    pointerEvents: 'none',
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Public API ────────────────────────────────────────────────

export async function initCampaigns(db, opts = {}) {
  _db = db;
  _profile = opts.profile || null;
  await Promise.all([loadCampaigns(), loadFellowships()]);
  bindCampaignEvents();
}

// ── Data loading ──────────────────────────────────────────────

async function loadCampaigns() {
  const el = document.getElementById('cmpList');
  if (!el) return;
  el.innerHTML = '<div class="muted" style="padding:12px">Loading…</div>';

  const { data, error } = await _db
    .from('email_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    el.innerHTML = `<div class="fs-banner fs-banner-danger">${esc(error.message)}</div>`;
    return;
  }
  _campaigns = data || [];
  renderCampaignList();
}

async function loadFellowships() {
  const { data } = await _db
    .from('fellowship_map')
    .select('fellowship_code, campus_name')
    .order('fellowship_code');
  _fellowships = data || [];
}

// ── Rendering ─────────────────────────────────────────────────

function renderCampaignList() {
  const el = document.getElementById('cmpList');
  if (!el) return;

  if (!_campaigns.length) {
    el.innerHTML = '<div class="muted" style="padding:12px 0;">No campaigns yet. Click <strong>New Campaign</strong> to start.</div>';
    return;
  }

  const rows = _campaigns.map(c => {
    const canEdit = c.status !== 'sending' && c.status !== 'sent';
    const canSend = c.status === 'draft' || c.status === 'ready';
    const tags = (c.recipient_tags || []).join(', ') || '—';
    const rcCount = c.recipient_count || 0;
    return `
      <tr>
        <td><strong>${esc(c.title)}</strong></td>
        <td>${esc(c.subject || '—')}</td>
        <td>${statusBadge(c.status)}</td>
        <td title="${esc(tags)}">${esc((c.recipient_tags || []).slice(0, 3).join(', ') + (c.recipient_tags?.length > 3 ? '…' : ''))}</td>
        <td>${rcCount ? esc(String(rcCount)) : '—'}</td>
        <td>${esc(c.sent_at ? fmt(c.sent_at) : (c.created_at ? fmt(c.created_at) : '—'))}</td>
        <td>
          <div class="actions">
            ${canEdit ? `<button class="fs-btn fs-btn-secondary" style="font-size:12px;padding:6px 10px;" onclick="window._cmpEdit('${esc(c.id)}')">Edit</button>` : ''}
            <button class="fs-btn fs-btn-secondary" style="font-size:12px;padding:6px 10px;" onclick="window._cmpPreview('${esc(c.id)}')">Preview</button>
            ${canSend ? `<button class="fs-btn fs-btn-secondary" style="font-size:12px;padding:6px 10px;" onclick="window._cmpSendTest('${esc(c.id)}')">Test Email</button>` : ''}
            ${canSend ? `<button class="fs-btn" style="font-size:12px;padding:6px 10px;" onclick="window._cmpSend('${esc(c.id)}')">Send</button>` : ''}
            ${canEdit ? `<button class="fs-btn fs-btn-secondary" style="font-size:12px;padding:6px 10px;color:var(--color-danger-fg);" onclick="window._cmpDelete('${esc(c.id)}')">Delete</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  el.innerHTML = `
    <div class="table-wrap fs-table-wrap">
      <table class="fs-table">
        <thead>
          <tr>
            <th>Campaign</th><th>Subject</th><th>Status</th>
            <th>Recipients</th><th>Count</th><th>Date</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ── Composer modal ────────────────────────────────────────────

function buildFellowshipCheckboxes(selected) {
  if (!_fellowships.length) return '<div class="muted" style="font-size:12px">Loading campuses…</div>';
  return _fellowships.map(f => {
    const checked = (selected || []).includes(f.fellowship_code) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;cursor:pointer;margin-bottom:4px;">
      <input type="checkbox" name="cmpTag" value="${esc(f.fellowship_code)}" ${checked} style="width:auto">
      ${esc(f.fellowship_code)} — ${esc(f.campus_name)}
    </label>`;
  }).join('');
}

export function openComposer(campaignId = null) {
  _editingId = campaignId;
  const c = campaignId ? _campaigns.find(x => x.id === campaignId) : null;

  const modal = document.getElementById('cmpModal');
  if (!modal) return;

  document.getElementById('cmpModalTitle').textContent = c ? 'Edit Campaign' : 'New Campaign';
  document.getElementById('cmpTitle').value = c?.title || '';
  document.getElementById('cmpSubject').value = c?.subject || '';
  document.getElementById('cmpBodyText').value = c?.body_text || '';
  document.getElementById('cmpBodyHtml').value = c?.body_html || '';
  document.getElementById('cmpIndividuals').value = (c?.recipient_emails || []).join(', ');
  document.getElementById('cmpTagList').innerHTML = buildFellowshipCheckboxes(c?.recipient_tags || []);

  document.getElementById('cmpRecipientCount').textContent = '';
  document.getElementById('cmpSaveErr').textContent = '';
  modal.style.display = 'flex';
  document.getElementById('cmpTitle').focus();
}

function getComposerData() {
  const tags = [...document.querySelectorAll('input[name="cmpTag"]:checked')].map(el => el.value);
  const rawIndividuals = document.getElementById('cmpIndividuals').value;
  const individuals = rawIndividuals
    .split(/[\s,;]+/)
    .map(e => e.trim().toLowerCase())
    .filter(e => e.includes('@'));

  return {
    title: document.getElementById('cmpTitle').value.trim(),
    subject: document.getElementById('cmpSubject').value.trim(),
    body_text: document.getElementById('cmpBodyText').value.trim(),
    body_html: document.getElementById('cmpBodyHtml').value.trim(),
    recipient_tags: tags,
    recipient_emails: individuals,
    updated_by: _profile?.email || null,
  };
}

async function saveDraft() {
  const btn = document.getElementById('cmpSaveBtn');
  const errEl = document.getElementById('cmpSaveErr');
  errEl.textContent = '';

  const data = getComposerData();
  if (!data.title) { errEl.textContent = 'Campaign title is required.'; return; }
  if (!data.subject) { errEl.textContent = 'Subject is required.'; return; }
  if (!data.body_text && !data.body_html) {
    errEl.textContent = 'Provide at least a plain-text or HTML body.'; return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving…';

  let error;
  if (_editingId) {
    ({ error } = await _db.from('email_campaigns').update(data).eq('id', _editingId));
  } else {
    ({ error } = await _db.from('email_campaigns').insert({
      ...data,
      status: 'draft',
      created_by: _profile?.email || null,
    }));
  }

  btn.disabled = false;
  btn.textContent = 'Save Draft';

  if (error) {
    errEl.textContent = error.message;
    return;
  }

  document.getElementById('cmpModal').style.display = 'none';
  showToast(_editingId ? 'Campaign updated.' : 'Draft saved.', 'success');
  await loadCampaigns();
}

// ── Preview HTML ──────────────────────────────────────────────

export function previewHtml(campaignId) {
  const c = _campaigns.find(x => x.id === campaignId);
  if (!c) return;

  const modal = document.getElementById('cmpPreviewModal');
  if (!modal) return;

  document.getElementById('cmpPreviewTitle').textContent = c.title;
  document.getElementById('cmpPreviewSubject').textContent = c.subject;
  const frame = document.getElementById('cmpPreviewFrame');

  if (c.body_html) {
    frame.style.display = 'block';
    document.getElementById('cmpPreviewText').style.display = 'none';
    // srcdoc is safe: does not inherit parent origin; no script execution from foreign content
    frame.srcdoc = c.body_html;
  } else {
    frame.style.display = 'none';
    const pre = document.getElementById('cmpPreviewText');
    pre.style.display = 'block';
    pre.textContent = c.body_text || '(no body)';
  }

  modal.style.display = 'flex';
}

// ── Recipient count preview ───────────────────────────────────

async function previewRecipientCount() {
  const tags = [...document.querySelectorAll('input[name="cmpTag"]:checked')].map(el => el.value);
  const rawInd = document.getElementById('cmpIndividuals').value;
  const individuals = rawInd.split(/[\s,;]+/).filter(e => e.includes('@'));

  const el = document.getElementById('cmpRecipientCount');

  if (!tags.length && !individuals.length) {
    el.textContent = 'No recipients selected.';
    return;
  }

  el.textContent = 'Counting…';

  let studentCount = 0;
  if (tags.length) {
    const { count, error } = await _db
      .from('students')
      .select('student_id', { count: 'exact', head: true })
      .in('fellowship_code', tags);
    if (!error) studentCount = count || 0;
  }

  const total = studentCount + individuals.length;
  el.textContent = `~${total} recipient${total !== 1 ? 's' : ''} (${studentCount} students + ${individuals.length} individual${individuals.length !== 1 ? 's' : ''})`;
}

// ── Send test email ───────────────────────────────────────────

export async function sendTestEmail(campaignId) {
  const c = _campaigns.find(x => x.id === campaignId);
  if (!c) return;

  const adminEmail = _profile?.email;
  if (!adminEmail) {
    showToast('Your admin email is not available.', 'error');
    return;
  }

  if (!confirm(`Send a test email to ${adminEmail}?`)) return;

  const { error } = await _db.from('email_queue').insert({
    recipient_email: adminEmail,
    recipient_name: _profile?.full_name || 'Admin',
    template_key: 'campaign',
    subject: `[TEST] ${c.subject}`,
    status: 'Pending',
    campaign_id: c.id,
    payload: {
      campaign_id: c.id,
      subject: c.subject,
      body_text: c.body_text || '',
      body_html: c.body_html || '',
      is_test: true,
    },
  });

  if (error) {
    showToast(`Failed: ${error.message}`, 'error');
    return;
  }

  showToast('Test email queued. The edge function will deliver it shortly.', 'success');
}

// ── Send campaign ─────────────────────────────────────────────

export async function sendCampaign(campaignId) {
  const c = _campaigns.find(x => x.id === campaignId);
  if (!c) {
    showToast('Campaign not found.', 'error');
    return;
  }

  if (c.status === 'sent') {
    showToast('This campaign has already been sent.', 'error');
    return;
  }
  if (c.status === 'sending') {
    showToast('This campaign is already being sent.', 'error');
    return;
  }
  if (_sendingId === campaignId) return; // UI guard

  const tagNames = (c.recipient_tags || []).join(', ') || 'none';
  const indCount = (c.recipient_emails || []).length;
  const confirm1 = confirm(
    `Send "${c.subject}" to:\n` +
    `• Fellowship tags: ${tagNames}\n` +
    `• Individual addresses: ${indCount}\n\n` +
    `This action cannot be undone.`
  );
  if (!confirm1) return;

  _sendingId = campaignId;

  // Step 1: atomic status transition via SECURITY DEFINER function
  const { data: began, error: beginErr } = await _db.rpc('campaign_begin_send', { p_campaign_id: campaignId });
  if (beginErr) {
    showToast(`Failed to lock campaign: ${beginErr.message}`, 'error');
    _sendingId = null;
    return;
  }
  if (!began) {
    showToast('Campaign cannot be sent (already sent or in progress).', 'error');
    _sendingId = null;
    await loadCampaigns();
    return;
  }

  // Step 2: collect recipient emails
  let recipientEmails = [...(c.recipient_emails || [])];

  if ((c.recipient_tags || []).length) {
    const { data: students, error: sErr } = await _db
      .from('students')
      .select('email, full_name, fellowship_code')
      .in('fellowship_code', c.recipient_tags);

    if (sErr) {
      showToast(`Failed to load recipients: ${sErr.message}`, 'error');
      await _db.rpc('campaign_finish_send', { p_campaign_id: campaignId, p_sent_count: 0, p_success: false });
      _sendingId = null;
      await loadCampaigns();
      return;
    }

    for (const s of (students || [])) {
      if (s.email && !recipientEmails.includes(s.email.toLowerCase())) {
        recipientEmails.push(s.email.toLowerCase());
      }
    }
  }

  // Deduplicate
  recipientEmails = [...new Set(recipientEmails.map(e => e.trim().toLowerCase()).filter(e => e.includes('@')))];

  if (!recipientEmails.length) {
    showToast('No recipients found for this campaign.', 'error');
    await _db.rpc('campaign_finish_send', { p_campaign_id: campaignId, p_sent_count: 0, p_success: false });
    _sendingId = null;
    await loadCampaigns();
    return;
  }

  // Step 3: insert all rows into email_queue
  const queueRows = recipientEmails.map(email => ({
    recipient_email: email,
    template_key: 'campaign',
    subject: c.subject,
    status: 'Pending',
    campaign_id: campaignId,
    payload: {
      campaign_id: campaignId,
      subject: c.subject,
      body_text: c.body_text || '',
      body_html: c.body_html || '',
    },
  }));

  // Insert in batches of 50 to stay within PostgREST limits
  const BATCH = 50;
  let insertFailed = false;
  for (let i = 0; i < queueRows.length; i += BATCH) {
    const { error: iErr } = await _db.from('email_queue').insert(queueRows.slice(i, i + BATCH));
    if (iErr) {
      insertFailed = true;
      showToast(`Partial failure inserting queue rows: ${iErr.message}`, 'error');
      break;
    }
  }

  // Step 4: finalize campaign status
  await _db.rpc('campaign_finish_send', {
    p_campaign_id: campaignId,
    p_sent_count: insertFailed ? 0 : recipientEmails.length,
    p_success: !insertFailed,
  });

  _sendingId = null;

  if (!insertFailed) {
    showToast(`Campaign queued for ${recipientEmails.length} recipient${recipientEmails.length !== 1 ? 's' : ''}. The edge function will deliver within the next cron interval.`, 'success');
  }

  await loadCampaigns();
}

// ── Delete ────────────────────────────────────────────────────

export async function deleteCampaign(campaignId) {
  const c = _campaigns.find(x => x.id === campaignId);
  if (!c) return;
  if (c.status === 'sent' || c.status === 'sending') {
    showToast('Cannot delete a sent or in-progress campaign.', 'error');
    return;
  }
  if (!confirm(`Delete draft "${c.title}"? This cannot be undone.`)) return;

  const { error } = await _db.from('email_campaigns').delete().eq('id', campaignId);
  if (error) { showToast(error.message, 'error'); return; }
  showToast('Draft deleted.', 'success');
  await loadCampaigns();
}

// ── Event binding ─────────────────────────────────────────────

function bindCampaignEvents() {
  // New campaign button
  const newBtn = document.getElementById('cmpNewBtn');
  if (newBtn) newBtn.addEventListener('click', () => openComposer(null));

  // Composer modal: save
  const saveBtn = document.getElementById('cmpSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveDraft);

  // Composer modal: close
  const closeBtn = document.getElementById('cmpModalClose');
  if (closeBtn) closeBtn.addEventListener('click', () => {
    document.getElementById('cmpModal').style.display = 'none';
  });

  // Composer modal: preview recipients
  const previewBtn = document.getElementById('cmpPreviewRecipientsBtn');
  if (previewBtn) previewBtn.addEventListener('click', previewRecipientCount);

  // Preview modal: close
  const previewClose = document.getElementById('cmpPreviewModalClose');
  if (previewClose) previewClose.addEventListener('click', () => {
    document.getElementById('cmpPreviewModal').style.display = 'none';
  });

  // Preview modal: live preview button in composer
  const previewLiveBtn = document.getElementById('cmpPreviewHtmlBtn');
  if (previewLiveBtn) previewLiveBtn.addEventListener('click', () => {
    const html = document.getElementById('cmpBodyHtml').value;
    const text = document.getElementById('cmpBodyText').value;
    const subject = document.getElementById('cmpSubject').value;

    document.getElementById('cmpPreviewTitle').textContent = 'Preview';
    document.getElementById('cmpPreviewSubject').textContent = subject || '(no subject)';
    const frame = document.getElementById('cmpPreviewFrame');
    const pre = document.getElementById('cmpPreviewText');

    if (html.trim()) {
      frame.style.display = 'block';
      pre.style.display = 'none';
      frame.srcdoc = html;
    } else {
      frame.style.display = 'none';
      pre.style.display = 'block';
      pre.textContent = text || '(no body)';
    }
    document.getElementById('cmpPreviewModal').style.display = 'flex';
  });

  // Dismiss modals on backdrop click
  document.getElementById('cmpModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('cmpModal'))
      document.getElementById('cmpModal').style.display = 'none';
  });
  document.getElementById('cmpPreviewModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('cmpPreviewModal'))
      document.getElementById('cmpPreviewModal').style.display = 'none';
  });

  // Wire global action stubs called from table row buttons
  window._cmpEdit = id => openComposer(id);
  window._cmpPreview = id => previewHtml(id);
  window._cmpSendTest = id => sendTestEmail(id);
  window._cmpSend = id => sendCampaign(id);
  window._cmpDelete = id => deleteCampaign(id);
}
