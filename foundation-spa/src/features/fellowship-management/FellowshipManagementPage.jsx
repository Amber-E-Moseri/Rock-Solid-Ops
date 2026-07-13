import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import { fetchFellowships, filterFellowships, upsertFellowship, deactivateFellowship, GROUPS } from './lib/fellowshipManagement.js';
import { PageHeader, Toolbar, SearchInput, Skeleton, EmptyState, Badge, Button, Modal } from '../../components/ui/index.js';

export default function FellowshipManagementPage() {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [subgroup, setSubgroup] = useState('');
  const [active, setActive] = useState('');
  const [editModal, setEditModal] = useState(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(null);

  const { data: list = [], isLoading, refetch } = useQuery({ queryKey: ['fellowships'], queryFn: fetchFellowships, staleTime: 60_000 });

  const subgroups = useMemo(() => [...new Set(list.map((f) => f.subgroup_id).filter(Boolean))].sort(), [list]);
  const filtered = useMemo(() => filterFellowships(list, { search, group, subgroup, active }), [list, search, group, subgroup, active]);

  const saveMut = useMutation({
    mutationFn: (values) => upsertFellowship(values, profile?.id),
    onSuccess: () => { refetch(); addToast('Saved', 'success'); },
    onError: (e) => addToast(e.message, 'error'),
  });

  async function handleDeactivate() {
    if (!confirmDeactivate) return;
    try {
      await deactivateFellowship(confirmDeactivate.fellowship_code, profile?.id);
      addToast('Deactivated', 'success');
      refetch();
    } catch (e) { addToast(e.message, 'error'); }
    setConfirmDeactivate(null);
  }

  return (
    <div className="page-content">
      <PageHeader title="Fellowship Management" actions={
        <Button variant="primary" size="sm" onClick={() => setEditModal({ isNew: true })}>Add Fellowship</Button>
      } />

      <Toolbar>
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code or campus…" />
        <select className="rso-select" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">All groups</option>
          {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select className="rso-select" value={subgroup} onChange={(e) => setSubgroup(e.target.value)}>
          <option value="">All subgroups</option>
          {subgroups.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="rso-select" value={active} onChange={(e) => setActive(e.target.value)}>
          <option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
      </Toolbar>

      {isLoading ? <Skeleton variant="rows" rows={5} /> : filtered.length === 0 ? (
        <EmptyState icon="🏠" title="No fellowships" subtitle="No fellowships match your filters" />
      ) : (
        <div className="rso-table-wrap">
          <table className="rso-table">
            <thead><tr><th>Code</th><th>Campus</th><th>Group</th><th>Subgroup</th><th>Timezone</th><th>Active</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map((f) => (
                <tr key={f.fellowship_code}>
                  <td style={{ fontWeight: 600 }}>{f.fellowship_code}</td>
                  <td>{f.campus_name || '—'}</td>
                  <td>{f.group_id || '—'}</td>
                  <td>{f.subgroup_id || '—'}</td>
                  <td style={{ fontSize: 'var(--fs-xs)' }}>{f.timezone || '—'}</td>
                  <td><Badge status={f.active ? 'active' : 'inactive'}>{f.active ? 'Active' : 'Inactive'}</Badge></td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <Button variant="ghost" size="sm" onClick={() => setEditModal({ isNew: false, fellowship: f })}>Edit</Button>
                      {f.active && <Button variant="danger" size="sm" onClick={() => setConfirmDeactivate(f)}>Deactivate</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editModal && (
        <FellowshipModal
          fellowship={editModal.isNew ? null : editModal.fellowship}
          onClose={() => setEditModal(null)}
          onSave={(v) => { saveMut.mutate(v); setEditModal(null); }}
          saving={saveMut.isPending}
        />
      )}

      {confirmDeactivate && (
        <Modal title="Deactivate Fellowship" onClose={() => setConfirmDeactivate(null)} footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDeactivate(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleDeactivate}>Deactivate</Button>
          </>
        }>
          <p>Deactivate <strong>{confirmDeactivate.fellowship_code}</strong> ({confirmDeactivate.campus_name})?</p>
        </Modal>
      )}
    </div>
  );
}

function FellowshipModal({ fellowship, onClose, onSave, saving }) {
  const [v, setV] = useState({
    fellowship_code: fellowship?.fellowship_code || '',
    campus_name: fellowship?.campus_name || '',
    group_id: fellowship?.group_id || '',
    subgroup_id: fellowship?.subgroup_id || '',
    timezone: fellowship?.timezone || 'America/Toronto',
    active: fellowship?.active !== false,
    _existing: !!fellowship,
  });
  const set = (k, val) => setV((p) => ({ ...p, [k]: val }));
  return (
    <Modal title={fellowship ? 'Edit Fellowship' : 'Add Fellowship'} onClose={onClose} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave(v)} disabled={saving || !v.fellowship_code}>{saving ? 'Saving…' : 'Save'}</Button>
      </>
    }>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <label className="rso-field"><span>Fellowship Code</span><input className="rso-input" value={v.fellowship_code} onChange={(e) => set('fellowship_code', e.target.value)} disabled={!!fellowship} /></label>
        <label className="rso-field"><span>Campus Name</span><input className="rso-input" value={v.campus_name} onChange={(e) => set('campus_name', e.target.value)} /></label>
        <label className="rso-field"><span>Group</span>
          <select className="rso-select" value={v.group_id} onChange={(e) => set('group_id', e.target.value)}>
            <option value="">—</option>
            {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label className="rso-field"><span>Subgroup</span><input className="rso-input" value={v.subgroup_id} onChange={(e) => set('subgroup_id', e.target.value)} /></label>
        <label className="rso-field"><span>Timezone</span><input className="rso-input" value={v.timezone} onChange={(e) => set('timezone', e.target.value)} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--fs-sm)' }}>
          <input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> Active
        </label>
      </div>
    </Modal>
  );
}
