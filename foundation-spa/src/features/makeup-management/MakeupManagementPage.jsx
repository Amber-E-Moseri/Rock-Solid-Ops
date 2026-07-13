import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import { fetchBatchOptions, fetchMakeupQueue, computeStats, filterQueue, markComplete, extendDeadline } from './lib/makeupManagement.js';
import { PageHeader, Toolbar, SearchInput, Skeleton, EmptyState, Badge, Button, Modal, KpiGrid, Kpi } from '../../components/ui/index.js';

const ADMIN_ROLES = ['admin', 'superadmin', 'principal', 'subgroup_admin', 'pastor'];

export default function MakeupManagementPage() {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const isAdmin = ADMIN_ROLES.includes(profile?.role);

  const [batchId, setBatchId] = useState('');
  const [search, setSearch] = useState('');
  const [subgroup, setSubgroup] = useState('');
  const [status, setStatus] = useState('');
  const [completeModal, setCompleteModal] = useState(null);
  const [extendModal, setExtendModal] = useState(null);

  const batches = useQuery({ queryKey: ['makeup-batches'], queryFn: fetchBatchOptions, staleTime: 5 * 60_000 });
  const { data: queue = [], isLoading, refetch } = useQuery({
    queryKey: ['makeup-queue', batchId],
    queryFn: () => fetchMakeupQueue(batchId || null),
    staleTime: 60_000,
  });

  const stats = useMemo(() => computeStats(queue), [queue]);
  const filtered = useMemo(() => filterQueue(queue, { search, subgroup, status }), [queue, search, subgroup, status]);
  const subgroups = useMemo(() => [...new Set(queue.map((m) => m.students?.subgroup_id).filter(Boolean))].sort(), [queue]);

  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-CA') : '—'; }
  function isOverdue(m) { return !m.makeup_completed && m.deadline && new Date(m.deadline) < new Date(); }

  async function handleComplete() {
    if (!completeModal) return;
    try {
      await markComplete(completeModal, profile?.id);
      addToast('Marked complete', 'success');
      refetch();
    } catch (e) { addToast(e.message, 'error'); }
    setCompleteModal(null);
  }

  return (
    <div className="page-content">
      <PageHeader title="Makeup Management" actions={<Button variant="secondary" size="sm" onClick={refetch}>Refresh</Button>} />

      {stats.overdue > 0 && (
        <div style={{ background: 'var(--color-warning-bg, #fef3cd)', border: '1px solid var(--color-warning-border, #ffc107)', borderRadius: 'var(--r-md)', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: 'var(--fs-sm)' }}>
          <strong>{stats.overdue} overdue makeup(s)</strong> — students cannot graduate (Gate 1) until all makeups are completed.
        </div>
      )}

      <KpiGrid>
        <Kpi label="Pending" value={stats.pending} />
        <Kpi label="Overdue" value={stats.overdue} />
        <Kpi label="Done This Week" value={stats.doneThisWeek} />
        <Kpi label="Completion Rate" value={`${stats.completionRate}%`} />
      </KpiGrid>

      <Toolbar>
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email…" />
        <select className="rso-select" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          <option value="">All batches</option>
          {(batches.data ?? []).map((b) => <option key={b.batch_id} value={b.batch_id}>{b.batch_name || b.batch_id}</option>)}
        </select>
        <select className="rso-select" value={subgroup} onChange={(e) => setSubgroup(e.target.value)}>
          <option value="">All subgroups</option>
          {subgroups.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="rso-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option><option value="overdue">Overdue</option><option value="complete">Complete</option>
        </select>
      </Toolbar>

      {isLoading ? <Skeleton variant="rows" rows={5} /> : filtered.length === 0 ? (
        <EmptyState icon="📋" title="No makeups" subtitle="No makeup records match your filters" />
      ) : (
        <div className="rso-table-wrap">
          <table className="rso-table">
            <thead><tr><th>Student</th><th>Fellowship</th><th>Class Missed</th><th>Type</th><th>Deadline</th><th>Status</th>{isAdmin && <th>Actions</th>}</tr></thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id}>
                  <td><div style={{ fontWeight: 600 }}>{m.students?.full_name || '—'}</div><div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{m.students?.email || ''}</div></td>
                  <td>{m.students?.fellowship_code || '—'}<br /><span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{m.students?.subgroup_id || ''}</span></td>
                  <td>{m.class_missed || '—'}</td>
                  <td>{m.makeup_type || '—'}</td>
                  <td style={{ fontSize: 'var(--fs-xs)' }}>{fmtDate(m.deadline)}</td>
                  <td>
                    {m.makeup_completed ? <Badge status="active">Complete</Badge>
                      : isOverdue(m) ? <Badge status="archived">Overdue</Badge>
                      : <Badge status="draft">Pending</Badge>}
                  </td>
                  {isAdmin && (
                    <td>
                      {!m.makeup_completed && (
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          <Button variant="primary" size="sm" onClick={() => setCompleteModal(m)}>Complete</Button>
                          <Button variant="ghost" size="sm" onClick={() => setExtendModal(m)}>Extend</Button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {completeModal && (
        <Modal title="Mark Makeup Complete" onClose={() => setCompleteModal(null)} footer={
          <>
            <Button variant="ghost" onClick={() => setCompleteModal(null)}>Cancel</Button>
            <Button variant="primary" onClick={handleComplete}>Confirm</Button>
          </>
        }>
          <p>Mark makeup for <strong>{completeModal.students?.full_name}</strong> (class: {completeModal.class_missed}) as completed?</p>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: '0.5rem' }}>This will also update attendance records and re-evaluate graduation eligibility.</p>
        </Modal>
      )}

      {extendModal && <ExtendModal item={extendModal} onClose={() => setExtendModal(null)} onSave={async (deadline, reason) => {
        try {
          await extendDeadline(extendModal, deadline, reason, profile?.id);
          addToast('Deadline extended', 'success');
          refetch(); setExtendModal(null);
        } catch (e) { addToast(e.message, 'error'); }
      }} />}
    </div>
  );
}

function ExtendModal({ item, onClose, onSave }) {
  const [deadline, setDeadline] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Modal title="Extend Deadline" onClose={onClose} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={async () => { setSaving(true); try { await onSave(deadline, reason); } finally { setSaving(false); } }} disabled={saving || !deadline || !reason}>
          {saving ? 'Saving…' : 'Extend'}
        </Button>
      </>
    }>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <p style={{ fontSize: 'var(--fs-sm)' }}>Student: <strong>{item.students?.full_name}</strong></p>
        <label className="rso-field"><span>New Deadline</span><input className="rso-input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
        <label className="rso-field"><span>Reason</span><textarea className="rso-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
    </Modal>
  );
}
