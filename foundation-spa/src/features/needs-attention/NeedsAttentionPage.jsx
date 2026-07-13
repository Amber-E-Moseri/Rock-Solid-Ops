import { useState, useMemo } from 'react';
import { useBatches, useAttentionData, useMarkResolved } from './hooks/useNeedsAttention.js';
import { FLAG_LABELS, isResolved, resolvedNote, filterFlags } from './lib/needsAttention.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  PageHeader, Toolbar, SearchInput, Skeleton, EmptyState, Badge, Button,
} from '../../components/ui/index.js';

function SeverityBadge({ severity }) {
  const s = String(severity ?? '').toLowerCase();
  const variant = s === 'critical' ? 'danger' : s === 'warning' ? 'warning' : 'info';
  return <Badge variant={variant}>{severity || 'info'}</Badge>;
}

function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function NeedsAttentionPage() {
  const { profile } = useAuth();
  const isRegSec = profile?.role === 'regional_secretary';
  const { addToast } = useToast();

  const [batchId, setBatchId] = useState('');
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const { data: batches } = useBatches();
  const { data, isLoading, dataUpdatedAt } = useAttentionData(batchId || undefined);
  const resolve = useMarkResolved();

  const resolved = data?.resolved ?? new Map();

  const studentFlags = useMemo(
    () => data ? filterFlags(data.studentFlags, { search, severity, showResolved, resolved, entityType: 'student' }) : [],
    [data, search, severity, showResolved],
  );
  const teacherFlags = useMemo(
    () => data ? filterFlags(data.teacherFlags, { search, severity, showResolved, resolved, entityType: 'teacher' }) : [],
    [data, search, severity, showResolved],
  );
  const systemFlags = useMemo(() => {
    if (!data) return [];
    let flags = data.systemFlags;
    if (severity) flags = flags.filter((f) => String(f.severity ?? '').toLowerCase() === severity.toLowerCase());
    if (!showResolved) flags = flags.filter((f) => !isResolved(resolved, f.flag_type, 'system', f.flag_type));
    return flags;
  }, [data, severity, showResolved]);

  const systemCount = useMemo(() => systemFlags.reduce((sum, f) => sum + (f.count || 0), 0), [systemFlags]);

  async function handleResolve(flagType, entityType, entityId) {
    try {
      await resolve.mutateAsync({ flagType, entityType, entityId });
      addToast('Marked as resolved', 'success');
    } catch (e) {
      addToast(`Failed: ${e.message}`, 'error');
    }
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Needs Attention"
        subtitle={dataUpdatedAt ? `Updated ${relTime(dataUpdatedAt)}` : ''}
      />

      {/* KPI pills */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '0.75rem 1rem', borderLeft: '3px solid #b91c1c' }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Students</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{studentFlags.length}</div>
        </div>
        <div className="card" style={{ padding: '0.75rem 1rem', borderLeft: '3px solid #b45309' }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Teachers</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{teacherFlags.length}</div>
        </div>
        <div className="card" style={{ padding: '0.75rem 1rem', borderLeft: '3px solid #7c2d12' }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>System</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{systemCount}</div>
        </div>
      </div>

      <Toolbar>
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, flag…" />
        <select className="rso-select" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          <option value="">All batches</option>
          {(batches ?? []).map((b) => <option key={b.batch_id} value={b.batch_id}>{b.batch_name}</option>)}
        </select>
        <select className="rso-select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Show resolved
        </label>
      </Toolbar>

      {isLoading ? (
        <Skeleton variant="rows" rows={6} />
      ) : (
        <>
          {/* Student flags */}
          <Section title="Student Attention Flags" count={studentFlags.length} color="#b91c1c">
            {studentFlags.length === 0 ? (
              <EmptyState icon="✅" title="No student flags" subtitle="All clear." />
            ) : isRegSec ? (
              <SummaryCards flags={studentFlags} />
            ) : (
              <div className="rso-table-wrap">
                <table className="rso-table">
                  <thead>
                    <tr>
                      <th>Flag</th>
                      <th>Student</th>
                      <th>Fellowship</th>
                      <th>Teacher</th>
                      <th>Detail</th>
                      <th>Severity</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentFlags.map((f, i) => {
                      const rid = f.applicant_id || i;
                      const res = isResolved(resolved, f.flag_type, 'student', f.applicant_id);
                      return (
                        <tr key={`s-${rid}-${f.flag_type}`} style={{ opacity: res ? 0.58 : 1 }}>
                          <td>{FLAG_LABELS[f.flag_type] || f.flag_type}</td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{f.full_name}</div>
                            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{f.email}</div>
                            {res && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{resolvedNote(resolved, f.flag_type, 'student', f.applicant_id)}</div>}
                          </td>
                          <td>{f.fellowship_code || '—'}</td>
                          <td>{f.teacher_name || '—'}</td>
                          <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.detail}</td>
                          <td><SeverityBadge severity={f.severity} /></td>
                          <td>
                            {!res && (
                              <Button variant="ghost" size="sm" onClick={() => handleResolve(f.flag_type, 'student', f.applicant_id)}>
                                Resolve
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Teacher flags */}
          <Section title="Teacher Attention Flags" count={teacherFlags.length} color="#b45309">
            {teacherFlags.length === 0 ? (
              <EmptyState icon="✅" title="No teacher flags" subtitle="All clear." />
            ) : (
              <div className="rso-table-wrap">
                <table className="rso-table">
                  <thead>
                    <tr>
                      <th>Flag</th>
                      <th>Teacher</th>
                      <th>Email</th>
                      <th>Classes</th>
                      <th>Detail</th>
                      <th>Severity</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teacherFlags.map((f, i) => {
                      const rid = f.teacher_id || i;
                      const res = isResolved(resolved, f.flag_type, 'teacher', f.teacher_id);
                      return (
                        <tr key={`t-${rid}-${f.flag_type}`} style={{ opacity: res ? 0.58 : 1 }}>
                          <td>{FLAG_LABELS[f.flag_type] || f.flag_type}</td>
                          <td style={{ fontWeight: 600 }}>{f.full_name}</td>
                          <td>{f.email}</td>
                          <td>{f.class_count ?? '—'}</td>
                          <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.detail}</td>
                          <td><SeverityBadge severity={f.severity} /></td>
                          <td>
                            {!res && (
                              <Button variant="ghost" size="sm" onClick={() => handleResolve(f.flag_type, 'teacher', f.teacher_id)}>
                                Resolve
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* System flags */}
          <Section title="System Flags" count={systemCount} color="#7c2d12">
            {systemFlags.length === 0 ? (
              <EmptyState icon="✅" title="No system flags" subtitle="All systems nominal." />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
                {systemFlags.map((f) => {
                  const res = isResolved(resolved, f.flag_type, 'system', f.flag_type);
                  return (
                    <div key={f.flag_type} className="card" style={{ padding: '1rem', opacity: res ? 0.58 : 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontWeight: 700 }}>{FLAG_LABELS[f.flag_type] || f.flag_type}</span>
                        <SeverityBadge severity={f.severity} />
                      </div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{f.count}</div>
                      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>{f.detail}</div>
                      {!res && (
                        <Button variant="ghost" size="sm" onClick={() => handleResolve(f.flag_type, 'system', f.flag_type)}>
                          Mark Resolved
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, count, color, children }) {
  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {title}
        <span style={{ fontSize: 'var(--fs-xs)', background: color, color: '#fff', borderRadius: 'var(--r-sm)', padding: '0.15rem 0.5rem', fontWeight: 600 }}>
          {count}
        </span>
      </h2>
      {children}
    </section>
  );
}

function SummaryCards({ flags }) {
  const grouped = {};
  for (const f of flags) {
    if (!grouped[f.flag_type]) grouped[f.flag_type] = { count: 0, maxSeverity: 'info' };
    grouped[f.flag_type].count++;
    if (f.severity === 'critical') grouped[f.flag_type].maxSeverity = 'critical';
    else if (f.severity === 'warning' && grouped[f.flag_type].maxSeverity !== 'critical') grouped[f.flag_type].maxSeverity = 'warning';
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
      {Object.entries(grouped).map(([type, { count, maxSeverity }]) => (
        <div key={type} className="card" style={{ padding: '1rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>{FLAG_LABELS[type] || type}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '1.25rem', fontWeight: 800 }}>{count}</span>
            <SeverityBadge severity={maxSeverity} />
          </div>
        </div>
      ))}
    </div>
  );
}
