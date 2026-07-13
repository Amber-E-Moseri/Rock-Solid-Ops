import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Plus } from 'lucide-react';
import {
  PageHeader, Toolbar, SearchInput, Select, Badge, Button, Skeleton, EmptyState, KpiGrid, Kpi, Modal, Input,
} from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  fetchMilestoneData, activeDefinitions, buildCompletionIndex, completedCodes,
  filterApplicants, summarize, toggleMilestone, saveDefinition, defaultDescription,
} from './lib/milestones.js';

const initials = (name) =>
  (String(name || '').trim().split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2) || '?').toUpperCase();

export default function MilestonesAdminPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const canManage = ['superadmin', 'admin', 'regional_secretary'].includes(String(profile?.role || '').toLowerCase());

  const [search, setSearch] = useState('');
  const [classOption, setClassOption] = useState('');
  const [milestone, setMilestone] = useState('');
  const [status, setStatus] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['milestones-admin'],
    queryFn: fetchMilestoneData,
    staleTime: 1000 * 60,
  });

  const defs = useMemo(() => (data ? activeDefinitions(data.milestoneDefs) : []), [data]);
  const index = useMemo(() => (data ? buildCompletionIndex(data.milestoneStatus) : new Map()), [data]);
  const rows = useMemo(
    () => (data ? filterApplicants(data.applicants, index, defs, { search, classOption, milestone, status }) : []),
    [data, index, defs, search, classOption, milestone, status],
  );
  const kpis = useMemo(() => summarize(rows, index, defs), [rows, index, defs]);
  const classValues = useMemo(
    () => (data ? [...new Set(data.applicants.map((a) => String(a.class_option_id || '').trim()).filter(Boolean))].sort() : []),
    [data],
  );

  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: ['milestones-admin'] }), [queryClient]);

  const handleToggle = useCallback(async (applicantId, code) => {
    if (!data?.milestonesReady) { toast('Milestones are not configured yet. Run migrations first.', 'warning'); return; }
    setBusy(true);
    try {
      await toggleMilestone({
        applicantId,
        milestoneCode: code,
        currentlyCompleted: completedCodes(index, applicantId).has(code),
        actorEmail: profile?.email,
      });
      toast('Milestone status updated.', 'success');
      await invalidate();
    } catch (err) {
      toast(`Milestone update failed: ${err?.message || err}`, 'error');
    } finally {
      setBusy(false);
    }
  }, [data, index, profile, toast, invalidate]);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Milestones" subtitle="Loading students…" />
        <Skeleton variant="row" count={8} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Milestones"
        subtitle="Track each student's spiritual journey across the foundation milestones."
        actions={
          <>
            {canManage && <Button variant="primary" onClick={() => setAddOpen(true)}><Plus size={14} /> Add Milestone</Button>}
            <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw size={14} className={isFetching ? 'spin' : ''} /> Refresh
            </Button>
          </>
        }
      />

      {!data?.milestonesReady && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 13, marginBottom: 14 }}>
          Milestone tables are not available yet. Apply migrations and refresh.
        </div>
      )}

      <KpiGrid>
        <Kpi value={kpis.milestones} label="Milestones" />
        <Kpi value={kpis.fullyComplete} label="Fully Complete" />
        <Kpi value={`${kpis.average}%`} label="Average Progress" />
        <Kpi value={kpis.zeroProgress} label="Not Started" />
      </KpiGrid>

      {/* Journey overview */}
      <section style={{ margin: '18px 0' }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 10px' }}>The Journey</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {defs.map((item, i) => (
            <article key={item.code} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 12 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--soft-purple)', color: 'var(--primary)', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{item.label || item.code}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{item.description || defaultDescription(item)}</div>
              </div>
              <Badge variant={item.is_required === false ? 'neutral' : 'info'}>{item.is_required === false ? 'Optional' : 'Required'}</Badge>
            </article>
          ))}
        </div>
      </section>

      <Toolbar>
        <SearchInput placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={classOption} onChange={(e) => setClassOption(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
          <option value="">All classes</option>
          {classValues.map((v) => <option key={v} value={v}>{v}</option>)}
        </Select>
        <Select value={milestone} onChange={(e) => setMilestone(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
          <option value="">Any milestone</option>
          {defs.map((d) => <option key={d.code} value={d.code}>{d.label || d.code}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto', minWidth: 140 }}>
          <option value="">All progress</option>
          <option value="completed">Has progress</option>
          <option value="pending">Incomplete</option>
        </Select>
      </Toolbar>

      {!defs.length ? (
        <EmptyState icon="🧭" title="No milestone definitions" message="No milestone definitions are active yet." />
      ) : !rows.length ? (
        <EmptyState icon="🔍" title="No students" message="No students match the selected filters." />
      ) : (
        <div className="rso-table-wrap" style={{ marginTop: 12 }}>
          <table className="rso-table">
            <thead>
              <tr>
                <th>Student</th>
                {defs.map((d, i) => <th key={d.code} title={d.label || d.code} style={{ textAlign: 'center', width: 44 }}>{i + 1}</th>)}
                <th style={{ textAlign: 'center', width: 60 }}>%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const done = completedCodes(index, a.id);
                const pct = defs.length ? Math.round((done.size / defs.length) * 100) : 0;
                const classMeta = a.class_option_id || a.fellowship_code || a.fellowship || a.subgroup_id || '-';
                return (
                  <tr key={a.id}>
                    <td>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--soft-purple)', color: 'var(--primary)', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(a.full_name)}</div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{a.full_name || '-'}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{classMeta}</div>
                        </div>
                      </div>
                    </td>
                    {defs.map((d) => {
                      const checked = done.has(d.code);
                      return (
                        <td key={d.code} style={{ textAlign: 'center' }}>
                          <button
                            onClick={() => handleToggle(a.id, d.code)}
                            disabled={busy || !canManage}
                            aria-label={checked ? 'Completed' : 'Pending'}
                            style={{
                              width: 26, height: 26, borderRadius: 8, cursor: canManage ? 'pointer' : 'default',
                              border: `2px solid ${checked ? 'var(--success, #22C55E)' : 'var(--border)'}`,
                              background: checked ? 'var(--success-bg, #ECFDF3)' : 'var(--surface)',
                              color: 'var(--success, #22C55E)', fontWeight: 800, fontSize: 13, lineHeight: 1,
                            }}
                          >
                            {checked ? '✓' : ''}
                          </button>
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center' }}>
                      <Badge variant={pct >= 100 ? 'success' : 'neutral'}>{pct}%</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <AddDefinitionModal
          defsCount={defs.length}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); invalidate(); toast('Milestone definition saved.', 'success'); }}
        />
      )}
    </div>
  );
}

function AddDefinitionModal({ defsCount, onClose, onSaved }) {
  const [label, setLabel] = useState('');
  const [session, setSession] = useState(String(defsCount + 1));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      await saveDefinition({ label, sessionNumber: session, defsCount });
      onSaved();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add Milestone Definition"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Milestone label</div>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Water Baptism" autoFocus />
          {label.trim() && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              Code: <code>{label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}</code>
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Class session number (optional)</div>
          <Input type="number" value={session} onChange={(e) => setSession(e.target.value)} />
        </div>
        {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
      </div>
    </Modal>
  );
}
