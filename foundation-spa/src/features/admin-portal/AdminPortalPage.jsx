import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchPortalStats, fetchActivityFeed, greeting, relTime } from './lib/adminPortal.js';
import { useAuth } from '../../hooks/useAuth.js';
import { Card, Skeleton, Badge, PageHeader, ErrorBanner } from '../../components/ui/index.js';

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
    { label: 'Teachers', value: stats.data?.teachers ?? '—' },
  ], [stats.data]);

  const regCards = [
    { icon: '📋', title: 'Review Queue', to: '/staff/applicant-directory' },
    isSuperadmin && { icon: '📅', title: 'Batch Management', to: '/staff/batch-management' },
    { icon: '⏳', title: 'Waiting Students', to: '/staff/waitlist' },
    { icon: '🔲', title: 'Class Editor', to: '/staff/class-editor' },
  ].filter(Boolean);

  const teachCards = [
    { icon: '✅', title: 'Attendance', to: '/staff/dashboards' },
    { icon: '📅', title: 'Schedule', to: '/staff/teacher-schedule' },
    { icon: '👥', title: 'Teachers', to: '/staff/teacher-management' },
    { icon: '💬', title: 'Messages', to: '/staff/messages' },
  ];

  const sysCards = isSuperadmin ? [
    { icon: '🔄', title: 'Failed Syncs', to: '/staff/failed-sync-retry-center' },
    { icon: '💚', title: 'System Health', to: '/staff/system-health' },
    { icon: '📧', title: 'Email Campaigns', to: '/staff/email-campaigns' },
    { icon: '📝', title: 'Audit Log', to: '/staff/audit-log' },
  ] : [];

  return (
    <div className="rso-stack">
      <PageHeader title={`${greeting()}, ${firstName}`} subtitle={(stats.data?.pending ?? 0) > 0 ? `${stats.data.pending} registration(s) to review` : 'Everything is up to date'} />

      {/* KPIs */}
      {stats.isLoading ? <Skeleton style={{ height: 90 }} /> : stats.isError ? (
        <ErrorBanner message="Could not load stats." onRetry={() => stats.refetch()} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          {kpis.map((k) => (
            <Card key={k.label}>
              <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: k.accent ? 'var(--color-warning)' : 'var(--text)' }}>{k.value}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 4 }}>{k.label}</div>
            </Card>
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
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>Recent Activity</div>
          {feed.isLoading ? <Skeleton style={{ height: 120 }} /> : feed.isError ? (
            <ErrorBanner message="Could not load recent activity." onRetry={() => feed.refetch()} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(feed.data?.recentLogs ?? []).map((log, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: log.actor_name === 'system' ? 'var(--surface-2)' : 'var(--soft-lav, #ede9fe)',
                    fontSize: 10, fontWeight: 700, color: 'var(--primary)', flexShrink: 0,
                  }}>
                    {(log.actor_name || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>{log.actor_name || 'System'}</span>{' '}
                    <span style={{ color: 'var(--muted)' }}>{(log.action || '').replace(/_/g, ' ')}</span>{' '}
                    <span style={{ color: 'var(--muted)', fontSize: 11 }}>{log.entity_type}</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{relTime(log.created_at)}</span>
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
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>System Health</div>
          {feed.isLoading ? <Skeleton style={{ height: 80 }} /> : feed.isError ? (
            <ErrorBanner message="Could not load system health." onRetry={() => feed.refetch()} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {cards.map((c) => (
          <Link key={c.to} to={c.to} style={{ textDecoration: 'none', color: 'inherit' }}>
            <Card style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <span style={{
                width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, background: 'var(--surface-2)', flexShrink: 0,
              }}>{c.icon}</span>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{c.title}</span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function HealthRow({ label, count, warn, active }) {
  const dotColor = active ? 'var(--color-success)' : warn ? 'var(--color-warning)' : 'var(--color-success)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, display: 'inline-block', flexShrink: 0 }} />
        {label}
      </div>
      <span style={{ color: 'var(--muted)', fontSize: 11 }}>
        {active ? 'Active' : count > 0 ? `${count} pending` : 'OK'}
      </span>
    </div>
  );
}
