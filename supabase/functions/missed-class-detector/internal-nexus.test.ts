// Missed-class-detector → Nexus integration tests
// Replaces internal-clickup.test.ts; M1/M2 were ClickUp-specific (removed with invokeClickupSync).
//
// M3  task semantics preserved after ClickUp → Nexus migration
// M4  failure behavior remains non-throwing JSON response
// M5  no invokeClickupSync, no internal-secret ClickUp path
// M6  Nexus task created via ensureNexusTask, not direct HTTP to clickup-sync
// M7  Nexus auth is server-side (NEXUS_API_KEY from env, not caller identity)

import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("M3: missed-class-detector task semantics are preserved", () => {
  assert(source.includes('"missed_class"'),             "missed_class task type still present");
  assert(source.includes('"escalation"'),               "escalation task type still present");
  assert(source.includes("MISSED_CLASS_DETECTOR_SUMMARY"), "summary audit log still present");
});

Deno.test("M4: detector failure behavior remains a non-throwing JSON response, now with a non-2xx status", () => {
  // Was `return json({ ok: false, error: message }, 200)`: a scheduler read a failed run as success.
  // Behavioural proof: db-failure.test.ts (DD01-DD05).
  assert(source.includes("}, unavailable ? 503 : 500);"), "catch block returns JSON with 503/500, not throws and not 200");
  assertEquals(source.includes('return json({ ok: false, error: message }, 200);'), false, "the 200-on-failure line is gone");
});

Deno.test("M5: invokeClickupSync and internal-secret ClickUp path are removed", () => {
  assertEquals(source.includes("invokeClickupSync"),           false, "no invokeClickupSync function");
  assertEquals(source.includes("INTERNAL_INVOKE_SECRET"),      false, "no INTERNAL_INVOKE_SECRET in missed-class-detector");
  assertEquals(source.includes('"x-internal-secret"'),         false, "no x-internal-secret header");
  assertEquals(source.includes("/functions/v1/clickup-sync"),  false, "no clickup-sync URL");
});

Deno.test("M6: Nexus tasks created via ensureNexusTask from shared module", () => {
  assert(source.includes('from "../_shared/nexus-tasks.ts"'),  "imports from nexus-tasks shared module");
  assert(source.includes("ensureNexusTask(db,"),               "calls ensureNexusTask with db client");
});

Deno.test("M7: Nexus task credentials come from server-side env, not the caller", () => {
  assert(source.includes("nexusTaskConfigFromEnv()"), "task API config is read via nexusTaskConfigFromEnv (NEXUS_TASK_API_URL/KEY)");
  assertEquals(source.includes('Deno.env.get("NEXUS_API_KEY")'), false, "the users-API shared secret is not used for tasks");
  assertEquals(source.includes('req.headers.get("authorization")'), false,
    "caller auth header must not be forwarded to Nexus");
});
