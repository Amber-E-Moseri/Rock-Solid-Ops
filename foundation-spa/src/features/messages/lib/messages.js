import { supabase } from '../../../supabase.js';

// All messaging goes through the messaging-api edge function (server enforces scope)
export async function messagingApi(action, params = {}) {
  const { data, error } = await supabase.functions.invoke('messaging-api', { body: { action, params } });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'Messaging request failed');
  return data.data;
}

export const SCOPE_CHOICES = [
  { key: 'INDIVIDUAL', label: 'Individual person' },
  { key: 'ALL_TEACHERS', label: 'All Teachers' },
  { key: 'SUBGROUP', label: 'Subgroup' },
  { key: 'GROUP', label: 'Group' },
  { key: 'ALL_ADMINS', label: 'All Admins' },
  { key: 'REGIONAL', label: 'Regional (all Canada)' },
];

export const TEACHER_SCOPE_CHOICES = [
  { key: 'MESSAGE_ADMIN', label: 'Message Admin' },
  { key: 'INDIVIDUAL', label: 'Search other teachers' },
];

export const SUBGROUP_OPTIONS = ['CESGA', 'CESGB', 'CSGA', 'CSGB', 'WSGA', 'WSGB'];
export const GROUP_OPTIONS = ['CE', 'CS', 'WS'];

export const ADMINISH_ROLES = ['admin', 'superadmin', 'regional_secretary', 'principal', 'subgroup_admin', 'pastor'];

export function scopeLabel(c) {
  const pCount = Number(c.participant_count || 0);
  const r = Array.isArray(c.participant_roles) ? c.participant_roles : [];
  if (pCount === 2) return 'Direct';
  if (String(c.scope_level || '') === 'CANADA') {
    if (r.length === 1 && r[0] === 'teacher') return 'All Teachers';
    if (r.length && r.every((x) => ADMINISH_ROLES.includes(String(x)))) return 'All Admins';
    return 'Regional';
  }
  if (String(c.scope_level || '') === 'GROUP') return c.scope_group_id || 'Group';
  if (String(c.scope_level || '') === 'SUBGROUP') {
    if (c.scope_group_id && c.scope_subgroup_id) return `${c.scope_group_id} · ${c.scope_subgroup_id}`;
    return c.scope_subgroup_id || 'Subgroup';
  }
  return 'Direct';
}

export function filterOptionsByRole(options, scopeKey, { groupId, subgroupId } = {}) {
  if (scopeKey === 'ALL_TEACHERS') return options.filter((r) => String(r.role) === 'teacher');
  if (scopeKey === 'ALL_ADMINS') return options.filter((r) => ADMINISH_ROLES.includes(String(r.role)));
  if (scopeKey === 'GROUP') return options.filter((r) => !groupId || String(r.group_id || '') === groupId);
  if (scopeKey === 'SUBGROUP') return options.filter((r) => !subgroupId || String(r.subgroup_id || '') === subgroupId);
  return options;
}

export async function searchProfiles(q) {
  const { data } = await supabase
    .from('profiles')
    .select('user_id, email, full_name, role')
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .limit(10);
  return Array.isArray(data) ? data : [];
}

export function buildSendPayload({ scope, subject, body, recipientUserIds, groupId, subgroupId }) {
  const payload = { subject, body, recipientUserIds };
  if (scope === 'SUBGROUP') {
    payload.scopeLevel = 'SUBGROUP';
    payload.scopeSubgroupId = subgroupId || null;
  } else if (scope === 'GROUP') {
    payload.scopeLevel = 'GROUP';
    payload.scopeGroupId = groupId || null;
  } else if (['ALL_TEACHERS', 'ALL_ADMINS', 'REGIONAL'].includes(scope)) {
    payload.scopeLevel = 'CANADA';
  } else {
    payload.scopeLevel = 'SUBGROUP';
  }
  return payload;
}
