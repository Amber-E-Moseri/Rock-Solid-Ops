// moodle-grade-sync: PostgREST query builders must never be chained with .catch().
//
// The Supabase builder is thenable but has NO .catch(); `builder.catch(...)` throws
// "catch is not a function" (and the un-awaited query is never sent). Two call sites did this:
//   1. the non-fatal "Course completed" admin notification after a milestone is recorded, and
//   2. the "grade sync unavailable" flag on moodle_enrollment_sync.
// Only the network edges (PostgREST + Moodle) are stubbed; the real handler and real supabase-js run.
import { assert, assertEquals } from "jsr:@std/assert@1";

const CRON = "grade-sync-test-cron-secret";
Deno.env.set("SUPABASE_URL", "http://pgrst.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("CRON_INVOKE_SECRET", CRON);
Deno.env.set("INTERNAL_INVOKE_SECRET", "test-internal-secret");
Deno.env.set("MOODLE_URL", "http://moodle.test");
Deno.env.set("MOODLE_TOKEN", "test-moodle-token");

type Handler = (req: Request) => Promise<Response> | Response;
let handler: Handler | undefined;
{
  const realServe = Deno.serve;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (arg: unknown) => { handler = arg as Handler; return { finished: Promise.resolve(), shutdown: () => Promise.resolve() }; };
  try { await import("./index.ts"); } finally { /* deno-lint-ignore no-explicit-any */ (Deno as any).serve = realServe; }
}
if (!handler) throw new Error("handler not captured");

type Calls = { method: string; path: string; body: unknown }[];

function installNetwork(moodleGrade: "ok" | "invalidfunction") {
  const calls: Calls = [];
  const realFetch = globalThis.fetch;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method || "GET").toUpperCase();
    let body: unknown = init?.body ?? null;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { /* form body */ } }

    if (url.host === "moodle.test") {
      const form = new URLSearchParams(String(init?.body ?? ""));
      const fn = form.get("wsfunction");
      calls.push({ method: "MOODLE", path: String(fn), body: null });
      if (fn === "core_completion_get_course_completion_status") return json(200, { completionstatus: { completed: true } });
      if (moodleGrade === "invalidfunction") return json(200, { exception: "moodle_exception", errorcode: "invalidfunction", message: "invalidfunction" });
      return json(200, { usergrades: [{ gradeitems: [{ id: 1, itemname: "Quiz 1", graderaw: "80", grademax: "100", itemtype: "mod" }, { id: 2, itemname: "Course total", graderaw: "80", grademax: "100", itemtype: "course" }] }] });
    }

    // PostgREST
    const table = url.pathname.replace("/rest/v1/", "");
    calls.push({ method, path: table, body });
    const wantsObject = String((init?.headers as Record<string, string>)?.["Accept"] ?? new Headers(init?.headers).get("accept") ?? "").includes("vnd.pgrst.object");
    if (method === "GET") {
      if (table === "moodle_enrollment_sync") return json(200, [{ id: "r1", email: "a@example.test", moodle_user_id: 5, course_id: 7, batch_id: "B1", class_option_id: null }]);
      if (table === "applicants") return json(200, wantsObject ? { id: "A1", full_name: "Ada", email: "a@example.test" } : [{ id: "A1", full_name: "Ada", email: "a@example.test" }]);
      if (table === "student_milestone_status") return wantsObject ? json(406, { code: "PGRST116", message: "no rows", details: null, hint: null }) : json(200, []);
      return json(200, []);
    }
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

const call = () => handler!(new Request("http://localhost/fn", { method: "POST", headers: { "x-cron-secret": CRON, "Content-Type": "application/json" }, body: "{}" }));

Deno.test("GS01: a newly completed student still gets the admin notification and their grades synced (no builder .catch)", async () => {
  const net = installNetwork("ok");
  try {
    const res = await call();
    const out = await res.json();
    assertEquals(out.ok, true);
    assertEquals(out.errors, [], `no per-row errors expected, got ${JSON.stringify(out.errors)}`);
    assertEquals(out.newly_completed, 1);
    assert(net.calls.some((c) => c.method === "POST" && c.path === "in_app_notifications"), "the notification insert must actually be sent");
    assert(net.calls.some((c) => c.method === "POST" && c.path === "student_grades"), "grade sync must run after the milestone");
    assert(out.grades_synced >= 1, `grades_synced=${out.grades_synced}`);
  } finally { net.restore(); }
});

Deno.test("GS02: 'grade sync unavailable' flags the enrollment row (the update is actually sent)", async () => {
  const net = installNetwork("invalidfunction");
  try {
    const res = await call();
    const out = await res.json();
    assertEquals(out.ok, true);
    const patch = net.calls.find((c) => c.method === "PATCH" && c.path === "moodle_enrollment_sync");
    assert(patch, "the grade_sync_available update must be sent to PostgREST");
    assertEquals((patch!.body as Record<string, unknown>).grade_sync_available, false);
    assertEquals(out.errors, [], `the flag update must not leak a TypeError into errors: ${JSON.stringify(out.errors)}`);
    assertEquals(out.grades_errors.length, 1);
  } finally { net.restore(); }
});
