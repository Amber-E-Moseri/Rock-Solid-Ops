import { supabase } from '../../../supabase.js';

export const FLAG_LABELS = {
  inactive_no_attendance: 'Inactive Student',
  repeat_absence_3_plus: '3+ Consecutive Absences',
  moodle_synced_no_login: 'No Moodle Login',
  stalled_no_milestones_4_weeks: 'Stalled Milestones',
  waitlist_over_14_days: 'Waitlisted 2+ Weeks',
  overdue_attendance_submission: 'Overdue Attendance',
  teacher_neglect: 'Teacher Neglect',
  teacher_unlinked_auth: 'Unlinked Teacher',
  stuck_moodle_sync_processing: 'Stuck Moodle Sync',
  failed_email_queue_24h: 'Failed Email Queue',
  stale_reviews_48h: 'Stale Reviews',
};

export async function fetchBatches() {
  const { data, error } = await supabase
    .from('batches')
    .select('batch_id, batch_name')
    .order('start_date', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function fetchAttentionData(batchId) {
  const [flagsRes, studentRes, teacherRes, systemRes] = await Promise.all([
    supabase
      .from('attention_flags')
      .select('flag_type, entity_type, entity_id, resolved, resolved_at, resolved_by, resolution_note, created_at')
      .order('created_at', { ascending: false })
      .limit(5000),
    supabase.rpc('get_student_attention_flags', { p_batch_id: batchId || null }),
    supabase.rpc('get_teacher_attention_flags', { p_batch_id: batchId || null }),
    supabase.rpc('get_system_attention_flags'),
  ]);

  if (flagsRes.error) throw flagsRes.error;

  const resolved = new Map();
  for (const f of flagsRes.data ?? []) {
    const key = `${f.flag_type}::${f.entity_type}::${f.entity_id}`;
    if (!resolved.has(key)) resolved.set(key, f);
  }

  return {
    studentFlags: studentRes.data ?? [],
    teacherFlags: teacherRes.data ?? [],
    systemFlags: systemRes.data ?? [],
    resolved,
  };
}

export function isResolved(resolved, flagType, entityType, entityId) {
  const key = `${flagType}::${entityType}::${entityId}`;
  const rec = resolved.get(key);
  return rec?.resolved === true;
}

export function resolvedNote(resolved, flagType, entityType, entityId) {
  const key = `${flagType}::${entityType}::${entityId}`;
  const rec = resolved.get(key);
  if (!rec?.resolved) return null;
  const date = rec.resolved_at ? new Date(rec.resolved_at).toLocaleDateString('en-CA') : '?';
  const who = rec.resolved_by || 'unknown';
  const note = rec.resolution_note ? ` (${rec.resolution_note})` : '';
  return `Resolved ${date} by ${who}${note}`;
}

export async function markResolved(flagType, entityType, entityId, actorEmail) {
  const note = window.prompt('Resolution note (optional):') ?? '';
  const now = new Date().toISOString();
  const payload = { resolved: true, resolved_at: now, resolved_by: actorEmail, resolution_note: note || null };

  const { data } = await supabase
    .from('attention_flags')
    .update(payload)
    .eq('flag_type', flagType)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('resolved', false)
    .select('id');

  if (!data || data.length === 0) {
    await supabase.from('attention_flags').insert({
      flag_type: flagType, entity_type: entityType, entity_id: entityId, ...payload,
    });
  }
}

export function filterFlags(flags, { search, severity, showResolved, resolved, entityType }) {
  return flags.filter((f) => {
    if (!showResolved && isResolved(resolved, f.flag_type, entityType, f.applicant_id || f.teacher_id || f.flag_type)) return false;
    if (severity && String(f.severity ?? '').toLowerCase() !== severity.toLowerCase()) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${f.full_name ?? ''} ${f.email ?? ''} ${f.teacher_name ?? ''} ${f.detail ?? ''} ${FLAG_LABELS[f.flag_type] ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
