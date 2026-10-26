// Isolated end-to-end tests for the Moodle containment patch. Runs the real moodle-sync and retry-worker
// handlers with an in-memory database and a stubbed Moodle endpoint. Nothing leaves the process.
//
// Run: deno test --import-map=supabase/tests/containment-e2e/import-map.json --allow-env --allow-read \
//        supabase/tests/containment-e2e/containment-e2e.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";

const SVC = "svc-test-key-0123456789abcdef";
Deno.env.set("SUPABASE_URL", "https://fake.supabase.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SVC);
Deno.env.set("MOODLE_URL", "https://moodle.test");
Deno.env.set("MOODLE_TOKEN", "moodle-test-token");

const ANON = "anon-public-key-not-secret";
const MOODLE_REPLIES: Record<string, unknown> = {
  core_webservice_get_site_info: { sitename: "Test Moodle", siteurl: "https://moodle.test" },
  core_user_get_users: { users: [] },
  core_user_create_users: [{ id: 501 }],
  enrol_manual_enrol_users: null,
};

function freshState() {
  return {
    tables: {
      profiles: [
        { user_id: "u-admin", email: "admin@test", role: "admin", is_active: true },
        { user_id: "u-teacher", email: "teacher@test", role: "teacher", is_active: true },
        { user_id: "u-inactive", email: "old@test", role: "admin", is_active: false },
      ],
      moodle_enrollment_sync: [] as Array<Record<string, any>>,
      failed_syncs: [] as Array<Record<string, any>>,
      email_queue: [{ id: "e-1", status: "Failed" }] as Array<Record<string, any>>,
      audit_logs: [] as Array<Record<string, any>>,
    } as Record<string, Array<Record<string, any>>>,
    jwts: {
      "jwt-admin": { id: "u-admin", email: "admin@test" },
      "jwt-teacher": { id: "u-teacher", email: "teacher@test" },
      "jwt-inactive": { id: "u-inactive", email: "old@test" },
    } as Record<string, { id: string; email?: string | null }>,
    log: [] as string[],
    moodleCalls: [] as string[],
  };
}

type State = ReturnType<typeof freshState>;
let state: State = freshState();
(globalThis as any).__fakeState = state;
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/webservice/rest/server.php")) {
    const fn = new URLSearchParams(String(init?.body ?? "")).get("wsfunction") ?? "";
    state.moodleCalls.push(fn);
    return new Response(JSON.stringify(MOODLE_REPLIES[fn] ?? null), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`unexpected outbound request in harness: ${url}`);
}) as typeof fetch;

// Both functions call Deno.serve at module load. Capture each handler as it registers.
const realServe = Deno.serve;
let captured: ((req: Request) => Promise<Response>) | null = null;
(Deno as any).serve = (h: any) => { captured = h; return {} as any; };
await import("../../functions/moodle-sync/index.ts");
const moodleSync = captured!;
captured = null;
await import("../../functions/retry-worker/index.ts");
const retryWorker = captured!;
(Deno as any).serve = realServe;

function req(path: "moodle" | "retry", body: unknown, auth?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth !== undefined) headers.authorization = auth;
  return new Request(`https://fake.supabase.test/functions/v1/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// Each test gets a fresh database and Moodle log.
function reset() {
  state = freshState();
  (globalThis as any).__fakeState = state;
}

async function call(path: "moodle" | "retry", body: unknown, auth?: string) {
  reset();
  const handler = path === "moodle" ? moodleSync : retryWorker;
  const res = await handler(req(path, body, auth));
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

const mutated = () =>
  state.log.filter((e) => e.startsWith("update:") || e.startsWith("insert:") || e.startsWith("rpc:"));

// ---------- moodle-sync: unauthorized paths (zero side effects) ----------

Deno.test("moodle-sync: missing Authorization is denied with zero DB or Moodle activity", async () => {
  const r = await call("moodle", { id: "row-1", limit: 1 });
  assertEquals([r.status, r.json.code], [401, "AUTH_REQUIRED"]);
  assertEquals(state.log, [], "no database operation at all, including the stuck-row reset");
  assertEquals(state.moodleCalls, []);
});

Deno.test("moodle-sync: an empty body with no credentials still touches nothing", async () => {
  const r = await call("moodle", {});
  assertEquals(r.status, 401);
  assertEquals(state.log, []);
  assertEquals(state.moodleCalls, []);
});

Deno.test("moodle-sync: anon-key bearer is denied for normal sync", async () => {
  const r = await call("moodle", { limit: 5 }, `Bearer ${ANON}`);
  assertEquals([r.status, r.json.code], [403, "SERVICE_ROLE_REQUIRED"]);
  assertEquals(state.log, []);
  assertEquals(state.moodleCalls, []);
});

Deno.test("moodle-sync: an unknown bearer is denied for normal sync", async () => {
  const r = await call("moodle", { id: "row-1" }, "Bearer not-a-real-token");
  assertEquals(r.status, 403);
  assertEquals(state.log, []);
});

Deno.test("moodle-sync: test action with an invalid bearer is denied with zero Moodle calls", async () => {
  const r = await call("moodle", { action: "test" }, "Bearer not-a-real-token");
  assertEquals(r.status, 401);
  assertEquals(state.moodleCalls, []);
  assertEquals(mutated(), []);
});

Deno.test("moodle-sync: test action with a non-admin profile is denied", async () => {
  const r = await call("moodle", { action: "test" }, "Bearer jwt-teacher");
  assertEquals([r.status, r.json.code], [401, "INVALID_SESSION"]);
  assertEquals(state.moodleCalls, []);
  assertEquals(mutated(), []);
});

Deno.test("moodle-sync: test action with an inactive admin profile is denied", async () => {
  const r = await call("moodle", { action: "test" }, "Bearer jwt-inactive");
  assertEquals(r.status, 401);
  assertEquals(state.moodleCalls, []);
});

Deno.test("moodle-sync: a normal sync with an admin JWT is refused (only service role syncs)", async () => {
  const r = await call("moodle", { limit: 5 }, "Bearer jwt-admin");
  assertEquals(r.status, 403);
  assertEquals(state.moodleCalls, []);
  assertEquals(mutated(), []);
});

// ---------- moodle-sync: authorized paths ----------

Deno.test("moodle-sync: test action succeeds for an active admin", async () => {
  const r = await call("moodle", { action: "test" }, "Bearer jwt-admin");
  assertEquals(r.status, 200);
  assertEquals(r.json.ok, true);
  assertEquals(state.moodleCalls, ["core_webservice_get_site_info"]);
});

Deno.test("moodle-sync: registration-processor's call (service key, {id, limit:1}) passes authorization", async () => {
  reset();
  state.tables.moodle_enrollment_sync.push({
    id: "row-1", email: "ok@test.com", full_name: "Ok Student", registration_status: "ASSIGNED",
    sync_status: "PENDING", sync_attempts: 0, retry_count: 0, updated_at: "2026-01-01T00:00:00Z",
  });
  const res = await moodleSync(req("moodle", { id: "row-1", limit: 1 }, `Bearer ${SVC}`));
  assert(res.status !== 401 && res.status !== 403, `service caller must pass auth, got ${res.status}`);
  assert(state.log.includes("claim-hit:moodle_enrollment_sync"), "authorized caller reaches the atomic claim");
});

// ---------- moodle-sync: concurrent claims ----------

Deno.test("moodle-sync: two concurrent runs cannot both claim the same row", async () => {
  reset();
  state.tables.moodle_enrollment_sync.push({
    id: "row-9", email: "dup@test.com", full_name: "Dup Student", registration_status: "ASSIGNED",
    sync_status: "PENDING", sync_attempts: 0, retry_count: 0, updated_at: "2026-01-01T00:00:00Z",
  });
  const body = { id: "row-9", limit: 1 };
  await Promise.all([
    moodleSync(req("moodle", body, `Bearer ${SVC}`)),
    moodleSync(req("moodle", body, `Bearer ${SVC}`)),
  ]);
  const hits = state.log.filter((e) => e === "claim-hit:moodle_enrollment_sync").length;
  assertEquals(hits, 1, "exactly one run wins the claim");
});

// ---------- retry-worker ----------

Deno.test("retry-worker: missing Authorization is refused, even for a Moodle retry", async () => {
  const r = await call("retry", { action: "retry", source: "moodle_enrollment_sync", id: "row-1" });
  assertEquals([r.status, r.json.code], [401, "AUTH_REQUIRED"]);
  assertEquals(state.log, []);
  assertEquals(state.moodleCalls, []);
});

Deno.test("retry-worker: anon-key bearer is refused", async () => {
  const r = await call("retry", { action: "resolve", source: "email_queue", id: "e-1" }, `Bearer ${ANON}`);
  assertEquals(r.status, 401);
  assertEquals(mutated(), []);
});

Deno.test("retry-worker: a non-admin profile is refused with zero writes", async () => {
  const r = await call("retry", { action: "resolve", source: "email_queue", id: "e-1" }, "Bearer jwt-teacher");
  assertEquals(r.status, 403);
  assertEquals(mutated(), []);
});

Deno.test("retry-worker: held Moodle retry causes no side effects", async () => {
  const r = await call("retry", { action: "retry", source: "moodle_enrollment_sync", id: "row-1" }, "Bearer jwt-admin");
  assertEquals([r.status, r.json.code], [409, "MOODLE_RETRY_HELD"]);
  // Approved contract: the refusal is audited, and it is the only write. No retry or Moodle row is touched.
  assertEquals(mutated(), ["insert:audit_logs"], "only the audited refusal may write");
  assert(state.tables.audit_logs.some((row) => JSON.stringify(row).includes("MOODLE_RETRY_HELD")));
  assertEquals(state.moodleCalls, []);
});

Deno.test("retry-worker: held Moodle retry by legacy source name is also refused", async () => {
  const r = await call("retry", { action: "retry", source: "moodle_sync", id: "row-1" }, "Bearer jwt-admin");
  assertEquals(r.status, 409);
  assertEquals(state.moodleCalls, []);
  assertEquals(mutated(), ["insert:audit_logs"], "only the audited refusal may write");
});

Deno.test("retry-worker: scheduled sweep stays disabled for an admin with no id", async () => {
  const r = await call("retry", { action: "retry", source: "moodle_enrollment_sync" }, "Bearer jwt-admin");
  assertEquals([r.status, r.json.code], [400, "MISSING_ID"]);
  assertEquals(state.moodleCalls, []);
  assertEquals(mutated(), []);
});

Deno.test("retry-worker: email_queue Resolve stays held (approved contract), with an audited refusal", async () => {
  const r = await call("retry", { action: "resolve", source: "email_queue", id: "e-1" }, "Bearer jwt-admin");
  assertEquals([r.status, r.json.code], [409, "EMAIL_RESOLVE_HELD"]);
  assert(!mutated().includes("update:email_queue"), "no email_queue write while Resolve is held");
  assertEquals(state.moodleCalls, []);
});

Deno.test("retry-worker: resolve for a non-Moodle, non-email source is unaffected by either hold", async () => {
  state.tables.failed_syncs.push({ id: "f-1", status: "Failed" });
  const r = await call("retry", { action: "resolve", source: "failed_syncs", id: "f-1" }, "Bearer jwt-admin");
  assertEquals(r.status, 200);
  assert(mutated().includes("update:failed_syncs"));
  assertEquals(state.moodleCalls, []);
});

// ---------- moodle-sync: stale PROCESSING rows and the connectivity test ----------

// Seeds the database, then calls the handler without the per-test reset, so the stale rows are visible to it.
async function callSeeded(body: unknown, auth: string, rows: Array<Record<string, any>>) {
  state = freshState();
  (globalThis as any).__fakeState = state;
  state.tables.moodle_enrollment_sync = rows;
  const res = await moodleSync(req("moodle", body, auth));
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

const STALE = "2020-01-01T00:00:00.000Z";
const staleRows = () => [
  { id: "p-1", sync_status: "PROCESSING", updated_at: STALE },
  { id: "p-2", sync_status: "PROCESSING", updated_at: STALE },
];
// Anything other than a read: the reads that authorization and the test action legitimately make.
const writes = () => state.log.filter((e) => !e.startsWith("select:") && !e.startsWith("auth."));

Deno.test("moodle-sync test action with stale PROCESSING rows: zero database writes, no reset audit", async () => {
  const r = await callSeeded({ action: "test" }, "Bearer jwt-admin", staleRows());
  assertEquals(r.status, 200);
  assertEquals(r.json.ok, true);
  assertEquals(writes(), [], "the connectivity test must not write, reset, audit or process");
  assert(!state.log.includes("insert:audit_logs"), "no MOODLE_SYNC_STUCK_RESET audit");
  assertEquals(state.tables.moodle_enrollment_sync.map((x) => x.sync_status), ["PROCESSING", "PROCESSING"]);
  assertEquals(state.moodleCalls, ["core_webservice_get_site_info"], "only the read-only connectivity request");
});

Deno.test("moodle-sync test action by service role with stale rows: still zero writes", async () => {
  const r = await callSeeded({ action: "test" }, `Bearer ${SVC}`, staleRows());
  assertEquals(r.status, 200);
  assertEquals(writes(), []);
  assertEquals(state.moodleCalls, ["core_webservice_get_site_info"]);
});

Deno.test("moodle-sync test action with a non-admin profile and stale rows: denied, zero writes", async () => {
  const r = await callSeeded({ action: "test" }, "Bearer jwt-teacher", staleRows());
  assertEquals([r.status, r.json.code], [401, "INVALID_SESSION"]);
  assertEquals(writes(), []);
  assertEquals(state.moodleCalls, []);
});

Deno.test("moodle-sync processing with an admin JWT and stale rows: refused, zero writes", async () => {
  const r = await callSeeded({ limit: 1 }, "Bearer jwt-admin", staleRows());
  assertEquals(r.status, 403);
  assertEquals(writes(), []);
  assertEquals(state.moodleCalls, []);
});

Deno.test("moodle-sync processing by service role still runs stuck-row recovery and its audit", async () => {
  const r = await callSeeded({ limit: 1 }, `Bearer ${SVC}`, staleRows());
  assert(r.status !== 401 && r.status !== 403, `service role must be authorized, got ${r.status}`);
  assert(mutated().includes("update:moodle_enrollment_sync"), "stale rows are reset for a processing run");
  assert(state.log.includes("insert:audit_logs"), "the reset is audited");
  assert(state.tables.audit_logs.some((row) => JSON.stringify(row).includes("MOODLE_SYNC_STUCK_RESET")));
});

Deno.test("cleanup: restore fetch", () => {
  globalThis.fetch = realFetch;
});
