import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("G1: registration-processor sends x-internal-secret to waitlist-processor", () => {
  assert(source.includes('Deno.env.get("INTERNAL_INVOKE_SECRET")'));
  assert(source.includes('"x-internal-secret": internalSecret'));
});

Deno.test("G2: registration waitlist caller does not send service-role bearer identity", () => {
  const callStart = source.indexOf("/functions/v1/waitlist-processor");
  const call = source.slice(Math.max(0, callStart - 500), callStart + 800);
  assertEquals(call.includes("Authorization"), false);
  assertEquals(call.includes("Bearer"), false);
  assertEquals(call.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
});

Deno.test("G3/G4/G5: registration core semantics remain present", () => {
  assert(source.includes("insert_applicant_reserve_slot"));
  assert(source.includes("assignApplicant("));
  assert(source.includes('event_type: "MOODLE_SYNC_REQUESTED"'));
  assert(source.includes("REGISTRATION_RECEIVED"));
});

Deno.test("G6: waitlist trigger remains fire-and-forget", () => {
  assert(source.includes("void fetch(`${SUPABASE_URL}/functions/v1/waitlist-processor`"));
  assert(source.includes(".catch(() => {})"));
});
