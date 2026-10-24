import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchPortalStats, fetchActivityFeed, greeting, relTime } from './lib/adminPortal.js';
import { useAuth } from '../../hooks/useAuth.js';
import { Card, Skeleton, Badge, PageHeader, ErrorBanner } from '../../components/ui/index.js';
import NamedIcon from '../../components/ui/NamedIcon.jsx';

const KPI_TONE = ['navy', 'gold', 'dark', 'coral'];

export default function AdminPortalPage() {
  const { profile } = useAuth();
  const role = profile?.role;
  const isSuperadmin = role === 'superadmin';
  const firstName = (profile?.full_name || profile?.email || '').split(/[\s@]/)[0];

  const stats = useQuery({ queryKey: ['portal-stats'], queryFn: fetchPortalStats, staleTime: 60_000 });
  const feed = useQuery({ queryKey: ['portal-feed'], queryFn: fetchActivityFeed, staleTime: 60_000 });

  const kpis = useMemo(() => [
    { label: 'Enrolled', value: stats.data?.enrolled ?? '—' },
    { label: 'Active Batches', value: stats.data?.activeBatches ?? '—' },
    { label: 'Pending Review', value: stats.data?.pending ?? '—', accent: true },
    { label: 'Active Teachers', value: stats.data?.teachers ?? '—' },
  ], [stats.data]);

  const regCards = [
    { icon: 'clipboard', title: 'Review Queue', to: '/staff/applicant-directory' },
    isSuperadmin && { icon: 'calendar', title: 'Batch Management', to: '/staff/batch-management' },
    { icon: 'clock', title: 'Waiting Students', to: '/staff/waitlist' },
    { icon: 'grid', title: 'Class Editor', to: '/staff/class-editor' },
  ].filter(Boolean);

  const teachCards = [
    { icon: 'check', title: 'Attendance', to: '/staff/dashboards' },
    { icon: 'calendar', title: 'Schedule', to: '/staff/teacher-schedule' },
    { icon: 'users', title: 'Teachers', to: '/staff/teacher-management' },
    { icon: 'message', title: 'Messages', to: '/staff/messages' },
  ];

  const sysCards = isSuperadmin ? [
    { icon: 'refresh', title: 'Failed Syncs', to: '/staff/failed-sync-retry-center' },
    { icon: 'activity', title: 'System Health', to: '/staff/system-health' },
    { icon: 'mail', title: 'Email Campaigns', to: '/staff/email-campaigns' },
    { icon: 'file', title: 'Audit Log', to: '/staff/audit-log' },
  ] : [];

  return (
    <div className="rso-stack">
      <PageHeader title={`${greeting()}, ${firstName}`} subtitle={(stats.data?.pending ?? 0) > 0 ? `${stats.data.pending} registration(s) to review` : 'Everything is up to date'} />

      {/* KPIs */}
      {stats.isLoading ? <Skeleton style={{ height: 90 }} /> : stats.isError ? (
        <ErrorBanner message="Could not load stats." onRetry={() => stats.refetch()} />
      ) : (
        <div className="rso-kpi-grid">
          {kpis.map((k, i) => (
            <div key={k.label} className={`rso-kpi-tile rso-kpi-tile-${KPI_TONE[i]}`}>
              <div className="rso-kpi-tile-value">{k.value}</div>
              <div className="rso-kpi-tile-label">{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Card sections */}
      <CardSection title="Registration & Students" cards={regCards} />
      <CardSection title="Teaching & Engagement" cards={teachCards} />
      {sysCards.length > 0 && <CardSection title="System & Ops" cards={sysCards} />}

      {/* Bottom panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Recent activity */}
        <Card>
          <div className="rso-section-title">Recent Activity</div>
          {feed.isLoading ? <Skeleton style={{ height: 120 }} /> : feed.isError ? (
            <ErrorBanner message="Could not load recent activity." onRetry={() => feed.refetch()} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(feed.data?.recentLogs ?? []).map((log, i) => (
                <div key={i} className="rso-activity-row">
                  <div className="rso-avatar">
                    {(log.actor_name || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{log.actor_name || 'System'}</span>{' '}
                    <span style={{ color: 'var(--muted)' }}>{(log.action || '').replace(/_/g, ' ')}</span>{' '}
                    <span style={{ color: 'var(--muted)', fontSize: 11 }}>{log.entity_type}</span>
                  </div>
                  <span className="rso-mono-time">{relTime(log.created_at)}</span>
                </div>
              ))}
              {(feed.data?.recentLogs ?? []).length === 0 && (
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>No recent activity</p>
              )}
            </div>
          )}
        </Card>

        {/* System health */}
        <Card>
          <div className="rso-section-title">System Health</div>
          {feed.isLoading ? <Skeleton style={{ height: 80 }} /> : feed.isError ? (
            <ErrorBanner message="Could not load system health." onRetry={() => feed.refetch()} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <HealthRow label="Email sender" count={feed.data?.pendingEmails ?? 0} warn={feed.data?.pendingEmails > 0} />
              <HealthRow label="Moodle sync" count={feed.data?.failedMoodle ?? 0} warn={feed.data?.failedMoodle > 0} />
              <HealthRow label="Registration processor" count={0} active />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function CardSection({ title, cards }) {
  return (
    <div>
      <div className="rso-section-title">{title}</div>
      <div className="rso-quick-grid">
        {cards.map((c) => (
          <Link key={c.to} to={c.to} className="rso-quick-card">
            <span className="rso-quick-icon" aria-hidden="true"><NamedIcon name={c.icon} size={20} /></span>
            <span>{c.title}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function HealthRow({ label, count, warn, active }) {
  const tone = active || !warn ? 'success' : 'warning';
  const text = active ? 'Active' : count > 0 ? `${count} pending` : 'OK';
  return (
    <div className="rso-health-row">
      <span>{label}</span>
      <Badge variant={tone}>{text}</Badge>
    </div>
  );
}
