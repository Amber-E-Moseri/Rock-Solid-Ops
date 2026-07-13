import { supabase } from '../../../supabase.js';

export const ALL_ROLES = ['superadmin', 'admin', 'pastor', 'principal', 'subgroup_admin', 'regional_secretary', 'teacher', 'student', 'pending'];

export async function fetchRoleAuditData() {
  const [profilesRes, teachersRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, role, is_active, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(2000),
    supabase
      .from('teachers')
      .select('email, class_option_id')
      .limit(2000),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (teachersRes.error) throw teachersRes.error;

  const classCounts = {};
  const teacherEmails = new Set();
  for (const t of teachersRes.data ?? []) {
    const email = String(t.email ?? '').toLowerCase();
    if (email) {
      teacherEmails.add(email);
      if (t.class_option_id) classCounts[email] = (classCounts[email] || 0) + 1;
    }
  }

  return { profiles: profilesRes.data ?? [], teacherEmails, classCounts };
}

export async function changeRole(uid, newRole, actorEmail) {
  const now = new Date().toISOString();
  const { data: prof } = await supabase.from('profiles').select('email').eq('id', uid).maybeSingle();
  const { error } = await supabase.from('profiles').update({ role: newRole, updated_at: now }).eq('id', uid);
  if (error) throw error;
  await supabase.from('audit_logs').insert({
    action: 'ROLE_CHANGED', entity_type: 'user', entity_id: uid,
    actor_email: actorEmail, status: 'SUCCESS',
    details: { email: prof?.email, new_role: newRole }, created_at: now,
  });
}

export async function setActive(uid, active, actorEmail) {
  const now = new Date().toISOString();
  const { data: prof } = await supabase.from('profiles').select('email').eq('id', uid).maybeSingle();
  const { error } = await supabase.from('profiles').update({ is_active: active, updated_at: now }).eq('id', uid);
  if (error) throw error;
  await supabase.from('audit_logs').insert({
    action: active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
    entity_type: 'user', entity_id: uid,
    actor_email: actorEmail, status: 'SUCCESS',
    details: { email: prof?.email }, created_at: now,
  });
}

export function computeRoleKpis(profiles) {
  return {
    total: profiles.length,
    admins: profiles.filter((p) => p.role === 'admin' || p.role === 'superadmin').length,
    teachers: profiles.filter((p) => p.role === 'teacher').length,
    pastors: profiles.filter((p) => p.role === 'pastor' || p.role === 'principal').length,
    pending: profiles.filter((p) => p.role === 'pending').length,
    inactive: profiles.filter((p) => p.is_active === false).length,
  };
}

export function filterProfiles(profiles, { tab, search }) {
  let result = profiles;
  if (tab === 'admin') result = result.filter((p) => p.role === 'admin' || p.role === 'superadmin');
  else if (tab === 'teacher') result = result.filter((p) => p.role === 'teacher');
  else if (tab === 'pastor') result = result.filter((p) => p.role === 'pastor' || p.role === 'principal');
  else if (tab === 'pending') result = result.filter((p) => p.role === 'pending');
  else if (tab === 'inactive') result = result.filter((p) => p.is_active === false);
  if (search) {
    const q = search.toLowerCase();
    result = result.filter((p) =>
      `${p.full_name ?? ''} ${p.email ?? ''}`.toLowerCase().includes(q),
    );
  }
  return result;
}
