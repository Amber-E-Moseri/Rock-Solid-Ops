import { useState, useMemo } from 'react';
import { useBatches, useAttentionData, useMarkResolved } from './hooks/useNeedsAttention.js';
import { FLAG_LABELS, isResolved, resolvedNote, filterFlags } from './lib/needsAttention.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  PageHeader, Toolbar, SearchInput, Skeleton, EmptyState, Badge, Button,
} from '../../components/ui/index.js';

const SECTIONS = ['students', 'teachers', 'system'];

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
  const addToast = useToast();

  const [batchId, setBatchId] = useState('');
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [section, setSection] = useState('students');

  const { data: batches } = useBatches();
  const { data, isLoading, isError, dataUpdatedAt } = useAttentionData(batchId || undefined);
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

  const tabLabels = {
    students: `Students (${studentFlags.length})`,
    teachers: `Teachers (${teacherFlags.length})`,
    system: `System (${systemCount})`,
  };

  return (
    <div className="page-content">
      <PageHeader
        title="Needs Attention"
        subtitle={dataUpdatedAt ? `Updated ${relTime(dataUpdatedAt)}` : ''}
      />

      {/* Summary tiles: counts come from the live flag lists. */}
      <div className="rso-kpi-grid">
        <div className="rso-kpi-tile rso-kpi-tile-coral">
          <div className="rso-kpi-tile-value">{studentFlags.length}</div>
          <div className="rso-kpi-tile-label">Students</div>
        </div>
        <div className="rso-kpi-tile rso-kpi-tile-gold">
          <div className="rso-kpi-tile-value">{teacherFlags.length}</div>
          <div className="rso-kpi-tile-label">Teachers</div>
        </div>
        <div className="rso-kpi-tile rso-kpi-tile-dark">
          <div className="rso-kpi-tile-value">{systemCount}</div>
          <div className="rso-kpi-tile-label">System</div>
        </div>
      </div>

      <Toolbar>
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, flag…" />
        <select className="rso-select" aria-label="Filter by batch" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          <option value="">All batches</option>
          {(batches ?? []).map((b) => <option key={b.batch_id} value={b.batch_id}>{b.batch_name}</option>)}
        </select>
        <select className="rso-select" aria-label="Filter by severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
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
      ) : isError ? (
        <EmptyState icon="⚠️" title="Needs Attention data unavailable" subtitle="The flags could not be loaded for your account. Nothing is shown as clear." />
      ) : (
        <>
          <div className="rso-tabs" role="tablist" aria-label="Attention sections" style={{ marginTop: 16 }}>
            {SECTIONS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`attention-tab-${key}`}
                aria-selected={section === key}
                aria-controls="attention-tabpanel"
                className="rso-tab"
                onClick={() => setSection(key)}
              >{tabLabels[key]}</button>
            ))}
          </div>

          <div role="tabpanel" id="attention-tabpanel" aria-labelledby={`attention-tab-${section}`}>
            {section === 'students' && (
              studentFlags.length === 0 ? (
                <EmptyState icon="✅" title="No student flags" message="All clear." />
              ) : isRegSec ? (
                <SummaryCards flags={studentFlags} />
              ) : (
                <>
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
                                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>{f.email}</div>
                                {res && <div style={{ fontSize: '0.65rem', color: 'var(--muted)', fontStyle: 'italic' }}>{resolvedNote(resolved, f.flag_type, 'student', f.applicant_id)}</div>}
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
                  <div className="rso-table-cards">
                    {studentFlags.map((f, i) => {
                      const rid = f.applicant_id || i;
                      const res = isResolved(resolved, f.flag_type, 'student', f.applicant_id);
                      return (
                        <div key={`sc-${rid}-${f.flag_type}`} className="rso-table-card" style={{ opacity: res ? 0.58 : 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700 }}>{f.full_name}</div>
                              <div style={{ fontSize: 12, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{f.email}</div>
                            </div>
                            <SeverityBadge severity={f.severity} />
                          </div>
                          <div className="rso-table-card-row"><span className="rso-table-card-label">Flag</span><span>{FLAG_LABELS[f.flag_type] || f.flag_type}</span></div>
                          <div className="rso-table-card-row"><span className="rso-table-card-label">Detail</span><span>{f.detail || '—'}</span></div>
                          {!res && (
                            <div style={{ marginTop: 8 }}>
                              <Button variant="ghost" size="sm" onClick={() => handleResolve(f.flag_type, 'student', f.applicant_id)}>Resolve</Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )
            )}

            {section === 'teachers' && (
              teacherFlags.length === 0 ? (
                <EmptyState icon="✅" title="No teacher flags" message="All clear." />
              ) : (
                <>
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
                  <div className="rso-table-cards">
                    {teacherFlags.map((f, i) => {
                      const rid = f.teacher_id || i;
                      const res = isResolved(resolved, f.flag_type, 'teacher', f.teacher_id);
                      return (
                        <div key={`tc-${rid}-${f.flag_type}`} className="rso-table-card" style={{ opacity: res ? 0.58 : 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700 }}>{f.full_name}</div>
                              <div style={{ fontSize: 12, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{f.email}</div>
                            </div>
                            <SeverityBadge severity={f.severity} />
                          </div>
                          <div className="rso-table-card-row"><span className="rso-table-card-label">Flag</span><span>{FLAG_LABELS[f.flag_type] || f.flag_type}</span></div>
                          <div className="rso-table-card-row"><span className="rso-table-card-label">Classes</span><span>{f.class_count ?? '—'}</span></div>
                          {!res && (
                            <div style={{ marginTop: 8 }}>
                              <Button variant="ghost" size="sm" onClick={() => handleResolve(f.flag_type, 'teacher', f.teacher_id)}>Resolve</Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )
            )}

            {section === 'system' && (
              systemFlags.length === 0 ? (
                <EmptyState icon="✅" title="No system flags" message="All systems nominal." />
              ) : (
                <div className="rso-quick-grid">
                  {systemFlags.map((f) => {
                    const res = isResolved(resolved, f.flag_type, 'system', f.flag_type);
                    return (
                      <div key={f.flag_type} className="rso-kpi-tile" style={{ opacity: res ? 0.58 : 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span style={{ fontWeight: 700 }}>{FLAG_LABELS[f.flag_type] || f.flag_type}</span>
                          <SeverityBadge severity={f.severity} />
                        </div>
                        <div className="rso-kpi-tile-value">{f.count}</div>
                        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', margin: '6px 0 10px' }}>{f.detail}</div>
                        {!res && (
                          <Button variant="ghost" size="sm" onClick={() => handleResolve(f.flag_type, 'system', f.flag_type)}>
                            Mark Resolved
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        </>
      )}
    </div>
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
    <div className="rso-quick-grid">
      {Object.entries(grouped).map(([type, { count, maxSeverity }]) => (
        <div key={type} className="rso-kpi-tile">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{FLAG_LABELS[type] || type}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="rso-kpi-tile-value">{count}</span>
            <SeverityBadge severity={maxSeverity} />
          </div>
        </div>
      ))}
    </div>
  );
}
