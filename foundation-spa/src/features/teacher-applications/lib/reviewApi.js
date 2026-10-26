// Administrator review calls against the PR #22 contract. Reads go only through the reviewer view
// (teacher_applications_review), which the database restricts to active admin and superadmin accounts.
// Decisions go only through review_teacher_application. This module never writes teachers, profiles or
// audit_logs, and it has no approve call: approval is served by the teacher-link contract (P1).

export const REVIEW_VIEW = 'teacher_applications_review';
export const REVIEW_COLUMNS = [
  'id', 'applicant_user_id', 'email', 'full_name', 'phone', 'fellowship_code', 'notes',
  'status', 'version', 'review_message', 'rejection_reason', 'email_verified_at',
  'submitted_at', 'reviewed_at', 'reviewed_by', 'approved_teacher_id', 'updated_at',
].join(',');

export const REVIEWER_ROLES = Object.freeze(['admin', 'superadmin']);

// Approve stays disabled until the teacher-link contract is certified (see docs/TEACHER_APPLICATION_REVIEW_UI.md).
// This is local to the review feature on purpose: src/releaseHolds.js is shared and not changed here.
export const APPROVAL_CONTRACT_AVAILABLE = false;
export const APPROVAL_HELD_MESSAGE =
  'Approval is held until the teacher account link is certified. No approval can be recorded from this screen.';

export const REVIEW_ACTIONS = Object.freeze({ REQUEST_INFO: 'REQUEST_INFO', REJECT: 'REJECT' });
export const MESSAGE_MAX = 1000;

export const STATUS_LABELS = Object.freeze({
  SUBMITTED: 'Pending review',
  INFO_REQUESTED: 'Information requested',
  APPROVED: 'Approved, activation pending',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
});

export const STATUS_TONES = Object.freeze({
  SUBMITTED: 'info',
  INFO_REQUESTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
});

export const STATUS_FILTERS = Object.freeze(['ALL', 'SUBMITTED', 'INFO_REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN']);

const DECIDABLE = new Set(['SUBMITTED', 'INFO_REQUESTED']);
export function isDecidable(application) {
  return DECIDABLE.has(application?.status);
}

export async function fetchReviewQueue(client) {
  const { data, error } = await client
    .from(REVIEW_VIEW)
    .select(REVIEW_COLUMNS)
    .order('submitted_at', { ascending: true })
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

export async function reviewApplication(client, { applicationId, action, expectedVersion, message }) {
  if (action !== REVIEW_ACTIONS.REQUEST_INFO && action !== REVIEW_ACTIONS.REJECT) {
    throw new Error('INVALID_ACTION');
  }
  const { data, error } = await client.rpc('review_teacher_application', {
    p_application_id: applicationId,
    p_action: action,
    p_expected_version: expectedVersion,
    p_message: message,
  });
  if (error) throw error;
  return data;
}

export function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (match) => `\\${match}`);
}

export async function fetchRosterMatches(client, email) {
  const { data, error } = await client
    .from('teachers')
    .select('teacher_id,full_name,email,status,teacher_user_id,deleted_at')
    .ilike('email', escapeLike(email))
    .limit(10);
  if (error) throw error;
  return data ?? [];
}

// Advisory only. teachers.email has no unique constraint, so the roster can hold more than one record.
export function summarizeRoster(matches) {
  const live = (matches ?? []).filter((row) => !row.deleted_at);
  if (live.length === 0) return { kind: 'none', matches: [] };
  if (live.length === 1) return { kind: 'match', matches: live };
  return { kind: 'ambiguous', matches: live };
}

export async function fetchNotificationStatus(client, applicationId) {
  const { data, error } = await client
    .from('email_queue')
    .select('id,template_key,status,sent_at,created_at')
    .contains('metadata', { application_id: applicationId })
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data ?? [];
}

export async function fetchReviewHistory(client, applicationId) {
  const { data, error } = await client
    .from('audit_logs')
    .select('logged_at,action,status')
    .eq('entity_type', 'teacher_application')
    .eq('entity_id', applicationId)
    .order('logged_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export function filterApplications(rows, { status = 'ALL', fellowship = '', search = '' } = {}) {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (status !== 'ALL' && row.status !== status) return false;
    if (fellowship && row.fellowship_code !== fellowship) return false;
    if (needle) {
      const haystack = [row.full_name, row.email, row.phone, row.fellowship_code]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function fellowshipOptions(rows) {
  return [...new Set(rows.map((row) => row.fellowship_code).filter(Boolean))].sort();
}

const REVIEW_ERRORS = {
  UNAUTHENTICATED: 'Sign in again to continue.',
  FORBIDDEN: 'You do not have permission to review applications.',
  APPLICATION_NOT_FOUND: 'This application no longer exists. The queue has been refreshed.',
  VERSION_CONFLICT: 'Someone else changed this application. The latest version is loaded. Check it, then decide again.',
  INVALID_TRANSITION: 'This application can no longer take that decision. The queue has been refreshed.',
  MESSAGE_REQUIRED: 'Enter a message before you continue.',
  MESSAGE_TOO_LONG: 'The message must be 1000 characters or fewer.',
  APPROVAL_NOT_AVAILABLE: APPROVAL_HELD_MESSAGE,
  INVALID_ACTION: 'That action is not available.',
};

export function reviewErrorMessage(error) {
  const raw = String(error?.message || '');
  if (raw.includes('reviewers cannot decide their own application')) {
    return 'You cannot decide an application you submitted yourself.';
  }
  const code = raw.split(':')[0].trim();
  return REVIEW_ERRORS[code] || 'The decision could not be recorded. Try again in a moment.';
}

// Errors after which the open record is stale and must be reloaded before another decision.
export function needsReload(error) {
  const code = String(error?.message || '').split(':')[0].trim();
  return ['VERSION_CONFLICT', 'APPLICATION_NOT_FOUND', 'INVALID_TRANSITION'].includes(code);
}
