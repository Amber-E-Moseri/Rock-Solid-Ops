import { supabase } from '../../../supabase.js';

async function invokeTeacherApi(action, params) {
  const { data, error } = await supabase.functions.invoke('teacher-portal-api', {
    body: { action, params },
  });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.message || `${action} failed`);
  return data;
}

export async function lookupTeacher(query) {
  const result = await invokeTeacherApi('lookupTeacherForAttendance', { query });
  return result?.data ?? [];
}

export async function getClassOptions(teacherId) {
  const result = await invokeTeacherApi('getTeacherActiveClassOptions', { teacherId });
  return result?.data ?? [];
}

export async function loadRoster(teacherId, classOptionId, classSession) {
  const result = await invokeTeacherApi('loadAttendanceRoster', {
    teacherId, classOptionId, classSession: classSession.join(','),
  });
  return result ?? {};
}

export async function searchPerson(query, classOptionId, teacherId, classSession) {
  const result = await invokeTeacherApi('searchAttendancePerson', {
    query, classOptionId, teacherId, classSession: classSession.join(','),
  });
  return result?.data ?? [];
}

export async function getMilestones(classSession) {
  const result = await invokeTeacherApi('getMilestonesForSession', { classSession: classSession.join(',') });
  return result?.data ?? [];
}

export async function submitAttendance(payload) {
  return invokeTeacherApi('submitTeacherAttendance', payload);
}

export async function submitOutcomes(payload) {
  return invokeTeacherApi('submitSessionOutcomes', payload);
}

export async function fetchAttendanceHistory(classOptionId) {
  const { data, error } = await supabase.from('attendance_records')
    .select('session_date, class_session, status, applicant_id')
    .eq('class_option_id', classOptionId)
    .order('session_date', { ascending: false })
    .limit(100);
  if (error) throw error;
  return groupHistory(data ?? []);
}

function groupHistory(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.session_date}||${r.class_session}`;
    if (!map.has(key)) map.set(key, { date: r.session_date, session: r.class_session, present: 0, absent: 0 });
    const g = map.get(key);
    if (r.status === 'Present') g.present++;
    else g.absent++;
  }
  return [...map.values()].slice(0, 10);
}

export const SESSIONS = ['Class1', 'Class2', 'Class3', 'Class4A', 'Class4B', 'Class5', 'Class6', 'Class7'];

export function initials(name) {
  return (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}
