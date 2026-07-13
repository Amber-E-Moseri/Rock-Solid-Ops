import { useState, useMemo, useCallback, useEffect, Fragment } from 'react';
import { PageHeader, Card, Badge, Button, Skeleton, SearchInput, Select } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  fetchSubmissions, computeKpis, filterSubmissions, getFilterOptions,
  setSubmissionStatus, fmtDate, fmtMonth, statusVariant, buildSlotSet,
  DAYS, TIMES,
} from './lib/availabilityApproval.js';

export default function AvailabilityApprovalPage() {
  const { profile } = useAuth();
  const toast = useToast();

  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [campusFilter, setCampusFilter] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [drawerItem, setDrawerItem] = useState(null);
  const [reviewNote, setReviewNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSubmissions();
      setSubmissions(data);
    } catch (e) {
      toast(e.message || 'Failed to load submissions', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => computeKpis(submissions), [submissions]);
  const filterOpts = useMemo(() => getFilterOptions(submissions), [submissions]);
  const filtered = useMemo(
    () => filterSubmissions(submissions, { search, status: statusFilter, month: monthFilter, campus: campusFilter }),
    [submissions, search, statusFilter, monthFilter, campusFilter],
  );

  const clearFilters = () => { setSearch(''); setStatusFilter(''); setMonthFilter(''); setCampusFilter(''); };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = (checked) => {
    setSelected(checked ? new Set(filtered.map(s => s.id)) : new Set());
  };

  const doSetStatus = useCallback(async (ids, status) => {
    setSaving(true);
    try {
      await setSubmissionStatus(ids, status, reviewNote, profile?.email);
      setSubmissions(prev => prev.map(s => ids.includes(s.id) ? { ...s, status, review_note: reviewNote } : s));
      setSelected(new Set());
      setDrawerItem(null);
      setReviewNote('');
      toast(`${ids.length} submission${ids.length > 1 ? 's' : ''} ${status}`, status === 'approved' ? 'success' : 'error');
    } catch (e) {
      toast('Failed to update: ' + (e.message || e), 'error');
    } finally {
      setSaving(false);
    }
  }, [reviewNote, profile, toast]);

  const openDrawer = (item) => {
    setDrawerItem(item);
    setReviewNote(item.review_note || '');
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Availability Approval"
        subtitle="Review and approve teacher availability submissions before scheduling classes."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={load}>Refresh</Button>
            <Button disabled={selected.size === 0 || saving} onClick={() => doSetStatus([...selected], 'approved')}>
              Approve Selected
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        {[
          { label: 'Submissions', value: kpis.total },
          { label: 'Pending Review', value: kpis.pending, color: 'var(--color-warning)' },
          { label: 'Approved', value: kpis.approved, color: 'var(--color-success)' },
          { label: 'Rejected', value: kpis.rejected, color: 'var(--color-danger)' },
        ].map(k => (
          <Card key={k.label}>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: k.color || 'var(--text)' }}>{loading ? '—' : k.value}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 4 }}>{k.label}</div>
          </Card>
        ))}
      </div>

      {/* Table panel */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Teacher Submissions</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{filtered.length} submission{filtered.length !== 1 ? 's' : ''}</div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <SearchInput placeholder="Search teacher name or email" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <select className="rso-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <select className="rso-select" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All months</option>
            {filterOpts.months.map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}
          </select>
          <select className="rso-select" value={campusFilter} onChange={e => setCampusFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All campuses</option>
            {filterOpts.campuses.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <Button size="sm" variant="secondary" onClick={clearFilters}>Clear</Button>
        </div>

        {loading ? <Skeleton style={{ height: 300 }} /> : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13, fontWeight: 600 }}>No submissions found.</div>
        ) : (
          <div className="rso-table-wrap">
            <table className="rso-table" style={{ minWidth: 800 }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox" checked={selected.size > 0 && selected.size === filtered.length} onChange={e => toggleAll(e.target.checked)} aria-label="Select all" />
                  </th>
                  <th>Teacher</th>
                  <th>Submitted</th>
                  <th>Month</th>
                  <th>Campus(es)</th>
                  <th>Slots</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const slotCount = (s.slots || []).length;
                  const campusStr = (s.campuses || []).slice(0, 2).join(', ') + (s.campuses?.length > 2 ? ` +${s.campuses.length - 2}` : '');
                  return (
                    <tr key={s.id}>
                      <td><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} /></td>
                      <td>
                        <div style={{ fontWeight: 700 }}>{s.teacher_name || '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.teacher_email || ''}</div>
                      </td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(s.created_at)}</td>
                      <td style={{ fontSize: 12 }}>{fmtMonth(s.month)}</td>
                      <td style={{ fontSize: 12 }}>{campusStr || '—'}</td>
                      <td><span style={{ fontWeight: 700 }}>{slotCount}</span> <span style={{ color: 'var(--muted)', fontSize: 12 }}>slot{slotCount !== 1 ? 's' : ''}</span></td>
                      <td><Badge variant={statusVariant(s.status)}>{s.status || 'pending'}</Badge></td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button size="sm" variant="secondary" onClick={() => openDrawer(s)}>Review</Button>
                          {s.status === 'pending' && (
                            <>
                              <Button size="sm" variant="primary" onClick={() => doSetStatus([s.id], 'approved')} disabled={saving}>✓</Button>
                              <Button size="sm" variant="danger" onClick={() => doSetStatus([s.id], 'rejected')} disabled={saving}>✕</Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Detail drawer */}
      {drawerItem && (
        <>
          <div onClick={() => setDrawerItem(null)} style={overlayStyle} />
          <aside style={drawerStyle}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{drawerItem.teacher_name || drawerItem.teacher_email || 'Teacher'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>{fmtMonth(drawerItem.month)} · {drawerItem.teacher_email || ''}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setDrawerItem(null)}>✕</Button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Badge variant={statusVariant(drawerItem.status)}>{drawerItem.status || 'pending'}</Badge>

              <div>
                <div style={sectionLabel}>Selected Slots</div>
                <SlotGrid slots={drawerItem.slots} />
              </div>

              {drawerItem.notes && (
                <div style={{ fontSize: 13, color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                  <strong style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Teacher Note</strong>
                  {drawerItem.notes}
                </div>
              )}

              <div>
                <label style={sectionLabel}>Review Note (optional)</label>
                <textarea className="rso-input" rows={3} value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="Add a note for the teacher…" style={{ resize: 'vertical', width: '100%' }} />
              </div>
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="danger" onClick={() => doSetStatus([drawerItem.id], 'rejected')} disabled={saving}>Reject</Button>
              <Button variant="primary" onClick={() => doSetStatus([drawerItem.id], 'approved')} disabled={saving}>Approve</Button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function SlotGrid({ slots }) {
  const slotSet = buildSlotSet(slots);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '80px repeat(7, 1fr)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={sgCorner}>Time</div>
      {DAYS.map(d => <div key={d} style={sgDay}>{d}</div>)}
      {TIMES.map(t => (
        <Fragment key={t}>
          <div style={sgTime}>{t}</div>
          {DAYS.map((_, di) => {
            const on = slotSet.has(`${di}:${t}`);
            return <div key={di} style={{ ...sgCell, ...(on ? sgCellOn : {}) }} />;
          })}
        </Fragment>
      ))}
    </div>
  );
}

const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(10,10,20,.42)', backdropFilter: 'blur(3px)', zIndex: 60 };
const drawerStyle = { position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(480px, 96vw)', background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,.14)', display: 'flex', flexDirection: 'column', zIndex: 61 };
const sectionLabel = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', display: 'block', marginBottom: 6 };
const sgCorner = { padding: '7px 8px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, color: 'var(--muted)' };
const sgDay = { padding: '7px 4px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 800, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--primary)' };
const sgTime = { padding: '7px 8px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', fontSize: 10, color: 'var(--muted)', fontWeight: 600 };
const sgCell = { minHeight: 32, borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)' };
const sgCellOn = { background: 'color-mix(in srgb, var(--primary) 14%, var(--surface))', outline: '2px inset var(--primary)', outlineOffset: -2 };
