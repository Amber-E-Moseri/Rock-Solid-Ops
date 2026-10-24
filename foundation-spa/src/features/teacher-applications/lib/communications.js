// Email contract for the teacher application workflow. Template keys are database identifiers: email_queue
// references email_templates, and email-sender renders from notification_templates. Only "exists" keys are
// present in the database today (PR #22). "proposed" keys belong to P1's approval and activation transactions
// and must not be sent until those transactions are certified. Bodies never contain reviewer text, and no
// message says an account is active unless the backend has activated it.
export const TEACHER_APPLICATION_EMAIL_CONTRACT = Object.freeze([
  {
    event: 'application_received',
    label: 'Application received',
    templateKey: 'teacher_application_received',
    source: 'submit_teacher_application (first submission)',
    state: 'exists',
  },
  {
    event: 'verification_required',
    label: 'Email verification required',
    templateKey: null,
    source: 'Supabase Auth confirmation email',
    state: 'auth',
  },
  {
    event: 'info_requested',
    label: 'Additional information requested',
    templateKey: 'teacher_application_info_requested',
    source: 'review_teacher_application (REQUEST_INFO)',
    state: 'exists',
  },
  {
    event: 'application_updated',
    label: 'Application updated',
    templateKey: null,
    source: 'submit_teacher_application (UPDATED). No email by design.',
    state: 'no_email',
  },
  {
    event: 'approved_activation_pending',
    label: 'Approved, activation pending',
    templateKey: 'teacher_application_approved_pending',
    source: 'P1 approval transaction (not yet certified)',
    state: 'proposed',
  },
  {
    event: 'account_activated',
    label: 'Teacher account activated',
    templateKey: 'teacher_account_activated',
    source: 'P1 activation transaction (not yet certified)',
    state: 'proposed',
  },
  {
    event: 'rejected',
    label: 'Application not approved',
    templateKey: 'teacher_application_rejected',
    source: 'review_teacher_application (REJECT)',
    state: 'exists',
  },
  {
    event: 'confirmation_resend',
    label: 'Confirmation link resent',
    templateKey: null,
    source: 'Supabase Auth resend (signup). Rate-limited by Auth and Turnstile.',
    state: 'auth',
  },
  {
    event: 'delivery_failure',
    label: 'Delivery failed, retry',
    templateKey: null,
    source: 'email_queue status Failed. retry-worker runs hourly; operators retry from the Retry Center.',
    state: 'operator',
  },
]);

export const TEMPLATE_LABELS = Object.freeze(
  Object.fromEntries(
    TEACHER_APPLICATION_EMAIL_CONTRACT.filter((entry) => entry.templateKey).map((entry) => [entry.templateKey, entry.label]),
  ),
);

export const NOTIFICATION_STATUS_LABELS = Object.freeze({
  Pending: 'Queued',
  Processing: 'Sending',
  Sent: 'Sent',
  Failed: 'Failed',
  Retried: 'Retried',
});

export const AUDIT_EVENT_LABELS = Object.freeze({
  TEACHER_APPLICATION_SUBMITTED: 'Submitted',
  TEACHER_APPLICATION_UPDATED: 'Updated by applicant',
  TEACHER_APPLICATION_RESUBMITTED: 'Resubmitted after information request',
  TEACHER_APPLICATION_INFO_REQUESTED: 'Information requested',
  TEACHER_APPLICATION_REJECTED: 'Rejected',
  TEACHER_APPLICATION_WITHDRAWN: 'Withdrawn by applicant',
  TEACHER_APPLICATION_APPROVED: 'Approved',
});

export function auditEventLabel(action) {
  return AUDIT_EVENT_LABELS[action] || 'Recorded event';
}
