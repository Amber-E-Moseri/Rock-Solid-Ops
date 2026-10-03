/**
 * Caller authentication for service-role Edge Functions.
 *
 * Functions deployed with verify_jwt=false (or that run with the service-role
 * key) bypass RLS, so the handler itself must prove who is calling.
 *
 * NEVER decode a JWT payload and trust its `role` claim: without signature
 * verification anyone can forge `{"role":"service_role"}`. A service caller is
 * recognised only by presenting the exact SUPABASE_SERVICE_ROLE_KEY.
 */

export const STAFF_ROLES = ["admin", "superadmin", "subgroup_admin", "pastor", "principal"];

export type CallerAuthResult =
  | { ok: true; kind: "service" | "staff"; actorEmail: string; userId?: string }
  | { ok: false; status: 401 | 403; error: string };

export function bearerToken(req: Request): string {
  const header = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

/** Constant-time string comparison (length is not secret here). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function isServiceRoleToken(token: string, serviceKey: string): boolean {
  return Boolean(token) && Boolean(serviceKey) && timingSafeEqual(token, serviceKey);
}

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * Accept the service-role key, or (when allowStaff) a valid user session whose
 * active profile has a staff role. Everything else is rejected.
 */
export async function authorizeCaller(
  req: Request,
  db: Db,
  serviceKey: string,
  opts: { allowStaff?: boolean; roles?: string[] } = {},
): Promise<CallerAuthResult> {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: "Missing bearer token" };
  if (isServiceRoleToken(token, serviceKey)) {
    return { ok: true, kind: "service", actorEmail: "service@system" };
  }
  if (!opts.allowStaff) return { ok: false, status: 403, error: "Service role required" };

  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return { ok: false, status: 401, error: "Invalid session" };

  const { data: profile } = await db
    .from("profiles")
    .select("role,is_active")
    .eq("user_id", data.user.id)
    .maybeSingle();
  const role = String(profile?.role || "").trim().toLowerCase();
  const active = profile?.is_active !== false;
  if (!profile || !active || !(opts.roles || STAFF_ROLES).includes(role)) {
    return { ok: false, status: 403, error: "Admin access required" };
  }
  return { ok: true, kind: "staff", actorEmail: data.user.email || "admin@system", userId: data.user.id };
}
