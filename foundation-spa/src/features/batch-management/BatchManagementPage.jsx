import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchBatches, fetchFellowshipMap, fetchSubgroups, upsertBatch,
  archiveBatch, deleteBatch, closeBatch, reopenBatch, rolloverBatch, announceBatch,
  filterBatches, fmtDate,
} from './lib/batchManagement.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Toolbar, SearchInput, Skeleton, EmptyState, Badge, Button, Modal, KpiGrid, Kpi } from '../../components/ui/index.js';

export default function BatchManagementPage() {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const qc = useQueryClient();
  const isSuperadmin = profile?.role === 'superadmin';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fellowshipFilter, setFellowshipFilter] = useState('');
  const [sort, setSort] = useState('newest');
  const [editModal, setEditModal] = useState(null);
  const [rolloverModal, setRolloverModal] = useState(null);
  const [announceModal, setAnnounceModal] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  const { data, isLoading, refetch } = useQuery({ queryKey: ['batch-mgmt'], queryFn: fetchBatches, staleTime: 60_000 });
  const fellowships = useQuery({ queryKey: ['batch-fellowships'], queryFn: fetchFellowshipMap, staleTime: 5 * 60_000 });
  const subgroups = useQuery({ queryKey: ['batch-subgroups'], queryFn: fetchSubgroups, staleTime: 5 * 60_000 });

  const batches = data?.batches ?? [];
  const counts = data?.counts ?? {};
  const moodleCourses = data?.moodleCourses ?? [];

  const filtered = useMemo(
    () => filterBatches(batches, { search, status: statusFilter, fellowship: fellowshipFilter, sort }),
    [batches, search, statusFilter, fellowshipFilter, sort],
  );

  const kpis = useMemo(() => ({
    total: batches.length,
    active: batches.filter((b) => b.status === 'Active').length,
    upcoming: batches.filter((b) => b.status === 'Upcoming' || b.status === 'Draft').length,
    openReg: batches.filter((b) => b.registration_open).length,
  }), [batches]);

  const saveMut = useMutation({ mutationFn: upsertBatch, onSuccess: () => { refetch(); addToast('Saved', 'success'); }, onError: (e) => addToast(e.message, 'error') });

  async function handleConfirmAction() {
    if (!confirmModal) return;
    const { action, batch } = confirmModal;
    try {
      if (action === 'archive') await archiveBatch(batch.batch_id);
      else if (action === 'delete') await deleteBatch(batch.batch_id);
      else if (action === 'close') await closeBatch(batch.batch_id);
      else if (action === 'reopen') await reopenBatch(batch.batch_id);
      addToast(`Batch ${action}d`, 'success');
      refetch();
    } catch (e) { addToast(e.message, 'error'); }
    setConfirmModal(null);
  }

  return (
    <div className="page-content">
      <PageHeader title="Batch Management" actions={
        <>
          <Button variant="primary" size="sm" onClick={() => setEditModal({ isNew: true })}>Create Batch</Button>
          <Button variant="secondary" size="sm" onClick={refetch}>Refresh</Button>
        </>
      } />

      <KpiGrid>
        <Kpi label="Total Batches" value={kpis.total} />
        <Kpi label="Active" value={kpis.active} />
        <Kpi label="Upcoming" value={kpis.upcoming} />
        <Kpi label="Open Registration" value={kpis.openReg} />
      </KpiGrid>

      <Toolbar>
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search batches…" />
        <select className="rso-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="Draft">Draft</option><option value="Active">Active</option>
          <option value="Archived">Archived</option><option value="Completed">Completed</option><option value="Upcoming">Upcoming</option>
        </select>
        <select className="rso-select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
        </select>
        {(search || statusFilter || fellowshipFilter) && <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatusFilter(''); setFellowshipFilter(''); }}>Clear</Button>}
      </Toolbar>

      {isLoading ? <Skeleton variant="rows" rows={5} /> : filtered.length === 0 ? (
        <EmptyState icon="📅" title="No batches" subtitle={search ? 'No batches matched your filters' : 'Create a batch to get started'} />
      ) : (
        <div className="rso-table-wrap">
          <table className="rso-table">
            <thead><tr><th>Batch</th><th>Fellowship</th><th>Subgroup</th><th>Dates</th><th>Capacity</th><th>Registered</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.batch_id}>
                  <td><div style={{ fontWeight: 600 }}>{b.batch_name || b.batch_id}</div><div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{b.batch_id}</div></td>
                  <td>{b.fellowship_group || '—'}</td>
                  <td>{b.subgroup_id || b.subgroup || '—'}</td>
                  <td style={{ fontSize: 'var(--fs-xs)' }}>{fmtDate(b.start_date)} — {fmtDate(b.end_date)}</td>
                  <td>{b.capacity ?? '—'}</td>
                  <td>{counts[b.batch_id] ?? 0}</td>
                  <td><Badge status={b.status?.toLowerCase()}>{b.status}</Badge></td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                      <Button variant="ghost" size="sm" onClick={() => setEditModal({ isNew: false, batch: b })}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => setRolloverModal(b)}>Rollover</Button>
                      <Button variant="ghost" size="sm" onClick={() => setAnnounceModal(b)}>Announce</Button>
                      {isSuperadmin && (b.status === 'Active' || b.status === 'Upcoming') && (
                        <Button variant="danger" size="sm" onClick={() => setConfirmModal({ action: 'close', batch: b })}>Close</Button>
                      )}
                      {(b.status === 'Archived' || b.status === 'Completed') && (
                        <Button variant="ghost" size="sm" onClick={() => setConfirmModal({ action: 'reopen', batch: b })}>Reopen</Button>
                      )}
                      {isSuperadmin && <Button variant="ghost" size="sm" onClick={() => setConfirmModal({ action: 'archive', batch: b })}>Archive</Button>}
                      {isSuperadmin && <Button variant="danger" size="sm" onClick={() => setConfirmModal({ action: 'delete', batch: b })}>Delete</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile cards (fallback for <640px) */}
      {!isLoading && filtered.length > 0 && (
        <div className="rso-table-cards">
          {filtered.map((b) => (
            <div key={b.batch_id} className="rso-table-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{b.batch_name || b.batch_id}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{b.batch_id}</div>
                </div>
                <Badge status={b.status?.toLowerCase()}>{b.status}</Badge>
              </div>
              <div className="rso-table-card-row"><span className="rso-table-card-label">Fellowship</span><span>{b.fellowship_group || '—'}</span></div>
              <div className="rso-table-card-row"><span className="rso-table-card-label">Subgroup</span><span>{b.subgroup_id || b.subgroup || '—'}</span></div>
              <div className="rso-table-card-row"><span className="rso-table-card-label">Dates</span><span>{fmtDate(b.start_date)} — {fmtDate(b.end_date)}</span></div>
              <div className="rso-table-card-row"><span className="rso-table-card-label">Capacity</span><span>{b.capacity ?? '—'}</span></div>
              <div className="rso-table-card-row"><span className="rso-table-card-label">Registered</span><span>{counts[b.batch_id] ?? 0}</span></div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                <Button variant="ghost" size="sm" onClick={() => setEditModal({ isNew: false, batch: b })}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => setRolloverModal(b)}>Rollover</Button>
                <Button variant="ghost" size="sm" onClick={() => setAnnounceModal(b)}>Announce</Button>
                {isSuperadmin && (b.status === 'Active' || b.status === 'Upcoming') && (
                  <Button variant="danger" size="sm" onClick={() => setConfirmModal({ action: 'close', batch: b })}>Close</Button>
                )}
                {(b.status === 'Archived' || b.status === 'Completed') && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmModal({ action: 'reopen', batch: b })}>Reopen</Button>
                )}
                {isSuperadmin && <Button variant="ghost" size="sm" onClick={() => setConfirmModal({ action: 'archive', batch: b })}>Archive</Button>}
                {isSuperadmin && <Button variant="danger" size="sm" onClick={() => setConfirmModal({ action: 'delete', batch: b })}>Delete</Button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit/Create Modal */}
      {editModal && (
        <BatchModal
          batch={editModal.isNew ? null : editModal.batch}
          subgroups={subgroups.data ?? []}
          moodleCourses={moodleCourses}
          onClose={() => setEditModal(null)}
          onSave={(values) => { saveMut.mutate(values); setEditModal(null); }}
          saving={saveMut.isPending}
        />
      )}

      {/* Rollover Modal */}
      {rolloverModal && (
        <RolloverModal
          source={rolloverModal}
          onClose={() => setRolloverModal(null)}
          onRollover={async (newValues, message) => {
            try {
              await rolloverBatch(rolloverModal, newValues, message);
              addToast('Batch rolled over', 'success');
              refetch(); setRolloverModal(null);
            } catch (e) { addToast(e.message, 'error'); }
          }}
        />
      )}

      {/* Announce Modal */}
      {announceModal && (
        <AnnounceModal
          batch={announceModal}
          onClose={() => setAnnounceModal(null)}
          onSend={async (subject, message, sendTo) => {
            try {
              const count = await announceBatch(announceModal.batch_id, subject, message, sendTo);
              addToast(`Queued ${count} emails`, 'success');
              setAnnounceModal(null);
            } catch (e) { addToast(e.message, 'error'); }
          }}
        />
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <Modal open title={`${confirmModal.action.charAt(0).toUpperCase() + confirmModal.action.slice(1)} Batch`} onClose={() => setConfirmModal(null)} footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmModal(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleConfirmAction}>Confirm</Button>
          </>
        }>
          <p>{confirmModal.action === 'delete' ? 'Permanently delete' : confirmModal.action.charAt(0).toUpperCase() + confirmModal.action.slice(1)} <strong>{confirmModal.batch.batch_name}</strong>?</p>
        </Modal>
      )}
    </div>
  );
}

function BatchModal({ batch, subgroups, moodleCourses, onClose, onSave, saving }) {
  const [v, setV] = useState({
    batch_id: batch?.batch_id || '',
    batch_name: batch?.batch_name || '',
    fellowship_group: batch?.fellowship_group || '',
    subgroup_id: batch?.subgroup_id || '',
    start_date: batch?.start_date?.slice(0, 10) || '',
    end_date: batch?.end_date?.slice(0, 10) || '',
    capacity: batch?.capacity ?? '',
    moodle_course_mapping: batch?.moodle_course_mapping || '',
    notes: batch?.notes || '',
    active: batch?.active !== false,
  });
  const set = (k, val) => setV((p) => ({ ...p, [k]: val }));
  return (
    <Modal open title={batch ? 'Edit Batch' : 'Create Batch'} onClose={onClose} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave(v)} disabled={saving || !v.batch_id || !v.batch_name}>{saving ? 'Saving…' : 'Save'}</Button>
      </>
    }>
      <div className="rso-form-grid">
        <label className="rso-field"><span>Batch ID</span><input className="rso-input" value={v.batch_id} onChange={(e) => set('batch_id', e.target.value)} disabled={!!batch} /></label>
        <label className="rso-field"><span>Batch Name</span><input className="rso-input" value={v.batch_name} onChange={(e) => set('batch_name', e.target.value)} /></label>
        <label className="rso-field"><span>Fellowship</span><input className="rso-input" value={v.fellowship_group} onChange={(e) => set('fellowship_group', e.target.value)} /></label>
        <label className="rso-field"><span>Subgroup</span>
          <select className="rso-select" value={v.subgroup_id} onChange={(e) => set('subgroup_id', e.target.value)}>
            <option value="">—</option>
            {subgroups.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="rso-field"><span>Start Date</span><input className="rso-input" type="date" value={v.start_date} onChange={(e) => set('start_date', e.target.value)} /></label>
        <label className="rso-field"><span>End Date</span><input className="rso-input" type="date" value={v.end_date} onChange={(e) => set('end_date', e.target.value)} /></label>
        <label className="rso-field"><span>Capacity</span><input className="rso-input" type="number" value={v.capacity} onChange={(e) => set('capacity', e.target.value)} /></label>
        <label className="rso-field"><span>Moodle Course</span>
          <select className="rso-select" value={v.moodle_course_mapping} onChange={(e) => set('moodle_course_mapping', e.target.value)}>
            <option value="">—</option>
            {moodleCourses.map((c) => <option key={c.id || c.course_id} value={c.id || c.course_id}>{c.name || c.course_name || c.id}</option>)}
          </select>
        </label>
        <label className="rso-field" style={{ gridColumn: '1 / -1' }}><span>Notes</span><textarea className="rso-input" rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--fs-sm)' }}>
          <input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> Active
        </label>
      </div>
    </Modal>
  );
}

function RolloverModal({ source, onClose, onRollover }) {
  const [v, setV] = useState({ batch_id: '', batch_name: '', start_date: '', end_date: '', message: '' });
  const set = (k, val) => setV((p) => ({ ...p, [k]: val }));
  const [saving, setSaving] = useState(false);
  return (
    <Modal open title="Rollover Batch" onClose={onClose} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={async () => { setSaving(true); try { await onRollover({ ...v, capacity: source.capacity, fellowship_group: source.fellowship_group, subgroup: source.subgroup, subgroup_id: source.subgroup_id, notes: source.notes }, v.message); } finally { setSaving(false); } }} disabled={saving || !v.batch_id || !v.batch_name}>
          {saving ? 'Rolling over…' : 'Rollover'}
        </Button>
      </>
    }>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Source: <strong>{source.batch_name}</strong></p>
        <label className="rso-field"><span>New Batch ID</span><input className="rso-input" value={v.batch_id} onChange={(e) => set('batch_id', e.target.value)} /></label>
        <label className="rso-field"><span>New Batch Name</span><input className="rso-input" value={v.batch_name} onChange={(e) => set('batch_name', e.target.value)} /></label>
        <label className="rso-field"><span>Start Date</span><input className="rso-input" type="date" value={v.start_date} onChange={(e) => set('start_date', e.target.value)} /></label>
        <label className="rso-field"><span>End Date</span><input className="rso-input" type="date" value={v.end_date} onChange={(e) => set('end_date', e.target.value)} /></label>
        <label className="rso-field"><span>Rollover Notice (optional)</span><textarea className="rso-input" rows={3} value={v.message} onChange={(e) => set('message', e.target.value)} placeholder="Message to send to existing students" /></label>
      </div>
    </Modal>
  );
}

function AnnounceModal({ batch, onClose, onSend }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sendTo, setSendTo] = useState('students');
  const [saving, setSaving] = useState(false);
  return (
    <Modal open title="Announce to Batch" onClose={onClose} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={async () => { setSaving(true); try { await onSend(subject, message, sendTo); } finally { setSaving(false); } }} disabled={saving || !subject || !message}>
          {saving ? 'Sending…' : 'Send'}
        </Button>
      </>
    }>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Batch: <strong>{batch.batch_name}</strong></p>
        <label className="rso-field"><span>Subject</span><input className="rso-input" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
        <label className="rso-field"><span>Message</span><textarea className="rso-input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
        <div style={{ display: 'flex', gap: '1rem', fontSize: 'var(--fs-sm)' }}>
          {['students', 'teachers', 'both'].map((opt) => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
              <input type="radio" name="sendTo" value={opt} checked={sendTo === opt} onChange={() => setSendTo(opt)} />
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
