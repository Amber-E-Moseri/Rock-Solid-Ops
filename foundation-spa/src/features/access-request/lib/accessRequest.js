import { supabase } from '../../../supabase.js';

// Requested roles. There is no group admin option: it is not a role in this model.
// Teacher requests file through the teacher application (Phase 2). The others file through
// access_requests (Phase 3). Filing never grants access; approval records a pending state only.
export const REQUEST_ROLES = Object.freeze([
  { value: 'teacher', label: 'Teacher', hint: 'Teach in your subgroup. Reviewed by an organization leader.' },
  { value: 'pastor', label: 'Pastor', hint: 'Oversee your assigned subgroups. Reviewed by a regional secretary or superadmin.' },
  { value: 'subgroup_admin', label: 'Subgroup Admin', hint: 'Review teacher requests for your assigned subgroup.' },
  { value: 'other', label: 'Other', hint: 'Any other staff role. Reviewed by a regional secretary or superadmin.' },
]);

export const ROLE_LABELS = Object.freeze(
  Object.fromEntries(REQUEST_ROLES.map((r) => [r.value, r.label])),
);

export const NAME_MIN = 2;
export const NAME_MAX = 120;
export const NOTE_MAX = 1000;
export const PHONE_MAX = 32;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+()\-.\s]+$/;

// ── Organization options (authoritative, from access_request_org_options) ─────

// Input: the RPC result, [{ group_id, subgroups: [{ subgroup_id, fellowships: [{ code, campus }] }] }].
// Output: the same tree with every value coerced to a string. Codes are kept exactly as stored.
export function normalizeOrgOptions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((g) => ({
    group_id: String(g.group_id),
    subgroups: (g.subgroups || []).map((s) => ({
      subgroup_id: String(s.subgroup_id),
      fellowships: (s.fellowships || []).map((f) => ({
        code: String(f.code),
        campus: String(f.campus || f.code),
      })),
    })),
  }));
}

export function groupOptions(tree) {
  return tree.map((g) => g.group_id);
}

// Subgroups belonging to one group. A subgroup from another group is never returned.
export function subgroupOptions(tree, groupId) {
  const group = tree.find((g) => g.group_id === groupId);
  return group ? group.subgroups.map((s) => s.subgroup_id) : [];
}

// Fellowships whose authoritative pair is exactly this group and subgroup.
export function fellowshipOptions(tree, groupId, subgroupId) {
  const group = tree.find((g) => g.group_id === groupId);
  const subgroup = group?.subgroups.find((s) => s.subgroup_id === subgroupId);
  return subgroup ? subgroup.fellowships : [];
}

// ── Validation (pure; the server re-checks every rule) ───────────────────────

// Returns { field: message }. An empty object means the draft may be submitted.
export function validateRequestDraft(draft, tree) {
  const errors = {};
  const d = draft || {};

  if (!REQUEST_ROLES.some((r) => r.value === d.requestedRole)) {
    errors.requestedRole = 'Choose the role you are requesting.';
  }

  const name = String(d.fullName || '').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    errors.fullName = `Enter your full name (${NAME_MIN} to ${NAME_MAX} characters).`;
  }

  const email = String(d.email || '').trim();
  if (!EMAIL_PATTERN.test(email)) {
    errors.email = 'Enter a valid email address.';
  }

  const phone = String(d.phone || '').trim();
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    if (phone.length > PHONE_MAX || digits.length < 7 || !PHONE_PATTERN.test(phone)) {
      errors.phone = 'Enter a phone number with at least 7 digits. Use digits, spaces, + ( ) - or .';
    }
  }

  if (!groupOptions(tree).includes(d.groupId)) {
    errors.groupId = 'Choose your group.';
  }

  if (!errors.groupId) {
    if (!d.subgroupId) {
      errors.subgroupId = 'Choose your subgroup.';
    } else if (!subgroupOptions(tree, d.groupId).includes(d.subgroupId)) {
      errors.subgroupId = 'That subgroup is not in the group you chose. Choose it again.';
    }
  }

  if (!errors.groupId && !errors.subgroupId) {
    const fellowships = fellowshipOptions(tree, d.groupId, d.subgroupId);
    if (!d.fellowshipCode) {
      errors.fellowshipCode = 'Choose your fellowship or campus.';
    } else if (!fellowships.some((f) => f.code === d.fellowshipCode)) {
      errors.fellowshipCode = 'That fellowship does not belong to the group and subgroup you chose.';
    }
  }

  if (String(d.note || '').length > NOTE_MAX) {
    errors.note = `Keep the note to ${NOTE_MAX} characters or fewer.`;
  }

  return errors;
}

// The payload sent to the server. The applicant's email is never sent: the server reads it from Auth.
export function buildSubmission(draft) {
  const d = draft || {};
  return {
    requestedRole: d.requestedRole,
    fullName: String(d.fullName || '').trim(),
    phone: String(d.phone || '').trim() || null,
    fellowshipCode: d.fellowshipCode,
    groupId: d.groupId,
    subgroupId: d.subgroupId,
    note: String(d.note || '').trim() || null,
  };
}

// ── Applicant status ─────────────────────────────────────────────────────────

export const OPEN_STATUSES = Object.freeze(['SUBMITTED', 'INFO_REQUESTED', 'APPROVAL_PENDING_PROVISIONING']);

export function statusInfo(status) {
  switch (status) {
    case 'SUBMITTED':
      return { label: 'Awaiting review', variant: 'pending', detail: 'Your request is in the review queue.' };
    case 'INFO_REQUESTED':
      return { label: 'More information needed', variant: 'review', detail: 'A reviewer asked for information. Reply below.' };
    case 'APPROVAL_PENDING_PROVISIONING':
      return {
        label: 'Approved, awaiting setup',
        variant: 'warning',
        detail: 'Your request was approved. Your access is not active until setup is complete.',
      };
    case 'REJECTED':
      return { label: 'Not approved', variant: 'danger', detail: 'This request was not approved. Contact an administrator for help.' };
    case 'WITHDRAWN':
      return { label: 'Withdrawn', variant: 'neutral', detail: 'You withdrew this request.' };
    default:
      return { label: status || 'Unknown', variant: 'neutral', detail: '' };
  }
}

// ── Server error translation ────────────────────────────────────────────────

const FRIENDLY = Object.freeze({
  UNAUTHENTICATED: 'Sign in to request access.',
  EMAIL_NOT_VERIFIED: 'Confirm your email address before you request access. Use the link we sent you.',
  INVALID_ROLE: 'Choose the role you are requesting.',
  INVALID_FULL_NAME: `Enter your full name (${NAME_MIN} to ${NAME_MAX} characters).`,
  INVALID_PHONE: 'That phone number is too long.',
  INVALID_NOTE: `Keep the note to ${NOTE_MAX} characters or fewer.`,
  INVALID_SCOPE: 'That group, subgroup and fellowship do not match. Choose them again.',
  INVALID_FELLOWSHIP: 'That fellowship is not open for requests right now.',
  ALREADY_STAFF: 'This account already has a staff role, so it cannot file a request.',
  ACCOUNT_INACTIVE: 'This account is inactive. Contact an administrator.',
  OPEN_TEACHER_APPLICATION: 'A teacher application is already open for this email address.',
  EXISTING_REQUEST: 'You already have an open request for another role. Withdraw it before requesting a different role.',
  DUPLICATE_OPEN_REQUEST: 'An open request already exists for this email address.',
  APPLICATION_PENDING: 'Your request is awaiting review, so you cannot file another one now.',
  APPLICATION_NOT_ALLOWED: 'A previous request was not approved. Contact an administrator.',
  USE_TEACHER_APPLICATION: 'Teacher requests are filed as a teacher application. Choose Teacher to continue.',
  EMAIL_REQUIRED: 'This account has no email address. Contact an administrator.',
});

// Maps "CODE: text" server messages to a sentence a person can act on. Unknown codes fall back.
export function friendlyMessage(error, fallback) {
  const match = /^([A-Z_]+):/.exec(String(error?.message || ''));
  if (match && FRIENDLY[match[1]]) return FRIENDLY[match[1]];
  return fallback || 'Something went wrong. Please try again.';
}

// ── Calls ───────────────────────────────────────────────────────────────────

export async function loadAccessOptions() {
  const { data, error } = await supabase.rpc('access_request_org_options');
  if (error) throw error;
  return normalizeOrgOptions(data);
}

// Teacher requests go through the existing teacher application. Other roles go through the general intake.
export async function submitRequest(draft) {
  const s = buildSubmission(draft);
  if (s.requestedRole === 'teacher') {
    const { data, error } = await supabase.rpc('submit_teacher_application', {
      p_full_name: s.fullName,
      p_phone: s.phone,
      p_fellowship_code: s.fellowshipCode,
      p_notes: s.note,
      p_group_id: s.groupId,
      p_subgroup_id: s.subgroupId,
    });
    if (error) throw error;
    return { ...data, kind: 'teacher' };
  }
  const { data, error } = await supabase.rpc('submit_access_request', {
    p_requested_role: s.requestedRole,
    p_full_name: s.fullName,
    p_phone: s.phone,
    p_fellowship_code: s.fellowshipCode,
    p_group_id: s.groupId,
    p_subgroup_id: s.subgroupId,
    p_note: s.note,
  });
  if (error) throw error;
  return { ...data, kind: 'general' };
}

const MY_GENERAL_COLUMNS = 'id, requested_role, full_name, fellowship_code, group_id, subgroup_id, note, status, version, review_message, submitted_at, updated_at';
const MY_TEACHER_COLUMNS = 'id, status, version, full_name, phone, fellowship_code, notes, review_message, submitted_at, updated_at, group_id, subgroup_id';

// The caller's own requests, from the applicant views. Those views are filtered by auth.uid() on the server.
export async function loadMyRequests() {
  const [general, teacher] = await Promise.all([
    supabase.from('access_requests_applicant').select(MY_GENERAL_COLUMNS).order('submitted_at', { ascending: false }).limit(20),
    supabase.from('teacher_applications_applicant').select(MY_TEACHER_COLUMNS).order('submitted_at', { ascending: false }).limit(20),
  ]);
  if (general.error) throw general.error;
  if (teacher.error) throw teacher.error;

  const generalItems = (general.data || []).map((r) => ({
    kind: 'general',
    id: r.id,
    role: r.requested_role,
    fullName: r.full_name,
    fellowshipCode: r.fellowship_code,
    groupId: r.group_id,
    subgroupId: r.subgroup_id,
    note: r.note,
    status: r.status,
    version: r.version,
    reviewMessage: r.review_message,
    submittedAt: r.submitted_at,
  }));
  const teacherItems = (teacher.data || []).map((r) => ({
    kind: 'teacher',
    id: r.id,
    role: 'teacher',
    fullName: r.full_name,
    fellowshipCode: r.fellowship_code,
    groupId: r.group_id,
    subgroupId: r.subgroup_id,
    note: r.notes,
    status: r.status,
    version: r.version,
    reviewMessage: r.review_message,
    submittedAt: r.submitted_at,
  }));
  return [...generalItems, ...teacherItems].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
}

export async function withdrawMyRequest(item) {
  if (item.kind === 'teacher') {
    const { data, error } = await supabase.rpc('withdraw_teacher_application', {
      p_application_id: item.id,
      p_expected_version: item.version,
    });
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.rpc('withdraw_access_request', {
    p_request_id: item.id,
    p_expected_version: item.version,
  });
  if (error) throw error;
  return data;
}
