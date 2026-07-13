import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  resolveTeacher, fetchTeacherClasses, fetchTeacherAvailability,
  deleteAvailability, insertAvailability, fetchStudentProgress,
  computeAttendanceRate, getMilestoneFlags,
} from './lib/teacherPortal.js';
import { PageHeader, Skeleton, EmptyState, Badge, Button } from '../../components/ui/index.js';

const ADMIN_ROLES = ['admin', 'superadmin', 'principal', 'subgroup_admin', 'pastor', 'regional_secretary'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MILESTONES = ['milestone_1', 'milestone_2', 'milestone_3', 'milestone_4'];

export default function TeacherPortalPage() {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const isAdmin = ADMIN_ROLES.includes(profile?.role);

  const params = new URLSearchParams(window.location.search);
  const sectionParam = params.get('section');
  const tabMap = { 'my-class': 0, 'availability': 1, 'progress': 2 };
  const [tab, setTab] = useState(tabMap[sectionParam] ?? 0);

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

      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '2px solid var(--border)' }}>
        {['My Classes', 'My Availability', 'Student Progress'].map((label, i) => (
          <button key={label} onClick={() => setTab(i)} style={{
            padding: '0.6rem 1.2rem', border: 'none', cursor: 'pointer',
            background: tab === i ? 'var(--primary)' : 'transparent',
            color: tab === i ? '#fff' : 'var(--text)',
            borderRadius: 'var(--r-md) var(--r-md) 0 0',
            fontWeight: tab === i ? 700 : 400, fontSize: 'var(--fs-sm)',
          }}>{label}</button>
        ))}
      </div>

      {teacher.isLoading ? <Skeleton variant="rows" rows={3} /> :
        !teacherId ? <EmptyState icon="👤" title="Teacher not found" subtitle="No teacher profile linked to your account" /> :
        tab === 0 ? <MyClassesTab teacherId={teacherId} /> :
        tab === 1 ? <AvailabilityTab teacherId={teacherId} teacherEmail={teacher.data?.email} addToast={addToast} /> :
        <ProgressTab teacherId={teacherId} />}
    </div>
  );
}

function MyClassesTab({ teacherId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['teacher-classes', teacherId],
    queryFn: () => fetchTeacherClasses(teacherId),
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton variant="rows" rows={3} />;
  const classes = data ?? [];
  if (!classes.length) return <EmptyState icon="📚" title="No classes" subtitle="You have no active class assignments" />;

  return (
    <div className="rso-table-wrap">
      <table className="rso-table">
        <thead><tr><th>Class</th><th>Day</th><th>Time</th><th>Campus</th><th>Enrolled</th><th>Status</th></tr></thead>
        <tbody>
          {classes.map((c, i) => (
            <tr key={c.class_option_id || i}>
              <td style={{ fontWeight: 600 }}>{c.class_name || c.class_option_id || `Class ${i + 1}`}</td>
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
  );
}

function AvailabilityTab({ teacherId, teacherEmail, addToast }) {
  const { data, isLoading, refetch } = useQuery({
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
  if (!slots.length) return <EmptyState icon="📅" title="No availability" subtitle="Submit your availability from the Teacher Schedule page" />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{slots.length} slot(s) on file</span>
        {selected.size > 0 && <Button variant="danger" size="sm" onClick={handleDelete} disabled={saving}>{saving ? 'Removing…' : `Remove ${selected.size} selected`}</Button>}
      </div>
      {DAYS.map((day) => {
        const daySlots = grouped[day];
        if (!daySlots?.length) return null;
        return (
          <div key={day} style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-sm)', marginBottom: '0.25rem' }}>{day}</div>
            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
              {daySlots.map((s) => (
                <button key={s.id} onClick={() => setSelected((prev) => {
                  const next = new Set(prev); next.has(s.id) ? next.delete(s.id) : next.add(s.id); return next;
                })} style={{
                  padding: '0.3rem 0.6rem', borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
                  fontSize: 'var(--fs-xs)',
                  background: selected.has(s.id) ? 'var(--color-danger, #dc3545)' : 'var(--surface)',
                  color: selected.has(s.id) ? '#fff' : 'var(--text)',
                }}>{s.time_slot} <Badge status={s.status?.toLowerCase() === 'approved' ? 'active' : 'draft'}>{s.status || 'Tentative'}</Badge></button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProgressTab({ teacherId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['teacher-progress', teacherId],
    queryFn: () => fetchStudentProgress(teacherId),
    staleTime: 2 * 60_000,
  });

  const [classFilter, setClassFilter] = useState('');

  if (isLoading) return <Skeleton variant="rows" rows={5} />;
  const { classes = [], students = [], milestones = [], attendance = [] } = data || {};
  if (!students.length) return <EmptyState icon="📊" title="No students" subtitle="No students enrolled in your classes" />;

  const filtered = classFilter ? students.filter((s) => s.class_option_id === classFilter) : students;

  return (
    <div>
      {classes.length > 1 && (
        <div style={{ marginBottom: '0.75rem' }}>
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
            {filtered.map((s) => {
              const flags = getMilestoneFlags(s.student_id, s.class_option_id, milestones);
              const rate = computeAttendanceRate(s.student_id, attendance);
              return (
                <tr key={s.student_id}>
                  <td style={{ fontWeight: 600 }}>{s.full_name}</td>
                  {MILESTONES.map((mk) => {
                    const done = flags.some((f) => f.milestone_key === mk && f.completed);
                    return <td key={mk} style={{ textAlign: 'center' }}>{done ? '✅' : '⬜'}</td>;
                  })}
                  <td>
                    {rate != null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <div style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                          <div style={{ width: `${rate}%`, height: '100%', background: rate >= 75 ? 'var(--color-success, #28a745)' : 'var(--color-danger, #dc3545)', borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 'var(--fs-xs)' }}>{rate}%</span>
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
