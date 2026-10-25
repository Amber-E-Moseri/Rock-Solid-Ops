// Authorization gate for retry-worker. It runs before any body parsing, retry, resolve, sweep,
// Moodle call or ClickUp escalation.
//
// Only a request that presents a Bearer token which verifies as an active admin is authorized. A
// missing Authorization header is not treated as a trusted scheduler. The platform scheduler's
// authentication contract is not verified (see docs/BRANCH_HOLDS.md), so no request is authorized
// on that basis.

export type VerifiedUser = { id: string; email?: string | null };

export type RetryAuthDecision =
  | { ok: true; actorEmail: string }
  | { ok: false; status: 401 | 403; code: string; error: string };

export type RetryAuthInput = {
  authHeader: string | null | undefined;
  verifyUser: (jwt: string) => Promise<VerifiedUser | null>;
  isAdmin: (user: VerifiedUser) => Promise<boolean>;
};

const UNAUTHENTICATED = {
  ok: false,
  status: 401,
  code: "AUTH_REQUIRED",
  error: "Authorization required",
} as const;

export async function authorizeRetryRequest(input: RetryAuthInput): Promise<RetryAuthDecision> {
  const header = String(input.authHeader ?? "");
  if (!header.startsWith("Bearer ")) return { ...UNAUTHENTICATED };

  const jwt = header.slice("Bearer ".length).trim();
  if (!jwt) return { ...UNAUTHENTICATED };

  let user: VerifiedUser | null = null;
  try {
    user = await input.verifyUser(jwt);
  } catch {
    user = null;
  }
  if (!user || !user.id) {
    return { ok: false, status: 401, code: "INVALID_SESSION", error: "Invalid session" };
  }

  let allowed = false;
  try {
    allowed = await input.isAdmin(user);
  } catch {
    allowed = false;
  }
  if (!allowed) {
    return { ok: false, status: 403, code: "ADMIN_REQUIRED", error: "Admin access required" };
  }

  return { ok: true, actorEmail: user.email || user.id };
}
