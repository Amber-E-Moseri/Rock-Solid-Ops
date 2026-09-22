import { createHash, timingSafeEqual } from "node:crypto";

function secretFailure(status: number): Response {
  return new Response(JSON.stringify({
    ok: false,
    error: status === 500 ? "Service configuration error" : "Unauthorized",
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function validateSecret(
  expectedEnvName: string,
  supplied: string,
): Response | null {
  const expected = Deno.env.get(expectedEnvName) ?? "";
  if (!expected) return secretFailure(500);
  if (!supplied) return secretFailure(401);

  const hashExpected = createHash("sha256").update(expected).digest();
  const hashSupplied = createHash("sha256").update(supplied).digest();
  const match = timingSafeEqual(hashExpected, hashSupplied);

  return match ? null : secretFailure(401);
}

/**
 * Validates the x-cron-secret request header against CRON_INVOKE_SECRET.
 * Returns a failure Response on error, null on success.
 *
 * Status codes:
 *   500 — CRON_INVOKE_SECRET env var is absent or empty (configuration failure)
 *   401 — x-cron-secret header is absent, empty, or does not match (auth failure)
 *
 * Comparison strategy: SHA-256 both values to fixed 32-byte digests before
 * calling timingSafeEqual. This eliminates length-based timing inference —
 * timingSafeEqual always receives equal-length buffers regardless of input
 * length, and no length or partial-match information leaks to callers.
 * Digests are transient (never logged or returned).
 */
export function validateCronAuth(req: Request): Response | null {
  return validateSecret("CRON_INVOKE_SECRET", req.headers.get("x-cron-secret") ?? "");
}

/**
 * Validates trusted Edge Function -> Edge Function calls.
 *
 * This intentionally uses a separate header and env var from cron auth:
 *   x-internal-secret -> INTERNAL_INVOKE_SECRET
 *
 * CRON_INVOKE_SECRET, SUPABASE_SERVICE_ROLE_KEY, and user JWTs are not accepted
 * as substitutes.
 */
export function validateInternalAuth(req: Request): Response | null {
  return validateSecret("INTERNAL_INVOKE_SECRET", req.headers.get("x-internal-secret") ?? "");
}
