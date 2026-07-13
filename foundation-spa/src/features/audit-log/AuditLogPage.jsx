import { useState, useCallback, useMemo, useEffect } from 'react';
import { useAuditLogs, useAuditActors } from './hooks/useAuditLog.js';
import { CATEGORIES, DATE_RANGES } from './lib/auditLog.js';
import {
  PageHeader, Toolbar, SearchInput, Select, Badge, Skeleton, Button, EmptyState,
} from '../../components/ui/index.js';
import { RefreshCw, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';

const CATEGORY_VARIANTS = {
  attendance: 'info',
  batch: 'warning',
  registration: 'success',
  roles: 'danger',
  sync: 'neutral',
  comms: 'info',
  admin: 'neutral',
};

const STATUS_VARIANTS = {
  success: 'success',
  error: 'danger',
  pending: 'warning',
  neutral: 'neutral',
};

function formatTimestamp(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function ActorCell({ actor }) {
  const initial = (actor || '?').charAt(0).toUpperCase();
  const name = actor || 'system';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 28, height: 28, borderRadius: 'var(--radius-full)',
        background: 'var(--soft-purple)', color: 'var(--primary)',
        fontSize: 11, fontWeight: 800,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{initial}</div>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{name}</span>
    </div>
  );
}

function DetailRow({ row }) {
  const details = row.details;
  return (
    <div style={{ padding: '12px 14px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12, marginBottom: details ? 12 : 0,
      }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Actor</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{row.actor}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Action</div>
          <div style={{ fontSize: 13 }}>{row.action}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Entity</div>
          <div style={{ fontSize: 13, fontFamily: "'DM Mono', monospace" }}>{row.entityType} / {row.entityId || '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>When</div>
          <div style={{ fontSize: 13 }}>{formatTimestamp(row.timestamp)}</div>
        </div>
      </div>
      {details && (
        <pre style={{
          whiteSpace: 'pre-wrap', fontSize: 12,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-sm)', padding: 12,
          maxHeight: '40vh', overflow: 'auto', margin: 0,
          color: 'var(--text)',
        }}>
          {typeof details === 'string' ? details : JSON.stringify(details, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function AuditLogPage() {
  const [search, setSearch] = useState('');
  const [actor, setActor] = useState('');
  const [dateRange, setDateRange] = useState('7');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState(null);

  const debouncedSearch = useDebounce(search, 400);

  const filters = useMemo(() => ({
    search: debouncedSearch,
    actor,
    dateRange,
    category,
    page,
  }), [debouncedSearch, actor, dateRange, category, page]);

  const { data, isLoading, isFetching, refetch } = useAuditLogs(filters);
  const { data: actors } = useAuditActors();

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  const handleReset = useCallback(() => {
    setSearch('');
    setActor('');
    setDateRange('7');
    setCategory('');
    setPage(0);
    setExpandedId(null);
  }, []);

  const handleFilterChange = useCallback((setter) => (e) => {
    setter(e.target.value);
    setPage(0);
  }, []);

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle={`${total.toLocaleString()} records`}
        actions={
          <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? 'spin' : ''} />
            Refresh
          </Button>
        }
      />

      <Toolbar>
        <SearchInput
          placeholder="Search action, actor, entity..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
        />
        <Select value={category} onChange={handleFilterChange(setCategory)} style={{ width: 'auto', minWidth: 150 }}>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </Select>
        <Select value={actor} onChange={handleFilterChange(setActor)} style={{ width: 'auto', minWidth: 150 }}>
          <option value="">All actors</option>
          {(actors || []).map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </Select>
        <Select value={dateRange} onChange={handleFilterChange(setDateRange)} style={{ width: 'auto', minWidth: 140 }}>
          {DATE_RANGES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </Select>
        <Button variant="ghost" size="sm" onClick={handleReset}>Reset</Button>
      </Toolbar>

      {isLoading ? (
        <Skeleton variant="row" count={8} />
      ) : rows.length === 0 ? (
        <EmptyState icon="📋" title="No audit records" message="Try adjusting your filters or date range." />
      ) : (
        <>
          {/* Desktop table */}
          <div className="rso-table-wrap">
            <table className="rso-table">
              <thead>
                <tr>
                  <th style={{ width: 200 }}>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th style={{ width: 100 }}>Category</th>
                  <th style={{ width: 140 }}>When</th>
                  <th style={{ width: 80 }}>Status</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <RowWithDetail
                    key={row.id}
                    row={row}
                    expanded={expandedId === row.id}
                    onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="rso-table-cards">
            {rows.map((row) => (
              <div key={row.id} className="rso-table-card" onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <ActorCell actor={row.actor} />
                  <Badge variant={STATUS_VARIANTS[row.status]}>{row.rawStatus}</Badge>
                </div>
                <div style={{ fontSize: 13, marginBottom: 4 }}>{row.action.replace(/_/g, ' ').toLowerCase()}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Badge variant={CATEGORY_VARIANTS[row.category]}>{row.category}</Badge>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{formatTimestamp(row.timestamp)}</span>
                </div>
                {expandedId === row.id && <DetailRow row={row} />}
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginTop: 14, padding: '10px 0', fontSize: 13, color: 'var(--muted)',
          }}>
            <span>{total.toLocaleString()} records · Page {page + 1} of {totalPages}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft size={14} /> Prev
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RowWithDetail({ row, expanded, onToggle }) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td><ActorCell actor={row.actor} /></td>
        <td style={{ whiteSpace: 'normal', maxWidth: 280 }}>{row.action.replace(/_/g, ' ').toLowerCase()}</td>
        <td className="mono">{row.entityId || '—'}</td>
        <td><Badge variant={CATEGORY_VARIANTS[row.category]}>{row.category}</Badge></td>
        <td>{formatTimestamp(row.timestamp)}</td>
        <td><Badge variant={STATUS_VARIANTS[row.status]}>{row.rawStatus}</Badge></td>
        <td>
          <button className="icon-btn" aria-label={expanded ? 'Collapse' : 'Expand'} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{ padding: 0 }}>
            <DetailRow row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
