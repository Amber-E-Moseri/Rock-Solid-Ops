import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Button, Input, Textarea, Badge, Modal, Select, EmptyState, Skeleton } from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  messagingApi, scopeLabel, filterOptionsByRole, searchProfiles, buildSendPayload,
  SCOPE_CHOICES, TEACHER_SCOPE_CHOICES, SUBGROUP_OPTIONS, GROUP_OPTIONS, ADMINISH_ROLES,
} from './lib/messages.js';

const fmtDate = (v) => { if (!v) return '-'; try { return new Date(v).toLocaleString(); } catch { return String(v); } };

export default function MessagesPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const isTeacher = String(profile?.role || '') === 'teacher';

  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const { data: conversations = [], isLoading: convsLoading } = useQuery({
    queryKey: ['messages-conversations'],
    queryFn: () => messagingApi('listConversations'),
    staleTime: 1000 * 30,
  });

  useEffect(() => {
    if (!selectedId && conversations.length) setSelectedId(String(conversations[0].id || ''));
  }, [conversations, selectedId]);

  const { data: thread, isLoading: msgsLoading } = useQuery({
    queryKey: ['messages-thread', selectedId],
    queryFn: async () => {
      const data = await messagingApi('listMessages', { conversationId: selectedId, limit: 100 });
      messagingApi('markRead', { conversationId: selectedId }).catch(() => {});
      return data;
    },
    enabled: Boolean(selectedId),
  });

  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  const bodyRef = useRef(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [messages.length]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['messages-conversations'] });
    queryClient.invalidateQueries({ queryKey: ['messages-thread'] });
  }, [queryClient]);

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const payload = { body };
      if (selectedId) payload.conversationId = selectedId;
      await messagingApi('sendMessage', payload);
      setDraft('');
      refresh();
    } catch (err) {
      toast(`Send failed: ${err?.message || err}`, 'error');
    } finally {
      setSending(false);
    }
  }, [draft, selectedId, refresh, toast]);

  return (
    <div>
      <PageHeader
        title={isTeacher ? 'Messages from Admin' : 'Messages'}
        subtitle={isTeacher ? 'Your admin will reach out here.' : 'In-app messaging between teachers and staff by jurisdiction.'}
        actions={!isTeacher && <Button variant="secondary" onClick={() => setComposeOpen(true)}>New</Button>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: 12, alignItems: 'start' }}>
        {/* Conversation list */}
        <aside style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 12, maxHeight: '70vh', overflowY: 'auto' }}>
          <strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>Conversations</strong>
          {convsLoading ? (
            <Skeleton variant="row" count={4} />
          ) : !conversations.length ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              {isTeacher ? 'No messages yet. Your admin will reach out here.' : 'No conversations yet.'}
            </div>
          ) : (
            conversations.map((c) => {
              const active = String(c.id) === String(selectedId);
              const unread = Number(c.unread_count || 0);
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(String(c.id))}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                    background: active ? 'color-mix(in srgb, var(--primary) 7%, transparent)' : 'var(--surface)',
                    borderRadius: 10, padding: 10, marginBottom: 8, color: 'var(--text)', font: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <strong style={{ fontSize: 13 }}>{c.subject || 'Conversation'}</strong>
                    {unread > 0 && <Badge variant="info">{unread}</Badge>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                    <Badge variant="neutral">{scopeLabel(c)}</Badge> · {fmtDate(c.updated_at || c.created_at)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.latest_message?.body ? String(c.latest_message.body).slice(0, 90) : 'No messages yet'}
                  </div>
                </button>
              );
            })
          )}
        </aside>

        {/* Thread + composer */}
        <section style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', overflow: 'hidden' }}>
          <div ref={bodyRef} style={{ height: 420, overflowY: 'auto', padding: 12, background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
            {!selectedId ? (
              <div style={{ fontSize: 13, color: 'var(--muted)', padding: 8 }}>Select or start a conversation.</div>
            ) : msgsLoading ? (
              <Skeleton variant="row" count={3} />
            ) : !messages.length ? (
              <div style={{ fontSize: 13, color: 'var(--muted)', padding: 8 }}>No messages in this conversation yet.</div>
            ) : (
              messages.map((m) => {
                const mine = String(m.sender_user_id) === String(profile?.user_id);
                return (
                  <article key={m.id} style={{
                    background: mine ? 'color-mix(in srgb, var(--primary) 8%, var(--surface))' : 'var(--surface)',
                    border: `1px solid ${mine ? 'color-mix(in srgb, var(--primary) 35%, var(--border))' : 'var(--border)'}`,
                    borderRadius: 10, padding: 10, marginBottom: 8,
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                      <strong>{m.sender_name || m.sender_role || 'Staff'}</strong> · {fmtDate(m.created_at)}
                    </div>
                    <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{m.body || ''}</div>
                  </article>
                );
              })
            )}
          </div>
          <div style={{ display: 'grid', gap: 8, padding: 12 }}>
            <Textarea rows={4} placeholder="Type your message..." value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="primary" onClick={handleSend} disabled={sending || !draft.trim()}>
                {sending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        </section>
      </div>

      {composeOpen && (
        <ComposeModal
          isTeacher={isTeacher}
          profile={profile}
          onClose={() => setComposeOpen(false)}
          onSent={(newId) => {
            setComposeOpen(false);
            refresh();
            if (newId) setSelectedId(String(newId));
          }}
        />
      )}
    </div>
  );
}

function ComposeModal({ isTeacher, profile, onClose, onSent }) {
  const toast = useToast();
  const [scope, setScope] = useState(isTeacher ? 'MESSAGE_ADMIN' : 'INDIVIDUAL');
  const [groupId, setGroupId] = useState('');
  const [subgroupId, setSubgroupId] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [recipients, setRecipients] = useState(() => new Map());
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);

  const { data: options = [] } = useQuery({
    queryKey: ['messages-recipient-options'],
    queryFn: async () => (await messagingApi('getRecipientOptions', {}))?.recipients || [],
    staleTime: 1000 * 60 * 5,
  });
  const optionMap = useMemo(() => new Map(options.map((r) => [String(r.user_id), r])), [options]);

  const choices = isTeacher ? TEACHER_SCOPE_CHOICES : SCOPE_CHOICES;
  const isSearchMode = ['INDIVIDUAL', 'MESSAGE_ADMIN'].includes(scope);

  // Auto-pick an admin when teacher selects MESSAGE_ADMIN (mirrors legacy)
  useEffect(() => {
    if (scope === 'MESSAGE_ADMIN') {
      const admin = options.find((r) => ADMINISH_ROLES.includes(String(r.role)));
      if (admin) setRecipients(new Map([[String(admin.user_id), admin]]));
    } else if (scope !== 'INDIVIDUAL') {
      setRecipients(new Map());
    }
  }, [scope, options]);

  // Search
  useEffect(() => {
    if (!isSearchMode) { setResults([]); return; }
    let cancel = false;
    (async () => {
      const q = search.trim();
      let rows = [];
      if (q) rows = await searchProfiles(q);
      else if (scope === 'MESSAGE_ADMIN') rows = options.slice(0, 10);
      else { setResults([]); return; }
      if (cancel) return;
      const scoped = rows
        .map((r) => optionMap.get(String(r.user_id)) || r)
        .filter((r) => {
          if (String(r.user_id) === String(profile?.user_id)) return false;
          if (isTeacher) return ['teacher', ...ADMINISH_ROLES].includes(String(r.role));
          if (scope === 'MESSAGE_ADMIN') return ADMINISH_ROLES.includes(String(r.role));
          return true;
        });
      setResults(scoped);
    })().catch(() => {});
    return () => { cancel = true; };
  }, [search, scope, isSearchMode, options, optionMap, profile, isTeacher]);

  const handleSend = async () => {
    try {
      setStatus('');
      const text = body.trim();
      if (!text) throw new Error('Message is required');
      let recipientUserIds = [...recipients.keys()];
      if (!recipientUserIds.length) {
        recipientUserIds = filterOptionsByRole(options, scope, { groupId, subgroupId })
          .filter((r) => String(r.user_id) !== String(profile?.user_id))
          .map((r) => String(r.user_id));
      }
      if (!recipientUserIds.length) throw new Error('Pick at least one recipient');
      setSending(true);
      const payload = buildSendPayload({
        scope, subject: subject.trim() || 'New Conversation', body: text, recipientUserIds, groupId, subgroupId,
      });
      await messagingApi('sendMessage', payload);
      toast('Message sent.', 'success');
      onSent();
    } catch (err) {
      setStatus(`Send failed: ${err?.message || err}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New Message" width={720}
      footer={<Button variant="primary" onClick={handleSend} disabled={sending} style={{ width: '100%' }}>{sending ? 'Sending…' : 'Send'}</Button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Step 1 — Who to message</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {choices.map((c) => (
              <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', borderRadius: 10, padding: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="radio" name="scopeType" value={c.key} checked={scope === c.key} onChange={() => setScope(c.key)} />
                {c.label}
              </label>
            ))}
          </div>
          {scope === 'SUBGROUP' && (
            <Select value={subgroupId} onChange={(e) => setSubgroupId(e.target.value)} style={{ marginTop: 8 }}>
              <option value="">Select subgroup</option>
              {SUBGROUP_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          )}
          {scope === 'GROUP' && (
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} style={{ marginTop: 8 }}>
              <option value="">Select group</option>
              {GROUP_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          )}
        </div>

        {isSearchMode && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Step 2 — Search</div>
            <Input placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, maxHeight: 200, overflowY: 'auto', marginTop: 8 }}>
              {!results.length ? (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: 8 }}>
                  {search.trim() ? 'No matching recipients.' : 'Type to search recipients.'}
                </div>
              ) : results.map((r) => (
                <button
                  key={r.user_id}
                  onClick={() => setRecipients((prev) => new Map(prev).set(String(r.user_id), r))}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', padding: '9px 10px', cursor: 'pointer', color: 'var(--text)', font: 'inherit' }}
                >
                  <span>
                    <strong style={{ fontSize: 13 }}>{r.full_name || '-'}</strong>
                    <br /><small style={{ color: 'var(--muted)' }}>{r.email || ''}</small>
                  </span>
                  <Badge variant="neutral">{String(r.role || '').replaceAll('_', ' ')}</Badge>
                </button>
              ))}
            </div>
            {recipients.size > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {[...recipients.values()].map((r) => (
                  <span key={r.user_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 10px', background: 'var(--soft-purple)', color: 'var(--primary)', fontSize: 12, fontWeight: 700 }}>
                    {r.full_name || r.email || 'Recipient'}
                    <button onClick={() => setRecipients((prev) => { const n = new Map(prev); n.delete(String(r.user_id)); return n; })} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Step {isSearchMode ? 3 : 2} — Message</div>
          <Input placeholder="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <Textarea rows={4} placeholder="Type your message..." value={body} onChange={(e) => setBody(e.target.value)} style={{ marginTop: 8 }} />
          {status && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 13 }}>{status}</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
