import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Copy, X } from 'lucide-react';
import {
  PageHeader, Card, Badge, Button, Skeleton, Toolbar, SearchInput, Select, Input, Modal,
} from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  fetchFailedJobs, computeKpis, filterJobs, invokeRetryAction, statusVariant, fmtDateTime,
} from './lib/failed-syncs.js';

const PAGE_SIZE = 25;

export default function FailedSyncRetryCenterPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const isReadOnly = String(profile?.role || '').toLowerCase() === 'regional_secretary';

  const { data: allRows, isLoading, isFetching } = useQuery({
    queryKey: ['failed-sync-retry'],
    queryFn: fetchFailedJobs,
    staleTime: 1000 * 60,
  });

  const [filters, setFilters] = useState({ status: '', type: '', dateFrom: '', dateTo: '', search: '' });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [detailJob, setDetailJob] = useState(null);

  const kpis = useMemo(() => computeKpis(allRows || []), [allRows]);
  const filtered = useMemo(() => filterJobs(allRows || [], filters), [allRows, filters]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const setFilter = useCallback((key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e?.target ? e.target.value : e }));
    setPage(0);
  }, []);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['failed-sync-retry'] });
  }, [queryClient]);

  const handleAction = useCallback(async (action, rows) => {
    setBusy(true);
    try {
      for (const row of rows) await invokeRetryAction(action, row.source, row.id);
      toast(`${action === 'retry' ? 'Retried' : 'Resolved'} ${rows.length} item(s)`, 'success');
      setSelected(new Set());
      refresh();
    } catch (e) {
      toast(String(e?.message || e), 'error');
    } finally {
      setBusy(false);
    }
  }, [toast, refresh]);

  const handleBulkVisible = useCallback(async () => {
    setBusy(true);
    try {
      for (const row of filtered) await invokeRetryAction('retry', row.source, row.id);
      toast(`Retried ${filtered.length} visible item(s)`, 'success');
      refresh();
    } catch (e) {
      toast(String(e?.message || e), 'error');
    } finally {
      setBusy(false);
    }
  }, [filtered, toast, refresh]);

  const selectedRows = useMemo(() => (allRows || []).filter((r) => selected.has(`${r.source}:${r.id}`)), [allRows, selected]);

  const toggleSelect = useCallback((key) => {
    setSelected((s) => { const next = new Set(s); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }, []);

  const copyText = useCallback((text) => {
    navigator.clipboard?.writeText(text).then(() => toast('Copied to clipboard', 'success')).catch(() => {});
  }, [toast]);

  if (isLoading) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Skeleton style={{ height: 40 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} style={{ height: 70 }} />)}</div>
        <Skeleton style={{ height: 300 }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Failed Sync Retry Center"
        subtitle="Operational view for failed jobs across queue, notifications, Moodle sync, and Mailchimp-linked failures."
        actions={
          <Button onClick={refresh} disabled={isFetching}>
            <RefreshCw size={14} style={{ marginRight: 4, ...(isFetching ? { animation: 'spin 1s linear infinite' } : {}) }} />
            Refresh
          </Button>
        }
      />

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        <KpiCard label="Total Failed Jobs" value={kpis.total} />
        <KpiCard label="Failed Emails" value={kpis.emails} />
        <KpiCard label="Failed Moodle Syncs" value={kpis.moodle} />
        <KpiCard label="Failed Mailchimp" value={kpis.mailchimp} />
        <KpiCard label="Retries Today" value={kpis.retriesToday} />
      </div>

      {/* Filters + actions */}
      <Card>
        <Toolbar style={{ flexWrap: 'wrap' }}>
          <Select value={filters.type} onChange={setFilter('type')}>
            <option value="">All Types</option>
            <option value="email">Email</option>
            <option value="moodle">Moodle</option>
            <option value="mailchimp">Mailchimp</option>
            <option value="sync">Sync</option>
          </Select>
          <Select value={filters.status} onChange={setFilter('status')}>
            <option value="">All Statuses</option>
            <option value="failed">Failed</option>
            <option value="error">Error</option>
            <option value="pending">Pending</option>
            <option value="retry">Retry</option>
          </Select>
          <Input type="date" value={filters.dateFrom} onChange={setFilter('dateFrom')} style={{ maxWidth: 160 }} />
          <Input type="date" value={filters.dateTo} onChange={setFilter('dateTo')} style={{ maxWidth: 160 }} />
          <SearchInput placeholder="Search email, student, error…" value={filters.search} onChange={setFilter('search')} />
        </Toolbar>
        {!isReadOnly && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 12px 12px' }}>
            <Button size="sm" variant="secondary" disabled={busy || selected.size === 0} onClick={() => handleAction('retry', selectedRows)}>Retry Selected</Button>
            <Button size="sm" variant="secondary" disabled={busy || filtered.length === 0} onClick={handleBulkVisible}>Retry All Visible</Button>
            <Button size="sm" variant="secondary" disabled={busy || selected.size === 0} onClick={() => handleAction('resolve', selectedRows)}>Mark Resolved</Button>
            <span style={{ flex: 1 }} />
            <span style={{ color: 'var(--muted)', fontSize: 13, alignSelf: 'center' }}>{filtered.length} visible of {(allRows || []).length} total</span>
          </div>
        )}
      </Card>

      {/* Table */}
      <Card>
        {filtered.length === 0 ? (
          <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 13 }}>
            No failed jobs match current filters.
          </div>
        ) : (
          <>
            <div className="rso-table-wrap">
              <table className="rso-table" style={{ minWidth: 1200 }}>
                <thead>
                  <tr>
                    {!isReadOnly && (
                      <th style={{ width: 36 }}>
                        <input type="checkbox"
                          checked={pageRows.length > 0 && pageRows.every((r) => selected.has(`${r.source}:${r.id}`))}
                          onChange={(e) => {
                            setSelected((s) => {
                              const next = new Set(s);
                              pageRows.forEach((r) => { const k = `${r.source}:${r.id}`; e.target.checked ? next.add(k) : next.delete(k); });
                              return next;
                            });
                          }}
                        />
                      </th>
                    )}
                    <th>Type</th>
                    <th>Recipient / Student</th>
                    <th>Trace ID</th>
                    <th>Status</th>
                    <th>Cause</th>
                    <th>Error</th>
                    <th>Created</th>
                    <th>Last Attempted</th>
                    <th>Retries</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const key = `${r.source}:${r.id}`;
                    return (
                      <tr key={key}>
                        {!isReadOnly && (
                          <td><input type="checkbox" checked={selected.has(key)} onChange={() => toggleSelect(key)} /></td>
                        )}
                        <td><Badge variant="info">{r.type}</Badge></td>
                        <td>{r.recipient}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>
                          {r.traceId ? `${r.traceId.slice(0, 8)}…${r.traceId.slice(-6)}` : <span style={{ color: 'var(--muted)' }}>-</span>}
                        </td>
                        <td><Badge variant={statusVariant(r.status)}>{r.status}</Badge></td>
                        <td>{r.failureReason ? <Badge variant="info">{r.failureReason.replace(/^MOODLE_/, '')}</Badge> : ''}</td>
                        <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--muted)' }} title={r.error}>{r.error}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.created_at)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.lastAttemptedAt)}</td>
                        <td>{r.retryCount}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {!isReadOnly && (
                              <>
                                <Button size="sm" variant="secondary" disabled={busy} onClick={() => handleAction('retry', [r])}>Retry</Button>
                                <Button size="sm" variant="secondary" disabled={busy} onClick={() => handleAction('resolve', [r])}>Resolve</Button>
                              </>
                            )}
                            <Button size="sm" variant="secondary" onClick={() => setDetailJob(r)}>Details</Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
      </Card>

      {/* Detail modal */}
      {detailJob && (
        <Modal open onClose={() => setDetailJob(null)} title={`${detailJob.type} — ${detailJob.source}`}>
          <div style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 12 }}>Error:</strong>
            <span style={{ fontSize: 13, marginLeft: 6 }}>{detailJob.error || '-'}</span>
          </div>
          <pre style={{
            margin: 0, padding: 12, fontSize: 11, lineHeight: 1.5, maxHeight: 300, overflow: 'auto',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8,
          }}>
            {JSON.stringify(detailJob.raw, null, 2)}
          </pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button size="sm" variant="secondary" onClick={() => copyText(detailJob.error || '')}>
              <Copy size={12} style={{ marginRight: 4 }} /> Copy Error
            </Button>
            <Button size="sm" variant="secondary" onClick={() => copyText(JSON.stringify(detailJob.raw, null, 2))}>
              <Copy size={12} style={{ marginRight: 4 }} /> Copy Raw
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function KpiCard({ label, value }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)', padding: '14px 16px', boxShadow: 'var(--shadow-soft)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 800 }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: '1.45rem', fontWeight: 800, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}
