import { supabase } from '../../../supabase.js';
import { ROLE_LABELS, friendlyMessage, statusInfo } from '../../access-request/lib/accessRequest.js';

// Staff roles that may open the inbox. The server decides what each one actually sees.
// Admin and principal are not listed: they have no approval authority in this workflow.
export const INBOX_ROLES = Object.freeze(['superadmin', 'regional_secretary', 'pastor', 'subgroup_admin']);

export const QUEUE_TABS = Object.freeze([
  { key: 'pending', label: 'Pending', statuses: ['SUBMITTED'] },
  { key: 'info', label: 'Needs information', statuses: ['INFO_REQUESTED'] },
  { key: 'awaiting', label: 'Awaiting provisioning', statuses: ['APPROVAL_PENDING_PROVISIONING'] },
  { key: 'rejected', label: 'Rejected', statuses: ['REJECTED'] },
  { key: 'all', label: 'All', statuses: null },
]);

const REVIEW_GENERAL_COLUMNS = 'id, applicant_user_id, requested_role, full_name, email, phone, fellowship_code, group_id, subgroup_id, note, status, version, review_message, reviewer_note, reviewed_by, reviewed_at, submitted_at, updated_at';
const REVIEW_TEACHER_COLUMNS = 'id, applicant_user_id, full_name, email, phone, fellowship_code, group_id, subgroup_id, notes, status, version, review_message, rejection_reason, reviewed_by, reviewed_at, submitted_at, updated_at';

function normalizeGeneral(r) {
  return {
    kind: 'general',
    id: r.id,
    role: r.requested_role,
    roleLabel: ROLE_LABELS[r.requested_role] || r.requested_role,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    fellowshipCode: r.fellowship_code,
    groupId: r.group_id,
    subgroupId: r.subgroup_id,
    note: r.note,
    status: r.status,
    version: r.version,
    reviewMessage: r.review_message,
    // Reviewer-only fields. They never reach the applicant views.
    reviewerNote: r.reviewer_note,
    reviewedAt: r.reviewed_at,
    submittedAt: r.submitted_at,
  };
}

function normalizeTeacher(r) {
  return {
    kind: 'teacher',
    id: r.id,
    role: 'teacher',
    roleLabel: ROLE_LABELS.teacher,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    fellowshipCode: r.fellowship_code,
    groupId: r.group_id,
    subgroupId: r.subgroup_id,
    note: r.notes,
    status: r.status,
    version: r.version,
    reviewMessage: r.review_message,
    reviewerNote: r.rejection_reason,
    reviewedAt: r.reviewed_at,
    submittedAt: r.submitted_at,
  };
}

// Both queues come from views that return only rows the caller may decide. The UI does not filter for authority.
export async function loadReviewQueue() {
  const [general, teacher] = await Promise.all([
    supabase.from('access_requests_review').select(REVIEW_GENERAL_COLUMNS).order('submitted_at', { ascending: false }).limit(500),
    supabase.from('teacher_applications_review').select(REVIEW_TEACHER_COLUMNS).order('submitted_at', { ascending: false }).limit(500),
  ]);
  if (general.error) throw general.error;
  if (teacher.error) throw teacher.error;
  return [
    ...(general.data || []).map(normalizeGeneral),
    ...(teacher.data || []).map(normalizeTeacher),
  ].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
}

// Decision history. General requests have an event trail. Teacher applications keep only their current state.
export async function loadHistory(item) {
  if (item.kind !== 'general') return [];
  const { data, error } = await supabase
    .from('access_request_events_review')
    .select('id, action, from_status, to_status, version, note, created_at')
    .eq('request_id', item.id)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return data || [];
}

// Decisions go through the scoped RPC for each kind. Teacher decisions use Phase 2's review function.
// Its APPROVE takes no note, so a note is not sent for teacher approvals.
export async function decideItem(item, { action, message, note }) {
  if (item.kind === 'teacher') {
    const { data, error } = await supabase.rpc('review_teacher_application', {
      p_application_id: item.id,
      p_action: action,
      p_expected_version: item.version,
      p_message: message || null,
    });
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.rpc('decide_access_request', {
    p_request_id: item.id,
    p_action: action,
    p_expected_version: item.version,
    p_message: message || null,
    p_note: note || null,
  });
  if (error) throw error;
  return data;
}

// Which actions the UI offers. Only open requests can be decided; the server still enforces every rule.
export function actionsFor(item) {
  const open = item.status === 'SUBMITTED' || item.status === 'INFO_REQUESTED';
  return {
    requestInfo: open,
    reject: open,
    approve: open,
    // The teacher path stores no approval note.
    approveNote: item.kind === 'general',
  };
}

export function filterQueue(items, { tab = 'pending', search = '', role = 'all', group = 'all' } = {}) {
  const spec = QUEUE_TABS.find((t) => t.key === tab) || QUEUE_TABS[0];
  const needle = String(search || '').trim().toLowerCase();
  return items.filter((item) => {
    if (spec.statuses && !spec.statuses.includes(item.status)) return false;
    if (role !== 'all' && item.role !== role) return false;
    if (group !== 'all' && item.groupId !== group) return false;
    if (needle) {
      const haystack = [item.fullName, item.email, item.groupId, item.subgroupId, item.fellowshipCode, item.roleLabel]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function countByTab(items) {
  return Object.fromEntries(
    QUEUE_TABS.map((t) => [t.key, t.statuses ? items.filter((i) => t.statuses.includes(i.status)).length : items.length]),
  );
}

// Decision errors. FORBIDDEN is split by its message, so a person is told whether it was their own request.
export function decisionErrorMessage(error) {
  const text = String(error?.message || '');
  if (/FORBIDDEN: reviewers cannot decide their own/.test(text)) return 'You cannot decide your own request.';
  if (/FORBIDDEN/.test(text)) return 'You are not authorized to decide this request.';
  if (/VERSION_CONFLICT/.test(text)) return 'This request changed while you were reviewing it. Reload to see the latest version.';
  if (/INVALID_TRANSITION/.test(text)) return 'This request can no longer take that action.';
  if (/MESSAGE_REQUIRED/.test(text)) return 'Enter the message for the applicant before sending.';
  if (/MESSAGE_TOO_LONG|NOTE_TOO_LONG/.test(text)) return 'Keep the message and notes to 1000 characters or fewer.';
  if (/APPLICATION_NOT_FOUND/.test(text)) return 'This request no longer exists. Reload the queue.';
  if (/INVALID_ACTION/.test(text)) return 'That action is not available for this request.';
  if (/UNAUTHENTICATED/.test(text)) return 'Sign in again to continue.';
  return friendlyMessage(error, 'This request could not be updated. Reload and try again.');
}

export { statusInfo };
