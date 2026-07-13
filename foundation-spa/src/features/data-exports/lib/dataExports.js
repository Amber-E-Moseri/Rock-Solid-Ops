import { supabase } from '../../../supabase.js';

export async function fetchExportData() {
  const [slotsRes, fellowshipRes, batchesRes, applicantsRes, studentsRes, milestonesRes, attendanceRes] =
    await Promise.all([
      supabase.from('class_slots').select('batch_id, class_option_id, class_options(class_option_id, fellowship_codes, group_id)'),
      supabase.from('fellowship_map').select('fellowship_code, campus_name, group_id'),
      supabase.from('batches').select('batch_id, batch_name, status').order('batch_name'),
      supabase.from('applicants').select('id, full_name, email, fellowship_code, class_option_id, registration_status, born_again, speaks_in_tongues, water_baptized').in('registration_status', ['ASSIGNED', 'WAITLISTED', 'ENROLLED']),
      supabase.from('students').select('student_id, applicant_id, full_name, fellowship_code, class_option_id'),
      supabase.from('student_milestone_status').select('student_id, milestone_code, completed'),
      supabase.from('attendance_log').select('student_id, present, class_option_id'),
    ]);

  for (const r of [slotsRes, fellowshipRes, batchesRes, applicantsRes, studentsRes, milestonesRes, attendanceRes]) {
    if (r.error) throw r.error;
  }

  return buildMaps({
    slots: slotsRes.data ?? [],
    fellowships: fellowshipRes.data ?? [],
    batches: batchesRes.data ?? [],
    applicants: applicantsRes.data ?? [],
    students: studentsRes.data ?? [],
    milestones: milestonesRes.data ?? [],
    attendance: attendanceRes.data ?? [],
  });
}

function buildMaps(raw) {
  const classToBatch = new Map();
  const classToFellowship = new Map();
  for (const s of raw.slots) {
    classToBatch.set(s.class_option_id, s.batch_id);
    const codes = s.class_options?.fellowship_codes;
    if (Array.isArray(codes) && codes.length > 0) {
      classToFellowship.set(s.class_option_id, codes[0]);
    }
  }

  const studentByApplicant = new Map();
  for (const s of raw.students) {
    if (s.applicant_id) studentByApplicant.set(String(s.applicant_id), s);
  }

  const milestoneByStudent = new Map();
  for (const m of raw.milestones) {
    if (!milestoneByStudent.has(m.student_id)) {
      milestoneByStudent.set(m.student_id, { BORN_AGAIN: false, WATER_BAPTIZED: false, HOLY_SPIRIT: false });
    }
    const entry = milestoneByStudent.get(m.student_id);
    const code = String(m.milestone_code ?? '').toUpperCase();
    if (code in entry) entry[code] = m.completed === true;
  }

  const attendanceByStudent = new Map();
  for (const a of raw.attendance) {
    if (!attendanceByStudent.has(a.student_id)) {
      attendanceByStudent.set(a.student_id, { total: 0, attended: 0 });
    }
    const entry = attendanceByStudent.get(a.student_id);
    entry.total++;
    if (a.present === true) entry.attended++;
  }

  return { ...raw, classToBatch, classToFellowship, studentByApplicant, milestoneByStudent, attendanceByStudent };
}

export function filterApplicants(applicants, filters, classToBatch) {
  const { classId, fellowshipCode, batchId, status } = filters;
  return applicants.filter((a) => {
    if (classId && a.class_option_id !== classId) return false;
    if (fellowshipCode && a.fellowship_code !== fellowshipCode) return false;
    if (status && a.registration_status !== status) return false;
    if (batchId && classToBatch.get(a.class_option_id) !== batchId) return false;
    return true;
  });
}

function escCsv(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }

export function exportFaithMilestones(students, milestoneByStudent, classId) {
  const headers = ['student_id', 'full_name', 'fellowship_code', 'class_option_id', 'BORN_AGAIN', 'WATER_BAPTIZED', 'HOLY_SPIRIT'];
  const rows = students
    .filter((s) => s.class_option_id === classId)
    .map((s) => {
      const m = milestoneByStudent.get(s.student_id) || { BORN_AGAIN: false, WATER_BAPTIZED: false, HOLY_SPIRIT: false };
      return [s.student_id, s.full_name, s.fellowship_code, s.class_option_id, m.BORN_AGAIN, m.WATER_BAPTIZED, m.HOLY_SPIRIT].map(escCsv);
    });
  downloadCsv(`faith-milestones-${classId}-${isoDate()}.csv`, headers, rows);
}

export function exportFullBatch(filtered, maps, batchId) {
  const { studentByApplicant, milestoneByStudent, attendanceByStudent, classToBatch } = maps;
  const headers = ['student_id', 'applicant_id', 'full_name', 'email', 'fellowship_code', 'class_option_id', 'batch_id', 'registration_status', 'born_again', 'speaks_in_tongues', 'water_baptized', 'attendance_count', 'attendance_pct', 'BORN_AGAIN', 'WATER_BAPTIZED', 'HOLY_SPIRIT'];
  const rows = filtered.map((a) => {
    const stu = studentByApplicant.get(String(a.id));
    const sid = stu?.student_id ?? '';
    const m = milestoneByStudent.get(sid) || { BORN_AGAIN: false, WATER_BAPTIZED: false, HOLY_SPIRIT: false };
    const att = attendanceByStudent.get(sid) || { total: 0, attended: 0 };
    const pct = att.total > 0 ? Math.round((att.attended / att.total) * 100) : 0;
    return [sid, a.id, a.full_name, a.email, a.fellowship_code, a.class_option_id, classToBatch.get(a.class_option_id) ?? '', a.registration_status, a.born_again, a.speaks_in_tongues, a.water_baptized, att.attended, pct, m.BORN_AGAIN, m.WATER_BAPTIZED, m.HOLY_SPIRIT].map(escCsv);
  });
  downloadCsv(`full-batch-export-${batchId}-${isoDate()}.csv`, headers, rows);
}

function isoDate() { return new Date().toISOString().slice(0, 10); }

function downloadCsv(filename, headers, rows) {
  const lines = [headers.join(','), ...rows.map((r) => r.join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
