// User-facing copy. Account-existence is never implied: recovery, resend and signup responses are the
// same whether or not an account exists. Internal reviewer notes and rejection reasons never appear.

export const GENERIC_ERROR = 'Something went wrong. Try again in a moment.';
export const RATE_LIMIT = 'Too many attempts. Wait a few minutes, then try again.';

export const RECOVERY_SENT =
  'If an account exists for that email address, a reset link is on its way. Check your inbox and spam folder.';

export const RESEND_SENT =
  'If that address is waiting for confirmation, a new link is on its way. Check your inbox and spam folder.';

export const SIGNUP_SENT =
  'Check your email for a confirmation link. Open it on this device to continue your application.';

export const VERIFICATION_REQUIRED = 'Complete the verification check, then try again.';

export const VERIFICATION_FAILED = 'The verification check did not complete. Complete it again and retry.';

export const VERIFICATION_UNAVAILABLE =
  'Sign-up and email requests are unavailable until human verification is configured. Contact an administrator.';

export const LINK_INVALID =
  'This link is not valid. Request a new one and use the newest email.';

export const LINK_EXPIRED =
  'This link has expired or has already been used. Request a new one and use the newest email.';

// Maps an RPC or PostgREST error to safe copy. Only known codes are shown; raw server text is not.
const APPLICATION_ERRORS = {
  UNAUTHENTICATED: 'Sign in again to continue.',
  EMAIL_REQUIRED: 'Your account needs an email address before you can apply.',
  EMAIL_NOT_VERIFIED: 'Confirm your email address before you apply. Check your inbox for the confirmation link.',
  INVALID_FULL_NAME: 'Enter your full name (2 to 120 characters).',
  INVALID_PHONE: 'The phone number is too long.',
  INVALID_NOTES: 'The notes are too long (1000 characters maximum).',
  INVALID_FELLOWSHIP: 'Choose an active fellowship.',
  ALREADY_TEACHER: 'We cannot accept a new application for this address. Contact an administrator.',
  ALREADY_APPROVED: 'This application has already been approved.',
  APPLICATION_NOT_ALLOWED: 'We cannot accept a new application for this address. Contact an administrator.',
  DUPLICATE_OPEN_APPLICATION: 'An application is already open for this address.',
  APPLICATION_NOT_FOUND: 'We could not find that application. Refresh the page.',
  VERSION_CONFLICT: 'This application changed elsewhere. Refresh the page and try again.',
  INVALID_TRANSITION: 'That action is not available for this application.',
};

// Reports what the server did. Only a first submission or a resubmission sends an email.
export function submitOutcomeMessage(outcome) {
  if (outcome === 'UNCHANGED') return 'Your application is already up to date.';
  if (outcome === 'UPDATED') return 'Your application has been updated. No email was sent for this change.';
  if (outcome === 'RESUBMITTED') return 'Your updated application has been sent to the administration team.';
  return 'Your application has been sent. A receipt is on its way by email.';
}

export function applicationErrorMessage(error) {
  const code = String(error?.message || '').split(':')[0].trim();
  return APPLICATION_ERRORS[code] || GENERIC_ERROR;
}

// Auth API errors: rate limits get their own copy; everything else is generic so it cannot reveal
// whether an address is registered.
export function isRateLimit(error) {
  if (!error) return false;
  const status = Number(error.status ?? 0);
  const code = String(error.code ?? '');
  return status === 429 || code.includes('rate') || code === 'over_email_send_rate_limit';
}

export function authErrorMessage(error, fallback = GENERIC_ERROR) {
  if (!error) return fallback;
  if (isRateLimit(error)) return RATE_LIMIT;
  if (String(error.code ?? '') === 'captcha_failed') return VERIFICATION_FAILED;
  if (String(error.code ?? '') === 'weak_password') return 'Choose a stronger password (at least 8 characters).';
  return fallback;
}
