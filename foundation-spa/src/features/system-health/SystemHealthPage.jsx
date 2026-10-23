import { RefreshCw } from 'lucide-react';
import { PageHeader, Card, Badge, Button, Skeleton } from '../../components/ui/index.js';
import { useSystemHealth } from './hooks/useSystemHealth.js';
import { fmtDateTime } from './lib/system-health.js';

export default function SystemHealthPage() {
  const supabaseUrl = window.FS_CONFIG?.SUPABASE_URL || '';
  const anonKey = window.FS_CONFIG?.SUPABASE_ANON_KEY || '';

  const { checks, metrics, failures, refresh } = useSystemHealth(supabaseUrl, anonKey);

  const isLoading = checks.isLoading && metrics.isLoading;
  const isFetching = checks.isFetching || metrics.isFetching || failures.isFetching;

  const healthChecks = checks.data?.checks || [];
  const missingTables = checks.data?.missingTables || [];
  const queueMetrics = metrics.data;
  const failureRows = failures.data || [];

  const passCount = healthChecks.filter((c) => c.state === 'pass').length;
  const warnCount = healthChecks.filter((c) => c.state === 'warn').length;
  const failCount = healthChecks.filter((c) => c.state === 'fail').length;
  const overallState = failCount > 0 ? 'bad' : warnCount > 0 ? 'degraded' : healthChecks.length > 0 ? 'ok' : 'loading';
  const uptimePct = healthChecks.length > 0 ? Math.round((passCount / healthChecks.length) * 100) : null;

  if (isLoading) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Skeleton style={{ height: 60 }} />
        <Skeleton style={{ height: 200 }} />
        <Skeleton style={{ height: 200 }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="System Health"
        subtitle="Live status of the workers, queues and integrations that keep Rock Solid running."
        actions={
          <Button onClick={refresh} disabled={isFetching}>
            <RefreshCw size={14} style={{ marginRight: 4, ...(isFetching ? { animation: 'spin 1s linear infinite' } : {}) }} />
            Refresh
          </Button>
        }
      />

      {/* Status bar */}
      <StatusBar state={overallState} uptimePct={uptimePct} passCount={passCount} warnCount={warnCount} failCount={failCount} total={healthChecks.length} />

      {/* Runtime checks grid */}
      {healthChecks.length > 0 && (
        <Card>
          <div className="rso-section-title">Runtime checks</div>
          <div className="rso-health-grid">
            {healthChecks.map((c) => (
              <div key={c.key} className="rso-health-tile">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div className="rso-health-title">{c.title}</div>
                  <HealthChip state={c.state} />
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.55, minHeight: 32 }}>{c.detail}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Queue depths + failures */}
      <div className="rso-two-pane">
        {/* Recent failures */}
        <Card>
          <div className="rso-section-title">Recent failures</div>
          {failureRows.length === 0 ? (
            <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 13, fontWeight: 600 }}>
              No recent failures found across monitored tables.
            </div>
          ) : (
            <div className="rso-table-wrap">
              <table className="rso-table" style={{ minWidth: 640 }}>
                <thead><tr><th>Source</th><th>Status</th><th>Target</th><th>Error</th><th>Created</th><th>Updated</th></tr></thead>
                <tbody>
                  {failureRows.map((f, i) => (
                    <tr key={i}>
                      <td>{f.source}</td>
                      <td><Badge variant={f.status.toLowerCase().includes('fail') ? 'danger' : 'warning'}>{f.status}</Badge></td>
                      <td>{f.target}</td>
                      <td style={{ maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--muted)' }} title={f.error}>{f.error}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(f.createdAt)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(f.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Queue depths */}
        {queueMetrics && (
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div className="rso-section-title" style={{ marginBottom: 0 }}>Queue depths</div>
              <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>live</span>
            </div>
            <div className="rso-table-wrap">
            <table className="rso-table">
              <thead>
                <tr>
                  <th>Queue</th>
                  <th style={{ textAlign: 'right' }}>Depth</th>
                  <th style={{ textAlign: 'right' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {queueMetrics.queues.map((q) => (
                  <tr key={q.name}>
                    <td><span style={{ fontWeight: 700 }}>{q.name}</span></td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--fs-font-mono)', fontWeight: 600 }}>{q.depth}</td>
                    <td style={{ textAlign: 'right' }}>
                      <QueueBadge depth={q.depth} warnAt={q.warnAt} badAt={q.badAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Card>
        )}
      </div>

      {/* Table notes */}
      {missingTables.length > 0 && (
        <Card>
          <div className="rso-section-title">Table notes</div>
          <ul style={{ margin: '0 0 0 18px', color: 'var(--muted)', fontSize: 13, fontWeight: 600, lineHeight: 1.7 }}>
            {missingTables.map((t) => <li key={t}>Optional table missing: {t}</li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

const qth = { textAlign: 'left', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', padding: '10px 16px', borderBottom: '1px solid var(--border)' };
const qtd = { padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 };

function StatusBar({ state, uptimePct, passCount, warnCount, failCount, total }) {
  const borderColor = state === 'bad' ? 'var(--danger)' : state === 'degraded' ? 'var(--warn)' : 'var(--success)';
  const pulseColor = borderColor;
  const label = state === 'bad' ? 'System error detected' : state === 'degraded' ? 'Attention required' : state === 'ok' ? 'All systems operational' : 'Checking…';
  const sub = state === 'ok' ? 'Auth, queues, emails and sync are all responding normally.'
    : `${passCount} pass, ${warnCount} warn, ${failCount} fail out of ${total} checks.`;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, background: 'var(--surface)',
      border: '1px solid var(--border)', borderLeft: `4px solid ${borderColor}`,
      borderRadius: 'var(--r-lg, 12px)', padding: '16px 20px', boxShadow: 'var(--sh-xs)',
    }}>
      <span style={{
        width: 12, height: 12, borderRadius: '50%', background: pulseColor, flexShrink: 0,
        animation: 'pulse-dot 1.8s ease-out infinite',
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{label}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>{sub}</div>
      </div>
      {uptimePct != null && (
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--success)', fontFamily: 'monospace' }}>{uptimePct}%</div>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)' }}>Uptime</div>
        </div>
      )}
    </div>
  );
}

function HealthChip({ state }) {
  const bg = state === 'pass' ? 'var(--success-bg, #ecfdf5)' : state === 'warn' ? 'var(--warn-bg, #fffbeb)' : 'var(--danger-bg, #fef2f2)';
  const color = state === 'pass' ? 'var(--success)' : state === 'warn' ? 'var(--warn)' : 'var(--danger)';
  const label = state === 'pass' ? 'PASS' : state === 'warn' ? 'WARN' : 'FAIL';
  return (
    <span style={{
      borderRadius: 999, padding: '3px 10px', fontSize: 10, fontWeight: 800,
      textTransform: 'uppercase', letterSpacing: '.05em', background: bg, color, flexShrink: 0,
    }}>{label}</span>
  );
}

function QueueBadge({ depth, warnAt, badAt }) {
  const level = depth >= badAt ? 'bad' : depth >= warnAt ? 'warn' : 'ok';
  const bg = level === 'bad' ? 'var(--danger-bg, #fef2f2)' : level === 'warn' ? 'var(--warn-bg, #fffbeb)' : 'var(--success-bg, #ecfdf5)';
  const color = level === 'bad' ? 'var(--danger)' : level === 'warn' ? 'var(--warn)' : 'var(--success)';
  const label = level === 'bad' ? 'HIGH' : level === 'warn' ? 'ELEVATED' : 'OK';
  return (
    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: bg, color }}>{label}</span>
  );
}
