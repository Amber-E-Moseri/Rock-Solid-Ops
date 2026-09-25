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

Deno.test("M4: detector failure behavior remains non-throwing JSON response", () => {
  assert(source.includes('return json({ ok: false, error: message }, 200);'),
    "catch block returns JSON, not throws");
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

Deno.test("M7: Nexus credentials are read from env, not forwarded from caller", () => {
  assert(source.includes('Deno.env.get("NEXUS_API_URL")'),     "NEXUS_API_URL read from Deno.env");
  assert(source.includes('Deno.env.get("NEXUS_API_KEY")'),     "NEXUS_API_KEY read from Deno.env");
  assertEquals(source.includes('req.headers.get("authorization")'), false,
    "caller auth header must not be forwarded to Nexus");
});
