import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Badge, Button, Skeleton, Input } from '../../components/ui/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { fetchMappings, validateMapping, saveMapping, seedMissing, testMoodleConnection, fmtDate } from './lib/moodle-settings.js';

export default function MoodleSettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: mappings, isLoading } = useQuery({
    queryKey: ['moodle-settings'],
    queryFn: fetchMappings,
    staleTime: 1000 * 30,
  });

  const [form, setForm] = useState({ batchId: '', groupId: '', courseId: '', active: true });
  const [msg, setMsg] = useState('');
  const [msgBad, setMsgBad] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ['moodle-settings'] }), [queryClient]);

  const showMsg = (text, bad = false) => { setMsg(text); setMsgBad(bad); };

  const handleEdit = useCallback((row) => {
    setForm({
      batchId: row.batch_id,
      groupId: row.group_id,
      courseId: String(row.moodle_course_id || ''),
      active: !!row.active,
    });
  }, []);

  const handleSave = useCallback(async () => {
    const err = validateMapping(form);
    if (err) { showMsg(err, true); return; }
    setBusy(true);
    try {
      await saveMapping(form);
      showMsg('Mapping saved.');
      refresh();
    } catch (e) {
      showMsg(String(e?.message || e), true);
    } finally {
      setBusy(false);
    }
  }, [form, refresh]);

  const handleSeed = useCallback(async () => {
    setBusy(true);
    showMsg('Seeding...');
    try {
      const count = await seedMissing(mappings || []);
      showMsg(count ? `Seeded ${count} rows.` : 'No missing rows to seed.');
      refresh();
    } catch (e) {
      showMsg(String(e?.message || e), true);
    } finally {
      setBusy(false);
    }
  }, [mappings, refresh]);

  const handleTest = useCallback(async () => {
    setBusy(true);
    showMsg('Testing Moodle connection...');
    try {
      await testMoodleConnection();
      showMsg('Moodle connection OK.');
    } catch (e) {
      showMsg(String(e?.message || e), true);
    } finally {
      setBusy(false);
    }
  }, []);

  if (isLoading) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Skeleton style={{ height: 40 }} />
        <Skeleton style={{ height: 180 }} />
        <Skeleton style={{ height: 300 }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader title="Moodle Settings" subtitle="Manage batch Moodle course mappings." />

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={fieldLabel}>Batch ID</label>
            <Input placeholder="e.g. 2026A" value={form.batchId} onChange={(e) => setForm((f) => ({ ...f, batchId: e.target.value }))} />
          </div>
          <div>
            <label style={fieldLabel}>Group/Subgroup</label>
            <Input placeholder="e.g. CSGA" value={form.groupId} onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))} />
          </div>
          <div>
            <label style={fieldLabel}>Moodle Course ID</label>
            <Input placeholder="numeric only" value={form.courseId} onChange={(e) => setForm((f) => ({ ...f, courseId: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
              Active mapping
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <Button onClick={handleSave} disabled={busy}>Save Mapping</Button>
          <Button variant="secondary" onClick={handleSeed} disabled={busy}>Seed Missing from Fellowship Map</Button>
          <Button variant="secondary" onClick={handleTest} disabled={busy}>Test Moodle Connection</Button>
        </div>
        {msg && (
          <div style={{ marginTop: 8, fontSize: 13, color: msgBad ? 'var(--color-danger)' : 'var(--muted)' }}>{msg}</div>
        )}
      </Card>

      <Card>
        {!mappings?.length ? (
          <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 13 }}>
            No mappings found.
          </div>
        ) : (
          <div className="rso-table-wrap">
            <table className="rso-table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>Batch</th><th>Group/Subgroup</th><th>Course ID</th><th>Active</th><th>Updated</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.batch_id || '-'}</td>
                    <td style={{ fontSize: 13 }}>{r.group_id || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.moodle_course_id || '-'}</td>
                    <td>{r.active ? <Badge variant="success">Yes</Badge> : <Badge variant="info">No</Badge>}</td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(r.updated_at)}</td>
                    <td><Button size="sm" variant="secondary" onClick={() => handleEdit(r)}>Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const fieldLabel = { fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 };
