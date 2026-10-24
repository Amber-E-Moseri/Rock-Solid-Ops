// Regression tests: legacy static pages must not derive roles or active state from user-writable
// metadata, and must fail closed on missing, failed or inactive profiles.
// Run: node --test tests/legacy-profile-trust.test.mjs
//
// PROFILE_TRUST_MODULE, AUTH_CLIENT_PATH and INDEX_HTML_PATH override the files under test. The
// vulnerable-code runs in the security notes point them at pre-fix copies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoPath = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const modulePath = process.env.PROFILE_TRUST_MODULE || repoPath("foundation/auth/profile-trust.js");
const authClientPath = process.env.AUTH_CLIENT_PATH || repoPath("foundation/auth/auth-client.js");
const indexHtmlPath = process.env.INDEX_HTML_PATH || repoPath("foundation/index.html");

const src = readFileSync(modulePath, "utf8");
const T = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

const UID = "11111111-1111-4111-8111-111111111111";
const TTL = 5 * 60 * 1000;
const NOW = 1_800_000_000_000;

// A signed-in user whose metadata the user controls. Forged values must never grant anything.
function forgedUser(role, where = "both") {
  const meta = where === "user" || where === "both" ? { role, full_name: "Forged" } : {};
  const appMeta = where === "app" || where === "both" ? { role } : {};
  return { id: UID, email: "applicant@example.org", user_metadata: meta, app_metadata: appMeta };
}

const rowLookup = (row) => async () => ({ data: row, error: null });
const noRowLookup = async () => ({ data: null, error: null });
const failedLookup = async () => ({
  data: null,
  error: { code: "42501", message: "permission denied for table profiles" },
});
const missingTableLookup = async () => ({ data: null, error: { code: "42P01", message: "relation does not exist" } });

function trusted(lookup, user, extra = {}) {
  return T.resolveTrustedProfile({ user, lookup, now: NOW, ...extra });
}

// ── Forged metadata cannot grant roles ─────────────────────────────────────────

for (const forgedRole of ["superadmin", "admin", "teacher"]) {
  for (const where of ["user", "app", "both"]) {
    test(`forged ${forgedRole} in ${where} metadata: no profiles row grants nothing`, async () => {
      const profile = await trusted(noRowLookup, forgedUser(forgedRole, where));
      assert.equal(profile, null);
    });
  }
}

test("forged superadmin metadata cannot override a pending profiles row", async () => {
  const profile = await trusted(rowLookup({ user_id: UID, role: "pending", is_active: true }), forgedUser("superadmin", "both"));
  assert.equal(profile.role, "pending");
  assert.notEqual(profile.role, "superadmin");
});

test("forged admin metadata cannot override a teacher profiles row", async () => {
  const profile = await trusted(rowLookup({ user_id: UID, role: "teacher", is_active: true }), forgedUser("admin", "app"));
  assert.equal(profile.role, "teacher");
  assert.equal(profile.is_active, true);
});

test("forged teacher metadata cannot grant a teacher role when the row says pending", async () => {
  const profile = await trusted(rowLookup({ user_id: UID, role: "pending", is_active: true }), forgedUser("teacher", "user"));
  assert.equal(profile.role, "pending");
});

test("display name never comes from metadata", async () => {
  const profile = await trusted(rowLookup({ user_id: UID, role: "pending", is_active: true }), forgedUser("admin", "user"));
  assert.equal(profile.full_name, "applicant@example.org");
});

// ── Missing role, inactive profile, unknown active state ──────────────────────

test("missing role is pending, never elevated by metadata", async () => {
  const profile = await trusted(rowLookup({ user_id: UID, role: null, is_active: true }), forgedUser("superadmin", "both"));
  assert.equal(profile.role, "pending");
});

test("blank role is pending, never elevated by metadata", async () => {
  const profile = await trusted(rowLookup({ user_id: UID, role: "   ", is_active: true }), forgedUser("admin", "both"));
  assert.equal(profile.role, "pending");
});

test("inactive profile fails closed even with forged active metadata", async () => {
  const user = { ...forgedUser("admin", "both"), user_metadata: { role: "admin", is_active: true }, app_metadata: { active: true } };
  assert.equal(await trusted(rowLookup({ user_id: UID, role: "admin", is_active: false }), user), null);
  assert.equal(await trusted(rowLookup({ user_id: UID, role: "admin", active: false }), user), null);
});

test("suspended, inactive and disabled statuses fail closed", async () => {
  for (const status of ["suspended", "INACTIVE", "disabled"]) {
    assert.equal(await trusted(rowLookup({ user_id: UID, role: "admin", is_active: true, status }), forgedUser("admin", "both")), null, status);
  }
});

test("a row with no explicit active flag fails closed", async () => {
  assert.equal(await trusted(rowLookup({ user_id: UID, role: "admin" }), forgedUser("admin", "both")), null);
});

// ── Lookup failure fails closed ────────────────────────────────────────────────

test("a failed profiles lookup throws instead of falling back to metadata", async () => {
  await assert.rejects(trusted(failedLookup, forgedUser("superadmin", "both")), (err) => err.name === "ProfileLookupError");
});

test("a missing profiles table is also a failed lookup, not a metadata fallback", async () => {
  await assert.rejects(trusted(missingTableLookup, forgedUser("admin", "both")), (err) => err.name === "ProfileLookupError");
});

// ── Legitimate active accounts still resolve ───────────────────────────────────

test("legitimate active teacher resolves from the profiles row", async () => {
  const profile = await trusted(rowLookup({ user_id: UID, email: "t@example.org", role: "teacher", is_active: true, full_name: "Tina" }), forgedUser());
  assert.equal(profile.role, "teacher");
  assert.equal(profile.is_active, true);
  assert.equal(profile.source, "profiles");
  assert.equal(profile.full_name, "Tina");
});

test("legitimate active admin resolves from the profiles row", async () => {
  const profile = await trusted(rowLookup({ user_id: UID, role: "admin", is_active: true }), forgedUser());
  assert.equal(profile.role, "admin");
  assert.equal(profile.is_active, true);
});

test("role comparison is case-insensitive and trimmed", () => {
  assert.equal(T.normalizeRole("  ADMIN "), "admin");
  assert.equal(T.normalizeRole(""), "pending");
});

// ── Session cache is trusted only when this resolver wrote it ─────────────────

const cacheEntry = (overrides = {}) => ({
  user_id: UID,
  ts: NOW,
  profile: { user_id: UID, role: "admin", is_active: true, source: "profiles" },
  ...overrides,
});

test("a fresh trusted cache entry is used without a lookup", async () => {
  const cache = { readCache: (uid, now) => (T.isTrustedCacheEntry(cacheEntry(), uid, now, TTL) ? cacheEntry().profile : null), writeCache: () => {} };
  const profile = await trusted(async () => { throw new Error("lookup must not run"); }, forgedUser(), cache);
  assert.equal(profile.role, "admin");
});

for (const [name, entry] of [
  ["metadata-sourced entry", cacheEntry({ profile: { user_id: UID, role: "superadmin", is_active: true, source: "auth" } })],
  ["entry with no provenance", cacheEntry({ profile: { user_id: UID, role: "superadmin", is_active: true } })],
  ["entry for another user", cacheEntry({ user_id: "22222222-2222-4222-8222-222222222222" })],
  ["expired entry", cacheEntry({ ts: NOW - TTL - 1 })],
  ["entry from the future", cacheEntry({ ts: NOW + 60_000 })],
  ["inactive cached profile", cacheEntry({ profile: { user_id: UID, role: "admin", is_active: false, source: "profiles" } })],
]) {
  test(`cache rejects ${name}`, () => {
    assert.equal(T.isTrustedCacheEntry(entry, UID, NOW, TTL), false);
  });
}

test("a poisoned cache entry does not short-circuit the server lookup", async () => {
  let looked = false;
  const poisoned = cacheEntry({ profile: { user_id: UID, role: "superadmin", is_active: true, source: "auth" } });
  const cache = { readCache: (uid, now) => (T.isTrustedCacheEntry(poisoned, uid, now, TTL) ? poisoned.profile : null), writeCache: () => {} };
  const profile = await trusted(async () => { looked = true; return { data: { user_id: UID, role: "pending", is_active: true }, error: null }; }, forgedUser("superadmin", "both"), cache);
  assert.equal(looked, true);
  assert.equal(profile.role, "pending");
});

test("inactive and empty results are never cached", async () => {
  const writes = [];
  const cache = { readCache: () => null, writeCache: (uid, profile) => writes.push(profile) };
  await trusted(rowLookup({ user_id: UID, role: "admin", is_active: false }), forgedUser(), cache);
  await trusted(noRowLookup, forgedUser(), cache);
  assert.equal(writes.length, 0);
  await trusted(rowLookup({ user_id: UID, role: "admin", is_active: true }), forgedUser(), cache);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].source, "profiles");
});

// ── Source contract: the legacy files read no metadata for authorization ──────

const authClientSrc = readFileSync(authClientPath, "utf8");
const indexSrc = readFileSync(indexHtmlPath, "utf8");

test("auth-client.js reads no user_metadata or app_metadata", () => {
  assert.doesNotMatch(authClientSrc, /user_metadata|app_metadata/);
});

test("auth-client.js has no metadata profile fallback", () => {
  assert.doesNotMatch(authClientSrc, /falling back to auth metadata|metadataProfile/);
});

test("auth-client.js resolves profiles through the trusted resolver", () => {
  assert.match(authClientSrc, /import \{[^}]*resolveTrustedProfile[^}]*\} from "\.\/profile-trust\.js";/);
  assert.match(authClientSrc, /return resolveTrustedProfile\(\{/);
});

test("requireAuth ends the session on a failed lookup and denies missing or inactive profiles", () => {
  assert.match(authClientSrc, /profile = await getCurrentProfile\(\);\s*\}\s*catch \(err\) \{[\s\S]*?redirectToLoginWithError\("session"\)/);
  assert.match(authClientSrc, /if \(!profile \|\| profile\.is_active !== true\) \{\s*redirectToLoginWithError\("inactive"\)/);
});

test("index.html reads no user_metadata or app_metadata and has no metadata fast path", () => {
  assert.doesNotMatch(indexSrc, /user_metadata|app_metadata/);
  assert.doesNotMatch(indexSrc, /resolveRoleFromSession/);
  assert.match(indexSrc, /getCurrentProfile\(\), 2500\)\.catch\(\(\) => null\)/);
});
