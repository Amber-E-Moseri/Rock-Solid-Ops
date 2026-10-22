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
