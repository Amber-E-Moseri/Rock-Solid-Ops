import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import {
  PageHeader, Card, Badge, Button, Skeleton, Toolbar, SearchInput, Select, Modal,
} from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  fetchWaitlistData, computeSummary, filterStudents, getAssignableClassOptions,
  assignApplicantToClass, removeFromWaitlist, runWaitlistCheck, saveSlotCapacity, countAssignedInSlot,
  fmt, daysSince, fillClass,
} from './lib/waitlist.js';

export default function WaitlistPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['waitlist'],
    queryFn: fetchWaitlistData,
    staleTime: 1000 * 60,
  });

  const [activeTab, setActiveTab] = useState('students');
  const [activeBatch, setActiveBatch] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fellowshipFilter, setFellowshipFilter] = useState('');
  const [assignTarget, setAssignTarget] = useState(null);
  const [assignClassId, setAssignClassId] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [checkBusy, setCheckBusy] = useState(false);
  const [capDrafts, setCapDrafts] = useState({});

  const students = data?.students || [];
  const slots = data?.slots || [];
  const batches = data?.batches || [];
  const classOptions = data?.classOptions || {};

  const summary = useMemo(() => computeSummary({ students, classOptions, activeBatch }), [students, classOptions, activeBatch]);
  const visibleStudents = useMemo(
    () => filterStudents(students, { activeBatch, search, statusFilter, fellowshipFilter }),
    [students, activeBatch, search, statusFilter, fellowshipFilter],
  );
  const visibleSlots = useMemo(() => slots.filter((s) => !activeBatch || s.batch_id === activeBatch), [slots, activeBatch]);
  const fellowshipOptions = useMemo(
    () => [...new Set(students.map((s) => String(s.fellowship_code || '').toUpperCase()).filter(Boolean))].sort(),
    [students],
  );

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['waitlist'] });
  }, [queryClient]);

  const openAssignModal = useCallback((student) => {
    setAssignTarget(student);
    setAssignError('');
    const options = getAssignableClassOptions(classOptions, student.fellowship_code);
    setAssignClassId(options[0]?.class_option_id || '');
  }, [classOptions]);

  const submitAssign = useCallback(async () => {
    if (!assignTarget || !assignClassId) return;
    setAssignBusy(true);
    setAssignError('');
    try {
      await assignApplicantToClass(assignTarget.id, assignClassId);
      toast(`${assignTarget.full_name || assignTarget.email} assigned to class successfully.`, 'success');
      setAssignTarget(null);
      refresh();
    } catch (e) {
      setAssignError(String(e?.message || e));
    } finally {
      setAssignBusy(false);
    }
  }, [assignTarget, assignClassId, toast, refresh]);

  const handleRemove = useCallback(async (s) => {
    if (!window.confirm(`Remove ${s.full_name || s.email} from the waiting list? Their status will be set to INACTIVE.`)) return;
    try {
      await removeFromWaitlist(s.id);
      toast(`${s.full_name || s.email} removed from waiting list.`, 'success');
      refresh();
    } catch (e) {
      toast(String(e?.message || e), 'error');
    }
  }, [toast, refresh]);

  const handleRunCheck = useCallback(async () => {
    setCheckBusy(true);
    try {
      const res = await runWaitlistCheck();
      toast(`Done — ${res.notified ?? 0} student(s) notified of available classes.`, 'success');
      refresh();
    } catch (e) {
      toast(String(e?.message || e), 'error');
    } finally {
      setCheckBusy(false);
    }
  }, [toast, refresh]);

  const handleSaveCap = useCallback(async (slot) => {
    const draft = capDrafts[slot.class_slot_id] || {};
    const newCap = draft.capacity !== undefined ? (draft.capacity === '' ? null : parseInt(draft.capacity, 10)) : slot.max_capacity;
    const newStatus = draft.status || slot.status || 'Active';

    if (newStatus === 'Cancelled') {
      const count = await countAssignedInSlot(slot.class_option_id, slot.batch_id);
      if (!window.confirm(`Cancel this slot? ${count} enrolled student(s) will need to be notified separately.`)) return;
    }

    try {
      await saveSlotCapacity({
        slotId: slot.class_slot_id, classOptionId: slot.class_option_id, batchId: slot.batch_id,
        oldCapacity: slot.max_capacity, newCapacity: newCap, newStatus, actorEmail: profile?.email,
      });
      toast('Slot saved.', 'success');
      refresh();
    } catch (e) {
      toast(String(e?.message || e), 'error');
    }
  }, [capDrafts, profile, toast, refresh]);

  if (isLoading) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Skeleton style={{ height: 40 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} style={{ height: 70 }} />)}</div>
        <Skeleton style={{ height: 300 }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Waiting Students"
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Select value={activeBatch} onChange={(e) => setActiveBatch(e.target.value)} style={{ minWidth: 160 }}>
              <option value="">All Batches</option>
              {batches.map((b) => <option key={b.batch_id} value={b.batch_id}>{b.batch_name || b.batch_id}</option>)}
            </Select>
            <Button variant="secondary" onClick={handleRunCheck} disabled={checkBusy}>Notify Available Classes</Button>
            <Button onClick={refresh} disabled={isFetching}>
              <RefreshCw size={14} style={{ marginRight: 4, ...(isFetching ? { animation: 'spin 1s linear infinite' } : {}) }} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
        <SummaryCard label="Total Waiting" value={summary.total} />
        <SummaryCard label="Waiting > 7 days" value={summary.gt7} accent={summary.gt7 > 0 ? 'warning' : null} />
        <SummaryCard label="Waiting > 14 days" value={summary.gt14} accent={summary.gt14 > 0 ? 'danger' : null} />
        <SummaryCard label="Fellowships – no class" value={summary.uncoveredCount} accent={summary.uncoveredCount > 0 ? 'danger' : null} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 14, padding: 4, width: 'fit-content' }}>
        <button
          onClick={() => setActiveTab('students')}
          style={tabStyle(activeTab === 'students')}
        >Waiting Students</button>
        <button
          onClick={() => setActiveTab('capacity')}
          style={tabStyle(activeTab === 'capacity')}
        >Class Capacity</button>
      </div>

      {activeTab === 'students' && (
        <Card>
          <Toolbar style={{ flexWrap: 'wrap' }}>
            <SearchInput placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="NO_MATCHING_TIME">No Suitable Time</option>
              <option value="WAITLISTED">Capacity Waitlist</option>
            </Select>
            <Select value={fellowshipFilter} onChange={(e) => setFellowshipFilter(e.target.value)}>
              <option value="">All Fellowships</option>
              {fellowshipOptions.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>
            <span style={{ color: 'var(--muted)', fontSize: 13, whiteSpace: 'nowrap' }}>
              {visibleStudents.length} student{visibleStudents.length !== 1 ? 's' : ''}
            </span>
          </Toolbar>

          {visibleStudents.length === 0 ? (
            <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 13 }}>
              No waiting students match the current filters.
            </div>
          ) : (
            <div className="rso-table-wrap">
              <table className="rso-table" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th>Name / Email</th><th>Fellowship</th><th>Availability</th><th>Reason</th>
                    <th>Waiting Since</th><th>Days</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStudents.map((s) => {
                    const sinceDate = s.waitlisted_at || s.created_at;
                    const days = daysSince(sinceDate) ?? 0;
                    const daysVariant = days > 14 ? 'danger' : days > 7 ? 'warning' : null;
                    const reason = s.availability_status === 'NO_MATCHING_TIME'
                      ? <Badge variant="warning">No Suitable Time</Badge>
                      : s.availability_status === 'CLASS_FULL'
                        ? <Badge variant="danger">Class Full</Badge>
                        : <Badge variant="info">{s.availability_status || s.registration_status || '—'}</Badge>;
                    return (
                      <tr key={s.id}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{s.full_name || '—'}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.email || ''}</div>
                        </td>
                        <td style={{ fontSize: 12 }}>{s.fellowship_code || '—'}</td>
                        <td style={{ fontSize: 12, maxWidth: 180, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{s.availability || '—'}</td>
                        <td>{reason}</td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmt(sinceDate)}</td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                          {daysVariant ? <Badge variant={daysVariant}>{days}d</Badge> : <span style={{ color: 'var(--muted)' }}>{days}d</span>}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <Button size="sm" onClick={() => openAssignModal(s)}>Assign to Class</Button>
                            <Button size="sm" variant="secondary" onClick={() => handleRemove(s)}>Remove</Button>
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
          {visibleStudents.length > 0 && (
            <div className="rso-table-cards">
              {visibleStudents.map((s) => {
                const sinceDate = s.waitlisted_at || s.created_at;
                const days = daysSince(sinceDate) ?? 0;
                const daysVariant = days > 14 ? 'danger' : days > 7 ? 'warning' : null;
                const reason = s.availability_status === 'NO_MATCHING_TIME'
                  ? <Badge variant="warning">No Suitable Time</Badge>
                  : s.availability_status === 'CLASS_FULL'
                    ? <Badge variant="danger">Class Full</Badge>
                    : <Badge variant="info">{s.availability_status || s.registration_status || '—'}</Badge>;
                return (
                  <div key={s.id} className="rso-table-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{s.full_name || '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.email || ''}</div>
                      </div>
                      {daysVariant ? <Badge variant={daysVariant}>{days}d</Badge> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>{days}d</span>}
                    </div>
                    <div className="rso-table-card-row"><span className="rso-table-card-label">Fellowship</span><span>{s.fellowship_code || '—'}</span></div>
                    <div className="rso-table-card-row"><span className="rso-table-card-label">Status</span>{reason}</div>
                    <div className="rso-table-card-row"><span className="rso-table-card-label">Waiting Since</span><span>{fmt(sinceDate)}</span></div>
                    {s.availability && (
                      <div className="rso-table-card-row" style={{ alignItems: 'flex-start' }}><span className="rso-table-card-label">Availability</span><span style={{ textAlign: 'right', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{s.availability}</span></div>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                      <Button size="sm" onClick={() => openAssignModal(s)}>Assign to Class</Button>
                      <Button size="sm" variant="secondary" onClick={() => handleRemove(s)}>Remove</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'capacity' && (
        <Card>
          {visibleSlots.length === 0 ? (
            <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 13 }}>
              No active class slots found.
            </div>
          ) : (
            <div className="rso-table-wrap">
              <table className="rso-table" style={{ minWidth: 1000 }}>
                <thead>
                  <tr>
                    <th>Class</th><th>Teacher</th><th>Day / Time</th><th>Batch</th>
                    <th>Enrolled</th><th>Fill</th><th>New Max</th><th>Status</th><th>Save</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSlots.map((slot) => {
                    const co = classOptions[slot.class_option_id] || {};
                    const bat = batches.find((b) => b.batch_id === slot.batch_id);
                    const pct = slot.max_capacity ? Math.round((slot.current_enrolment / slot.max_capacity) * 100) : 0;
                    const draft = capDrafts[slot.class_slot_id] || {};
                    const capValue = draft.capacity !== undefined ? draft.capacity : (slot.max_capacity ?? '');
                    const statusValue = draft.status !== undefined ? draft.status : (slot.status || 'Active');
                    return (
                      <tr key={slot.class_slot_id}>
                        <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{slot.class_option_id}</td>
                        <td style={{ fontSize: 12 }}>{co.teacher_name || '—'}</td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{[co.day, co.class_time].filter(Boolean).join(' · ') || '—'}</td>
                        <td style={{ fontSize: 12 }}>{bat?.batch_name || slot.batch_id}</td>
                        <td style={{ fontSize: 12 }}>{slot.current_enrolment} / {slot.max_capacity ?? '∞'}</td>
                        <td>
                          {slot.max_capacity ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 70, height: 7, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                                <div style={{ height: '100%', borderRadius: 99, width: `${Math.min(100, pct)}%`, background: `var(--color-${fillClass(pct)}, var(--primary))` }} />
                              </div>
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{pct}%</span>
                            </div>
                          ) : <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>}
                        </td>
                        <td>
                          <input
                            type="number" min="0" placeholder="∞" value={capValue}
                            onChange={(e) => setCapDrafts((d) => ({ ...d, [slot.class_slot_id]: { ...d[slot.class_slot_id], capacity: e.target.value } }))}
                            style={{ width: 70, border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px', fontSize: 12, textAlign: 'center' }}
                          />
                        </td>
                        <td>
                          <select
                            value={statusValue}
                            onChange={(e) => setCapDrafts((d) => ({ ...d, [slot.class_slot_id]: { ...d[slot.class_slot_id], status: e.target.value } }))}
                            style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px', fontSize: 12, background: 'var(--surface)' }}
                          >
                            <option value="Active">Active</option>
                            <option value="Closed">Closed</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
                        </td>
                        <td><Button size="sm" variant="secondary" onClick={() => handleSaveCap(slot)}>Save</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Assign modal */}
      {assignTarget && (
        <Modal open onClose={() => setAssignTarget(null)} title="Assign to Class">
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
            <strong style={{ color: 'var(--text)' }}>{assignTarget.full_name || assignTarget.email}</strong><br />
            {assignTarget.email || ''} &nbsp;·&nbsp; {assignTarget.fellowship_code || '—'}<br />
            <span style={{ marginTop: 4, display: 'inline-block' }}>Availability: <em>{assignTarget.availability || 'not specified'}</em></span>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Class</label>
            {(() => {
              const options = getAssignableClassOptions(classOptions, assignTarget.fellowship_code);
              const fc = String(assignTarget.fellowship_code || '').toUpperCase();
              return options.length ? (
                <Select value={assignClassId} onChange={(e) => setAssignClassId(e.target.value)} style={{ width: '100%' }}>
                  {options.map((c) => {
                    const match = (c.fellowship_codes || []).map((v) => String(v || '').toUpperCase()).includes(fc);
                    const label = [c.teacher_name, c.day, c.class_time].filter(Boolean).join(' – ') || c.class_option_id;
                    return <option key={c.class_option_id} value={c.class_option_id}>{label}{match ? ' ✓' : ''}</option>;
                  })}
                </Select>
              ) : <div style={{ fontSize: 13, color: 'var(--muted)' }}>No active class options available</div>;
            })()}
          </div>
          {assignError && (
            <div style={{ padding: 10, border: '1px solid var(--color-danger)', borderRadius: 8, background: 'var(--danger-bg, #fef2f2)', color: 'var(--color-danger)', fontSize: 13, marginBottom: 10 }}>
              Assignment failed: {assignError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setAssignTarget(null)}>Cancel</Button>
            <Button onClick={submitAssign} disabled={assignBusy || !assignClassId}>Assign</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function tabStyle(active) {
  return {
    border: 'none',
    background: active ? '#fff' : 'transparent',
    color: active ? 'var(--primary)' : 'var(--muted)',
    borderRadius: 10,
    padding: '7px 18px',
    fontWeight: 700,
    fontSize: 13,
    cursor: 'pointer',
    boxShadow: active ? '0 1px 4px rgba(76,42,146,.14)' : 'none',
  };
}

function SummaryCard({ label, value, accent }) {
  const accentColor = accent ? `var(--color-${accent})` : 'var(--text)';
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', padding: 14, boxShadow: 'var(--sh-xs)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 26, fontWeight: 800, color: accentColor }}>{value}</div>
    </div>
  );
}
