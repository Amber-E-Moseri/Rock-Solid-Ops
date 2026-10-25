// Inbound authorization for moodle-sync. It runs before any database read or write, and before any
// Moodle request. A request is authorized only by an explicit credential:
//   - the service-role bearer, exactly equal to SUPABASE_SERVICE_ROLE_KEY (internal callers:
//     registration-processor, retry-worker); or
//   - for the `test` connectivity action only, a bearer that verifies as an active admin profile.
// Absence of Authorization is never permission. Anon-key and other bearers are refused.

export type MoodleSyncActor = { via: "service_role"; actor: string } | { via: "admin_jwt"; actor: string };

export type MoodleSyncAuthDecision =
  | { ok: true; actor: MoodleSyncActor }
  | { ok: false; status: 401 | 403; code: string; error: string };

export type MoodleSyncAuthInput = {
  authHeader: string | null | undefined;
  serviceKey: string;
  allowAdminJwt: boolean;
  verifyAdmin: (jwt: string) => Promise<{ id: string; email?: string | null } | null>;
};

// Constant-time string comparison, so the service key cannot be recovered by timing.
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function authorizeMoodleSyncCaller(input: MoodleSyncAuthInput): Promise<MoodleSyncAuthDecision> {
  const header = String(input.authHeader ?? "");
  if (!header.startsWith("Bearer ")) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Authorization required" };
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Authorization required" };
  }

  if (input.serviceKey && constantTimeEquals(token, input.serviceKey)) {
    return { ok: true, actor: { via: "service_role", actor: "service-role" } };
  }

  if (!input.allowAdminJwt) {
    return { ok: false, status: 403, code: "SERVICE_ROLE_REQUIRED", error: "Service caller required" };
  }

  let user: { id: string; email?: string | null } | null = null;
  try {
    user = await input.verifyAdmin(token);
  } catch {
    user = null;
  }
  if (!user || !user.id) {
    return { ok: false, status: 401, code: "INVALID_SESSION", error: "Invalid session" };
  }
  return { ok: true, actor: { via: "admin_jwt", actor: user.email || user.id } };
}
