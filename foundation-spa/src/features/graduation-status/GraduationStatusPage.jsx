import { useState, useMemo, useCallback, useEffect } from 'react';
import { PageHeader, Card, Badge, Button, Skeleton, SearchInput, Modal } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  fetchBatches, fetchBatchStudents, evaluateBatchGraduation, overrideGraduationEligibility,
  eligibilityLabel, eligibilityVariant, computeSummary, filterRows, fmtDate,
} from './lib/graduationStatus.js';

const ADMIN_ROLES = ['admin', 'superadmin', 'principal', 'subgroup_admin', 'pastor'];

export default function GraduationStatusPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const isAdmin = ADMIN_ROLES.includes(String(profile?.role || '').toLowerCase());

  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [eligFilter, setEligFilter] = useState('');
  const [flash, setFlash] = useState(null);
  const [evaluating, setEvaluating] = useState(false);

  const [overrideTarget, setOverrideTarget] = useState(null);
  const [overrideDecision, setOverrideDecision] = useState('null');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);

  useEffect(() => {
    fetchBatches().then(setBatches).catch(e => toast(e.message, 'error'));
  }, [toast]);

  const loadBatch = useCallback(async (id) => {
    setBatchId(id);
    if (!id) { setRows([]); return; }
    setLoading(true);
    setFlash(null);
    try {
      setRows(await fetchBatchStudents(id));
    } catch (e) {
      setFlash({ msg: e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  const filtered = useMemo(() => filterRows(rows, { search, eligibility: eligFilter }), [rows, search, eligFilter]);
  const summary = useMemo(() => computeSummary(rows), [rows]);

  const handleEvaluate = async () => {
    if (!batchId) return;
    setEvaluating(true);
    setFlash(null);
    try {
      const result = await evaluateBatchGraduation(batchId);
      setFlash({ msg: `Evaluated ${result?.processed ?? '?'} students — ${result?.eligible ?? '?'} eligible, ${result?.not_eligible ?? '?'} not eligible.`, type: 'success' });
      setRows(await fetchBatchStudents(batchId));
    } catch (e) {
      setFlash({ msg: `Evaluation failed: ${e.message}`, type: 'error' });
    } finally {
      setEvaluating(false);
    }
  };

  const openOverride = (row) => {
    setOverrideTarget(row);
    setOverrideDecision(row.ge?.override_eligible != null ? String(row.ge.override_eligible) : 'null');
    setOverrideReason(row.ge?.override_reason || '');
  };

  const saveOverride = async () => {
    if (!overrideTarget) return;
    setOverrideSaving(true);
    try {
      const eligible = overrideDecision === 'null' ? null : overrideDecision === 'true';
      await overrideGraduationEligibility(overrideTarget.id, batchId, eligible, overrideReason);
      toast('Override saved.', 'success');
      setOverrideTarget(null);
      setRows(await fetchBatchStudents(batchId));
    } catch (e) {
      toast(`Override failed: ${e.message}`, 'error');
    } finally {
      setOverrideSaving(false);
    }
  };

  const GateIcon = ({ pass }) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 22, height: 22, borderRadius: '50%', fontSize: 12, fontWeight: 700,
      background: pass ? '#dcfce7' : '#fee2e2', color: pass ? '#166534' : '#991b1b',
    }}>
      {pass ? '✓' : '✗'}
    </span>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Graduation Status"
        subtitle="Four-gate eligibility engine — evaluates attendance, Moodle, milestones, and exam grade."
        actions={
          <Button disabled={!batchId || !isAdmin || evaluating} onClick={handleEvaluate}>
            {evaluating ? 'Evaluating…' : 'Evaluate All'}
          </Button>
        }
      />

      {/* Summary */}
      {batchId && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          {[
            { label: 'Total Students', value: summary.total },
            { label: 'Evaluated', value: summary.evaluated },
            { label: 'Eligible', value: summary.eligible, color: '#166534' },
            { label: 'Overridden', value: summary.overridden, color: '#5b21b6' },
          ].map(k => (
            <Card key={k.label}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{k.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: k.color || 'var(--text)', marginTop: 4 }}>{loading ? '—' : k.value}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchInput placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <select className="rso-select" value={batchId} onChange={e => loadBatch(e.target.value)} style={{ width: 'auto' }}>
          <option value="">— Select batch —</option>
          {batches.map(b => <option key={b.batch_id} value={b.batch_id}>{b.name || b.batch_id}{b.active ? '' : ' (inactive)'}</option>)}
        </select>
        <select className="rso-select" value={eligFilter} onChange={e => setEligFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All</option>
          <option value="eligible">Eligible</option>
          <option value="not_eligible">Not Eligible</option>
          <option value="override">Overridden</option>
        </select>
      </div>

      {flash && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: flash.type === 'error' ? 'var(--danger-bg)' : 'var(--success-bg)',
          color: flash.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)',
          border: '1px solid var(--border)',
        }}>
          {flash.msg}
        </div>
      )}

      {!batchId ? (
        <Card><div style={{ padding: 24, color: 'var(--muted)', fontSize: 14 }}>Select a batch above to load graduation status.</div></Card>
      ) : loading ? (
        <Skeleton style={{ height: 300 }} />
      ) : (
        <Card>
          <div className="rso-table-wrap">
            <table className="rso-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th title="≥ 6 sessions present/makeup" style={{ textAlign: 'center' }}>Attend</th>
                  <th title="Moodle course complete" style={{ textAlign: 'center' }}>Moodle</th>
                  <th title="Born Again + Holy Spirit milestones" style={{ textAlign: 'center' }}>Milestones</th>
                  <th title="Overall course grade ≥ 70%" style={{ textAlign: 'center' }}>Exam</th>
                  <th>Status</th>
                  <th>Last Evaluated</th>
                  {isAdmin && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={isAdmin ? 8 : 7} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>No students match current filters.</td></tr>
                ) : filtered.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{r.full_name || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.email || ''}</div>
                    </td>
                    <td style={{ textAlign: 'center' }}>{r.ge ? <GateIcon pass={r.ge.gate1_attendance} /> : '—'}</td>
                    <td style={{ textAlign: 'center' }}>{r.ge ? <GateIcon pass={r.ge.gate2_moodle_complete} /> : '—'}</td>
                    <td style={{ textAlign: 'center' }}>{r.ge ? <GateIcon pass={r.ge.gate3_milestones_met} /> : '—'}</td>
                    <td style={{ textAlign: 'center' }}>{r.ge ? <GateIcon pass={r.ge.gate4_exam_passed} /> : '—'}</td>
                    <td><Badge variant={eligibilityVariant(r.ge)}>{eligibilityLabel(r.ge)}</Badge></td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{r.ge ? fmtDate(r.ge.last_evaluated_at) : '—'}</td>
                    {isAdmin && (
                      <td><Button size="sm" variant="secondary" onClick={() => openOverride(r)}>Override</Button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Override modal */}
      <Modal open={!!overrideTarget} title={overrideTarget ? `Override — ${overrideTarget.full_name || overrideTarget.email}` : ''} onClose={() => setOverrideTarget(null)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              <label style={formLabel}>Decision</label>
              <select className="rso-select" value={overrideDecision} onChange={e => setOverrideDecision(e.target.value)} style={{ width: '100%' }}>
                <option value="true">Mark Eligible</option>
                <option value="false">Mark Not Eligible</option>
                <option value="null">Clear Override</option>
              </select>
            </div>
            <div>
              <label style={formLabel}>Reason (optional)</label>
              <textarea className="rso-input" rows={3} value={overrideReason} onChange={e => setOverrideReason(e.target.value)} placeholder="Briefly explain the override…" style={{ width: '100%', resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setOverrideTarget(null)}>Cancel</Button>
              <Button onClick={saveOverride} disabled={overrideSaving}>{overrideSaving ? 'Saving…' : 'Save Override'}</Button>
            </div>
          </div>
        </Modal>
    </div>
  );
}

const formLabel = { fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4, display: 'block' };
