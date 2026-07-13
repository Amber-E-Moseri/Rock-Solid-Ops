import { useState, useMemo } from 'react';
import { useOperationalTrace } from './hooks/useOperationalTrace.js';
import { EVENT_STYLES, FILTER_CHIPS, relTime, absTime, exportTraceJson, exportTraceCsv } from './lib/operationalTrace.js';
import {
  PageHeader, Toolbar, Skeleton, EmptyState, Button, Badge,
} from '../../components/ui/index.js';

const PAGE_SIZE = 50;

function StatusBadge({ status }) {
  const s = String(status ?? '').toUpperCase();
  let cls = 'chip-pending';
  if (s.includes('ASSIGNED') || s === 'SENT' || s === 'PRESENT' || s === 'COMPLETED' || s === 'SUCCESS') cls = 'chip-assigned';
  else if (s.includes('WAIT')) cls = 'chip-waitlisted';
  else if (s.includes('DUP') || s.includes('FAIL') || s.includes('ERROR') || s === 'ABSENT') cls = 'chip-duplicate';
  return <span className={`chip ${cls}`}>{status}</span>;
}

export default function OperationalTracePage() {
  const [input, setInput] = useState('');
  const [lookup, setLookup] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortAsc, setSortAsc] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);

  const { data, isLoading, isFetching } = useOperationalTrace(lookup);
  const applicant = data?.applicant;

  const filtered = useMemo(() => {
    if (!data) return [];
    let evts = data.events;
    const chip = FILTER_CHIPS.find((c) => c.key === filter);
    if (chip && chip.types.length > 0) evts = evts.filter((e) => chip.types.includes(e.type));
    if (sortAsc) evts = [...evts].reverse();
    return evts;
  }, [data, filter, sortAsc]);

  const visible = filtered.slice(0, shown);

  function doSearch() {
    const v = input.trim();
    if (v) { setLookup(v); setShown(PAGE_SIZE); setFilter('all'); }
  }

  const emailsSent = useMemo(
    () => (data?.events ?? []).filter((e) => e.source === 'email_queue' && String(e.status).toUpperCase() === 'SENT').length,
    [data],
  );
  const moodleStatus = useMemo(
    () => (data?.events ?? []).find((e) => e.source === 'moodle_enrollment_sync')?.status ?? '—',
    [data],
  );
  const lastAttendance = useMemo(
    () => (data?.events ?? []).find((e) => e.type === 'attendance')?.ts,
    [data],
  );
  const milestoneCount = useMemo(
    () => (data?.events ?? []).filter((e) => e.type === 'milestone').length,
    [data],
  );

  return (
    <div className="page-content">
      <PageHeader title="Operational Trace" />

      {/* Search bar */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <input
          className="rso-input"
          style={{ flex: 1 }}
          placeholder="Enter email, applicant ID, or trace ID…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
        />
        <Button variant="primary" onClick={doSearch} disabled={!input.trim() || isFetching}>
          {isFetching ? 'Searching…' : 'Search'}
        </Button>
        {lookup && (
          <Button variant="ghost" onClick={() => { setLookup(''); setInput(''); }}>
            Clear
          </Button>
        )}
      </div>

      {isLoading && <Skeleton variant="rows" rows={5} />}

      {!lookup && !isLoading && (
        <EmptyState icon="🔍" title="Search for a student" subtitle="Enter an email, applicant ID, or trace ID to view their operational timeline." />
      )}

      {data && (
        <>
          {data.errors.length > 0 && (
            <div className="card" style={{ padding: '0.75rem 1rem', borderLeft: '3px solid #C8102E', marginBottom: '1rem', fontSize: 'var(--fs-sm)' }}>
              <strong>Partial data:</strong> {data.errors.map((e) => `${e.error}: ${e.message}`).join('; ')}
            </div>
          )}

          {/* Summary KPIs */}
          {applicant && (
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
              {[
                { label: 'Registration Date', value: absTime(applicant.created_at), color: '#4C2A92' },
                { label: 'Current Status', value: applicant.registration_status, color: '#16a34a', isBadge: true },
                { label: 'Class Assigned', value: applicant.class_option_id || '—', color: '#0891b2' },
                { label: 'Emails Sent', value: emailsSent, color: '#7c3aed' },
                { label: 'Moodle Status', value: moodleStatus, color: '#0ea5e9', isBadge: true },
                { label: 'Last Attendance', value: lastAttendance ? absTime(lastAttendance) : '—', color: '#d97706' },
                { label: 'Milestones', value: `${milestoneCount}/5`, color: '#ca8a04' },
              ].map((k) => (
                <div key={k.label} className="card" style={{ padding: '0.5rem 0.75rem', borderLeft: `3px solid ${k.color}`, flex: '1 1 140px', minWidth: 120 }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k.label}</div>
                  <div style={{ fontWeight: 700, fontSize: 'var(--fs-sm)', marginTop: '0.15rem' }}>
                    {k.isBadge ? <StatusBadge status={k.value} /> : k.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Filter chips + controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
              {FILTER_CHIPS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => { setFilter(c.key); setShown(PAGE_SIZE); }}
                  style={{
                    padding: '0.3rem 0.75rem', borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
                    fontSize: 'var(--fs-xs)', fontWeight: filter === c.key ? 600 : 400,
                    background: filter === c.key ? '#4C2A92' : 'var(--surface)',
                    color: filter === c.key ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button className="rso-btn rso-btn-ghost rso-btn-sm" onClick={() => setSortAsc((p) => !p)}>
                {sortAsc ? 'Oldest first' : 'Newest first'}
              </button>
              <button className="rso-btn rso-btn-ghost rso-btn-sm" onClick={() => exportTraceJson(applicant, filtered)}>JSON</button>
              <button className="rso-btn rso-btn-ghost rso-btn-sm" onClick={() => exportTraceCsv(filtered)}>CSV</button>
            </div>
          </div>

          {/* Timeline */}
          {filtered.length === 0 ? (
            <EmptyState icon="📭" title="No events" subtitle="No events match the current filter." />
          ) : (
            <div style={{ position: 'relative', paddingLeft: '2rem' }}>
              <div style={{ position: 'absolute', left: '0.75rem', top: 0, bottom: 0, width: 2, background: 'var(--border)' }} />
              {visible.map((evt, i) => {
                const style = EVENT_STYLES[evt.type] || EVENT_STYLES.manual;
                return <TimelineEvent key={`${evt.traceId}-${i}`} evt={evt} style={style} />;
              })}
              {shown < filtered.length && (
                <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                  <Button variant="secondary" size="sm" onClick={() => setShown((s) => s + PAGE_SIZE)}>
                    Load more ({filtered.length - shown} remaining)
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TimelineEvent({ evt, style }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ position: 'relative', marginBottom: '1rem' }}>
      <div style={{ position: 'absolute', left: '-1.55rem', top: '0.4rem', width: 12, height: 12, borderRadius: '50%', background: style.color, border: '2px solid var(--bg)' }} />
      <div className="card" style={{ padding: '0.75rem 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
          <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: style.color }}>
            {style.icon} {style.label}
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }} title={absTime(evt.ts)}>
            {relTime(evt.ts)}
          </span>
        </div>
        <div style={{ fontSize: 'var(--fs-sm)' }}>{evt.description}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.35rem', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
          <span>
            {evt.actor && `by ${evt.actor} · `}
            {evt.traceId && (
              <>
                <span className="mono" style={{ cursor: 'pointer' }} onClick={() => navigator.clipboard.writeText(String(evt.traceId))} title="Click to copy">
                  {String(evt.traceId).slice(0, 8)}…
                </span>
              </>
            )}
          </span>
          {evt.status && <StatusBadge status={evt.status} />}
        </div>
        {evt.details && (
          <>
            <button
              onClick={() => setExpanded((p) => !p)}
              style={{ marginTop: '0.35rem', fontSize: '0.65rem', background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: 0 }}
            >
              {expanded ? 'Hide details' : 'View details'}
            </button>
            {expanded && (
              <pre className="json-block" style={{ marginTop: '0.5rem', fontSize: '0.65rem', maxHeight: 300, overflow: 'auto' }}>
                {JSON.stringify(evt.details, null, 2)}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
