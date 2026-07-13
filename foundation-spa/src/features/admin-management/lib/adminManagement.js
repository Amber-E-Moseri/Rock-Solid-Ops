import { supabase } from '../../../supabase.js';

const STAFF_PROJECTIONS = [
  'id, user_id, full_name, email, role, is_active, active, created_at, updated_at',
  'id, full_name, email, role, is_active, active, created_at, updated_at',
  'id, full_name, email, role, active, created_at, updated_at',
  'id, email, role, active',
  'id, email, role',
];

const TEACHER_PROJECTIONS = [
  'teacher_id, full_name, email, phone, group_id, subgroup_id, status, active, deleted_at, teacher_user_id, updated_at',
  'teacher_id, teacher_name, email, phone, group_id, subgroup_id, status, active, deleted_at, teacher_user_id, updated_at',
  'id, full_name, email, phone, group_id, subgroup_id, status, active, deleted_at, teacher_user_id, updated_at',
  'teacher_id, full_name, email, group_id, subgroup_id, active, teacher_user_id',
];

async function trySelect(table, projections) {
  for (const proj of projections) {
    const { data, error } = await supabase.from(table).select(proj).limit(4000);
    if (!error && data) {
      const cols = proj.split(',').map((c) => c.trim());
      return { data, cols };
    }
    if (error?.code === '42P01') throw new Error(`Table "${table}" does not exist`);
  }
  throw new Error(`All projections failed for "${table}"`);
}

export async function fetchStaff() {
  const { data, cols } = await trySelect('profiles', STAFF_PROJECTIONS);
  const idKey = cols.includes('user_id') ? 'user_id' : 'id';
  data.sort((a, b) => String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || '')));
  return { rows: data, idKey, cols };
}

export async function fetchTeachers() {
  const { data, cols } = await trySelect('teachers', TEACHER_PROJECTIONS);
  const idKey = cols.includes('teacher_id') ? 'teacher_id' : 'id';
  const nameKey = cols.includes('teacher_name') ? 'teacher_name' : 'full_name';
  data.sort((a, b) => String(a[nameKey] || a.email || '').localeCompare(String(b[nameKey] || b.email || '')));
  return { rows: data, idKey, nameKey, cols, supportsStatus: cols.includes('status'), supportsDeletedAt: cols.includes('deleted_at') };
}

export function isStaffActive(row) {
  if (row.is_active === false || row.active === false) return false;
  return true;
}

export function isTeacherActive(row) {
  return row.active !== false && !row.deleted_at;
}

export function isTeacherLinked(row) {
  return !!row.teacher_user_id;
}

export async function toggleStaffActive(row, idKey, next) {
  const now = new Date().toISOString();
  const payload = { active: next, updated_at: now };
  if ('is_active' in row) payload.is_active = next;
  const { error } = await supabase.from('profiles').update(payload).eq(idKey, row[idKey]);
  if (error) throw error;
}

export async function saveStaff(row, idKey, values) {
  const now = new Date().toISOString();
  const active = values.active === 'true' || values.active === true;
  const patch = { full_name: values.full_name, role: values.role, is_active: active, active, updated_at: now };

  if (row) {
    const { error } = await supabase.from('profiles').update(patch).eq(idKey, row[idKey]);
    if (error) throw error;
  } else {
    const { data: existing, error: lookupErr } = await supabase
      .from('profiles').select('user_id,email').ilike('email', values.email).limit(1).maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!existing) throw new Error('No profile found for this email. Invite/create the auth user first.');
    const { error } = await supabase.from('profiles').update(patch).eq('user_id', existing.user_id);
    if (error) throw error;
  }
}

export async function toggleTeacherActive(row, meta, next) {
  const now = new Date().toISOString();
  const patch = { active: next, updated_at: now };
  if (meta.supportsDeletedAt) patch.deleted_at = next ? null : now;
  if (meta.supportsStatus) patch.status = next ? 'ACTIVE' : 'INACTIVE';
  const { error } = await supabase.from('teachers').update(patch).eq(meta.idKey, row[meta.idKey]);
  if (error) throw error;
}

export async function saveTeacher(row, meta, values) {
  const now = new Date().toISOString();
  const active = values.active === 'true' || values.active === true;
  const patch = {
    [meta.nameKey || 'full_name']: values.full_name,
    email: values.email,
    phone: values.phone || null,
    group_id: values.group_id,
    subgroup_id: values.subgroup_id || null,
    active,
    updated_at: now,
  };
  if (meta.supportsDeletedAt) patch.deleted_at = active ? null : now;
  if (meta.supportsStatus) patch.status = active ? 'ACTIVE' : 'PENDING';

  if (row) {
    const { error } = await supabase.from('teachers').update(patch).eq(meta.idKey, row[meta.idKey]);
    if (error) throw error;
  } else {
    patch[meta.idKey || 'teacher_id'] = `T-${Date.now()}`;
    patch.created_at = now;
    if (meta.supportsStatus) patch.status = 'ACTIVE';
    const { error } = await supabase.from('teachers').insert(patch);
    if (error) throw error;
  }
}

// Create a staff/admin user end-to-end via the admin-api edge function.
// The server enforces the permission boundary (superadmin -> any role; admin -> teacher
// only). admin-api reads action + fields from the top level of the request body.
export async function createStaffDirect({ full_name, email, temp_password, role, notes }) {
  const { data, error } = await supabase.functions.invoke('admin-api', {
    body: { action: 'create-staff-direct', full_name, email, temp_password, role, notes: notes || null },
  });
  if (error) {
    // Edge non-2xx responses surface as a FunctionsHttpError; try to read the JSON body.
    let msg = error.message || 'Failed to create staff user';
    try { const body = await error.context?.json?.(); if (body?.error) msg = body.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (data?.ok === false) throw new Error(data.error || data.message || 'Failed to create staff user');
  return data;
}

export async function linkTeacher(teacherId, authUserId, actorEmail, allowRelink) {
  const { data, error } = await supabase.rpc('link_teacher_to_auth_user', {
    p_teacher_id: teacherId,
    p_auth_user_id: authUserId,
    p_actor_email: actorEmail,
    p_allow_relink: allowRelink,
  });
  if (error) throw error;
  if (data && data.ok === false) throw new Error(data.message || 'Link failed');
}

export async function unlinkTeacher(teacherId, actorEmail) {
  const { data, error } = await supabase.rpc('unlink_teacher_from_auth_user', {
    p_teacher_id: teacherId,
    p_actor_email: actorEmail,
    p_reason: 'admin-management unlink',
  });
  if (error) throw error;
  if (data && data.ok === false) throw new Error(data.message || 'Unlink failed');
}
