import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import {
  PageHeader, Card, Badge, Button, Skeleton, Toolbar, SearchInput, Select, Input,
} from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  fetchAllNotifications, computeSummary, filterRows, invokeRetryWorker, statusVariant, fmtDate,
} from './lib/notifications.js';

const PAGE_SIZE = 25;

export default function NotificationCenterPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const isReadOnly = String(profile?.role || '').toLowerCase() === 'regional_secretary';

  const { data: allRows, isLoading, isFetching } = useQuery({
    queryKey: ['notification-center'],
    queryFn: fetchAllNotifications,
    staleTime: 1000 * 60,
  });

  const [filters, setFilters] = useState({ status: '', type: '', search: '', date: '' });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [detailRow, setDetailRow] = useState(null);

  const summary = useMemo(() => computeSummary(allRows || []), [allRows]);
  const filtered = useMemo(() => filterRows(allRows || [], filters), [allRows, filters]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const setFilter = useCallback((key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e?.target ? e.target.value : e }));
    setPage(0);
  }, []);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['notification-center'] });
  }, [queryClient]);

  const toggleSelect = useCallback((id) => {
    setSelected((s) => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  const handleAction = useCallback(async (action, rows) => {
    setBusy(true);
    try {
      for (const row of rows) await invokeRetryWorker(action, row.source, row.id);
      toast(`${action === 'retry' ? 'Retried' : 'Resolved'} ${rows.length} item(s)`, 'success');
      setSelected(new Set());
      refresh();
    } catch (e) {
      toast(String(e?.message || e), 'error');
    } finally {
      setBusy(false);
    }
  }, [toast, refresh]);

  const selectedRows = useMemo(() => (allRows || []).filter((r) => selected.has(r.id)), [allRows, selected]);

  if (isLoading) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Skeleton style={{ height: 40 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} style={{ height: 70 }} />)}</div>
        <Skeleton style={{ height: 300 }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Notification Operations + Retry Center"
        subtitle="Operational visibility for email + Moodle delivery with safe retry workflows."
        actions={
          <Button onClick={refresh} disabled={isFetching}>
            <RefreshCw size={14} style={{ marginRight: 4, ...(isFetching ? { animation: 'spin 1s linear infinite' } : {}) }} />
            Refresh
          </Button>
        }
      />

      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        <StatCard label="Pending Emails" value={summary.pendingEmails} />
        <StatCard label="Failed Emails" value={summary.failedEmails} />
        <StatCard label="Pending Moodle Syncs" value={summary.pendingMoodle} />
        <StatCard label="Failed Moodle Syncs" value={summary.failedMoodle} />
      </div>

      {/* Filters + bulk actions */}
      <Card>
        <Toolbar>
          <Select value={filters.status} onChange={setFilter('status')}>
            <option value="">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="FAILED">Failed</option>
            <option value="SENT">Sent</option>
            <option value="RESOLVED">Resolved</option>
          </Select>
          <Select value={filters.type} onChange={setFilter('type')}>
            <option value="">All Types</option>
            <option value="email">Email</option>
            <option value="moodle">Moodle</option>
            <option value="notification">Notification</option>
            <option value="sync">Sync</option>
          </Select>
          <Input type="date" value={filters.date} onChange={setFilter('date')} />
          <SearchInput placeholder="Search email / subject / error…" value={filters.search} onChange={setFilter('search')} />
          {!isReadOnly && (
            <>
              <Button size="sm" variant="secondary" disabled={busy || selected.size === 0} onClick={() => handleAction('retry', selectedRows)}>Retry Selected</Button>
              <Button size="sm" variant="secondary" disabled={busy || selected.size === 0} onClick={() => handleAction('resolve', selectedRows)}>Resolve Selected</Button>
            </>
          )}
        </Toolbar>
      </Card>

      {/* Table */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>Operations Queue</div>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>{filtered.length} rows</span>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 13 }}>
            No rows match the current filters.
          </div>
        ) : (
          <>
            <div className="rso-table-wrap">
              <table className="rso-table" style={{ minWidth: 1120 }}>
                <thead>
                  <tr>
                    {!isReadOnly && <th style={{ width: 42 }}><input type="checkbox" checked={pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))} onChange={(e) => { const ids = pageRows.map((r) => r.id); setSelected((s) => { const next = new Set(s); ids.forEach((id) => e.target.checked ? next.add(id) : next.delete(id)); return next; }); }} /></th>}
                    <th>Source</th><th>Type</th><th>Recipient</th><th>Subject/Key</th><th>Status</th><th>Error</th><th>Updated</th>
                    {!isReadOnly && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={`${r.source}-${r.id}`} onClick={() => setDetailRow(detailRow?.id === r.id ? null : r)} style={{ cursor: 'pointer' }}>
                      {!isReadOnly && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                        </td>
                      )}
                      <td>{r.source}</td>
                      <td>{r.type}</td>
                      <td>{r.recipient || '—'}</td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subject || '—'}</td>
                      <td><Badge variant={statusVariant(r.status)}>{r.status || '—'}</Badge></td>
                      <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--muted)' }} title={r.error}>{r.error || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.created_at)}</td>
                      {!isReadOnly && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => handleAction('retry', [r])}>Retry</Button>
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => handleAction('resolve', [r])}>Resolve</Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pager */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 10 }}>
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>Page {page + 1} of {totalPages}</span>
              <Button size="sm" variant="secondary" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </>
        )}

        {/* Detail panel */}
        {detailRow && (
          <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>Error Details</div>
              <Button size="sm" variant="secondary" onClick={() => setDetailRow(null)}>Close</Button>
            </div>
            <pre style={{ margin: 0, padding: 12, fontSize: 12, lineHeight: 1.5, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify(detailRow.raw, null, 2)}
            </pre>
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', padding: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 28, fontWeight: 800, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}
