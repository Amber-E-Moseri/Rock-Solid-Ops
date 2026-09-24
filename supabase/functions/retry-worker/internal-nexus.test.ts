// Retry-worker → Nexus integration tests
// Replaces internal-clickup.test.ts; R1/R2/R3 were ClickUp-specific.
//
// R4  failure semantics preserved (RETRY_WORKER_NEXUS_ESCALATION_ERROR)
// R5  no triggerClickupEscalation, no internal-secret ClickUp path
// R6  Nexus escalation via ensureNexusTask, not direct HTTP to clickup-sync
// R7  Nexus credentials are server-side env vars, not forwarded from caller
// R8  maybeEscalateMoodleFailure no longer requires supabaseUrl argument

import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("R4: retry-worker Nexus escalation error log name is correct", () => {
  assert(source.includes("RETRY_WORKER_NEXUS_ESCALATION_ERROR"),
    "escalation error log renamed to NEXUS variant");
  assertEquals(source.includes("RETRY_WORKER_CLICKUP_ESCALATION_ERROR"), false,
    "old ClickUp escalation error log name must be removed");
});

Deno.test("R5: triggerClickupEscalation and ClickUp HTTP path are removed", () => {
  assertEquals(source.includes("triggerClickupEscalation"),          false, "no triggerClickupEscalation");
  assertEquals(source.includes("INTERNAL_INVOKE_SECRET"),            false, "no INTERNAL_INVOKE_SECRET");
  // Note: "x-internal-secret" legitimately appears as a REJECTION gate (returns 401),
  // not as a send path — that is correct security behavior.
  assertEquals(source.includes("/functions/v1/clickup-sync"),        false, "no clickup-sync URL");
});

Deno.test("R6: Nexus escalation via ensureNexusTask from shared module", () => {
  assert(source.includes('from "../_shared/nexus-tasks.ts"'),        "imports from nexus-tasks shared module");
  assert(source.includes("ensureNexusTask(db,"),                     "calls ensureNexusTask with db client");
});

Deno.test("R7: Nexus credentials are read from env in maybeEscalateMoodleFailure", () => {
  const fnStart = source.indexOf("async function maybeEscalateMoodleFailure");
  assert(fnStart !== -1, "maybeEscalateMoodleFailure must exist");
  const fnSnippet = source.slice(fnStart, fnStart + 2000);
  assert(fnSnippet.includes('Deno.env.get("NEXUS_API_URL")'),        "NEXUS_API_URL read from env inside function");
  assert(fnSnippet.includes('Deno.env.get("NEXUS_API_KEY")'),        "NEXUS_API_KEY read from env inside function");
});

Deno.test("R8: maybeEscalateMoodleFailure signature no longer takes supabaseUrl", () => {
  const fnStart = source.indexOf("async function maybeEscalateMoodleFailure");
  const fnEnd = source.indexOf("{", fnStart);
  const signature = source.slice(fnStart, fnEnd);
  assertEquals(signature.includes("supabaseUrl"), false,
    "supabaseUrl parameter must be removed from maybeEscalateMoodleFailure");
});
