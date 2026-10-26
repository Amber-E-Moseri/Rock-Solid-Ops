// Turn anything that can be thrown or returned as `error` into a short, safe string.
//
// supabase-js returns PostgREST failures as PLAIN OBJECTS ({ message, code, details, hint }), not Error
// instances, so `error instanceof Error ? error.message : String(error)` yields "[object Object]".
// describeError handles both shapes; redactSecrets removes credentials before the text is logged,
// stored in audit rows or returned to a caller.

const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const NEXUS_KEY_RE = /blwk_[0-9a-fA-F]{8,}/g;

/** Remove JWTs, Nexus API keys and any explicitly supplied secret values. */
export function redactSecrets(text: string, secrets: Array<string | undefined | null> = []): string {
  let out = String(text).replace(JWT_RE, "[redacted-jwt]").replace(NEXUS_KEY_RE, "[redacted-key]");
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join("[redacted]");
  }
  return out;
}

/** Best-effort one-line description of an unknown error value, redacted and length-bounded. */
export function describeError(err: unknown, secrets: Array<string | undefined | null> = [], max = 300): string {
  let text: string;
  if (err instanceof Error) {
    text = err.message || err.name;
  } else if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const msg = typeof o.message === "string" && o.message ? o.message : "";
    const code = typeof o.code === "string" && o.code ? ` (code ${o.code})` : "";
    text = msg ? `${msg}${code}` : safeJson(o);
  } else {
    text = String(err);
  }
  return redactSecrets(text, secrets).slice(0, max);
}

/**
 * True when the failure looks like "the database could not be reached / is unavailable" rather than a
 * logic or data error. Used to answer 503 (retry later) instead of 500.
 */
export function looksLikeUnavailable(err: unknown): boolean {
  const o = (err && typeof err === "object" ? err : {}) as Record<string, unknown>;
  const code = typeof o.code === "string" ? o.code : "";
  if (/^(08|53|57)/.test(code)) return true; // connection exception, insufficient resources, operator intervention
  const status = typeof o.status === "number" ? o.status : 0;
  if (status === 502 || status === 503 || status === 504) return true;
  const text = (err instanceof Error ? err.message : typeof o.message === "string" ? o.message : String(err)).toLowerCase();
  return /fetch failed|failed to fetch|econnrefused|econnreset|enotfound|network|connection (refused|reset|closed)|error sending request|timed? ?out|unreachable|dns error/.test(text);
}

function safeJson(o: unknown): string {
  try {
    const s = JSON.stringify(o);
    return s && s !== "{}" ? s : "unknown error";
  } catch {
    return "unknown error";
  }
}
