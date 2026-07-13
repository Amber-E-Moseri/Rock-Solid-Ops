import { supabase } from '../../../supabase.js';

export async function resolveTeacher(profile) {
  if (!profile?.email) return null;
  const { data } = await supabase.from('teachers')
    .select('teacher_id, full_name, email, active, status')
    .ilike('email', profile.email).is('deleted_at', null).limit(1).maybeSingle();
  return data;
}

export async function fetchTeacherClasses(teacherId) {
  const { data, error } = await supabase.functions.invoke('teacher-portal-api', {
    body: { action: 'getTeacherActiveClassOptions', teacher_id: teacherId },
  });
  if (error) throw error;
  return data?.class_options ?? data ?? [];
}

export async function fetchTeacherAvailability(teacherId) {
  const { data, error } = await supabase.from('teacher_availability')
    .select('*').eq('teacher_id', teacherId).order('day').order('time_slot');
  if (error) throw error;
  return data ?? [];
}

export async function deleteAvailability(ids) {
  if (!ids.length) return;
  const { error } = await supabase.from('teacher_availability')
    .delete().in('id', ids);
  if (error) throw error;
}

export async function insertAvailability(records) {
  if (!records.length) return;
  const { error } = await supabase.from('teacher_availability').insert(records);
  if (error) throw error;
}

export async function fetchStudentProgress(teacherId) {
  const classes = await fetchTeacherClasses(teacherId);
  const classIds = classes.map((c) => c.class_option_id || c.id).filter(Boolean);
  if (!classIds.length) return { classes, students: [], milestones: [], attendance: [] };

  const [studentsRes, msRes, attRes] = await Promise.all([
    supabase.from('students').select('student_id, full_name, email, class_option_id, batch_id').in('class_option_id', classIds).limit(500),
    supabase.from('student_milestone_status').select('*').in('class_option_id', classIds).limit(2000),
    supabase.from('attendance_log').select('student_id, status, session_date').in('class_option_id', classIds).limit(5000),
  ]);

  return {
    classes,
    students: studentsRes.data ?? [],
    milestones: msRes.data ?? [],
    attendance: attRes.data ?? [],
  };
}

export function computeAttendanceRate(studentId, attendance) {
  const records = attendance.filter((a) => a.student_id === studentId);
  if (!records.length) return null;
  const present = records.filter((a) => a.status === 'Present' || a.status === 'Late').length;
  return Math.round((present / records.length) * 100);
}

export function getMilestoneFlags(studentId, classOptionId, milestones) {
  return milestones.filter((m) => m.student_id === studentId && m.class_option_id === classOptionId);
}
