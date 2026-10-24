// Release holds for staff actions whose backend contract is not yet certified.
// A held action stays disabled in the UI, and its service call fails closed
// before any request is sent. Set a value to true only after the certification
// named beside it is recorded.

// Availability approval must go through a server-side safeguard (RPC or Edge
// Function with role and audit checks). Until then, no browser write is made.
export const APPROVAL_CERTIFIED = false;

// Moodle retry needs a verified endpoint, authentication and authorization
// contract. Until then the live Moodle function must not be invoked.
export const MOODLE_RETRY_CERTIFIED = false;

export const APPROVAL_HOLD_MESSAGE =
  'Availability approval is pending backend certification. Review is read-only until approvals are certified.';

export const MOODLE_RETRY_HOLD_MESSAGE =
  'Moodle retry is on hold pending endpoint and authorization certification.';

// retry-worker's retry branch invokes live Moodle synchronization for these
// sources. The server canonicalises moodle_sync to moodle_enrollment_sync, so
// both identifiers are held.
export const MOODLE_RETRY_SOURCES = Object.freeze(['moodle_enrollment_sync', 'moodle_sync']);

// True when a retry-worker request would invoke live Moodle sync while the hold
// is in force. Resolve and every non-Moodle source are not affected.
export function isMoodleRetryHeld(action, source, certified = MOODLE_RETRY_CERTIFIED) {
  if (certified) return false;
  if (String(action || '').trim() !== 'retry') return false;
  return MOODLE_RETRY_SOURCES.includes(String(source || '').trim());
}

// Teacher attendance and outcome submission write to the live roster. Keep this
// false until the submit path is certified against the staging contract. While
// false the teacher page disables Submit and Submit Outcomes, and the save
// functions refuse before any request is sent.
export const ATTENDANCE_SUBMIT_CERTIFIED = false;

export const ATTENDANCE_SUBMIT_HOLD_MESSAGE =
  'Attendance submission is on hold pending certification. Nothing has been saved.';
