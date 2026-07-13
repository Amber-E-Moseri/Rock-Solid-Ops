import { supabase } from '../../../supabase.js';

export const GROUPS = ['CE', 'CS', 'WS'];

export async function fetchFellowships() {
  const { data, error } = await supabase.from('fellowship_map')
    .select('*').order('fellowship_code');
  if (error) throw error;
  return data ?? [];
}

export function filterFellowships(list, { search, group, subgroup, active }) {
  let out = list;
  if (search) {
    const q = search.toLowerCase();
    out = out.filter((f) => `${f.fellowship_code} ${f.campus_name}`.toLowerCase().includes(q));
  }
  if (group) out = out.filter((f) => f.group_id === group);
  if (subgroup) out = out.filter((f) => f.subgroup_id === subgroup);
  if (active === 'active') out = out.filter((f) => f.active);
  else if (active === 'inactive') out = out.filter((f) => !f.active);
  return out;
}

export async function upsertFellowship(values, actorId) {
  const now = new Date().toISOString();
  const isNew = !values._existing;
  const payload = { ...values, updated_at: now };
  delete payload._existing;
  if (isNew) payload.created_at = now;

  const { error } = await supabase.from('fellowship_map')
    .upsert(payload, { onConflict: 'fellowship_code' });
  if (error) throw error;

  await supabase.from('audit_logs').insert({
    action: isNew ? 'FELLOWSHIP_CREATED' : 'FELLOWSHIP_UPDATED',
    actor_id: actorId,
    target_id: values.fellowship_code,
    metadata: { fellowship_code: values.fellowship_code, campus_name: values.campus_name },
    created_at: now,
  });
}

export async function deactivateFellowship(code, actorId) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('fellowship_map')
    .update({ active: false, updated_at: now }).eq('fellowship_code', code);
  if (error) throw error;

  await supabase.from('audit_logs').insert({
    action: 'FELLOWSHIP_DEACTIVATED',
    actor_id: actorId,
    target_id: code,
    metadata: { fellowship_code: code },
    created_at: now,
  });
}
