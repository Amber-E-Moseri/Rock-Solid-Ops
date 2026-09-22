import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("M1: missed-class-detector sends x-internal-secret to clickup-sync", () => {
  assert(source.includes('Deno.env.get("INTERNAL_INVOKE_SECRET")'));
  assert(source.includes('"x-internal-secret": internalSecret'));
});

Deno.test("M2: missed-class-detector clickup caller does not send service-role bearer identity", () => {
  const fnStart = source.indexOf("async function invokeClickupSync");
  const fnEnd = source.indexOf("async function logAudit", fnStart);
  const fn = source.slice(fnStart, fnEnd);
  assertEquals(fn.includes("Authorization"), false);
  assertEquals(fn.includes("apikey"), false);
  assertEquals(fn.includes("serviceKey"), false);
});

Deno.test("M3: detector task semantics are preserved", () => {
  assert(source.includes('type: "missed_class"'));
  assert(source.includes('type: "escalation"'));
  assert(source.includes("MISSED_CLASS_DETECTOR_SUMMARY"));
});

Deno.test("M4: detector failure behavior remains non-throwing response", () => {
  assert(source.includes('return json({ ok: false, error: message }, 200);'));
});
