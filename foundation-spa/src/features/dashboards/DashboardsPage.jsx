import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Download } from 'lucide-react';
import {
  PageHeader, Card, Badge, Button, Skeleton, Select,
} from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useBatches, useScope, useDashboardData } from './hooks/useDashboard.js';
import { retryAllFailedMoodleSyncs, exportCapacityCsv, fmtDate, fmtTime, relativeMinutes, isRegionalSecretary } from './lib/dashboard.js';
import { HorizontalBarChart, DoughnutChart, SparklineChart, ProgressBar, FunnelGrid } from './components/MiniCharts.jsx';

const STATUS_VARIANT = { ASSIGNED: 'success', PENDING: 'info', WAITLISTED: 'warning', DUPLICATE: 'danger', REVIEW: 'warning', INACTIVE: 'neutral' };

export default function DashboardsPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [batchId, setBatchId] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const { data: batches } = useBatches();
  const { data: scope } = useScope();
  const { data: d, isLoading, isFetching } = useDashboardData(batchId, scope?.subgroups);

  const isRS = isRegionalSecretary(profile?.role);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['dashboard-data'] });
  }, [queryClient]);

  const handleRetryMoodle = useCallback(async () => {
    setRetrying(true);
    try {
      await retryAllFailedMoodleSyncs();
      queryClient.invalidateQueries({ queryKey: ['dashboard-data'] });
      toast('Moodle sync retry initiated', 'success');
    } catch {
      toast('Retry failed', 'error');
    } finally {
      setRetrying(false);
    }
  }, [queryClient, toast]);

  if (isLoading) {
    return (
      <div className="rso-stack">
        <Skeleton style={{ height: 40 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} style={{ height: 90, borderRadius: 12 }} />)}
        </div>
        <Skeleton style={{ height: 200 }} />
        <Skeleton style={{ height: 200 }} />
      </div>
    );
  }

  const reg = d?.registration;
  const stale = d?.staleQueue;
  const teacherKpis = d?.teacherKpis;
  const att = d?.attendance;
  const ms = d?.milestones;
  const moodle = d?.moodleSync;

  return (
    <div className="rso-stack">
      {/* Header */}
      <PageHeader
        title="Operational Dashboard"
        subtitle="Live registration and delivery summary"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Select value={batchId || ''} onChange={(e) => setBatchId(e.target.value || null)} style={{ minWidth: 180 }}>
              <option value="">All Batches</option>
              {(batches || []).map((b) => (
                <option key={b.batch_id} value={b.batch_id}>
                  {b.active ? '[A] ' : ''}{b.displayName}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={handleRefresh} disabled={isFetching}>
              <RefreshCw size={14} style={{ marginRight: 4, ...(isFetching ? { animation: 'spin 1s linear infinite' } : {}) }} />
              Refresh
            </Button>
            {d?.fetchedAt && (
              <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                Updated {relativeMinutes(d.fetchedAt)}
              </span>
            )}
          </div>
        }
      />

      {/* Scope banner */}
      {scope?.scoped && (
        <div className="rso-banner rso-banner-info">
          <strong>Scoped view:</strong> Showing data for your assigned subgroups only.
        </div>
      )}

      {/* Stale queue banner */}
      {stale?.count > 0 && (
        <div className="rso-banner rso-banner-warning" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span><strong>{stale.count} registration(s)</strong> have been in REVIEW status for over 48 hours.</span>
          <Button size="sm" variant="secondary" onClick={() => navigate('/staff/applicant-directory')}>View Applicants</Button>
        </div>
      )}

      {/* Batch switcher pills */}
      {batches?.length > 0 && (
        <div className="rso-pill-row">
          <BatchPill active={!batchId} onClick={() => setBatchId(null)} label="All Batches" meta="" />
          {batches.map((b) => (
            <BatchPill
              key={b.batch_id}
              active={batchId === b.batch_id}
              onClick={() => setBatchId(b.batch_id)}
              label={b.displayName}
              meta={`${fmtDate(b.start_date)} — ${b.active ? 'Active' : 'Inactive'} — ${b.studentCount} students`}
            />
          ))}
        </div>
      )}

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        <KpiCard value={reg?.enrolled} label="Total Enrolled" asOf={d?.fetchedAt} />
        <KpiCard value={reg?.waitlisted} label="Waitlisted" variant="warn" asOf={d?.fetchedAt} />
        <KpiCard value={reg?.pendingReview} label="Pending Review" variant="danger" asOf={d?.fetchedAt} />
        <KpiCard value={reg?.duplicates} label="Duplicates" variant="muted" asOf={d?.fetchedAt} />
        <KpiCard value={teacherKpis?.activeCertified} label="Active/Certified Teachers" asOf={d?.fetchedAt} />
        <KpiCard value={teacherKpis?.currentlyTeaching} label="Currently Teaching" asOf={d?.fetchedAt} />
        <KpiCard value={stale?.count} label="Stale Reviews (>48 h)" variant={stale?.count > 10 ? 'danger' : 'warn'} asOf={d?.fetchedAt} />
      </div>

      {/* Duplicate summary */}
      {d?.duplicates && (
        <Card>
          <div className="rso-media-row">
            <div>
              <div style={{ fontSize: 14, fontWeight: 800 }}>Duplicate Registrations</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--danger)', lineHeight: 1.1, marginTop: 4 }}>
                {d.duplicates.count.toLocaleString()}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
                {d.duplicates.count > 0
                  ? `Newest duplicate: ${fmtDate(d.duplicates.newestDate)}`
                  : 'No unresolved duplicate groups in your current scope.'}
              </div>
            </div>
            <Button variant="secondary" onClick={() => navigate('/staff/applicant-directory?duplicate=unresolved_only')}>
              Open Applicant Directory
            </Button>
          </div>
        </Card>
      )}

      {/* Attendance health */}
      {att && (
        <Card>
          <SectionHeader title="Attendance Health" asOf={att.calculatedAt || d?.fetchedAt} />
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: att.rate > 80 ? '#15803d' : att.rate >= 60 ? '#b45309' : '#b91c1c' }}>
            {att.rate.toFixed(1)}% attendance submission rate
          </div>
          <ProgressBar value={att.rate} />
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            {att.submitted.toLocaleString()} submitted / {att.expected.toLocaleString()} expected — {att.zeroClasses} classes with zero submissions — {att.staleClasses} stale classes
          </div>
          {att.missingClasses.length > 0 && (
            <div className="rso-table-wrap" style={{ marginTop: 12 }}>
              <table className="rso-table">
                <thead><tr><th>Teacher</th><th>Class</th><th>Last submitted</th><th>Sessions missing</th></tr></thead>
                <tbody>
                  {att.missingClasses.map((m, i) => (
                    <tr key={i}>
                      <td>{m.teacher_name || '-'}</td>
                      <td>{m.class_label || '-'}</td>
                      <td>{fmtTime(m.last_submitted)}</td>
                      <td>{Number(m.sessions_missing || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* 3-column ops row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Milestone progress */}
        {ms && (
          <Card>
            <SectionHeader title="Student Milestone Progress" asOf={ms.calculatedAt || d?.fetchedAt} />
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              {ms.fullyComplete}/{ms.total} fully complete — {ms.zeroComplete} with zero complete — avg {ms.avgPct.toFixed(1)}%
            </div>
            <ProgressBar value={ms.completionPct} />
            {ms.breakdown.length > 0 && (
              <div className="rso-table-wrap" style={{ marginTop: 12 }}>
                <table className="rso-table">
                  <thead><tr><th>Milestone</th><th>% completed</th></tr></thead>
                  <tbody>
                    {ms.breakdown.map((m, i) => (
                      <tr key={i}>
                        <td>{m.milestone_name || m.milestone_code || '-'}</td>
                        <td>{Number(m.completion_pct || 0).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* Moodle sync health */}
        {moodle && (
          <Card>
            <SectionHeader title="Moodle Sync Health" asOf={d?.fetchedAt} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              <FunnelStep label="SYNCED" value={moodle.counts.SYNCED} cls="#15803d" />
              <FunnelStep label="PENDING" value={moodle.counts.PENDING} cls="#b45309" />
              <FunnelStep label="FAILED" value={moodle.counts.FAILED} cls="#b91c1c" />
              <FunnelStep label="PROCESSING" value={moodle.counts.PROCESSING} cls="#15803d" />
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
              Last successful sync: {fmtTime(moodle.lastSuccess)}
            </div>
            <Button size="sm" variant="secondary" onClick={handleRetryMoodle} disabled={retrying} style={{ marginTop: 12 }}>
              {retrying ? 'Retrying…' : 'Retry all failed'}
            </Button>
          </Card>
        )}

        {/* Quick actions */}
        <Card>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: 'var(--text)' }}>Quick Actions</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <Button size="sm" variant="secondary" onClick={() => navigate('/staff/teacher-schedule')}>Approve Teacher Slots</Button>
            <Button size="sm" variant="secondary" onClick={handleRetryMoodle} disabled={retrying}>Retry all failed Moodle syncs</Button>
            <Button size="sm" variant="secondary" onClick={() => navigate('/staff/audit-log')}>View audit log</Button>
            <Button size="sm" variant="secondary" onClick={() => d?.capacity && exportCapacityCsv(d.capacity)}>
              <Download size={14} style={{ marginRight: 4 }} />
              Export student list (CSV)
            </Button>
          </div>
        </Card>
      </div>

      {/* Registration funnel */}
      {d?.funnel && (
        <Card>
          <SectionHeader title="Registration Funnel" asOf={d?.fetchedAt} />
          <FunnelGrid steps={d.funnel} />
        </Card>
      )}

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {/* Registration status bar chart */}
        {reg?.rows?.length > 0 && (
          <Card>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>Registration Status</div>
            <HorizontalBarChart rows={reg.rows.map((r) => ({ label: r.reg_status, value: Number(r.cnt) }))} />
          </Card>
        )}

        {/* Fellowship doughnut */}
        {d?.fellowship?.length > 0 && (
          <Card>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>Fellowship Breakdown</div>
            <DoughnutChart rows={d.fellowship.map((r) => ({ label: r.fellowship, value: Number(r.cnt) }))} />
          </Card>
        )}
      </div>

      {/* Weekly trend sparkline */}
      {d?.weeklyTrend?.length > 0 && (
        <Card>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>Weekly Registrations (last 12 weeks)</div>
          <SparklineChart
            points={d.weeklyTrend.map((r) => Number(r.cnt))}
            labels={d.weeklyTrend.map((r) => fmtDate(r.week_start).replace(/,?\s*\d{4}$/, ''))}
          />
        </Card>
      )}

      {/* Class capacity */}
      {d?.capacity?.length > 0 && (
        <Card>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>Class Capacity</div>
          <div className="rso-table-wrap">
            <table className="rso-table">
              <thead><tr><th>Class</th><th>Teacher</th><th>Enrolled</th><th>Status</th></tr></thead>
              <tbody>
                {d.capacity.map((r, i) => (
                  <tr key={i}>
                    <td>{r.classLabel}</td>
                    <td>{r.teacher_name}</td>
                    <td>{r.enrolled.toLocaleString()}</td>
                    <td>
                      <Badge variant={r.max > 0 && r.enrolled >= r.max ? 'warning' : 'success'}>
                        {r.max > 0 && r.enrolled >= r.max ? 'Full' : 'Active'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Escalation + activity row */}
      {!isRS && (
        <div className="rso-split">
          <Card>
            <SectionHeader title="Escalation Tasks" />
            {d?.escalation?.length > 0 ? (
              <div className="rso-table-wrap">
                <table className="rso-table" style={{ minWidth: 700 }}>
                  <thead><tr><th>Type</th><th>Person</th><th>Class</th><th>Status</th><th>Error</th><th>Created</th></tr></thead>
                  <tbody>
                    {d.escalation.map((r, i) => (
                      <tr key={i}>
                        <td>{r.source_type || '-'}</td>
                        <td>{r.person_name || '-'}</td>
                        <td>{r.class_info || '-'}</td>
                        <td><Badge variant={r.task_status === 'DONE' ? 'success' : r.task_status === 'FAILED' ? 'danger' : 'warning'}>{r.task_status}</Badge></td>
                        <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.error_message || '-'}</td>
                        <td>{fmtDate(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 13 }}>
                No escalation tasks on record.
              </div>
            )}
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Recent Activity</div>
            <div className="rso-table-wrap">
              <table className="rso-table">
                <thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Entity</th></tr></thead>
                <tbody>
                  {(d?.activityFeed || []).length > 0 ? d.activityFeed.map((r, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap' }}>{relativeMinutes(r.created_at)}</td>
                      <td>{r.action || '-'}</td>
                      <td>{r.actor_email || 'system'}</td>
                      <td>{r.entity_type || '-'}{r.entity_id ? `:${r.entity_id}` : ''}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan="4">No activity.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Recent registrations */}
      {d?.recentRegistrations?.length > 0 && (
        <Card>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>Recent Registrations</div>
          <div className="rso-table-wrap">
            <table className="rso-table">
              <thead><tr><th>Time</th><th>Name</th><th>Email</th><th>Fellowship</th><th>Batch</th><th>Status</th><th>Availability</th></tr></thead>
              <tbody>
                {d.recentRegistrations.map((r, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(r.created_at || r.submitted_at)}</td>
                    <td>{r.full_name || r.name || '-'}</td>
                    <td>{r.email || '-'}</td>
                    <td>{r.fellowship_code || r.group_id || '-'}{r.subgroup_id ? ` / ${r.subgroup_id}` : ''}</td>
                    <td>{r.batch_id || '-'}</td>
                    <td><Badge variant={STATUS_VARIANT[String(r.registration_status || r.status || '').toUpperCase()] || 'neutral'}>{r.registration_status || r.status || '-'}</Badge></td>
                    <td>{r.availability_status || r.availability_outcome || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards (fallback for <640px) */}
          <div className="rso-table-cards">
            {d.recentRegistrations.map((r, i) => (
              <div key={i} className="rso-table-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{r.full_name || r.name || '-'}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.email || '-'}</div>
                  </div>
                  <Badge variant={STATUS_VARIANT[String(r.registration_status || r.status || '').toUpperCase()] || 'neutral'}>{r.registration_status || r.status || '-'}</Badge>
                </div>
                <div className="rso-table-card-row"><span className="rso-table-card-label">Fellowship</span><span>{r.fellowship_code || r.group_id || '-'}{r.subgroup_id ? ` / ${r.subgroup_id}` : ''}</span></div>
                <div className="rso-table-card-row"><span className="rso-table-card-label">Batch</span><span>{r.batch_id || '-'}</span></div>
                <div className="rso-table-card-row"><span className="rso-table-card-label">Availability</span><span>{r.availability_status || r.availability_outcome || '-'}</span></div>
                <div className="rso-table-card-row"><span className="rso-table-card-label">Time</span><span>{fmtTime(r.created_at || r.submitted_at)}</span></div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function KpiCard({ value, label, variant, asOf }) {
  const color = variant === 'danger' ? 'var(--danger)'
    : variant === 'warn' ? 'var(--warn)'
    : variant === 'muted' ? 'var(--muted)'
    : 'var(--primary)';
  return (
    <article style={{
      border: '1px solid var(--border)', borderLeft: `3px solid ${color}`,
      background: 'var(--surface)', borderRadius: 12, padding: 20, boxShadow: 'var(--sh-xs)',
    }}>
      <div style={{ fontSize: '2rem', fontWeight: 800, color, lineHeight: 1.1 }}>
        {value != null ? Number(value).toLocaleString() : '-'}
      </div>
      <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)' }}>
        {label}
      </div>
      {asOf && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>as of {relativeMinutes(asOf)}</div>}
    </article>
  );
}

function SectionHeader({ title, asOf }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
      {asOf && <span style={{ fontSize: 11, color: 'var(--muted)' }}>as of {relativeMinutes(asOf)}</span>}
    </div>
  );
}

function FunnelStep({ label, value, cls }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: 'var(--surface-2)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 800, marginTop: 4, color: cls }}>{value.toLocaleString()}</div>
    </div>
  );
}

function BatchPill({ active, onClick, label, meta }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rso-pill${active ? ' active' : ''}`}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: active ? 'var(--primary)' : 'var(--text)' }}>{label}</div>
      {meta && <div style={{ marginTop: 2, fontSize: 11, color: 'var(--muted)' }}>{meta}</div>}
    </button>
  );
}
