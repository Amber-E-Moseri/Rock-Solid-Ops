// Admin lookup for retry-worker. Profiles are the authoritative source. The legacy admin_users table is
// consulted only when no profiles row exists for the verified user.
//
// Every missing value, missing table, query error and unexpected shape denies access. No input other
// than the verified user id and verified email is used, and never user_metadata or app_metadata.

export const RETRY_ADMIN_ROLES: readonly string[] = Object.freeze([
  "admin",
  "superadmin",
  "subgroup_admin",
  "pastor",
  "principal",
]);

const INACTIVE_LEGACY_STATUSES: readonly string[] = Object.freeze(["suspended", "inactive", "disabled"]);

// Minimal query surface used here. Matches the supabase-js builder shape without depending on it.
export type AdminQueryResult = { data: unknown; error: unknown };
export type AdminQuery = {
  select(columns: string): AdminQuery;
  eq(column: string, value: string): AdminQuery;
  maybeSingle(): PromiseLike<AdminQueryResult>;
};
export type AdminDb = { from(table: string): AdminQuery };

function roleOf(row: Record<string, unknown>): string {
  return String(row.role ?? "").trim().toLowerCase();
}

// Profiles: the row must be explicitly active. A missing or null is_active is not active.
export function isActiveAdminProfile(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return r.is_active === true && RETRY_ADMIN_ROLES.includes(roleOf(r));
}

// Legacy admin_users rows: active must be explicitly true, and the status must not be a terminal state.
export function isActiveLegacyAdmin(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  const status = String(r.status ?? "").trim().toLowerCase();
  if (INACTIVE_LEGACY_STATUSES.includes(status)) return false;
  return r.active === true && RETRY_ADMIN_ROLES.includes(roleOf(r));
}

const LEGACY_COLUMNS = "role,status,active";

export async function resolveRetryAdmin(
  db: AdminDb,
  userId: string,
  email?: string | null,
): Promise<boolean> {
  try {
    if (!userId) return false;

    const profile = await db
      .from("profiles")
      .select("role,is_active")
      .eq("user_id", userId)
      .maybeSingle();
    if (profile.error) return false;
    // A profile row is authoritative. An inactive or non-admin profile never falls through to admin_users.
    if (profile.data) return isActiveAdminProfile(profile.data);

    // No profile row: legacy lookup by verified user id first.
    const byId = await db
      .from("admin_users")
      .select(LEGACY_COLUMNS)
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (byId.error) return false;
    if (byId.data) return isActiveLegacyAdmin(byId.data);

    // Then by verified email, as a separate exact-match query. The value is never spliced into a filter string.
    const verifiedEmail = String(email ?? "").trim();
    if (!verifiedEmail) return false;
    const byEmail = await db
      .from("admin_users")
      .select(LEGACY_COLUMNS)
      .eq("email", verifiedEmail)
      .maybeSingle();
    if (byEmail.error) return false;
    return byEmail.data ? isActiveLegacyAdmin(byEmail.data) : false;
  } catch (_) {
    return false;
  }
}
