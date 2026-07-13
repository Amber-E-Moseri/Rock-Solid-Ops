import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  fetchTeacherList, fetchCampuses, fetchConflicts, convertSlot,
  monthOptions, submitAvailability, getActiveBatchId, resolveTeacherId,
  DAYS, SLOTS, TZ_OPTIONS, SUBGROUP_LABELS, to24h,
} from './lib/teacherSchedule.js';
import { PageHeader, Button, Skeleton, Modal, SearchInput, ErrorBanner } from '../../components/ui/index.js';

export default function TeacherSchedulePage() {
  const { profile } = useAuth();
  const { addToast } = useToast();

  const [teacherName, setTeacherName] = useState('');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [teacherTz, setTeacherTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const months = useMemo(() => monthOptions(6), []);
  const [monthIdx, setMonthIdx] = useState(0);

  const [selectedCampuses, setSelectedCampuses] = useState(new Set());
  const [campusSearch, setCampusSearch] = useState('');
  const [slotSet, setSlotSet] = useState(new Set());
  const [showReview, setShowReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  const teacherList = useQuery({ queryKey: ['ts-teachers'], queryFn: fetchTeacherList, staleTime: 5 * 60_000 });
  const campusList = useQuery({ queryKey: ['ts-campuses'], queryFn: fetchCampuses, staleTime: 5 * 60_000 });
  const campusCodes = useMemo(() => [...selectedCampuses], [selectedCampuses]);
  const conflicts = useQuery({
    queryKey: ['ts-conflicts', campusCodes.sort().join(','), months[monthIdx]?.label],
    queryFn: () => fetchConflicts(campusCodes),
    enabled: campusCodes.length > 0,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (profile?.email) setTeacherEmail(profile.email);
  }, [profile?.email]);

  useEffect(() => {
    const list = teacherList.data ?? [];
    if (!teacherName || teacherName.length < 2) { setSuggestions([]); return; }
    const q = teacherName.toLowerCase();
    const matches = list.filter((t) => t.teacherName.toLowerCase().includes(q) || t.teacherEmail.toLowerCase().includes(q));
    const exact = matches.filter((t) => t.teacherName.toLowerCase() === q || t.teacherEmail.toLowerCase() === q);
    if (exact.length === 1) {
      setTeacherEmail(exact[0].teacherEmail);
      setTeacherTz(exact[0].teacherTimezone);
      setSuggestions([]);
    } else {
      setSuggestions(matches.slice(0, 8));
    }
  }, [teacherName, teacherList.data]);

  function selectSuggestion(t) {
    setTeacherName(t.teacherName);
    setTeacherEmail(t.teacherEmail);
    setTeacherTz(t.teacherTimezone);
    setSuggestions([]);
  }

  function toggleCampus(code) {
    setSelectedCampuses((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  function toggleSlot(day, time) {
    const key = `${day}||${time}`;
    setSlotSet((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function isConflict(day, time) {
    if (!conflicts.data || campusCodes.length === 0) return false;
    const m = months[monthIdx];
    for (const code of campusCodes) {
      const set = conflicts.data[code];
      if (!set) continue;
      const converted = convertSlot(day, time, teacherTz, campusList.data?.find((c) => c.code === code)?.timezone || 'America/Toronto', m.year, m.month);
      if (set.has(`${converted.day}__${converted.time}`)) return true;
    }
    return false;
  }

  const groupedCampuses = useMemo(() => {
    const campuses = campusList.data ?? [];
    const filtered = campusSearch
      ? campuses.filter((c) => `${c.campusName} ${c.code} ${c.groupID} ${c.subgroupID}`.toLowerCase().includes(campusSearch.toLowerCase()))
      : campuses;
    const groups = {};
    for (const c of filtered) {
      const gKey = c.groupID || 'Other';
      if (!groups[gKey]) groups[gKey] = {};
      const sgKey = c.subgroupID || 'Other';
      if (!groups[gKey][sgKey]) groups[gKey][sgKey] = [];
      groups[gKey][sgKey].push(c);
    }
    return groups;
  }, [campusList.data, campusSearch]);

  const slotSummary = useMemo(() => {
    const byCampus = {};
    const m = months[monthIdx];
    for (const code of campusCodes) {
      byCampus[code] = [];
      const tz = campusList.data?.find((c) => c.code === code)?.timezone || 'America/Toronto';
      for (const key of slotSet) {
        const [day, time] = key.split('||');
        const conv = convertSlot(day, time, teacherTz, tz, m.year, m.month);
        byCampus[code].push(`${conv.day.slice(0, 3)} ${conv.time}`);
      }
      byCampus[code].sort();
    }
    return byCampus;
  }, [slotSet, campusCodes, teacherTz, months, monthIdx, campusList.data]);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const batchId = await getActiveBatchId();
      if (!batchId) throw new Error('No active batch found');
      let tid = null;
      if (teacherEmail) tid = await resolveTeacherId(teacherEmail);
      if (!tid) throw new Error('Teacher not found by email');
      const count = await submitAvailability(teacherEmail, tid, batchId, slotSet, campusCodes, months[monthIdx].label);
      addToast(`${count} slot(s) submitted`, 'success');
      setShowReview(false);
      setSlotSet(new Set());
    } catch (e) { addToast(e.message, 'error'); }
    finally { setSubmitting(false); }
  }

  const canSubmit = teacherName && teacherEmail && teacherTz && slotSet.size > 0 && campusCodes.length > 0;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader title="Teacher Availability" subtitle="Select your available time slots for upcoming classes." />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.5rem' }}>
        {/* Main */}
        <div>
          {/* Teacher details */}
          <div className="rso-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '0.75rem' }}>Teacher Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <label className="rso-field" style={{ position: 'relative' }}>
                <span>Teacher Name</span>
                <input className="rso-input" value={teacherName} onChange={(e) => setTeacherName(e.target.value)} />
                {suggestions.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', zIndex: 10, maxHeight: 200, overflow: 'auto' }}>
                    {suggestions.map((s) => (
                      <div key={s.teacherId} onClick={() => selectSuggestion(s)}
                        style={{ padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '13px' }}>
                        {s.teacherName} <span style={{ color: 'var(--muted)' }}>({s.teacherEmail})</span>
                      </div>
                    ))}
                  </div>
                )}
              </label>
              <label className="rso-field"><span>Email</span><input className="rso-input" value={teacherEmail} onChange={(e) => setTeacherEmail(e.target.value)} /></label>
              <label className="rso-field"><span>Timezone</span>
                <select className="rso-select" value={teacherTz} onChange={(e) => setTeacherTz(e.target.value)}>
                  {TZ_OPTIONS.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </label>
              <label className="rso-field"><span>Month</span>
                <select className="rso-select" value={monthIdx} onChange={(e) => setMonthIdx(Number(e.target.value))}>
                  {months.map((m, i) => <option key={i} value={i}>{m.label}</option>)}
                </select>
              </label>
            </div>
            {teacherList.isError && (
              <div style={{ marginTop: '0.75rem' }}>
                <ErrorBanner message="Could not load teacher directory — search-as-you-type won't work, but you can still fill in details manually." onRetry={() => teacherList.refetch()} />
              </div>
            )}
          </div>

          {/* Campuses */}
          <div className="rso-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '0.5rem' }}>Campuses</h3>
            <SearchInput value={campusSearch} onChange={(e) => setCampusSearch(e.target.value)} placeholder="Search campuses…" style={{ marginBottom: '0.75rem' }} />
            {campusList.isLoading ? <Skeleton variant="text" /> : campusList.isError ? (
              <ErrorBanner message="Could not load campuses." onRetry={() => campusList.refetch()} />
            ) : Object.entries(groupedCampuses).map(([gid, subs]) => (
              <div key={gid} style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>{gid}</div>
                {Object.entries(subs).map(([sgid, campuses]) => (
                  <div key={sgid} style={{ marginBottom: '0.5rem' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '0.15rem' }}>{SUBGROUP_LABELS[sgid] || sgid}</div>
                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                      {campuses.map((c) => (
                        <button key={c.code} onClick={() => toggleCampus(c.code)} style={{
                          padding: '0.3rem 0.6rem', borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
                          fontSize: '11px', fontWeight: selectedCampuses.has(c.code) ? 600 : 400,
                          background: selectedCampuses.has(c.code) ? 'var(--primary)' : 'var(--surface)',
                          color: selectedCampuses.has(c.code) ? '#fff' : 'var(--text)',
                        }}>{c.campusName || c.code}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            <p style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{selectedCampuses.size} selected</p>
          </div>

          {/* Availability grid */}
          {campusCodes.length > 0 && (
            <div className="rso-card" style={{ padding: '1rem' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '0.5rem' }}>Availability — {teacherTz}</h3>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `80px repeat(7, 1fr)`, gap: 1, minWidth: 600 }}>
                  <div />
                  {DAYS.map((d) => <div key={d} style={{ textAlign: 'center', fontWeight: 600, fontSize: '11px', padding: '0.3rem' }}>{d.slice(0, 3)}</div>)}
                  {SLOTS.map((time) => (
                    <>
                      <div key={`l-${time}`} style={{ fontSize: '0.65rem', color: 'var(--muted)', padding: '0.2rem 0.25rem', display: 'flex', alignItems: 'center' }}>{time}</div>
                      {DAYS.map((day) => {
                        const key = `${day}||${time}`;
                        const active = slotSet.has(key);
                        const conflict = isConflict(day, time);
                        return (
                          <div key={key} onClick={() => !conflict && toggleSlot(day, time)} style={{
                            padding: '0.2rem', textAlign: 'center', cursor: conflict ? 'not-allowed' : 'pointer',
                            background: active ? 'var(--primary)' : 'var(--surface)',
                            color: active ? '#fff' : 'var(--text)',
                            opacity: conflict ? 0.4 : 1,
                            borderRadius: 2, fontSize: '11px',
                          }}>{active ? '✓' : ''}</div>
                        );
                      })}
                    </>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: 'var(--muted)' }}>{slotSet.size} slot(s) selected</span>
                <Button variant="primary" disabled={!canSubmit} onClick={() => setShowReview(true)}>Review & Submit</Button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ position: 'sticky', top: 80 }}>
          <div className="rso-card" style={{ padding: '1rem' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '0.5rem' }}>Summary</h3>
            <p style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '0.75rem' }}>Timezone: {teacherTz}</p>
            {Object.entries(slotSummary).map(([code, slots]) => (
              <div key={code} style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '0.25rem' }}>
                  {campusList.data?.find((c) => c.code === code)?.campusName || code}
                </div>
                <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                  {slots.map((s, i) => (
                    <span key={i} style={{ padding: '0.15rem 0.4rem', borderRadius: 'var(--r-sm)', background: 'var(--surface)', fontSize: '0.6rem' }}>{s}</span>
                  ))}
                </div>
              </div>
            ))}
            <p style={{ fontSize: '13px', fontWeight: 700, marginTop: '0.5rem' }}>Total: {slotSet.size} slots</p>
          </div>
        </div>
      </div>

      {/* Review modal */}
      {showReview && (
        <Modal title="Review & Submit" onClose={() => setShowReview(false)} footer={
          <>
            <Button variant="ghost" onClick={() => setShowReview(false)}>Close</Button>
            <Button variant="primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Submitting…' : 'Confirm Submit'}</Button>
          </>
        }>
          <p style={{ fontSize: '13px', marginBottom: '0.5rem' }}><strong>{teacherName}</strong> ({teacherEmail}) — {teacherTz}</p>
          {Object.entries(slotSummary).map(([code, slots]) => (
            <div key={code} style={{ marginBottom: '0.5rem' }}>
              <div style={{ fontWeight: 600, fontSize: '13px' }}>{code}</div>
              <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                {slots.map((s, i) => (
                  <span key={i} style={{ padding: '0.15rem 0.4rem', borderRadius: 'var(--r-sm)', background: 'var(--primary)', color: '#fff', fontSize: '0.6rem' }}>{s}</span>
                ))}
              </div>
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}
