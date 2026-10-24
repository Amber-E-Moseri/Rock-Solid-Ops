/**
 * FUNCTION AUTHORIZATION REGRESSION (waitlist-processor, moodle-sync)
 *
 * Verifies the caller gate on the two functions that mutate data or reach Moodle:
 *   - unauthenticated, anon-key and non-staff requests are refused before any work;
 *   - allowed staff and service-role callers pass.
 *
 * Every request here is either refused or uses a nonexistent identifier, so no Moodle account, password or
 * credential email is touched and no Moodle endpoint is reached. Users are created and removed in the local stack.
 *
 * Requirements:
 *   LOCAL_INTEGRATION_TEST=true            (safety gate)
 *   SUPABASE_URL=http://127.0.0.1:54321    (local stack only)
 *   SUPABASE_SERVICE_ROLE_KEY=<key>        (from `supabase status`)
 *   SUPABASE_ANON_KEY=<key>                (from `supabase status`)
 *
 * Run:
 *   LOCAL_INTEGRATION_TEST=true \
 *   SUPABASE_SERVICE_ROLE_KEY=$(supabase status --output env | grep SERVICE_ROLE_KEY | cut -d= -f2) \
 *   SUPABASE_ANON_KEY=$(supabase status --output env | grep ANON_KEY | cut -d= -f2) \
 *   deno run --allow-net --allow-env supabase/tests/security/function-auth-regression.ts
 *
 * Never embeds credentials. Never contacts production.
 */

if (Deno.env.get("LOCAL_INTEGRATION_TEST") !== "true") {
  console.error("ERROR: Set LOCAL_INTEGRATION_TEST=true to run this test.");
  console.error("This test creates local users and must never run against production.");
  Deno.exit(1);
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

if (!SERVICE_KEY || !ANON_KEY) {
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY must be set.");
  console.error("  Run: supabase status --output env");
  Deno.exit(1);
}

const TS = Date.now();
const PASSWORD = `FnAuth${TS}x`;
// Nonexistent identifiers: an authorized call succeeds without touching any row.
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

type Result = { status: number; json: Record<string, unknown> | null };

async function call(fn: string, bearer: string | null, body: unknown): Promise<Result> {
  const headers: Record<string, string> = {
    apikey: ANON_KEY,
    "Content-Type": "application/json",
  };
  if (bearer !== null) headers["Authorization"] = `Bearer ${bearer}`;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text.length ? JSON.parse(text) as Record<string, unknown> : null;
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

async function adminCreateUser(email: string): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const d = await r.json() as { id?: string };
  if (!d.id) throw new Error(`createUser(${email}) failed: ${JSON.stringify(d)}`);
  return d.id;
}

// The profile row is created by the auth trigger. Set its role with the service key, then confirm it.
async function setRole(userId: string, role: string): Promise<void> {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  for (let attempt = 0; attempt < 20; attempt++) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`,
      { method: "PATCH", headers, body: JSON.stringify({ role, is_active: true }) },
    );
    const rows = await r.json() as Array<{ role?: string }>;
    if (Array.isArray(rows) && rows[0]?.role === role) return;
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`profile for ${userId} did not reach role ${role}`);
}

async function signIn(email: string): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const d = await r.json() as { access_token?: string };
  if (!d.access_token) throw new Error(`signIn(${email}) failed`);
  return d.access_token;
}

async function deleteUser(userId: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

// ── Assertions ───────────────────────────────────────────────────────────────

let failures = 0;
let passes = 0;

function check(name: string, ok: boolean, detail: string) {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}: ${detail}`);
  }
}

function expectRefused(name: string, r: Result, status: number, code: string) {
  check(
    name,
    r.status === status && r.json?.code === code && r.json?.ok === false,
    `expected ${status} ${code}, got ${r.status} ${JSON.stringify(r.json)}`,
  );
}

function expectNoMoodleLeak(name: string, r: Result) {
  check(name, !("moodleUrl" in (r.json ?? {})), "refused response must not disclose the Moodle URL");
}

function expectProcessed(name: string, r: Result) {
  check(name, r.status === 200 && r.json?.ok === true, `expected 200 ok, got ${r.status} ${JSON.stringify(r.json)}`);
}

// ── Setup ────────────────────────────────────────────────────────────────────

const created: string[] = [];

try {
  const adminEmail = `fnauth-admin-${TS}@invalid.local`;
  const regionalEmail = `fnauth-regional-${TS}@invalid.local`;
  const teacherEmail = `fnauth-teacher-${TS}@invalid.local`;

  const adminId = await adminCreateUser(adminEmail);
  created.push(adminId);
  await setRole(adminId, "admin");

  const regionalId = await adminCreateUser(regionalEmail);
  created.push(regionalId);
  await setRole(regionalId, "regional_secretary");

  const teacherId = await adminCreateUser(teacherEmail);
  created.push(teacherId);
  await setRole(teacherId, "teacher");

  const adminJwt = await signIn(adminEmail);
  const regionalJwt = await signIn(regionalEmail);
  const teacherJwt = await signIn(teacherEmail);

  const waitlistBody = { class_option_id: MISSING_ID, batch_id: MISSING_ID };

  console.log("\nwaitlist-processor");
  expectRefused(
    "no credential is refused before processing",
    await call("waitlist-processor", null, waitlistBody),
    401,
    "AUTH_REQUIRED",
  );
  expectRefused(
    "anon key as bearer is refused (public/anon processing)",
    await call("waitlist-processor", ANON_KEY, waitlistBody),
    401,
    "INVALID_SESSION",
  );
  expectRefused(
    "teacher JWT is refused",
    await call("waitlist-processor", teacherJwt, waitlistBody),
    403,
    "STAFF_REQUIRED",
  );
  expectProcessed("admin JWT is processed", await call("waitlist-processor", adminJwt, waitlistBody));
  expectProcessed(
    "regional_secretary JWT is processed",
    await call("waitlist-processor", regionalJwt, waitlistBody),
  );
  expectProcessed(
    "service-role call (registration-processor contract) is processed",
    await call("waitlist-processor", SERVICE_KEY, waitlistBody),
  );

  console.log("\nmoodle-sync");
  const testAction = { action: "test" };
  const idOnly = { id: MISSING_ID, limit: 1 };

  // Without a credential, the gateway may answer first if it enforces JWTs for this function. Either way the
  // request must be refused with 401 and must not disclose the Moodle URL.
  const anonymousTest = await call("moodle-sync", null, testAction);
  check(
    "no credential is refused for action=test",
    anonymousTest.status === 401 && (anonymousTest.json?.code === "AUTH_REQUIRED" || anonymousTest.json?.code === undefined),
    `expected 401, got ${anonymousTest.status} ${JSON.stringify(anonymousTest.json)}`,
  );
  expectNoMoodleLeak("refused action=test does not disclose the Moodle URL", anonymousTest);

  const anonymousSync = await call("moodle-sync", null, {});
  check(
    "no credential is refused for an unbounded sync",
    anonymousSync.status === 401 && (anonymousSync.json?.code === "AUTH_REQUIRED" || anonymousSync.json?.code === undefined),
    `expected 401, got ${anonymousSync.status} ${JSON.stringify(anonymousSync.json)}`,
  );

  expectRefused(
    "anon key as bearer is refused for action=test",
    await call("moodle-sync", ANON_KEY, testAction),
    401,
    "INVALID_SESSION",
  );
  expectRefused(
    "teacher JWT is refused for action=test",
    await call("moodle-sync", teacherJwt, testAction),
    403,
    "STAFF_REQUIRED",
  );
  expectRefused(
    "teacher JWT is refused for a forced id",
    await call("moodle-sync", teacherJwt, idOnly),
    403,
    "STAFF_REQUIRED",
  );
  expectRefused(
    "regional_secretary JWT is refused (not a manual Moodle role)",
    await call("moodle-sync", regionalJwt, idOnly),
    403,
    "STAFF_REQUIRED",
  );
  // action=test with an admin JWT is not exercised here: it contacts Moodle when MOODLE_URL is configured.
  expectProcessed(
    "admin JWT reaches the sync path (nonexistent id, no Moodle contact)",
    await call("moodle-sync", adminJwt, idOnly),
  );
  expectProcessed(
    "service-role call (registration-processor and retry-worker contract) reaches the sync path",
    await call("moodle-sync", SERVICE_KEY, idOnly),
  );
} catch (err) {
  failures++;
  console.log(`  FAIL  setup: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  for (const id of created) await deleteUser(id);
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) Deno.exit(1);
