import { supabase } from '../../../supabase.js';

export async function fetchMappings() {
  const { data, error } = await supabase
    .from('rocksolid_admin_mappings')
    .select('id,admin_email,nexus_user_id,nexus_user_name,nexus_user_email,group_id,subgroup_id,active,updated_at')
    .order('group_id', { ascending: true })
    .limit(4000);
  if (error) throw error;
  return data || [];
}

export async function saveMapping(mapping, existingId) {
  const payload = {
    admin_email: mapping.adminEmail,
    nexus_user_id: mapping.nexusUserId,
    nexus_user_name: mapping.nexusUserName,
    nexus_user_email: mapping.nexusUserEmail,
    group_id: mapping.groupId,
    subgroup_id: mapping.subgroupId || null,
    active: mapping.active,
    updated_at: new Date().toISOString(),
  };

  if (existingId) {
    const { error } = await supabase.from('rocksolid_admin_mappings').update(payload).eq('id', existingId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('rocksolid_admin_mappings').insert({ ...payload, created_at: new Date().toISOString() });
    if (error) throw error;
  }
}

export async function toggleMappingActive(id, active) {
  const { error } = await supabase
    .from('rocksolid_admin_mappings')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export function filterMappings(rows, search) {
  const q = String(search || '').toLowerCase();
  if (!q) return rows;
  return rows.filter(r => JSON.stringify(r || {}).toLowerCase().includes(q));
}
