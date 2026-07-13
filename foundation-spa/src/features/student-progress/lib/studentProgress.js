import { supabase } from '../../../supabase.js';

async function invokeTeacherApi(action, params) {
  const { data, error } = await supabase.functions.invoke('teacher-portal-api', {
    body: { action, params },
  });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.message || data.error || `${action} failed`);
  return data;
}

export const CLASS_COLUMNS = ['Class1', 'Class2', 'Class3', 'Class4A', 'Class4B', 'Class5', 'Class6', 'Class7'];

export async function searchTeachers(query) {
  const result = await invokeTeacherApi('lookupTeacherForAttendance', { query });
  return result?.data ?? [];
}

export async function getTeacherClassOptions(teacherId) {
  const result = await invokeTeacherApi('getTeacherActiveClassOptions', { teacherId });
  return result?.data ?? [];
}

export async function getProgressGrid(teacherId, classOptionId) {
  const result = await invokeTeacherApi('getTeacherClassProgressGrid', { teacherId, classOptionId });
  return {
    milestones: Array.isArray(result?.data?.milestones) ? result.data.milestones : [],
    classes: Array.isArray(result?.data?.classes) && result.data.classes.length ? result.data.classes : CLASS_COLUMNS,
    students: result?.data?.students || [],
  };
}

export async function updateStudentMilestone(studentId, milestoneCode, completed) {
  return invokeTeacherApi('updateStudentMilestone', { studentId, milestoneCode, completed });
}

export function normFaith(v) {
  const t = String(v || '').trim();
  return t || "I'm not sure";
}

export function faithBadgeVariant(kind, value) {
  const v = normFaith(value);
  if (v === 'Yes') return 'success';
  if (v === 'No') return kind === 'water' ? 'danger' : 'warning';
  return 'info';
}

export function computeChecks(student, view, milestoneCols, classCols) {
  return view === 'classes'
    ? classCols.map((c) => !!(student.attendance || {})[c])
    : milestoneCols.map((m) => !!(student.milestones || {})[m.code]);
}

export function computeProgressPct(checks) {
  if (!checks.length) return 0;
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function filterStudents(students, { search, atRiskOnly, classCols }) {
  const q = String(search || '').toLowerCase();
  return students.filter((s) => {
    if (q && !(s.fullName || '').toLowerCase().includes(q) && !(s.studentId || '').toLowerCase().includes(q)) return false;
    if (atRiskOnly) {
      const attended = classCols.filter((c) => !!(s.attendance || {})[c]).length;
      const pct = classCols.length ? Math.round((attended / classCols.length) * 100) : 0;
      if (pct >= 75) return false;
    }
    return true;
  });
}

export function computeStats(rows, view, milestoneCols, classCols) {
  const activeCols = view === 'classes' ? classCols : milestoneCols.map((m) => m.code);
  const total = rows.length;
  let totalChecks = 0;
  const possibleChecks = total * activeCols.length;
  rows.forEach((s) => {
    if (view === 'classes') classCols.forEach((c) => { if ((s.attendance || {})[c]) totalChecks++; });
    else milestoneCols.forEach((m) => { if ((s.milestones || {})[m.code]) totalChecks++; });
  });
  const overallPct = possibleChecks ? Math.round((totalChecks / possibleChecks) * 100) : 0;
  const perColumn = view === 'classes'
    ? classCols.map((c) => rows.filter((s) => !!(s.attendance || {})[c]).length)
    : milestoneCols.map((m) => rows.filter((s) => !!(s.milestones || {})[m.code]).length);
  return { total, overallPct, perColumn };
}

export function buildCsv(rows, view, milestoneCols, classCols) {
  const isClasses = view === 'classes';
  const headers = ['StudentID', 'Name', ...(isClasses ? classCols : milestoneCols.map((m) => m.code)), 'Attended', 'Total', 'Pct'];
  const lines = rows.map((s) => {
    const checks = isClasses
      ? classCols.map((c) => ((s.attendance || {})[c] ? '1' : '0'))
      : milestoneCols.map((m) => ((s.milestones || {})[m.code] ? '1' : '0'));
    const attended = checks.filter((v) => v === '1').length;
    const total = (isClasses ? classCols.length : milestoneCols.length) || 0;
    return [s.studentId || '', s.fullName || '', ...checks, attended, total, `${total ? Math.round((attended / total) * 100) : 0}%`].join(',');
  });
  return [headers.join(','), ...lines].join('\n');
}
