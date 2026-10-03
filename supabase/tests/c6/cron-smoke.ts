/**
 * Cron function smoke test against a REAL test database.
 *
 * Loads each scheduled handler in-process and sends five credential variants:
 *   no auth | wrong x-cron-secret | service-role bearer | forged {"role":"service_role"} JWT | correct x-cron-secret
 * The first four must be rejected (401/403) BEFORE any work; the last must pass authentication and be allowed to run
 * against the test database. Resend/Moodle/Nexus variables are removed so no real communication can leave the process.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (local test stack).
 * Run: deno run --allow-net --allow-env --allow-read supabase/tests/c6/cron-smoke.ts
 */
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!SERVICE_KEY || !Deno.env.get("SUPABASE_URL")) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required"); Deno.exit(1); }
const CRON = "smoke-cron-secret-" + crypto.randomUUID();
Deno.env.set("CRON_INVOKE_SECRET", CRON);
Deno.env.set("INTERNAL_INVOKE_SECRET", "smoke-internal-" + crypto.randomUUID());
for (const k of ["RESEND_API_KEY", "MOODLE_URL", "MOODLE_TOKEN", "NEXUS_API_URL", "NEXUS_API_KEY", "NEXUS_TASK_API_URL", "NEXUS_TASK_API_KEY"]) Deno.env.delete(k);

type Handler = (req: Request) => Promise<Response> | Response;
const cache = new Map<string, Handler>();
async function load(fn: string): Promise<Handler> {
  if (cache.has(fn)) return cache.get(fn)!;
  const realServe = Deno.serve; let captured: Handler | undefined;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (a: unknown, b?: unknown) => { captured = (typeof a === "function" ? a : b) as Handler; return { finished: Promise.resolve(), shutdown: () => Promise.resolve() }; };
  let mod: Record<string, unknown>;
  try { mod = await import(`../../functions/${fn}/index.ts`); } finally { /* deno-lint-ignore no-explicit-any */ (Deno as any).serve = realServe; }
  if (!captured && typeof mod.handler === "function") captured = mod.handler as Handler;
  if (!captured) throw new Error(`no handler for ${fn}`);
  cache.set(fn, captured); return captured;
}

const FUNCTIONS = [
  "retry-worker", "email-sender", "notification-batch-processor", "missed-class-detector", "attention-flag-push-sweep",
  "review-checkin", "student-engagement-monitor", "waitlist-processor", "report-generator", "moodle-grade-sync",
  "attendance-reminder", "moodle-sync",
];
const forged = `x.${btoa(JSON.stringify({ role: "service_role" }))}.y`;
const post = (h: Record<string, string>, body: unknown = { report_type: "weekly_regional" }) =>
  new Request("http://localhost/fn", { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(body) });

const variants: Array<[string, Record<string, string>, boolean]> = [
  ["no auth", {}, false],
  ["wrong secret", { "x-cron-secret": "not-the-secret" }, false],
  ["service-role bearer", { Authorization: `Bearer ${SERVICE_KEY}` }, false],
  ["forged service_role JWT", { Authorization: `Bearer ${forged}` }, false],
  ["correct x-cron-secret", { "x-cron-secret": CRON }, true],
];

let fail = 0;
console.log("function | no auth | wrong secret | service bearer | forged JWT | correct secret");
for (const fn of FUNCTIONS) {
  const h = await load(fn);
  const cells: string[] = []; let ok = true;
  for (const [name, headers, shouldPass] of variants) {
    let status: number | string;
    try {
      const res = await Promise.race([
        Promise.resolve(h(post(headers))).then((r) => r.status),
        new Promise<string>((r) => setTimeout(() => r("running"), 20000)),
      ]);
      status = res;
    } catch (e) { status = shouldPass ? "ran-then-threw" : `threw:${String(e).slice(0, 30)}`; }
    const rejected = status === 401 || status === 403;
    const good = shouldPass ? !rejected : rejected;
    if (!good) { ok = false; fail++; }
    cells.push(`${status}${good ? "" : " ✗"}`);
    void name;
  }
  console.log(`${ok ? "PASS" : "FAIL"} | ${fn} | ${cells.join(" | ")}`);
}
console.log(`SUMMARY: ${FUNCTIONS.length} functions x ${variants.length} variants = ${FUNCTIONS.length * variants.length} checks, ${fail} FAIL`);
Deno.exit(fail ? 1 : 0);
