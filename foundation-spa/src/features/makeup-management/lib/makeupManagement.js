import { supabase } from '../../../supabase.js';

export async function fetchBatchOptions() {
  const { data } = await supabase.from('batches')
    .select('batch_id, batch_name, status, active')
    .order('created_at', { ascending: false }).limit(50);
  return data ?? [];
}

export async function fetchMakeupQueue(batchId) {
  let q = supabase.from('makeup_queue')
    .select('*, students(full_name, email, fellowship_code, subgroup_id)')
    .order('created_at', { ascending: false });
  if (batchId) q = q.eq('batch_id', batchId);
  const { data, error } = await q.limit(500);
  if (error) throw error;
  return data ?? [];
}

export function computeStats(list) {
  const now = new Date();
  let pending = 0, overdue = 0, doneThisWeek = 0, completed = 0;
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  for (const m of list) {
    if (m.makeup_completed) {
      completed++;
      if (m.completed_at && new Date(m.completed_at) >= weekAgo) doneThisWeek++;
    } else if (m.deadline && new Date(m.deadline) < now) {
      overdue++;
    } else {
      pending++;
    }
  }
  const total = list.length || 1;
  return { pending, overdue, doneThisWeek, completionRate: Math.round((completed / total) * 100) };
}

export function filterQueue(list, { search, subgroup, status }) {
  let out = list;
  if (search) {
    const q = search.toLowerCase();
    out = out.filter((m) => {
      const name = m.students?.full_name || '';
      const email = m.students?.email || '';
      return `${name} ${email}`.toLowerCase().includes(q);
    });
  }
  if (subgroup) out = out.filter((m) => (m.students?.subgroup_id || '') === subgroup);
  if (status === 'pending') out = out.filter((m) => !m.makeup_completed && !(m.deadline && new Date(m.deadline) < new Date()));
  else if (status === 'overdue') out = out.filter((m) => !m.makeup_completed && m.deadline && new Date(m.deadline) < new Date());
  else if (status === 'complete') out = out.filter((m) => m.makeup_completed);
  return out;
}

export async function markComplete(item, actorId) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('makeup_queue')
    .update({ makeup_completed: true, completed_at: now, completed_by: actorId, updated_at: now })
    .eq('id', item.id);
  if (error) throw error;

  if (item.attendance_log_id) {
    await supabase.from('attendance_log')
      .update({ made_up: true, updated_at: now })
      .eq('id', item.attendance_log_id);
  }

  await supabase.rpc('evaluate_graduation_eligibility', { p_student_id: item.student_id }).catch(() => {});

  await supabase.from('audit_logs').insert({
    action: 'MAKEUP_COMPLETED', actor_id: actorId,
    target_id: item.student_id,
    metadata: { makeup_id: item.id, class_missed: item.class_missed },
    created_at: now,
  });
}

export async function extendDeadline(item, newDeadline, reason, actorId) {
  const now = new Date().toISOString();
  const notes = [item.notes, `Extended to ${newDeadline}: ${reason}`].filter(Boolean).join('\n');
  const { error } = await supabase.from('makeup_queue')
    .update({ deadline: newDeadline, notes, updated_at: now })
    .eq('id', item.id);
  if (error) throw error;

  await supabase.from('audit_logs').insert({
    action: 'MAKEUP_DEADLINE_EXTENDED', actor_id: actorId,
    target_id: item.student_id,
    metadata: { makeup_id: item.id, new_deadline: newDeadline, reason },
    created_at: now,
  });
}
