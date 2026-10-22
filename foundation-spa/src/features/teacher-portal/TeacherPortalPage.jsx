import { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  resolveTeacher, fetchTeacherClasses, fetchTeacherAvailability,
  deleteAvailability, insertAvailability, fetchStudentProgress,
  computeAttendanceRate, getMilestoneFlags,
} from './lib/teacherPortal.js';
import { SLOTS, to24h, getActiveBatchId } from '../teacher-schedule/lib/teacherSchedule.js';
import { PageHeader, Skeleton, EmptyState, Badge, Button, Select, ErrorBanner } from '../../components/ui/index.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MILESTONES = ['milestone_1', 'milestone_2', 'milestone_3', 'milestone_4'];
const MILESTONE_LABELS = ['Foundation class', 'Water baptism', 'Cell placement', 'Maturity class'];

const TAB_PATHS = ['/teacher/index', '/teacher/availability', '/teacher/progress'];
const TAB_LABELS = ['My Classes', 'My Availability', 'Student Progress'];

// A failed read is shown as an error with Retry. It is never rendered as an empty state.
function loadFailureMessage(what, error) {
  return `${what} could not be loaded${error?.message ? `: ${error.message}` : '.'}`;
}

function tabFromLocation(pathname, search) {
  if (pathname.endsWith('/availability')) return 1;
  if (pathname.endsWith('/progress')) return 2;
  const section = new URLSearchParams(search).get('section');
  return { 'my-class': 0, availability: 1, progress: 2 }[section] ?? 0;
}

function to12h(time) {
  const m = String(time || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(time || '');
  const h = Number(m[1]);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m[2]} ${ampm}`;
}

export default function TeacherPortalPage() {
  const { profile } = useAuth();
  const addToast = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const tab = tabFromLocation(location.pathname, location.search);

  const teacher = useQuery({
    queryKey: ['teacher-resolve', profile?.email],
    queryFn: () => resolveTeacher(profile),
    enabled: !!profile?.email,
    staleTime: 5 * 60_000,
  });

  const teacherId = teacher.data?.teacher_id;

  return (
    <div className="page-content">
      <PageHeader title="Teacher Portal" subtitle={teacher.data ? `Welcome, ${teacher.data.full_name}` : undefined} />

      <div role="tablist" aria-label="Teacher portal sections" className="rso-tab-list">
        {TAB_LABELS.map((label, i) => (
          <button key={label} role="tab" aria-selected={tab === i} className="rso-tab"
            onClick={() => navigate(TAB_PATHS[i], { replace: true })}>{label}</button>
        ))}
      </div>

      {teacher.isLoading ? <Skeleton variant="rows" rows={3} /> :
        teacher.isError ? <ErrorBanner message={loadFailureMessage('Your teacher profile', teacher.error)} onRetry={() => teacher.refetch()} /> :
        !teacherId ? <EmptyState icon="👤" title="Teacher not found" subtitle="No teacher profile linked to your account" /> :
        tab === 0 ? <MyClassesTab teacherId={teacherId} /> :
        tab === 1 ? <AvailabilityTab teacherId={teacherId} teacherEmail={teacher.data?.email} addToast={addToast} /> :
        <ProgressTab teacherId={teacherId} />}
    </div>
  );
}

function MyClassesTab({ teacherId }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['teacher-classes', teacherId],
    queryFn: () => fetchTeacherClasses(teacherId),
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton variant="rows" rows={3} />;
  if (isError) return <ErrorBanner message={loadFailureMessage('Your classes', error)} onRetry={() => refetch()} />;
  const classes = data ?? [];
  if (!classes.length) return <EmptyState icon="📚" title="No classes" subtitle="You have no active class assignments" />;

  return (
    <>
      <div className="rso-table-wrap">
        <table className="rso-table">
          <thead><tr><th>Class</th><th>Day</th><th>Time</th><th>Campus</th><th>Enrolled</th><th>Status</th></tr></thead>
          <tbody>
            {classes.map((c, i) => (
              <tr key={c.class_option_id || i}>
                <td className="rso-tp-cell-strong">{c.class_name || c.class_option_id || `Class ${i + 1}`}</td>
                <td>{c.day || '—'}</td>
                <td>{c.class_time || '—'}</td>
                <td>{c.fellowship_codes?.join(', ') || '—'}</td>
                <td>{c.current_enrollment ?? c.enrollment_count ?? '—'}</td>
                <td><Badge status={c.active ? 'active' : 'inactive'}>{c.active ? 'Active' : 'Inactive'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rso-table-cards">
        {classes.map((c, i) => (
          <div className="rso-table-card" key={c.class_option_id || i}>
            <div className="rso-tp-card-head">
              <span className="rso-tp-card-title">{c.class_name || c.class_option_id || `Class ${i + 1}`}</span>
              <Badge status={c.active ? 'active' : 'inactive'}>{c.active ? 'Active' : 'Inactive'}</Badge>
            </div>
            <div className="rso-table-card-row"><span className="rso-table-card-label">Day</span><span>{c.day || '—'}</span></div>
            <div className="rso-table-card-row"><span className="rso-table-card-label">Time</span><span>{c.class_time || '—'}</span></div>
            <div className="rso-table-card-row"><span className="rso-table-card-label">Campus</span><span>{c.fellowship_codes?.join(', ') || '—'}</span></div>
            <div className="rso-table-card-row"><span className="rso-table-card-label">Enrolled</span><span>{c.current_enrollment ?? c.enrollment_count ?? '—'}</span></div>
          </div>
        ))}
      </div>
    </>
  );
}

function AvailabilityTab({ teacherId, teacherEmail, addToast }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['teacher-availability', teacherId],
    queryFn: () => fetchTeacherAvailability(teacherId),
    staleTime: 60_000,
  });

  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);

  const slots = data ?? [];
  const grouped = useMemo(() => {
    const map = {};
    for (const s of slots) {
      if (!map[s.day]) map[s.day] = [];
      map[s.day].push(s);
    }
    return map;
  }, [slots]);

  async function handleDelete() {
    if (!selected.size) return;
    setSaving(true);
    try {
      await deleteAvailability([...selected]);
      addToast('Slots removed', 'success');
      setSelected(new Set());
      refetch();
    } catch (e) { addToast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  if (isLoading) return <Skeleton variant="rows" rows={4} />;

  // A failed read is an error, not an empty calendar. Retry only re-reads; it never writes.
  if (isError) {
    return (
      <ErrorBanner
        message={`Your availability could not be loaded${error?.message ? `: ${error.message}` : '.'}`}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div>
      {!slots.length ? (
        <EmptyState icon="📅" title="No availability yet" subtitle="Pick your free time slots below and submit them for approval" />
      ) : (
        <>
          <div className="rso-tp-toolbar">
            <span className="rso-tp-muted">
              {slots.length} slot(s) on file — tap a slot to select it for removal
            </span>
            {selected.size > 0 && <Button variant="danger" size="sm" onClick={handleDelete} disabled={saving}>{saving ? 'Removing…' : `Remove ${selected.size} selected`}</Button>}
          </div>
          {DAYS.map((day) => {
            const daySlots = grouped[day];
            if (!daySlots?.length) return null;
            return (
              <div key={day} className="rso-tp-day">
                <div className="rso-tp-day-label">{day}</div>
                <div className="rso-tp-chips">
                  {daySlots.map((s) => (
                    <button key={s.id} type="button" className="rso-tp-chip"
                      aria-pressed={selected.has(s.id)}
                      onClick={() => setSelected((prev) => {
                        const next = new Set(prev); next.has(s.id) ? next.delete(s.id) : next.add(s.id); return next;
                      })}>{to12h(s.time_slot)} <Badge status={s.status?.toLowerCase() === 'approved' ? 'active' : 'draft'}>{s.status || 'Tentative'}</Badge></button>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      <AddAvailability
        teacherId={teacherId}
        teacherEmail={teacherEmail}
        existing={slots}
        addToast={addToast}
        onAdded={refetch}
      />
    </div>
  );
}

/**
 * Teacher self-service availability submission. Writes the same
 * teacher_availability rows the staff Teacher Schedule page writes
 * (status 'Tentative', pending admin approval) — one pipeline, one truth.
 */
function AddAvailability({ teacherId, teacherEmail, existing, addToast, onAdded }) {
  const [day, setDay] = useState('Monday');
  const [picked, setPicked] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);

  const onFileForDay = useMemo(() => {
    const set = new Set();
    for (const s of existing) {
      if (s.day === day) set.add(String(s.time_slot || '').slice(0, 5));
    }
    return set;
  }, [existing, day]);

  function togglePick(slot) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(slot) ? next.delete(slot) : next.add(slot);
      return next;
    });
  }

  async function handleSubmit() {
    if (!picked.size) return;
    setSubmitting(true);
    try {
      const batchId = await getActiveBatchId();
      if (!batchId) { addToast('No active batch is open for availability right now.', 'error'); return; }
      const records = [...picked].map((slot) => ({
        teacher_id: teacherId,
        batch_id: batchId,
        day,
        time_slot: to24h(slot),
        status: 'Tentative',
        notes: 'Self-submitted via Teacher Portal',
        created_by: teacherEmail,
        updated_by: teacherEmail,
      }));
      await insertAvailability(records);
      addToast(`${records.length} slot(s) submitted for approval`, 'success');
      setPicked(new Set());
      onAdded?.();
    } catch (e) { addToast(e.message, 'error'); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="rso-tp-panel">
      <div className="rso-tp-panel-title">Add availability</div>
      <p className="rso-tp-panel-help">
        Choose a day, tap the times you're free, then submit. Slots go to your coordinator for approval.
      </p>
      <div className="rso-tp-day-select">
        <Select value={day} onChange={(e) => { setDay(e.target.value); setPicked(new Set()); }} aria-label="Day of week">
          {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
      </div>
      <div className="rso-tp-chips rso-tp-chips-spaced">
        {SLOTS.map((slot) => {
          const already = onFileForDay.has(to24h(slot).slice(0, 5));
          const on = picked.has(slot);
          return (
            <button key={slot} type="button" className="rso-tp-chip rso-tp-chip-add"
              disabled={already} aria-pressed={on} onClick={() => togglePick(slot)}
              title={already ? 'Already on file for this day' : undefined}>{slot}</button>
          );
        })}
      </div>
      <Button onClick={handleSubmit} disabled={!picked.size || submitting}>
        {submitting ? 'Submitting…' : picked.size ? `Submit ${picked.size} slot(s) for ${day}` : 'Select times to submit'}
      </Button>
    </div>
  );
}

function ProgressTab({ teacherId }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['teacher-progress', teacherId],
    queryFn: () => fetchStudentProgress(teacherId),
    staleTime: 2 * 60_000,
  });

  const [classFilter, setClassFilter] = useState('');

  if (isLoading) return <Skeleton variant="rows" rows={5} />;
  if (isError) return <ErrorBanner message={loadFailureMessage('Student progress', error)} onRetry={() => refetch()} />;
  const { classes = [], students = [], milestones = [], attendance = [] } = data || {};
  if (!students.length) return <EmptyState icon="📊" title="No students" subtitle="No students enrolled in your classes" />;

  const filtered = classFilter ? students.filter((s) => s.class_option_id === classFilter) : students;

  const rows = filtered.map((s) => {
    const flags = getMilestoneFlags(s.student_id, s.class_option_id, milestones);
    return {
      ...s,
      done: MILESTONES.map((mk) => flags.some((f) => f.milestone_key === mk && f.completed)),
      rate: computeAttendanceRate(s.student_id, attendance),
    };
  });

  // The fill width is the only value that depends on data, so it stays inline.
  const rateBar = (rate) => rate != null ? (
    <div className="rso-tp-rate">
      <div className="rso-tp-rate-track">
        <div className={`rso-tp-rate-fill${rate >= 75 ? ' is-good' : ''}`} style={{ width: `${rate}%` }} />
      </div>
      <span className="rso-tp-rate-value">{rate}%</span>
    </div>
  ) : '—';

  return (
    <div>
      {classes.length > 1 && (
        <div className="rso-tp-filter">
          <select className="rso-select" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="">All classes</option>
            {classes.map((c) => <option key={c.class_option_id || c.id} value={c.class_option_id || c.id}>{c.class_name || c.class_option_id || c.id}</option>)}
          </select>
        </div>
      )}
      <div className="rso-table-wrap">
        <table className="rso-table">
          <thead><tr><th>Student</th><th>M1</th><th>M2</th><th>M3</th><th>M4</th><th>Attendance</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.student_id}>
                <td className="rso-tp-cell-strong">{s.full_name}</td>
                {s.done.map((d, i) => (
                  <td key={MILESTONES[i]} className="rso-tp-cell-center">{d ? '✅' : '⬜'}</td>
                ))}
                <td>{rateBar(s.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rso-table-cards">
        {rows.map((s) => (
          <div className="rso-table-card" key={s.student_id}>
            <div className="rso-tp-card-title">{s.full_name}</div>
            <div className="rso-table-card-row">
              <span className="rso-table-card-label">Milestones</span>
              <span className="rso-tp-milestones">
                {s.done.map((d, i) => (
                  <span key={MILESTONES[i]} title={MILESTONE_LABELS[i]} aria-label={`${MILESTONE_LABELS[i]}: ${d ? 'done' : 'not done'}`}>{d ? '✅' : '⬜'}</span>
                ))}
              </span>
            </div>
            <div className="rso-table-card-row">
              <span className="rso-table-card-label">Attendance</span>
              {rateBar(s.rate)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
