// Trusted profile resolution for the legacy static pages.
//
// Authorization uses only the server-side profiles row. user_metadata and app_metadata are
// writable by the signed-in user (signUp data, updateUser), so they never supply a role, an
// active state, or a display name. Every failure fails closed:
//   - a failed lookup throws ProfileLookupError (never a fallback profile)
//   - no profiles row returns null
//   - an inactive profile, or one without an explicit active flag, returns null
//   - a row without a role is treated as "pending", which is non-elevated
// Only profiles produced by this resolver are cached, and a cache entry is accepted only when its
// provenance marker matches. The module has no imports and no browser globals, so tests can load it.

export class ProfileLookupError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "ProfileLookupError";
    this.cause = cause;
  }
}

const INACTIVE_STATUSES = new Set(["suspended", "inactive", "disabled"]);

export function normalizeRole(rawRole, fallbackRole = "pending") {
  const role = String(rawRole || "").trim();
  if (!role) return fallbackRole;
  return role.toLowerCase();
}

// Active only when the row says so explicitly. An unknown state is not active.
export function resolveActiveState(row) {
  const status = String(row?.status || "").trim().toLowerCase();
  if (row?.is_active === false || row?.active === false) return false;
  if (INACTIVE_STATUSES.has(status)) return false;
  return row?.is_active === true || row?.active === true;
}

// Builds the profile from the server row. The user argument supplies only the verified email.
export function profileFromRow(row, user) {
  if (!row || typeof row !== "object") return null;
  return {
    user_id: row.user_id || row.id || user?.id || null,
    email: row.email || user?.email || null,
    full_name: row.full_name || row.name || row.email || user?.email || "User",
    role: normalizeRole(row.role, "pending"),
    is_active: resolveActiveState(row),
    source: "profiles",
  };
}

// A cache entry is trusted only when it was written by this resolver, for this user, within the TTL,
// and still describes an active profile.
export function isTrustedCacheEntry(entry, userId, now, ttlMs) {
  if (!entry || entry.user_id !== userId) return false;
  if (typeof entry.ts !== "number" || now < entry.ts || now - entry.ts > ttlMs) return false;
  const profile = entry.profile;
  return Boolean(
    profile &&
      profile.source === "profiles" &&
      profile.user_id === userId &&
      profile.is_active === true,
  );
}

// Resolves the trusted profile for a verified user.
//   readCache(userId, now) -> cached profile or null
//   writeCache(userId, profile, now)
//   lookup(userId) -> { data, error }; data is the row or null
export async function resolveTrustedProfile({ user, readCache, writeCache, lookup, now = Date.now() }) {
  if (!user || !user.id) return null;

  const cached = readCache ? readCache(user.id, now) : null;
  if (cached) return cached;

  const result = await lookup(user.id);
  if (result && result.error) {
    throw new ProfileLookupError("The profiles lookup failed.", result.error);
  }

  const row = result ? result.data : null;
  if (!row) return null;

  const profile = profileFromRow(row, user);
  if (!profile || profile.is_active !== true) return null;

  if (writeCache) writeCache(user.id, profile, now);
  return profile;
}
