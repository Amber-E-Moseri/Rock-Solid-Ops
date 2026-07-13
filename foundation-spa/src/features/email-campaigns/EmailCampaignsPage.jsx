import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Plus } from 'lucide-react';
import {
  PageHeader, Button, Badge, Modal, Input, Textarea, Skeleton, EmptyState,
} from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  fetchCampaigns, fetchFellowships, fetchEmailQueue, parseIndividuals,
  saveCampaignDraft, deleteCampaign, countRecipients, sendTestEmail, sendCampaign,
  STATUS_LABELS,
} from './lib/emailCampaigns.js';

const fmt = (v) => { if (!v) return '—'; try { return new Date(v).toLocaleString(); } catch { return v; } };

function queueBadge(s) {
  const x = String(s || '').toLowerCase();
  const variant = x.includes('fail') || x.includes('error') ? 'danger'
    : x.includes('pending') || x.includes('queue') ? 'warning'
    : x.includes('sent') || x.includes('complete') ? 'success'
    : 'info';
  return <Badge variant={variant}>{s || '—'}</Badge>;
}

export default function EmailCampaignsPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [composer, setComposer] = useState(null);   // null | { campaign|null }
  const [preview, setPreview] = useState(null);     // null | { title, subject, html, text }
  const [confirmAction, setConfirmAction] = useState(null); // { kind, campaign }
  const [busy, setBusy] = useState(false);

  const { data: campaigns = [], isLoading } = useQuery({ queryKey: ['email-campaigns'], queryFn: fetchCampaigns });
  const { data: fellowships = [] } = useQuery({ queryKey: ['fellowship-map'], queryFn: fetchFellowships, staleTime: 1000 * 60 * 10 });
  const { data: queueRows = [], isLoading: queueLoading } = useQuery({ queryKey: ['email-queue-recent'], queryFn: fetchEmailQueue });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['email-campaigns'] });
    queryClient.invalidateQueries({ queryKey: ['email-queue-recent'] });
  }, [queryClient]);

  const run = useCallback(async (fn, successMsg) => {
    setBusy(true);
    try {
      const result = await fn();
      toast(typeof successMsg === 'function' ? successMsg(result) : successMsg, 'success');
      refresh();
      return true;
    } catch (err) {
      toast(`${err?.message || err}`, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, [toast, refresh]);

  const handleConfirm = async () => {
    const { kind, campaign } = confirmAction;
    setConfirmAction(null);
    if (kind === 'test') {
      await run(() => sendTestEmail({ campaign, adminEmail: profile?.email, adminName: profile?.full_name }),
        'Test email queued. The edge function will deliver it shortly.');
    } else if (kind === 'send') {
      await run(() => sendCampaign(campaign),
        (n) => `Campaign queued for ${n} recipient${n !== 1 ? 's' : ''}. The edge function will deliver within the next cron interval.`);
    } else if (kind === 'delete') {
      await run(() => deleteCampaign(campaign.id), 'Draft deleted.');
    }
  };

  return (
    <div>
      <PageHeader
        title="Email Campaigns"
        subtitle="Draft, preview and send bulk email. Delivery is handled server-side via the email queue."
        actions={
          <>
            <Button variant="primary" onClick={() => setComposer({ campaign: null })}><Plus size={14} /> New Campaign</Button>
            <Button variant="secondary" onClick={refresh}><RefreshCw size={14} /> Refresh</Button>
          </>
        }
      />

      {/* Campaign list */}
      {isLoading ? (
        <Skeleton variant="row" count={5} />
      ) : !campaigns.length ? (
        <EmptyState icon="📣" title="No campaigns yet" message="Click New Campaign to start." />
      ) : (
        <div className="rso-table-wrap">
          <table className="rso-table">
            <thead>
              <tr><th>Campaign</th><th>Subject</th><th>Status</th><th>Recipients</th><th>Count</th><th>Date</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const canEdit = c.status !== 'sending' && c.status !== 'sent';
                const canSend = c.status === 'draft' || c.status === 'ready';
                const info = STATUS_LABELS[c.status] || { label: c.status || '—', variant: 'neutral' };
                const tags = c.recipient_tags || [];
                return (
                  <tr key={c.id}>
                    <td><strong>{c.title}</strong></td>
                    <td>{c.subject || '—'}</td>
                    <td><Badge variant={info.variant}>{info.label}</Badge></td>
                    <td title={tags.join(', ')}>{tags.slice(0, 3).join(', ')}{tags.length > 3 ? '…' : ''}</td>
                    <td>{c.recipient_count || '—'}</td>
                    <td style={{ fontSize: 12 }}>{fmt(c.sent_at || c.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {canEdit && <Button size="sm" variant="secondary" onClick={() => setComposer({ campaign: c })}>Edit</Button>}
                        <Button size="sm" variant="secondary" onClick={() => setPreview({ title: c.title, subject: c.subject, html: c.body_html, text: c.body_text })}>Preview</Button>
                        {canSend && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmAction({ kind: 'test', campaign: c })}>Test Email</Button>}
                        {canSend && <Button size="sm" variant="primary" disabled={busy} onClick={() => setConfirmAction({ kind: 'send', campaign: c })}>Send</Button>}
                        {canEdit && <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirmAction({ kind: 'delete', campaign: c })}>Delete</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent email queue */}
      <h3 style={{ fontSize: 15, fontWeight: 800, margin: '24px 0 10px' }}>Recent Email Queue</h3>
      {queueLoading ? (
        <Skeleton variant="row" count={4} />
      ) : (
        <div className="rso-table-wrap">
          <table className="rso-table">
            <thead>
              <tr><th>Created</th><th>Recipient</th><th>Name</th><th>Template</th><th>Subject</th><th>Campaign</th><th>Status</th><th>Error</th></tr>
            </thead>
            <tbody>
              {!queueRows.length ? (
                <tr><td colSpan={8} style={{ color: 'var(--muted)' }}>No records found.</td></tr>
              ) : queueRows.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontSize: 12 }}>{fmt(row.created_at)}</td>
                  <td>{row.recipient_email}</td>
                  <td>{row.recipient_name || '—'}</td>
                  <td className="mono">{row.template_key}</td>
                  <td>{row.subject || '—'}</td>
                  <td className="mono">{row.campaign_id ? `${String(row.campaign_id).slice(0, 8)}…` : '—'}</td>
                  <td>{queueBadge(row.status)}</td>
                  <td style={{ fontSize: 12, color: 'var(--danger)' }}>{row.error_message || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {composer && (
        <ComposerModal
          campaign={composer.campaign}
          fellowships={fellowships}
          onClose={() => setComposer(null)}
          onSaved={() => { setComposer(null); refresh(); }}
          onPreview={setPreview}
          actorEmail={profile?.email}
        />
      )}

      {preview && (
        <Modal open onClose={() => setPreview(null)} title={preview.title || 'Preview'} width={760}>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>Subject: <strong style={{ color: 'var(--text)' }}>{preview.subject || '(no subject)'}</strong></div>
          {preview.html?.trim() ? (
            <iframe sandbox="allow-same-origin" title="Email preview" srcDoc={preview.html}
              style={{ width: '100%', height: '50vh', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }} />
          ) : (
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, maxHeight: '50vh', overflow: 'auto' }}>
              {preview.text || '(no body)'}
            </pre>
          )}
        </Modal>
      )}

      {confirmAction && (
        <Modal open onClose={() => setConfirmAction(null)} title={
          confirmAction.kind === 'test' ? 'Send test email?' :
          confirmAction.kind === 'send' ? 'Send campaign?' : 'Delete draft?'
        }
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmAction(null)}>Cancel</Button>
              <Button variant={confirmAction.kind === 'delete' ? 'danger' : 'primary'} onClick={handleConfirm}>
                {confirmAction.kind === 'test' ? 'Send Test' : confirmAction.kind === 'send' ? 'Confirm Send' : 'Delete'}
              </Button>
            </>
          }
        >
          {confirmAction.kind === 'test' && <p style={{ fontSize: 14 }}>Send a test email to <strong>{profile?.email}</strong>?</p>}
          {confirmAction.kind === 'send' && (
            <div style={{ fontSize: 14 }}>
              <p>Send <strong>"{confirmAction.campaign.subject}"</strong> to:</p>
              <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                <li>Fellowship tags: {(confirmAction.campaign.recipient_tags || []).join(', ') || 'none'}</li>
                <li>Individual addresses: {(confirmAction.campaign.recipient_emails || []).length}</li>
              </ul>
              <p style={{ color: 'var(--danger)', fontWeight: 600 }}>This action cannot be undone.</p>
            </div>
          )}
          {confirmAction.kind === 'delete' && <p style={{ fontSize: 14 }}>Delete draft <strong>"{confirmAction.campaign.title}"</strong>? This cannot be undone.</p>}
        </Modal>
      )}
    </div>
  );
}

function ComposerModal({ campaign, fellowships, onClose, onSaved, onPreview, actorEmail }) {
  const toast = useToast();
  const [title, setTitle] = useState(campaign?.title || '');
  const [subject, setSubject] = useState(campaign?.subject || '');
  const [bodyText, setBodyText] = useState(campaign?.body_text || '');
  const [bodyHtml, setBodyHtml] = useState(campaign?.body_html || '');
  const [individuals, setIndividuals] = useState((campaign?.recipient_emails || []).join(', '));
  const [tags, setTags] = useState(() => new Set(campaign?.recipient_tags || []));
  const [countMsg, setCountMsg] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleTag = (code) => setTags((prev) => {
    const next = new Set(prev);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });

  const handleCount = async () => {
    const inds = parseIndividuals(individuals);
    const tagList = [...tags];
    if (!tagList.length && !inds.length) { setCountMsg('No recipients selected.'); return; }
    setCountMsg('Counting…');
    const { studentCount, individualCount, total } = await countRecipients({ tags: tagList, individuals: inds });
    setCountMsg(`~${total} recipient${total !== 1 ? 's' : ''} (${studentCount} students + ${individualCount} individual${individualCount !== 1 ? 's' : ''})`);
  };

  const handleSave = async () => {
    setError('');
    if (!title.trim()) { setError('Campaign title is required.'); return; }
    if (!subject.trim()) { setError('Subject is required.'); return; }
    if (!bodyText.trim() && !bodyHtml.trim()) { setError('Provide at least a plain-text or HTML body.'); return; }
    setSaving(true);
    try {
      await saveCampaignDraft({
        id: campaign?.id || null,
        actorEmail,
        data: {
          title: title.trim(),
          subject: subject.trim(),
          body_text: bodyText.trim(),
          body_html: bodyHtml.trim(),
          recipient_tags: [...tags],
          recipient_emails: parseIndividuals(individuals),
        },
      });
      toast(campaign ? 'Campaign updated.' : 'Draft saved.', 'success');
      onSaved();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={campaign ? 'Edit Campaign' : 'New Campaign'} width={760}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="secondary" onClick={() => onPreview({ title: 'Preview', subject, html: bodyHtml, text: bodyText })}>Preview</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Draft'}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Campaign Title *"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. July welcome blast" /></Field>
        <Field label="Subject *"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Plain-text Body"><Textarea rows={4} value={bodyText} onChange={(e) => setBodyText(e.target.value)} /></Field>
        <Field label="HTML Body (optional — takes precedence when set)"><Textarea rows={6} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} /></Field>
        <Field label="Recipient Campuses / Fellowships (targets all students in these campuses)">
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, maxHeight: 160, overflowY: 'auto' }}>
            {!fellowships.length ? (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Loading campuses…</span>
            ) : fellowships.map((f) => (
              <label key={f.fellowship_code} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', marginBottom: 4 }}>
                <input type="checkbox" checked={tags.has(f.fellowship_code)} onChange={() => toggleTag(f.fellowship_code)} />
                {f.fellowship_code} — {f.campus_name}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Individual Recipients (email addresses, comma-separated)">
          <Textarea rows={3} value={individuals} onChange={(e) => setIndividuals(e.target.value)} placeholder="alice@example.com, bob@example.com" />
        </Field>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button size="sm" variant="secondary" onClick={handleCount}>Preview Recipient Count</Button>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{countMsg}</span>
        </div>
        {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
      </div>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
