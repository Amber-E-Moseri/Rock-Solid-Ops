import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchBatches, fetchFellowshipMap, fetchSubgroups, upsertBatch,
  archiveBatch, deleteBatch, closeBatch, reopenBatch, rolloverBatch, announceBatch,
  filterBatches, fmtDate,
} from './lib/batchManagement.js';
import { campusesForBatch, countCampuses } from './lib/batchCampus.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, SearchInput, Skeleton, EmptyState, Badge, Button, Modal } from '../../components/ui/index.js';
import './batch-management.css';

const PAGE_SIZE = 10;
const TABS = [
  { key: '', label: 'All' },
  { key: 'Active', label: 'Active' },
  { key: 'Upcoming', label: 'Upcoming' },
  { key: 'Archived', label: 'Archived' },
];

// Roles that may insert and update batches. Mirrors is_admin() (latest definition: migration
// 202605220030), which the batches insert and update policies use. Delete stays superadmin-only.
const BATCH_WRITE_ROLES = ['superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal', 'regional_secretary'];

const isArchivedStatus = (status) => ['archived', 'completed'].includes(String(status || '').toLowerCase());

function matchesTab(batch, tab) {
  if (!tab) return true;
  if (tab === 'Archived') return isArchivedStatus(batch.status);
  return String(batch.status || '').toLowerCase() === tab.toLowerCase();
}

export default function BatchManagementPage() {
  const { profile } = useAuth();
  const addToast = useToast();
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
  const [tab, setTab] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [viewBatch, setViewBatch] = useState(null);

  const { data, isLoading, refetch } = useQuery({ queryKey: ['batch-mgmt'], queryFn: fetchBatches, staleTime: 60_000 });
  const fellowships = useQuery({ queryKey: ['batch-fellowships'], queryFn: fetchFellowshipMap, staleTime: 5 * 60_000 });
  const subgroups = useQuery({ queryKey: ['batch-subgroups'], queryFn: fetchSubgroups, staleTime: 5 * 60_000 });

  const batches = data?.batches ?? [];
  const counts = data?.counts ?? {};
  const moodleCourses = data?.moodleCourses ?? [];

  const filtered = useMemo(
    () => filterBatches(batches.filter((b) => matchesTab(b, tab)), { search, status: statusFilter, fellowship: fellowshipFilter, sort }),
    [batches, tab, search, statusFilter, fellowshipFilter, sort],
  );
  const visible = filtered.slice(0, visibleCount);

  const tabCounts = useMemo(() => ({
    '': batches.length,
    Active: batches.filter((b) => matchesTab(b, 'Active')).length,
    Upcoming: batches.filter((b) => matchesTab(b, 'Upcoming')).length,
    Archived: batches.filter((b) => matchesTab(b, 'Archived')).length,
  }), [batches]);

  const fellowshipOptions = useMemo(
    () => [...new Set(batches.map((b) => b.fellowship_group).filter(Boolean))].sort(),
    [batches],
  );

  const fellowshipRows = useMemo(() => fellowships.data ?? [], [fellowships.data]);

  const canEditBatches = BATCH_WRITE_ROLES.includes(profile?.role);
  const canEditBatch = (b) => canEditBatches && !isArchivedStatus(b.status);

  const kpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const upcomingStarts = batches
      .filter((b) => b.status === 'Upcoming' && b.start_date)
      .map((b) => String(b.start_date).slice(0, 10))
      .filter((d) => d >= today)
      .sort();
    const years = batches.map((b) => new Date(b.created_at).getFullYear()).filter(Number.isFinite);
    // Open Registration counts batches with registration open. Campuses are the ones those batches reach.
    const openBatches = batches.filter((b) => b.registration_open);
    return {
      total: batches.length,
      since: years.length ? Math.min(...years) : null,
      active: batches.filter((b) => b.status === 'Active').length,
      upcoming: batches.filter((b) => b.status === 'Upcoming').length,
      nextStart: upcomingStarts[0] ? fmtMonthDay(upcomingStarts[0]) : null,
      openReg: openBatches.length,
      campuses: countCampuses(openBatches, fellowshipRows),
    };
  }, [batches, fellowshipRows]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [tab, search, statusFilter, fellowshipFilter, sort]);

  useEffect(() => {
    if (!openMenuId) return undefined;
    const onPointerDown = (e) => { if (!e.target.closest('[data-menu]')) setOpenMenuId(null); };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [openMenuId]);

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

  function clearFilters() {
    setSearch('');
    setStatusFilter('');
    setFellowshipFilter('');
    setTab('');
  }

  // Row overflow menu. Entries and their permissions match the previous inline action buttons.
  function menuItems(b) {
    const status = String(b.status || '').toLowerCase();
    const items = [
      { label: 'Rollover', onSelect: () => setRolloverModal(b) },
      { label: 'Announce', onSelect: () => setAnnounceModal(b) },
    ];
    if (isSuperadmin && (status === 'active' || status === 'upcoming')) {
      items.push({ label: 'Close', danger: true, onSelect: () => setConfirmModal({ action: 'close', batch: b }) });
    }
    if (isArchivedStatus(status)) {
      items.push({ label: 'Reopen', onSelect: () => setConfirmModal({ action: 'reopen', batch: b }) });
    }
    if (isSuperadmin) {
      items.push({ label: 'Archive', onSelect: () => setConfirmModal({ action: 'archive', batch: b }) });
      items.push({ label: 'Delete', danger: true, onSelect: () => setConfirmModal({ action: 'delete', batch: b }) });
    }
    return items;
  }

  return (
    <div className="page-content bm-page">
      <PageHeader
        title="Batch Management"
        subtitle="Programme batches, campus registration and open classes."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={refetch}>↺ Refresh</Button>
            <Button variant="primary" size="sm" className="bm-btn-gold" onClick={() => setEditModal({ isNew: true })}>+ Create Batch</Button>
          </>
        }
      />

      <div className="bm-kpis">
        <div className="bm-kpi bm-kpi-primary">
          <span className="bm-kpi-label">Total Batches</span>
          <span className="bm-kpi-value">{kpis.total}</span>
          <span className="bm-kpi-sub">{kpis.since ? `Since ${kpis.since}` : 'All time'}</span>
        </div>
        <div className="bm-kpi bm-kpi-ink">
          <span className="bm-kpi-label">Active</span>
          <span className="bm-kpi-value">{kpis.active}</span>
          <span className="bm-kpi-sub">Running now</span>
        </div>
        <div className="bm-kpi bm-kpi-gold">
          <span className="bm-kpi-label">Upcoming</span>
          <span className="bm-kpi-value">{kpis.upcoming}</span>
          <span className="bm-kpi-sub">{kpis.nextStart ? `Next: ${kpis.nextStart}` : 'None scheduled'}</span>
        </div>
        <div className="bm-kpi bm-kpi-rose">
          <span className="bm-kpi-label">Open Registration</span>
          <span className="bm-kpi-value">{kpis.openReg}</span>
          <span className="bm-kpi-sub">Across {kpis.campuses} campus{kpis.campuses === 1 ? '' : 'es'}</span>
        </div>
      </div>

      <section className="bm-card">
        <div className="bm-tabs" role="tablist" aria-label="Batch status">
          {TABS.map((t) => (
            <button
              key={t.key || 'all'}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`bm-tab${tab === t.key ? ' bm-tab-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              <span className="bm-tab-count">{tabCounts[t.key]}</span>
            </button>
          ))}
        </div>

        <div className="bm-filters">
          <div className="bm-search">
            <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search batches…" />
          </div>
          <select className="rso-select" aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Status: All</option>
            <option value="Draft">Draft</option><option value="Active">Active</option>
            <option value="Archived">Archived</option><option value="Completed">Completed</option><option value="Upcoming">Upcoming</option>
          </select>
          <select className="rso-select" aria-label="Fellowship" value={fellowshipFilter} onChange={(e) => setFellowshipFilter(e.target.value)}>
            <option value="">Fellowship: All</option>
            {fellowshipOptions.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select className="rso-select" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          </select>
          {(search || statusFilter || fellowshipFilter || tab) && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>}
        </div>

        {isLoading ? <Skeleton variant="rows" rows={5} /> : filtered.length === 0 ? (
          <EmptyState icon="📅" title="No batches" subtitle={search || statusFilter || fellowshipFilter || tab ? 'No batches matched your filters' : 'Create a batch to get started'} />
        ) : (
          <div className="rso-table-wrap bm-table-wrap">
            <table className="rso-table bm-table">
              <thead><tr><th>Batch</th><th>Dates</th><th>Registered</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {visible.map((b) => {
                  return (
                    <tr key={b.batch_id}>
                      <td>
                        <div className="bm-batch-name">{b.batch_name || b.batch_id}</div>
                        <div className="bm-batch-meta">{batchMeta(b, fellowshipRows)}</div>
                      </td>
                      <td className="bm-mono">{fmtShortDate(b.start_date)} → {fmtShortDate(b.end_date)}</td>
                      <td className="bm-mono">{counts[b.batch_id] ?? 0} / {b.capacity ?? '—'}</td>
                      <td><Badge status={b.status?.toLowerCase()}>{b.status}</Badge></td>
                      <td>
                        <div className="bm-actions">
                          {canEditBatch(b) ? (
                            <Button variant="primary" size="sm" onClick={() => setEditModal({ isNew: false, batch: b })}>Edit</Button>
                          ) : (
                            <Button variant="secondary" size="sm" className="bm-btn-outline" onClick={() => setViewBatch(b)}>View</Button>
                          )}
                          <div className="bm-menu-wrap" data-menu>
                            <button
                              type="button"
                              className="bm-menu-trigger"
                              aria-label="More actions"
                              aria-haspopup="menu"
                              aria-expanded={openMenuId === b.batch_id}
                              onClick={() => setOpenMenuId(openMenuId === b.batch_id ? null : b.batch_id)}
                            >
                              ⋯
                            </button>
                            {openMenuId === b.batch_id && (
                              <div className="bm-menu" role="menu">
                                {menuItems(b).map((item) => (
                                  <button
                                    key={item.label}
                                    type="button"
                                    role="menuitem"
                                    className={`bm-menu-item${item.danger ? ' bm-menu-item-danger' : ''}`}
                                    onClick={() => { setOpenMenuId(null); item.onSelect(); }}
                                  >
                                    {item.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      {/* Mobile cards (fallback for <640px) */}
      {!isLoading && filtered.length > 0 && (
        <div className="rso-table-cards">
          {visible.map((b) => (
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
                {canEditBatch(b) ? (
                  <Button variant="primary" size="sm" onClick={() => setEditModal({ isNew: false, batch: b })}>Edit</Button>
                ) : (
                  <Button variant="secondary" size="sm" className="bm-btn-outline" onClick={() => setViewBatch(b)}>View</Button>
                )}
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

        {!isLoading && filtered.length > 0 && (
          <div className="bm-footer">
            <span>Showing {visible.length} of {filtered.length} batches</span>
            {visible.length < filtered.length && (
              <Button variant="ghost" size="sm" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>Load more</Button>
            )}
          </div>
        )}
      </section>

      {/* Read-only details (View) */}
      {viewBatch && (
        <BatchDetailsModal
          batch={viewBatch}
          campuses={campusesForBatch(viewBatch, fellowshipRows)}
          registered={counts[viewBatch.batch_id] ?? 0}
          moodleCourses={moodleCourses}
          onClose={() => setViewBatch(null)}
        />
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

// Dates are shown as MM-DD, matching the batch list layout.
function fmtShortDate(value) {
  return value ? String(value).slice(5, 10) : '—';
}

function fmtMonthDay(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

// Second line under the batch name: the campus (or a count when it spans several), then the subgroup
// or fellowship. Falls back to the batch id.
function batchMeta(b, fellowshipRows) {
  const campuses = campusesForBatch(b, fellowshipRows);
  const campusLabel = campuses.length === 1 ? campuses[0] : campuses.length > 1 ? `${campuses.length} campuses` : null;
  const parts = [campusLabel, b.subgroup_id || b.subgroup || b.fellowship_group].filter(Boolean);
  return parts.length ? parts.join(' · ') : b.batch_id;
}

// Read-only batch details. Text only: no form fields, so nothing in this dialog can change the batch.
function BatchDetailsModal({ batch, campuses, registered, moodleCourses, onClose }) {
  const course = moodleCourses.find((c) => (c.id || c.course_id) === batch.moodle_course_mapping);
  const rows = [
    ['Batch ID', batch.batch_id],
    ['Campus', campuses.length ? campuses.join(', ') : '—'],
    ['Fellowship', batch.fellowship_group || '—'],
    ['Subgroup', batch.subgroup_id || batch.subgroup || '—'],
    ['Start', fmtDate(batch.start_date)],
    ['End', fmtDate(batch.end_date)],
    ['Capacity', batch.capacity ?? '—'],
    ['Registered', registered],
    ['Moodle course', course?.name || course?.course_name || batch.moodle_course_mapping || '—'],
    ['Status', batch.status || '—'],
    ['Notes', batch.notes || '—'],
  ];
  return (
    <Modal open title={batch.batch_name || batch.batch_id} onClose={onClose} footer={
      <Button variant="ghost" onClick={onClose}>Close</Button>
    }>
      <dl className="bm-details">
        {rows.map(([label, value]) => (
          <div key={label} className="bm-details-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Modal>
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
