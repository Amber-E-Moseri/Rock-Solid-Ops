// Validates the `next` redirect target used by the static login.
//
// Accepts only same-origin, app-local paths. Rejects C0 controls, space, DEL and
// backslash, in both the raw value and one percent-decoded copy. Browsers strip
// tabs and newlines from URLs and treat a backslash like a slash, so
// "/\t/host" and "/\/host" would otherwise become protocol-relative redirects.
// Returns the validated path, or null when the value is unsafe.
const UNSAFE = /[\s\u0000-\u001f\u007f-\u009f\\]/;
const APP_ORIGIN = "https://app.invalid";

export function safeNextPath(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  if (UNSAFE.test(raw)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (UNSAFE.test(decoded)) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || decoded.startsWith("//")) return null;
  let url;
  try {
    url = new URL(raw, APP_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== APP_ORIGIN) return null;
  return raw;
}
