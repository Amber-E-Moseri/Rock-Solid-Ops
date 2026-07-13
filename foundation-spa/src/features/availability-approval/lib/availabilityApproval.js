import { supabase } from '../../../supabase.js';

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const TIMES = ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00'];

export async function fetchSubmissions() {
  const { data, error } = await supabase
    .from('teacher_availability')
    .select('id, teacher_name, teacher_email, month, campuses, slots, notes, status, review_note, reviewed_at, reviewed_by, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return data || [];
}

export function computeKpis(submissions) {
  return {
    total: submissions.length,
    pending: submissions.filter(s => s.status === 'pending').length,
    approved: submissions.filter(s => s.status === 'approved').length,
    rejected: submissions.filter(s => s.status === 'rejected').length,
  };
}

export function filterSubmissions(submissions, { search, status, month, campus }) {
  const q = String(search || '').toLowerCase();
  return submissions.filter(s => {
    if (q && !(s.teacher_name || '').toLowerCase().includes(q) && !(s.teacher_email || '').toLowerCase().includes(q)) return false;
    if (status && s.status !== status) return false;
    if (month && s.month !== month) return false;
    if (campus && !(s.campuses || []).includes(campus)) return false;
    return true;
  });
}

export function getFilterOptions(submissions) {
  const months = [...new Set(submissions.map(s => s.month).filter(Boolean))].sort();
  const campuses = [...new Set(submissions.flatMap(s => s.campuses || []).filter(Boolean))].sort();
  return { months, campuses };
}

export async function setSubmissionStatus(ids, status, reviewNote, reviewerEmail) {
  const { error } = await supabase
    .from('teacher_availability')
    .update({
      status,
      review_note: reviewNote || '',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerEmail,
    })
    .in('id', ids);
  if (error) throw error;
}

export function fmtDate(v) {
  return v ? new Date(v).toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

export function fmtMonth(v) {
  return v ? new Date(v + '-01').toLocaleString('en-CA', { month: 'long', year: 'numeric' }) : '—';
}

export function statusVariant(status) {
  switch (status) {
    case 'approved': return 'success';
    case 'rejected': return 'danger';
    case 'pending': return 'warning';
    default: return 'info';
  }
}

export function buildSlotSet(slots) {
  return new Set((slots || []).map(s => `${s.day}:${s.time}`));
}
