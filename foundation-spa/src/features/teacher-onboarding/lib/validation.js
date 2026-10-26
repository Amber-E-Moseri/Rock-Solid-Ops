// Client-side validation mirrors the server contract (teacher_applications, PR #22). The server stays
// authoritative: these checks only give immediate feedback and keep obviously bad input off the wire.

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
export const NAME_MIN = 2;
export const NAME_MAX = 120;
export const PHONE_MAX = 32;
export const NOTES_MAX = 1000;
export const EMAIL_MAX = 254;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return 'Enter your email address.';
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return 'Enter a valid email address.';
  return null;
}

export function validatePassword(password, confirm) {
  const value = String(password ?? '');
  if (value.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (value.length > PASSWORD_MAX) return `Use no more than ${PASSWORD_MAX} characters.`;
  if (value !== String(confirm ?? '')) return 'The two passwords do not match.';
  return null;
}

export function validateRegistration({ fullName, email, password, confirm }) {
  const errors = {};
  const name = String(fullName ?? '').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    errors.fullName = `Enter your full name (${NAME_MIN} to ${NAME_MAX} characters).`;
  }
  const emailError = validateEmail(email);
  if (emailError) errors.email = emailError;
  const passwordError = validatePassword(password, confirm);
  if (passwordError) errors.password = passwordError;
  return errors;
}

export function validateApplication({ fullName, phone, fellowshipCode, notes }) {
  const errors = {};
  const name = String(fullName ?? '').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    errors.fullName = `Enter your full name (${NAME_MIN} to ${NAME_MAX} characters).`;
  }
  if (String(phone ?? '').trim().length > PHONE_MAX) {
    errors.phone = `Phone number must be ${PHONE_MAX} characters or fewer.`;
  }
  if (!String(fellowshipCode ?? '').trim()) {
    errors.fellowshipCode = 'Choose the fellowship you would serve.';
  }
  if (String(notes ?? '').length > NOTES_MAX) {
    errors.notes = `Notes must be ${NOTES_MAX} characters or fewer.`;
  }
  return errors;
}

export function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}
