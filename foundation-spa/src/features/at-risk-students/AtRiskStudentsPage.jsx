import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import {
  PageHeader, Toolbar, SearchInput, Select, Badge, Button, Skeleton, EmptyState, KpiGrid, Kpi,
} from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  fetchAtRiskData, filterLogs, summarize, daysSince,
  SCENARIO_LABELS, SCENARIO_VARIANTS,
  markResponded, withdrawStudent, sendCheckin,
} from './lib/atRisk.js';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'never_started', label: 'Never Started' },
  { id: 'dropped_off', label: 'Dropped Off' },
  { id: 'final_notice', label: 'Final Notice' },
];

export default function AtRiskStudentsPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [batch, setBatch] = useState('');
  const [scenario, setScenario] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['at-risk-students'],
    queryFn: fetchAtRiskData,
    staleTime: 1000 * 60,
  });

  const rows = useMemo(
    () => (data ? filterLogs(data.logs, { tab, scenario, batch, search }) : []),
    [data, tab, scenario, batch, search],
  );
  const kpis = useMemo(() => (data ? summarize(data.logs, data.students) : null), [data]);

  const runAction = useCallback(async (fn, successMsg) => {
    setBusy(true);
    try {
      await fn();
      toast(successMsg, 'success');
      await queryClient.invalidateQueries({ queryKey: ['at-risk-students'] });
    } catch (err) {
      toast(`Failed: ${err?.message || err}`, 'error');
    } finally {
      setBusy(false);
    }
  }, [toast, queryClient]);

  const studentFor = (log) => data?.byEmail.get(String(log.student_email || '').toLowerCase());

  const handleResponded = (log) => runAction(
    () => markResponded({ email: log.student_email, batchId: log.batch_id || '', student: studentFor(log), actorEmail: profile?.email }),
    `${log.student_email} marked as responded — status restored to Active.`,
  );
  const handleWithdraw = (log) => runAction(
    () => withdrawStudent({ email: log.student_email, batchId: log.batch_id || '', student: studentFor(log), actorEmail: profile?.email }),
    `${log.student_email} marked as Withdrawn.`,
  );
  const handleCheckin = (log) => runAction(
    () => sendCheckin({ email: log.student_email, scenario: log.scenario, student: studentFor(log) }),
    `Check-in email queued for ${log.student_email}.`,
  );

  if (isLoading) {
    return (
      <div>
        <PageHeader title="At Risk Students" subtitle="Loading…" />
        <Skeleton variant="row" count={8} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="At Risk Students"
        subtitle="Students flagged by the engagement worker — never started, dropped off, or unresponsive."
        actions={
          <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? 'spin' : ''} /> Refresh
          </Button>
        }
      />

      <KpiGrid>
        <Kpi value={kpis.total} label="Total At Risk" />
        <Kpi value={kpis.neverStarted} label="Never Started" />
        <Kpi value={kpis.droppedOff} label="Dropped Off" />
        <Kpi value={kpis.finalNotice} label="Final Notice Sent" />
        <Kpi value={kpis.withdrawn} label="Withdrawn This Batch" />
      </KpiGrid>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '14px 0' }}>
        {TABS.map((t) => (
          <Button key={t.id} size="sm" variant={tab === t.id ? 'primary' : 'secondary'} onClick={() => setTab(t.id)}>
            {t.label}
          </Button>
        ))}
      </div>

      <Toolbar>
        <SearchInput placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={batch} onChange={(e) => setBatch(e.target.value)} style={{ width: 'auto', minWidth: 150 }}>
          <option value="">All Batches</option>
          {(data?.batches || []).map((b) => <option key={b.batch_id} value={b.batch_id}>{b.batch_name || b.batch_id}</option>)}
        </Select>
        <Select value={scenario} onChange={(e) => setScenario(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
          <option value="">All Scenarios</option>
          {Object.entries(SCENARIO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Toolbar>

      {rows.length === 0 ? (
        <EmptyState icon="🛟" title="No at-risk students" message="No students match the current filters." />
      ) : (
        <div className="rso-table-wrap" style={{ marginTop: 12 }}>
          <table className="rso-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Fellowship</th>
                <th>Class</th>
                <th>Scenario</th>
                <th>Email Sent</th>
                <th>Last Attended</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((log, i) => {
                const stu = studentFor(log);
                const dayAgo = log.email_sent_at ? daysSince(log.email_sent_at) : null;
                const attDays = stu?._last_att_date ? daysSince(stu._last_att_date) : null;
                return (
                  <tr key={log.id ?? i}>
                    <td>
                      <strong>{log._name || log.student_email}</strong>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{log.student_email}</div>
                    </td>
                    <td>{stu?.fellowship_code || '-'}</td>
                    <td>{stu?._class_label || '-'}</td>
                    <td><Badge variant={SCENARIO_VARIANTS[log.scenario] || 'neutral'}>{SCENARIO_LABELS[log.scenario] || log.scenario}</Badge></td>
                    <td style={{ fontSize: 12 }}>{dayAgo != null ? `${dayAgo}d ago` : '-'}</td>
                    <td style={{ fontSize: 12 }}>{attDays != null ? `${attDays}d ago` : 'Never'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Button size="sm" variant="success" disabled={busy} onClick={() => handleResponded(log)}>Mark Responded</Button>
                        <Button size="sm" variant="danger" disabled={busy} onClick={() => handleWithdraw(log)}>Withdraw</Button>
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => handleCheckin(log)}>Send Check-in</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
