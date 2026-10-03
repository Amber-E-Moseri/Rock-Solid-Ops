/**
 * Authentication regression for service-role Edge Functions.
 *
 * Loads each function's real handler in-process (Deno.serve is captured) and
 * proves that unauthenticated and forged-JWT callers are rejected BEFORE any
 * database or external call. SUPABASE_URL points at an unroutable address so a
 * missed guard would fail loudly instead of touching a real project.
 */
import { assertEquals } from "jsr:@std/assert@1";

const SERVICE_KEY = "regression-service-key";
Deno.env.set("SUPABASE_URL", "http://127.0.0.1:9");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "regression-anon-key");
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
  try {
    await import(rel);
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).serve = realServe;
  }
  if (!captured) throw new Error(`no handler captured for ${rel}`);
  cache.set(rel, captured);
  return captured;
}

const forgedJwt = `x.${btoa(JSON.stringify({ role: "service_role" }))}.y`;
const post = (auth?: string, body: unknown = {}) =>
  new Request("http://localhost/fn", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  });

const GUARDED = [
  "retry-worker",
  "moodle-sync",
  "moodle-grade-sync",
  "waitlist-processor",
  "student-engagement-monitor",
  "attendance-reminder",
  "review-checkin",
  "report-generator",
  "clickup-sync",
];

for (const fn of GUARDED) {
  Deno.test(`${fn}: no Authorization header → 401`, async () => {
    const h = await loadHandler(`../${fn}/index.ts`);
    const res = await h(post(undefined, { type: "escalation", report_type: "weekly" }));
    assertEquals(res.status, 401);
    await res.body?.cancel();
  });

  Deno.test(`${fn}: forged service_role JWT → rejected (401/403)`, async () => {
    const h = await loadHandler(`../${fn}/index.ts`);
    const res = await h(post(`Bearer ${forgedJwt}`, { type: "escalation", report_type: "weekly" }));
    if (![401, 403].includes(res.status)) throw new Error(`${fn} returned ${res.status}`);
    await res.body?.cancel();
  });
}

Deno.test("class-selection notify_waitlisted: forged service_role JWT → 401", async () => {
  const h = await loadHandler("../class-selection/index.ts");
  const res = await h(post(`Bearer ${forgedJwt}`, { action: "notify_waitlisted", fellowship_codes: ["X"], batch_id: "b" }));
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

Deno.test("class-selection notify_waitlisted: no Authorization → 401", async () => {
  const h = await loadHandler("../class-selection/index.ts");
  const res = await h(post(undefined, { action: "notify_waitlisted", fellowship_codes: ["X"], batch_id: "b" }));
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

// ── Input validation reached only by an authorised caller (no DB/network touched) ──
const svc = `Bearer ${SERVICE_KEY}`;
const rawPost = (auth: string, raw: string) =>
  new Request("http://localhost/fn", { method: "POST", headers: { Authorization: auth }, body: raw });

Deno.test("clickup-sync (service key): empty body → 400, malformed JSON → 400, bad type → 400", async () => {
  const h = await loadHandler("../clickup-sync/index.ts");
  for (const r of [post(svc, {}), rawPost(svc, "{not json"), post(svc, { type: "bogus" })]) {
    const res = await h(r);
    assertEquals(res.status, 400);
    const j = await res.json();
    assertEquals(j.ok, false);
    assertEquals(JSON.stringify(j).includes("stack"), false);
  }
});

Deno.test("clickup-sync: non-POST → 405", async () => {
  const h = await loadHandler("../clickup-sync/index.ts");
  const res = await h(new Request("http://localhost/fn", { method: "GET", headers: { Authorization: svc } }));
  assertEquals(res.status, 405);
  await res.body?.cancel();
});

Deno.test("retry-worker (service key): invalid action → 400", async () => {
  const h = await loadHandler("../retry-worker/index.ts");
  const res = await h(post(svc, { action: "drop_table" }));
  assertEquals(res.status, 400);
  const j = await res.json();
  assertEquals(j.code, "INVALID_ACTION");
});
