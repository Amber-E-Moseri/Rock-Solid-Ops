import { cloneElement, useCallback, useEffect, useId, useMemo, useState } from 'react';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ErrorBanner from '../../components/ui/ErrorBanner.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { Input, Select, Textarea } from '../../components/ui/Input.jsx';
import { REQUEST_ROLES, statusInfo } from '../access-request/lib/accessRequest.js';
import '../access-request/accessRequest.css';
import {
  QUEUE_TABS, actionsFor, countByTab, decideItem, decisionErrorMessage,
  filterQueue, loadHistory, loadReviewQueue,
} from './lib/accessRequestsInbox.js';

const NOTE_MAX = 1000;

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AccessRequestsPage() {
  const [queue, setQueue] = useState({ status: 'loading', items: [], error: '' });
  const [tab, setTab] = useState('pending');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [group, setGroup] = useState('all');
  const [selectedKey, setSelectedKey] = useState(null);

  const refresh = useCallback(async () => {
    setQueue((prev) => ({ ...prev, status: 'loading', error: '' }));
    try {
      setQueue({ status: 'ready', items: await loadReviewQueue(), error: '' });
    } catch (err) {
      setQueue({ status: 'error', items: [], error: err?.message || 'The queue could not be loaded.' });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const counts = useMemo(() => countByTab(queue.items), [queue.items]);
  const groups = useMemo(() => [...new Set(queue.items.map((i) => i.groupId).filter(Boolean))].sort(), [queue.items]);
  const visible = useMemo(
    () => filterQueue(queue.items, { tab, search, role, group }),
    [queue.items, tab, search, role, group],
  );
  const selected = queue.items.find((i) => `${i.kind}-${i.id}` === selectedKey) || null;

  return (
    <div className="ar-inbox">
      <PageHeader
        title="Access Requests"
        subtitle="Requests you may decide. Approval records a decision. It does not activate an account, grant staff access, or send email."
      />

      <TabBar tab={tab} onChange={setTab} counts={counts} />

      <div className="ar-toolbar" role="search">
        <Filter label="Search">
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email, group or subgroup" />
        </Filter>
        <Filter label="Requested role">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="all">All roles</option>
            {REQUEST_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </Filter>
        <Filter label="Group">
          <Select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="all">All groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
        </Filter>
      </div>

      {queue.status === 'loading' && <Skeleton variant="row" count={4} />}
      {queue.status === 'error' && <ErrorBanner message={queue.error} onRetry={refresh} />}

      {queue.status === 'ready' && queue.items.length === 0 && (
        <EmptyState icon="📭" title="No requests are waiting for you" message="When someone you can review files a request, it appears here." />
      )}

      {queue.status === 'ready' && queue.items.length > 0 && visible.length === 0 && (
        <EmptyState icon="🔎" title="No requests match these filters" message="Change the tab, role, group or search to see more." />
      )}

      {queue.status === 'ready' && visible.length > 0 && (
        <ul className="ar-queue" aria-label="Requests">
          {visible.map((item) => {
            const info = statusInfo(item.status);
            const key = `${item.kind}-${item.id}`;
            return (
              <li key={key} className="ar-queue-item">
                <div className="ar-queue-main">
                  <div className="ar-queue-name">{item.fullName}</div>
                  <div className="ar-queue-meta">
                    {item.roleLabel} · {item.groupId} / {item.subgroupId} · {item.fellowshipCode}
                  </div>
                  <div className="ar-queue-meta">Submitted {formatDate(item.submittedAt)}</div>
                </div>
                <div className="ar-queue-side">
                  <Badge variant={info.variant}>{info.label}</Badge>
                  <Button variant="secondary" size="sm" onClick={() => setSelectedKey(key)} aria-label={`Review ${item.fullName}`}>
                    Review
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <RequestDrawer
        item={selected}
        onClose={() => setSelectedKey(null)}
        onDecided={refresh}
      />
    </div>
  );
}

function TabBar({ tab, onChange, counts }) {
  return (
    <div className="ar-tabs" role="tablist" aria-label="Request status">
      {QUEUE_TABS.map((t) => {
        const selected = tab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`ar-tab-${t.key}`}
            aria-selected={selected}
            aria-controls="ar-queue-panel"
            tabIndex={selected ? 0 : -1}
            className={`ar-tab${selected ? ' is-active' : ''}`}
            onClick={() => onChange(t.key)}
          >
            {t.label} <span className="ar-tab-count">{counts[t.key] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

// A labelled filter. The id is injected into the one control so the label is programmatically linked.
function Filter({ label, children }) {
  const id = useId();
  return (
    <div className="rso-field ar-filter">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id })}
    </div>
  );
}

// ── Detail drawer: applicant, assignment, history, reviewer notes, and the authorized actions ──

function RequestDrawer({ item, onClose, onDecided }) {
  const uid = useId();
  const [history, setHistory] = useState({ status: 'idle', rows: [], error: '' });
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  useEffect(() => {
    setMessage(''); setNote(''); setConfirming(false); setError(''); setResult('');
    if (!item) { setHistory({ status: 'idle', rows: [], error: '' }); return undefined; }
    let alive = true;
    setHistory({ status: 'loading', rows: [], error: '' });
    loadHistory(item)
      .then((rows) => alive && setHistory({ status: 'ready', rows, error: '' }))
      .catch((err) => alive && setHistory({ status: 'error', rows: [], error: err?.message || 'History could not be loaded.' }));
    return () => { alive = false; };
  }, [item]);

  if (!item) return <Drawer open={false} onClose={onClose} title="" />;

  const actions = actionsFor(item);
  const info = statusInfo(item.status);

  async function decide(action) {
    setError('');
    setResult('');
    if ((action === 'REQUEST_INFO' || action === 'REJECT') && !message.trim()) {
      setError(action === 'REQUEST_INFO' ? 'Write the question for the applicant first.' : 'Write the reason first.');
      return;
    }
    setBusy(true);
    try {
      const response = await decideItem(item, { action, message: message.trim(), note: note.trim() });
      const next = response?.status ? statusInfo(response.status).label : 'Updated';
      setResult(`Recorded: ${next}.`);
      setConfirming(false);
      onDecided();
    } catch (err) {
      setError(decisionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={item.fullName} width={520}>
      <div className="ar-drawer">
        <section aria-labelledby={`${uid}-facts`}>
          <h3 id={`${uid}-facts`} className="ar-section-title">Request</h3>
          <dl className="ar-facts">
            <div><dt>Requested role</dt><dd>{item.roleLabel}</dd></div>
            <div><dt>Status</dt><dd><Badge variant={info.variant}>{info.label}</Badge></dd></div>
            <div><dt>Submitted</dt><dd>{formatDate(item.submittedAt)}</dd></div>
            <div><dt>Group</dt><dd>{item.groupId}</dd></div>
            <div><dt>Subgroup</dt><dd>{item.subgroupId}</dd></div>
            <div><dt>Fellowship</dt><dd>{item.fellowshipCode}</dd></div>
          </dl>
          <p className="ar-help">{item.email}{item.phone ? ` · ${item.phone}` : ''}</p>
          {item.note && <p className="ar-message">Applicant note: “{item.note}”</p>}
          {item.reviewMessage && <p className="ar-message">Sent to applicant: “{item.reviewMessage}”</p>}
          {item.reviewerNote && <p className="ar-help">Reviewer note (internal): {item.reviewerNote}</p>}
        </section>

        <section aria-labelledby={`${uid}-history`}>
          <h3 id={`${uid}-history`} className="ar-section-title">History</h3>
          {item.kind === 'teacher' && (
            <p className="ar-help">Teacher applications show their current state and reviewer. A full event trail is not yet recorded for them.</p>
          )}
          {history.status === 'loading' && <Skeleton variant="row" count={2} />}
          {history.status === 'error' && <ErrorBanner message={history.error} />}
          {item.kind === 'general' && history.status === 'ready' && history.rows.length === 0 && (
            <p className="ar-help">No events recorded yet.</p>
          )}
          {history.status === 'ready' && history.rows.length > 0 && (
            <ol className="ar-history">
              {history.rows.map((row) => (
                <li key={row.id}>
                  <span className="ar-history-action">{row.action.replace(/_/g, ' ').toLowerCase()}</span>
                  {row.from_status ? ` · ${statusInfo(row.from_status).label} → ` : ' · '}
                  {statusInfo(row.to_status).label}
                  <span className="ar-help"> · {formatDate(row.created_at)}</span>
                  {row.note && <div className="ar-help">Note: {row.note}</div>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby={`${uid}-decide`} className="ar-decide">
          <h3 id={`${uid}-decide`} className="ar-section-title">Decide</h3>
          {!actions.requestInfo && (
            <p className="ar-help">This request is no longer open, so it cannot be decided here.</p>
          )}

          {actions.requestInfo && (
            <>
              <div className="rso-field">
                <label htmlFor={`${uid}-message`}>Message to the applicant (for information requests and rejections)</label>
                <Textarea id={`${uid}-message`} rows={3} maxLength={NOTE_MAX} value={message} onChange={(e) => setMessage(e.target.value)} />
                <p className="ar-help">The applicant sees a request for information. A rejection reason stays internal.</p>
              </div>
              <div className="rso-field">
                <label htmlFor={`${uid}-note`}>Internal reviewer note (optional)</label>
                <Textarea
                  id={`${uid}-note`}
                  rows={2}
                  maxLength={NOTE_MAX}
                  value={note}
                  disabled={!actions.approveNote}
                  onChange={(e) => setNote(e.target.value)}
                  aria-describedby={`${uid}-note-help`}
                />
                <p id={`${uid}-note-help`} className="ar-help">
                  {actions.approveNote ? 'Visible to reviewers only.' : 'Notes are not stored for teacher approvals yet.'}
                </p>
              </div>

              {error && <ErrorBanner message={error} />}
              {result && <p role="status" className="ar-help">{result}</p>}

              <div className="ar-decide-actions">
                <Button variant="secondary" disabled={busy} onClick={() => decide('REQUEST_INFO')}>Request information</Button>
                <Button variant="secondary" disabled={busy} onClick={() => decide('REJECT')}>Reject</Button>
                {!confirming && (
                  <Button variant="primary" disabled={busy} onClick={() => setConfirming(true)}>Approve…</Button>
                )}
              </div>

              {confirming && (
                <div className="ar-notice" role="alertdialog" aria-labelledby={`${uid}-confirm-title`}>
                  <strong id={`${uid}-confirm-title`}>Confirm approval</strong>
                  <p className="ar-help">
                    Approval records this decision and its reviewer. It does not activate the account, grant staff access, create
                    a teacher record, change a role, send email, or call any other system.
                  </p>
                  <div className="ar-decide-actions">
                    <Button variant="primary" disabled={busy} onClick={() => decide('APPROVE')}>
                      {busy ? 'Recording…' : 'Record approval'}
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </Drawer>
  );
}
