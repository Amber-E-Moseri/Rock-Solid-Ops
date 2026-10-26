// Nexus Layer 2 requirements and retry-worker auth regressions.
//
// These are NOT Layer 1 unit tests. The Layer 1 suites (nexus-tasks, nexus-reconcile, nexus-assignment,
// nexus-assignee-policy, nexus-persistence, nexus-idempotency) test pure shared modules only.
//
// Cases marked GATED read function sources and assert that Nexus task creation is wired into the existing
// Edge Functions (missed-class-detector, retry-worker). They cannot pass until Layer 2 is integrated, so they
// are skipped unless NEXUS_LAYER2_WIRING=true. Coverage is preserved here, not deleted.
//
// Cases marked ACTIVE pass on the current approved retry-worker and always run.
//
// Coverage map (the eight Layer 2/auth cases from the C6 branch):
//   NT09  missed-class-detector imports nexus-tasks            -> GATED L2-NT09
//   NT10  retry-worker imports nexus-tasks                      -> GATED L2-NT10
//   NT11  no clickup-sync call from missed-class-detector       -> GATED L2-NT11
//   NT12  no clickup-sync call from retry-worker                -> GATED L2-NT12
//   NT14  retry-worker authorization unchanged                  -> ACTIVE AUTH-NT14 (approved model, see below)
//   NT15  escalation error log renamed to NEXUS                 -> GATED L2-NT15
//         (NT15 Moodle eligibility half stays ACTIVE in nexus-tasks.test.ts)
//   RC20  retry-worker reconciles before the sweep              -> GATED L2-RC20
//   ID15  retry-worker authorization structure unchanged        -> ACTIVE AUTH-ID15 (approved model, see below)
//
// Auth substitution, deliberate: the C6 branch's retry-worker auth model (validateCronAuth, x-cron-secret,
// serviceDb.auth.getUser) is NOT adopted. The approved model on main is authorizeRetryRequest() gating the handler
// before any work, with resolveRetryAdmin() as the admin check. NT14 and ID15 therefore assert the approved model,
// and AUTH-NEG asserts the C6 model is absent. Layer 2 must keep the approved model.
//
// Run the gated cases with:  NEXUS_LAYER2_WIRING=true deno test --allow-read --allow-env <this file>

import { assert, assertEquals } from "jsr:@std/assert@1";

const LAYER2 = Deno.env.get("NEXUS_LAYER2_WIRING") === "true";

const missedSrc = () => Deno.readTextFile(new URL("../missed-class-detector/index.ts", import.meta.url));
const retrySrc = () => Deno.readTextFile(new URL("../retry-worker/index.ts", import.meta.url));

// ── GATED: Layer 2 wiring ────────────────────────────────────────────────────

Deno.test({
  name: "L2-NT09: missed-class-detector imports ensureNexusTask from _shared/nexus-tasks",
  ignore: !LAYER2,
  fn: async () => {
    const src = await missedSrc();
    assert(src.includes('from "../_shared/nexus-tasks.ts"'), "missed-class-detector must import from nexus-tasks.ts");
    assert(src.includes("ensureNexusTask("), "missed-class-detector must call ensureNexusTask");
  },
});

Deno.test({
  name: "L2-NT10: retry-worker imports ensureNexusTask from _shared/nexus-tasks",
  ignore: !LAYER2,
  fn: async () => {
    const src = await retrySrc();
    assert(src.includes('from "../_shared/nexus-tasks.ts"'), "retry-worker must import from nexus-tasks.ts");
    assert(src.includes("ensureNexusTask("), "retry-worker must call ensureNexusTask");
  },
});

Deno.test({
  name: "L2-NT11: no clickup-sync HTTP invocation from missed-class-detector",
  ignore: !LAYER2,
  fn: async () => {
    const src = await missedSrc();
    assertEquals(src.includes("/functions/v1/clickup-sync"), false, "no clickup-sync URL in missed-class-detector");
    assertEquals(src.includes("invokeClickupSync"), false, "invokeClickupSync function must be removed");
    assertEquals(src.includes('"x-internal-secret": internalSecret'), false, "no internal-secret clickup pathway in missed-class-detector");
  },
});

Deno.test({
  name: "L2-NT12: no clickup-sync HTTP invocation from retry-worker",
  ignore: !LAYER2,
  fn: async () => {
    const src = await retrySrc();
    assertEquals(src.includes("/functions/v1/clickup-sync"), false, "no clickup-sync URL in retry-worker");
    assertEquals(src.includes("triggerClickupEscalation"), false, "triggerClickupEscalation function must be removed");
  },
});

Deno.test({
  name: "L2-NT15: retry-worker escalation error log is renamed to NEXUS",
  ignore: !LAYER2,
  fn: async () => {
    const src = await retrySrc();
    assert(src.includes("RETRY_WORKER_NEXUS_ESCALATION_ERROR"), "escalation error log renamed to NEXUS");
  },
});

Deno.test({
  // Anchor note: "if (isCronCall && !id)" is a C6 retry-worker construct. When Layer 2 is integrated, re-anchor this
  // assertion to the approved retry-worker's manual/sweep branch. The ordering requirement (reconcile before any
  // sweep or escalation) is what must be preserved.
  name: "L2-RC20: retry-worker reconciles BEFORE any step of the cron sweep that could reach ensureNexusTask",
  ignore: !LAYER2,
  fn: async () => {
    const src = await retrySrc();
    const handlerStart = src.indexOf("Deno.serve(");
    const reconcileAt = src.indexOf("reconcileUnknownNexusTasks(serviceDb", src.indexOf("if (isCronCall && !id)", handlerStart));
    const sweepAt = src.indexOf("sweepMoodleEnrollmentRetries(serviceDb, limit)", handlerStart);
    assert(reconcileAt > 0 && sweepAt > 0 && reconcileAt < sweepAt, "reconcile must precede the sweep/escalation");
    assert(src.includes('"reconcile_nexus"'), "explicit operator action present");
    assert(src.includes("NEXUS_RECONCILE_ERROR"), "a reconcile failure must not break the sweep");
  },
});

// ── ACTIVE: retry-worker auth on the approved model ──────────────────────────

Deno.test("AUTH-NT14: retry-worker gates every request through authorizeRetryRequest before any work (approved model)", async () => {
  const src = await retrySrc();
  assert(src.includes('from "../_shared/retry-authorization.ts"'), "authorizeRetryRequest imported from retry-authorization");
  const gateAt = src.indexOf("await authorizeRetryRequest({");
  const sweepAt = src.indexOf("sweepMoodleEnrollmentRetries(serviceDb, limit)");
  assert(gateAt > 0, "authorizeRetryRequest gate present");
  assert(sweepAt > gateAt, "auth gate precedes the sweep");
  assert(src.includes("if (!authDecision.ok)"), "denied requests return before any work");
});

Deno.test("AUTH-ID15: admin resolution uses resolveRetryAdmin; denial is ADMIN_REQUIRED (approved model)", async () => {
  const src = await retrySrc();
  assert(src.includes("resolveRetryAdmin(serviceDb"), "admin check resolved via resolveRetryAdmin");
  const auth = await Deno.readTextFile(new URL("../_shared/retry-authorization.ts", import.meta.url));
  assert(auth.includes('code: "ADMIN_REQUIRED"'), "non-admin callers receive ADMIN_REQUIRED");
  assert(auth.includes("Admin access required"), "admin error message preserved");
});

Deno.test("AUTH-NEG: the older C6 cron-auth model is not present in retry-worker", async () => {
  const src = await retrySrc();
  assertEquals(src.includes("validateCronAuth"), false, "C6 validateCronAuth model must not be adopted");
  assertEquals(src.includes('req.headers.has("x-cron-secret")'), false, "C6 x-cron-secret path must not be adopted");
});
