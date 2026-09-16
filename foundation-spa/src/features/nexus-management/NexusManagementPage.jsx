import { useState, useMemo, useCallback, useEffect } from 'react';
import { PageHeader, Card, Badge, Button, Skeleton, SearchInput, Modal } from '../../components/ui/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { fetchMappings, saveMapping, toggleMappingActive, filterMappings } from './lib/nexusManagement.js';

export default function NexusManagementPage() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ adminEmail: '', nexusUserId: '', nexusUserName: '', nexusUserEmail: '', groupId: '', subgroupId: '', active: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchMappings());
    } catch (e) {
      toast(e.message || 'Failed to load mappings', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => filterMappings(rows, search), [rows, search]);

  const openAdd = () => {
    setEditing({ id: null });
    setForm({ adminEmail: '', nexusUserId: '', nexusUserName: '', nexusUserEmail: '', groupId: '', subgroupId: '', active: true });
  };

  const openEdit = (row) => {
    setEditing({ id: row.id });
    setForm({
      adminEmail: row.admin_email || '',
      nexusUserId: row.nexus_user_id || '',
      nexusUserName: row.nexus_user_name || '',
      nexusUserEmail: row.nexus_user_email || '',
      groupId: row.group_id || '',
      subgroupId: row.subgroup_id || '',
      active: row.active !== false,
    });
  };

  const handleSave = async () => {
    if (!form.adminEmail || !form.groupId) {
      toast('Admin email and group ID are required.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await saveMapping(form, editing?.id);
      toast('Mapping saved.', 'success');
      setEditing(null);
      await load();
    } catch (e) {
      toast(`Save failed: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (row) => {
    const next = !(row.active !== false);
    try {
      await toggleMappingActive(row.id, next);
      toast(`Mapping ${next ? 'reactivated' : 'deactivated'}.`, 'success');
      await load();
    } catch (e) {
      toast(`Update failed: ${e.message}`, 'error');
    }
  };

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Nexus Management"
        subtitle="Nexus user admin mappings"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={load}>Refresh</Button>
            <Button onClick={openAdd}>Add Mapping</Button>
          </div>
        }
      />

      <Card>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <SearchInput placeholder="Search mappings…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1 }} />
          <Button size="sm" variant="secondary" onClick={() => setSearch('')}>Clear</Button>
        </div>

        {loading ? <Skeleton style={{ height: 300 }} /> : filtered.length === 0 ? (
          <div style={{ padding: 42, textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>📭</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>No mappings found.</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{search ? 'No records matched your search.' : 'Add a mapping to get started.'}</div>
          </div>
        ) : (
          <div className="rso-table-wrap">
            <table className="rso-table">
              <thead>
                <tr>
                  <th>Admin Email</th>
                  <th>Nexus User</th>
                  <th>Group</th>
                  <th>Subgroup</th>
                  <th>Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td><strong>{r.admin_email || '-'}</strong></td>
                    <td>
                      <div>{r.nexus_user_name || '-'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.nexus_user_email || ''}</div>
                    </td>
                    <td>{r.group_id || '-'}</td>
                    <td>{r.subgroup_id || '-'}</td>
                    <td><Badge variant={r.active !== false ? 'success' : 'info'}>{r.active !== false ? 'Active' : 'Inactive'}</Badge></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>Edit</Button>
                        <Button size="sm" variant={r.active !== false ? 'danger' : 'secondary'} onClick={() => handleToggle(r)}>
                          {r.active !== false ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <Modal open title={editing.id ? 'Edit Nexus Mapping' : 'Add Nexus Mapping'} onClose={() => setEditing(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={fl}>Admin Email (Rock Solid)</label>
              <input className="rso-input" type="email" value={form.adminEmail} onChange={e => setField('adminEmail', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={fl}>Nexus User Name</label>
              <input className="rso-input" value={form.nexusUserName} onChange={e => setField('nexusUserName', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={fl}>Nexus User Email</label>
              <input className="rso-input" type="email" value={form.nexusUserEmail} onChange={e => setField('nexusUserEmail', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={fl}>Group ID</label>
              <input className="rso-input" value={form.groupId} onChange={e => setField('groupId', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={fl}>Subgroup ID</label>
              <input className="rso-input" value={form.subgroupId} onChange={e => setField('subgroupId', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={fl}>Active</label>
              <select className="rso-select" value={String(form.active)} onChange={e => setField('active', e.target.value === 'true')} style={{ width: '100%' }}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Mapping'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const fl = { fontSize: 12, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 5 };
