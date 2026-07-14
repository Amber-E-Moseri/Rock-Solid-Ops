import { supabase } from '../../../supabase.js';

export const STATUS_TABS = ['PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'ALL'];

export async function fetchTeachers() {
  const { data, error } = await supabase.from('teachers')
    .select('teacher_id, full_name, email, fellowship_code, group_id, subgroup_id, status, active, teacher_user_id, created_at, deleted_at')
    .limit(4000);
  if (error) throw error;
  const teachers = data ?? [];

  const ids = teachers.map((t) => t.teacher_id).filter(Boolean);
  let classMap = new Map();
  if (ids.length > 0) {
    const { data: avail } = await supabase.from('teacher_availability')
      .select('teacher_id, class_option_id')
      .in('teacher_id', ids)
      .eq('status', 'Confirmed')
      .limit(500);
    for (const a of avail ?? []) {
      classMap.set(a.teacher_id, a.class_option_id);
    }
  }

  teachers.sort((a, b) => String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || '')));
  return { teachers, classMap };
}

export function filterTeachers(teachers, { tab, search, group, subgroup }) {
  return teachers.filter((t) => {
    if (tab !== 'ALL' && t.status !== tab) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${t.full_name} ${t.email} ${t.fellowship_code} ${t.group_id} ${t.subgroup_id} ${t.status}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (group && t.group_id !== group) return false;
    if (subgroup && t.subgroup_id !== subgroup) return false;
    return true;
  });
}

export async function performAction(teacherId, action, reason, actorEmail, teacherUserId) {
  const now = new Date().toISOString();
  const patches = {
    activate:   { status: 'ACTIVE', active: true, activated_at: now, activated_by: actorEmail, rejected_at: null, suspended_at: null, suspended_reason: null, updated_at: now },
    reject:     { status: 'INACTIVE', active: false, rejected_at: now, rejected_by: actorEmail, rejected_reason: reason, updated_at: now },
    suspend:    { status: 'SUSPENDED', active: false, suspended_at: now, suspended_by: actorEmail, suspended_reason: reason, updated_at: now },
    unsuspend:  { status: 'ACTIVE', active: true, activated_at: now, activated_by: actorEmail, suspended_reason: null, updated_at: now },
    inactivate: { status: 'INACTIVE', active: false, deactivated_at: now, deactivated_by: actorEmail, deactivated_reason: reason, updated_at: now },
    deactivate: { status: 'INACTIVE', active: false, deactivated_at: now, deactivated_by: actorEmail, deactivated_reason: reason, updated_at: now },
  };
  const patch = patches[action];
  if (!patch) throw new Error(`Unknown action: ${action}`);

  const { error } = await supabase.from('teachers').update(patch).eq('teacher_id', teacherId);
  if (error) throw error;

  if (action === 'suspend') {
    await supabase.from('teacher_availability').update({ status: 'Suspended' }).eq('teacher_id', teacherId).eq('status', 'Tentative');
  }

  if (teacherUserId) {
    const profileActive = action === 'activate' || action === 'unsuspend';
    const profilePatch = action === 'deactivate'
      ? { role: 'pending', is_active: false }
      : { is_active: profileActive };
    await supabase.from('profiles').update(profilePatch).eq('user_id', teacherUserId);
  }

  const eventTypes = {
    activate: 'TEACHER_APPROVED', reject: 'TEACHER_REJECTED', suspend: 'TEACHER_SUSPENDED',
    unsuspend: 'TEACHER_REACTIVATED', inactivate: 'TEACHER_INACTIVATED', deactivate: 'TEACHER_DEACTIVATED',
  };
  await supabase.from('audit_logs').insert({
    action: eventTypes[action], entity_type: 'teacher', entity_id: teacherId,
    actor_email: actorEmail, details: { reason }, created_at: now,
  });

  const statusEmailMap = {
    activate:   { template_key: 'teacher_status_positive', scenario_label: 'approved' },
    unsuspend:  { template_key: 'teacher_status_positive', scenario_label: 'reactivated' },
    reject:     { template_key: 'teacher_status_negative', scenario_label: 'rejected' },
    suspend:    { template_key: 'teacher_status_negative', scenario_label: 'suspended' },
  };
  const statusEmail = statusEmailMap[action];
  if (statusEmail) {
    const { data: teacherRow } = await supabase.from('teachers')
      .select('full_name, email').eq('teacher_id', teacherId).maybeSingle();
    if (teacherRow?.email) {
      const isPositive = statusEmail.template_key === 'teacher_status_positive';
      await supabase.from('email_queue').insert({
        recipient_email: teacherRow.email,
        recipient_name: teacherRow.full_name || '',
        template_key: statusEmail.template_key,
        subject: 'An update on your Foundation School teacher account',
        status: 'Pending',
        payload: {
          first_name: String(teacherRow.full_name || 'Teacher').split(/\s+/)[0],
          scenario_label: statusEmail.scenario_label,
          ...(isPositive
            ? { cta_label: 'Log In to Teacher Portal', cta_url: 'https://rocksolidsuite.netlify.app/foundation/auth/login.html' }
            : { reason: reason || 'No additional reason was provided.' }),
        },
      });
    }
  }
}

export async function createTeacherDirect(params) {
  const { data, error } = await supabase.functions.invoke('teacher-portal-api', {
    body: { action: 'createTeacherDirect', params },
  });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.message || 'Failed to create teacher');
  return data;
}

export async function linkTeacherAuth(teacherId, authUserId, actorEmail, allowRelink) {
  const { data, error } = await supabase.rpc('link_teacher_to_auth_user', {
    p_teacher_id: teacherId, p_auth_user_id: authUserId, p_actor_email: actorEmail, p_allow_relink: allowRelink,
  });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.message || 'Link failed');
}

export async function unlinkTeacherAuth(teacherId, actorEmail, reason) {
  const { data, error } = await supabase.rpc('unlink_teacher_from_auth_user', {
    p_teacher_id: teacherId, p_actor_email: actorEmail, p_reason: reason || 'admin unlink',
  });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.message || 'Unlink failed');
}

export function fmtDate(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return String(ts); }
}
