/**
 * Authentication regression for privileged (service-role) Edge Functions.
 *
 * Loads each function's real handler in-process (Deno.serve is captured, or the
 * module's exported `handler` is used) and proves that unauthenticated and
 * forged-JWT callers are rejected BEFORE any database or external call.
 * SUPABASE_URL points at an unroutable address so a missed guard would fail
 * loudly instead of touching a real project.
 *
 * Caller contract under test (this branch's scheme, see _shared/auth.ts):
 *   - scheduled callers present  x-cron-secret      == CRON_INVOKE_SECRET
 *   - function-to-function calls present x-internal-secret == INTERNAL_INVOKE_SECRET
 *   - humans present a verified Supabase session + staff role
 * The service-role key and decoded JWT `role` claims are NOT credentials for the
 * cron/internal paths. class-selection notify_waitlisted is the one operator
 * action that still takes the exact service key (never a decoded claim).
 */
import { assertEquals } from "jsr:@std/assert@1";

const SERVICE_KEY = "regression-service-key";
const CRON_SECRET = "regression-cron-secret";
const INTERNAL_SECRET = "regression-internal-secret";
Deno.env.set("SUPABASE_URL", "http://127.0.0.1:9");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "regression-anon-key");
Deno.env.set("CRON_INVOKE_SECRET", CRON_SECRET);
Deno.env.set("INTERNAL_INVOKE_SECRET", INTERNAL_SECRET);
Deno.env.set("MOODLE_URL", "http://127.0.0.1:9");
Deno.env.set("MOODLE_TOKEN", "regression-moodle-token");

type Handler = (req: Request) => Promise<Response> | Response;

const cache = new Map<string, Handler>();

async function loadHandler(rel: string): Promise<Handler> {
  if (cache.has(rel)) return cache.get(rel)!;
  const realServe = Deno.serve;
  let captured: Handler | undefined;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (arg: unknown, maybe?: unknown) => {
    captured = (typeof arg === "function" ? arg : maybe) as Handler;
    return { finished: Promise.resolve(), shutdown: () => Promise.resolve() };
  };
  let mod: Record<string, unknown>;
  try {
    mod = await import(rel);
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).serve = realServe;
  }
  if (!captured && typeof mod.handler === "function") captured = mod.handler as Handler;
  if (!captured) throw new Error(`no handler captured for ${rel}`);
  cache.set(rel, captured);
  return captured;
}

const forgedJwt = `x.${btoa(JSON.stringify({ role: "service_role" }))}.y`;
const post = (headers: Record<string, string> = {}, body: unknown = {}) =>
  new Request("http://localhost/fn", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const BODY = { type: "escalation", report_type: "weekly" };

// Every privileged function below must reject callers presenting no credentials
// and callers presenting a forged (unsigned) service_role JWT.
const GUARDED = [
  "retry-worker",
  "moodle-sync",
  "moodle-grade-sync",
  "waitlist-processor",
  "student-engagement-monitor",
  "attendance-reminder",
  "review-checkin",
  "report-generator",
  "email-sender",
  "notification-batch-processor",
  "missed-class-detector",
  "attention-flag-push-sweep",
];

for (const fn of GUARDED) {
  Deno.test(`${fn}: no credentials → 401`, async () => {
    const h = await loadHandler(`../${fn}/index.ts`);
    const res = await h(post({}, BODY));
    assertEquals(res.status, 401);
    await res.body?.cancel();
  });

  Deno.test(`${fn}: forged service_role JWT → rejected (401/403)`, async () => {
    const h = await loadHandler(`../${fn}/index.ts`);
    const res = await h(post(bearer(forgedJwt), BODY));
    if (![401, 403].includes(res.status)) throw new Error(`${fn} returned ${res.status}`);
    await res.body?.cancel();
  });
}

// Cron-only entry points: neither the real service key nor a wrong cron secret
// may stand in for x-cron-secret.
const CRON_ONLY = [
  "moodle-sync",
  "student-engagement-monitor",
  "attendance-reminder",
  "review-checkin",
  "email-sender",
  "notification-batch-processor",
  "missed-class-detector",
  "attention-flag-push-sweep",
];

for (const fn of CRON_ONLY) {
  Deno.test(`${fn}: service-role key as bearer is not a cron credential → 401`, async () => {
    const h = await loadHandler(`../${fn}/index.ts`);
    const res = await h(post(bearer(SERVICE_KEY), BODY));
    assertEquals(res.status, 401);
    await res.body?.cancel();
  });

  Deno.test(`${fn}: wrong x-cron-secret → 401`, async () => {
    const h = await loadHandler(`../${fn}/index.ts`);
    const res = await h(post({ "x-cron-secret": "not-the-secret" }, BODY));
    assertEquals(res.status, 401);
    await res.body?.cancel();
  });
}

// Every function the cron cutover script targets (plus retry-worker, whose schedule is not in the
// repo) must ACCEPT the correct x-cron-secret: the guard passes and the handler proceeds (it then
// fails on the unroutable database or returns a business status, never 401/403).
const CRON_ACCEPTING = [
  ...CRON_ONLY,
  "retry-worker",
  "waitlist-processor",
  "moodle-grade-sync",
  "report-generator",
];

// A guard rejection returns immediately. A handler that is still running after the grace period
// has passed the guard and is working against the unroutable database, so "pending" = accepted.
// The orphaned handler is left to finish in the background (hence sanitizers off for these tests).
const GRACE_MS = 750;

for (const fn of CRON_ACCEPTING) {
  Deno.test({
    name: `${fn}: correct x-cron-secret passes the auth guard`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const h = await loadHandler(`../${fn}/index.ts`);
      const outcome = await Promise.race([
        Promise.resolve(h(post({ "x-cron-secret": CRON_SECRET }, { action: "drop_table", ...BODY })))
          .then((res) => ({ status: res.status }))
          .catch(() => ({ status: -1 })), // threw after auth: DB/network failure = past the guard
        new Promise<{ status: "pending" }>((r) => setTimeout(() => r({ status: "pending" }), GRACE_MS)),
      ]);
      if (outcome.status === 401 || outcome.status === 403) {
        throw new Error(`${fn} rejected the correct cron secret (${outcome.status})`);
      }
    },
  });
}

// ── class-selection notify_waitlisted: exact service key only ──
const NOTIFY = { action: "notify_waitlisted", fellowship_codes: ["X"], batch_id: "b" };

Deno.test("class-selection notify_waitlisted: forged service_role JWT → 401", async () => {
  const h = await loadHandler("../class-selection/index.ts");
  const res = await h(post(bearer(forgedJwt), NOTIFY));
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

Deno.test("class-selection notify_waitlisted: no Authorization → 401", async () => {
  const h = await loadHandler("../class-selection/index.ts");
  const res = await h(post({}, NOTIFY));
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

Deno.test("class-selection notify_waitlisted: exact service key passes the guard (400 on invalid input, no DB touched)", async () => {
  const h = await loadHandler("../class-selection/index.ts");
  const res = await h(post(bearer(SERVICE_KEY), { action: "notify_waitlisted" }));
  assertEquals(res.status, 400);
  const j = await res.json();
  assertEquals(j.code, "INVALID_INPUT");
});

// ── Input validation reached only by an authorised caller (no DB/network touched) ──
const internal = { "x-internal-secret": INTERNAL_SECRET };
const cron = { "x-cron-secret": CRON_SECRET };
const rawPost = (headers: Record<string, string>, raw: string) =>
  new Request("http://localhost/fn", { method: "POST", headers, body: raw });

// clickup-sync is a retired 410 tombstone (see clickup-sync/retired.test.ts); it has no writer behaviour left to guard.

Deno.test("retry-worker (cron secret): invalid action → 400", async () => {
  const h = await loadHandler("../retry-worker/index.ts");
  const res = await h(post(cron, { action: "drop_table" }));
  assertEquals(res.status, 400);
  const j = await res.json();
  assertEquals(j.code, "INVALID_ACTION");
});

Deno.test("retry-worker: internal secret is not a cron credential → 401", async () => {
  const h = await loadHandler("../retry-worker/index.ts");
  const res = await h(post(internal, { action: "drop_table" }));
  assertEquals(res.status, 401);
  await res.body?.cancel();
});
