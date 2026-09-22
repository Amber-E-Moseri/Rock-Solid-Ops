import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("R1: retry-worker sends x-internal-secret to clickup-sync", () => {
  assert(source.includes('Deno.env.get("INTERNAL_INVOKE_SECRET")'));
  assert(source.includes('"x-internal-secret": internalSecret'));
});

Deno.test("R2: retry-worker clickup caller does not send service-role bearer identity", () => {
  const fnStart = source.indexOf("async function triggerClickupEscalation");
  const fnEnd = source.indexOf("async function isAdmin", fnStart);
  const fn = source.slice(fnStart, fnEnd);
  assertEquals(fn.includes("Authorization"), false);
  assertEquals(fn.includes("apikey"), false);
  assertEquals(fn.includes("serviceKey"), false);
});

Deno.test("R3: retry-worker clickup endpoint is preserved", () => {
  assert(source.includes("${supabaseUrl}/functions/v1/clickup-sync"));
});

Deno.test("R4: retry-worker clickup failure semantics are preserved", () => {
  assert(source.includes("if (!res.ok) throw new Error"));
  assert(source.includes("RETRY_WORKER_CLICKUP_ESCALATION_ERROR"));
});
