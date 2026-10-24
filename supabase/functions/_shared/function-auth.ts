// Caller authorization for edge functions that mutate data or reach external services.
//
// The gateway verify_jwt setting is not an authorization decision: the anon key is also a signed JWT,
// so a function must decide for itself who may proceed. This module runs before any request body is
// read or any mutation is made. Staff roles come only from the trusted public.profiles row. user_metadata
// and app_metadata are never consulted. A service-role caller is accepted only by an exact, constant-time
// match against the server-side service credential.

export type VerifiedUser = { id: string; email?: string | null };

export type CallerDeps = {
  serviceKey: string;
  // Lower-case role names. A staff caller must hold one of these on an active profile.
  allowedRoles: readonly string[];
  verifyUser: (jwt: string) => Promise<VerifiedUser | null>;
  // Returns the trusted role of an active profile, or null when the profile is missing or inactive.
  roleOf: (userId: string) => Promise<string | null>;
};

export type CallerDecision =
  | { ok: true; kind: "service_role" }
  | { ok: true; kind: "staff"; actorEmail: string; role: string }
  | { ok: false; status: 401 | 403; code: string; error: string };

export type AuthDb = {
  auth: {
    getUser: (jwt: string) => Promise<{ data: { user: { id: string; email?: string | null } | null }; error: unknown }>;
  };
  // Query builder, typed loosely because it is the Supabase client's own chain.
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
};

export function bearerToken(authHeader: string | null | undefined): string {
  const header = String(authHeader ?? "");
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

// Compares every character so the time taken does not reveal how much of a guess matched.
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// A profile grants a role only when it exists, is explicitly active and carries a role.
// A missing or null is_active fails closed.
export function trustedProfileRole(profile: { role?: unknown; is_active?: unknown } | null | undefined): string | null {
  if (!profile || profile.is_active !== true) return null;
  const role = String(profile.role ?? "").trim().toLowerCase();
  return role || null;
}

const MISSING_CREDENTIAL = {
  ok: false,
  status: 401,
  code: "AUTH_REQUIRED",
  error: "Authorization required",
} as const;

export async function authorizeCaller(
  authHeader: string | null | undefined,
  deps: CallerDeps,
): Promise<CallerDecision> {
  const token = bearerToken(authHeader);
  if (!token) return { ...MISSING_CREDENTIAL };

  // Exact match only. An empty configured key never matches, because the token is non-empty here.
  if (deps.serviceKey && constantTimeEqual(token, deps.serviceKey)) {
    return { ok: true, kind: "service_role" };
  }

  let user: VerifiedUser | null = null;
  try {
    user = await deps.verifyUser(token);
  } catch {
    user = null;
  }
  if (!user?.id) {
    return { ok: false, status: 401, code: "INVALID_SESSION", error: "Invalid session" };
  }

  let role: string | null = null;
  try {
    role = await deps.roleOf(user.id);
  } catch {
    role = null;
  }
  const normalized = String(role ?? "").trim().toLowerCase();
  if (!normalized || !deps.allowedRoles.includes(normalized)) {
    return { ok: false, status: 403, code: "STAFF_REQUIRED", error: "Staff access required" };
  }

  return { ok: true, kind: "staff", actorEmail: user.email || user.id, role: normalized };
}

// Builds the response for a refused caller. Only the status, a code and a fixed message are returned.
export function denialResponse(
  decision: Extract<CallerDecision, { ok: false }>,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ ok: false, error: decision.error, code: decision.code }), {
    status: decision.status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// Production wiring: verifies the bearer with Supabase Auth and reads the role from public.profiles
// through the service-role client. Both lookups fail closed.
export function supabaseCallerDeps(
  db: AuthDb,
  options: { serviceKey: string; allowedRoles: readonly string[] },
): CallerDeps {
  return {
    serviceKey: options.serviceKey,
    allowedRoles: options.allowedRoles,
    verifyUser: async (jwt) => {
      const { data, error } = await db.auth.getUser(jwt);
      if (error || !data?.user) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },
    roleOf: async (userId) => {
      const { data, error } = await db
        .from("profiles")
        .select("role,is_active")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return null;
      return trustedProfileRole(data);
    },
  };
}
