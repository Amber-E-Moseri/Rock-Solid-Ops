import { assert, assertEquals } from "jsr:@std/assert@1";

// Source-contract checks for retry-worker. The handler calls Deno.serve at load time.
const raw = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const src = raw.replaceAll("\r\n", "\n");

Deno.test("no code path treats a missing Authorization header as a scheduler", () => {
  assert(!src.includes("isCronCall"), "isCronCall must be gone");
});

Deno.test("authorization runs before any body read or write", () => {
  const auth = src.indexOf("authorizeRetryRequest({");
  assert(auth > 0);
  assert(auth < src.indexOf("await req.json()"));
  assert(auth < src.indexOf("await applyRetry(serviceDb"));
  assert(auth < src.indexOf("await applyResolve(serviceDb"));
});

Deno.test("the Moodle hold runs before any retry write", () => {
  const hold = src.indexOf("planDirectRetry(action, source)");
  assert(hold > 0);
  assert(hold < src.indexOf("await applyRetry(serviceDb"));
});

Deno.test("the scheduled sweep is disabled", () => {
  assertEquals(src.includes("const SCHEDULED_SWEEP_ENABLED = false;"), true);
});
