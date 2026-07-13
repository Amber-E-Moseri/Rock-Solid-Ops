import { useState, useMemo } from 'react';
import { useAdminActivity } from './hooks/useAdminActivity.js';
import { applyFilters, computeKpis, computeActorSummary, exportCsv } from './lib/adminActivity.js';
import { useAuth } from '../../hooks/useAuth.js';
import {
  PageHeader, KpiGrid, Kpi, Toolbar, SearchInput, Skeleton, EmptyState, Button,
} from '../../components/ui/index.js';

const ENTITY_TYPES = ['applicant', 'student', 'teacher', 'batch', 'user', 'system'];

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function statusClass(s) {
  const v = String(s ?? '').toLowerCase();
  if (v === 'success') return 'status-success';
  if (v === 'error' || v === 'failed') return 'status-error';
  return 'status-pending';
}

function ExpandRow({ details }) {
  const [open, setOpen] = useState(false);
  const hasDetails = details && Object.keys(details).length > 0;
  if (!hasDetails) return <td />;
  return (
    <td>
      <button
        className="icon-btn"
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
        title={open ? 'Collapse' : 'Expand'}
      >
        {open ? '−' : '+'}
      </button>
      {open && (
        <div style={{ position: 'absolute', zIndex: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '0.75rem', marginTop: '0.25rem', maxWidth: 420 }}>
          <pre className="json-block">{JSON.stringify(details, null, 2)}</pre>
        </div>
      )}
    </td>
  );
}

export default function AdminActivityPage() {
  const { profile } = useAuth();
  const isSuperadmin = profile?.role === 'superadmin';

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch } = useAdminActivity();

  const allLogs = useMemo(
    () => data?.pages.flatMap((p) => p.rows) ?? [],
    [data],
  );

  const [filters, setFilters] = useState({ actor: '', action: '', entityType: '', dateFrom: '', dateTo: '' });
  const patch = (key, val) => setFilters((f) => ({ ...f, [key]: val }));

  const filtered = useMemo(() => applyFilters(allLogs, filters), [allLogs, filters]);
  const kpis = useMemo(() => computeKpis(allLogs), [allLogs]);
  const actorSummary = useMemo(() => isSuperadmin ? computeActorSummary(allLogs) : [], [allLogs, isSuperadmin]);

  const uniqueActions = useMemo(
    () => [...new Set(allLogs.map((l) => l.action).filter(Boolean))].sort(),
    [allLogs],
  );

  const resetFilters = () => setFilters({ actor: '', action: '', entityType: '', dateFrom: '', dateTo: '' });

  return (
    <div className="page-content">
      <PageHeader
        title="Admin Activity"
        subtitle={`${filtered.length} record${filtered.length !== 1 ? 's' : ''}`}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => exportCsv(filtered)}>Export CSV</Button>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>Refresh</Button>
          </>
        }
      />

      <KpiGrid>
        <Kpi label="Today" value={kpis.today} />
        <Kpi label="This Week" value={kpis.week} />
        <Kpi label="This Month" value={kpis.month} />
        <Kpi label="Total Loaded" value={kpis.total} />
      </KpiGrid>

      <Toolbar>
        <SearchInput
          value={filters.actor}
          onChange={(e) => patch('actor', e.target.value)}
          placeholder="Filter by actor email…"
        />
        <select className="rso-select" value={filters.action} onChange={(e) => patch('action', e.target.value)}>
          <option value="">All actions</option>
          {uniqueActions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="rso-select" value={filters.entityType} onChange={(e) => patch('entityType', e.target.value)}>
          <option value="">All entity types</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          className="rso-input"
          type="date"
          value={filters.dateFrom}
          onChange={(e) => patch('dateFrom', e.target.value)}
          title="From date"
        />
        <input
          className="rso-input"
          type="date"
          value={filters.dateTo}
          onChange={(e) => patch('dateTo', e.target.value)}
          title="To date"
        />
        <Button variant="ghost" size="sm" onClick={resetFilters}>Reset</Button>
      </Toolbar>

      {isLoading ? (
        <Skeleton variant="rows" rows={8} />
      ) : filtered.length === 0 ? (
        <EmptyState icon="📋" title="No activity records" subtitle="Try adjusting your filters or date range." />
      ) : (
        <div className="rso-table-wrap">
          <table className="rso-table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity Type</th>
                <th>Entity ID</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => (
                <tr key={log.id} style={{ position: 'relative' }}>
                  <ExpandRow details={log.details} />
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(log.created_at)}</td>
                  <td>{log.actor_email || 'system'}</td>
                  <td>{log.action}</td>
                  <td>{log.entity_type}</td>
                  <td className="mono" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.entity_id}</td>
                  <td><span className={statusClass(log.status)}>{log.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasNextPage && (
        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <Button variant="secondary" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      {isSuperadmin && actorSummary.length > 0 && (
        <section style={{ marginTop: '2rem' }}>
          <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: '1rem' }}>Actor Summary (last 30 days)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
            {actorSummary.map((a) => (
              <div key={a.email} className="card" style={{ padding: '1rem' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', marginBottom: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.email}</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  {a.count} actions · last {fmtDate(a.last)}
                </div>
                {a.topAction && <span className="chip chip-active" style={{ fontSize: '0.65rem' }}>{a.topAction}</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
