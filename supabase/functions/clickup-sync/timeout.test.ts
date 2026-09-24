// C6 timeout tests — createNexusTaskWithBackoff per-attempt AbortController
//
// T21  NEXUS_TASK_TIMEOUT_MS constant is derived from NEXUS_TIMEOUT_MS env var
// T22  AbortController is constructed per attempt (inside the retry loop)
// T23  signal is passed to fetch
// T24  clearTimeout is called in a finally block (timer leak prevention)
// T25  timeout constant is module-level, not inlined

import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("T21: NEXUS_TASK_TIMEOUT_MS is read from NEXUS_TIMEOUT_MS env with 15 s default", () => {
  assert(
    source.includes('Deno.env.get("NEXUS_TIMEOUT_MS") || "15000"'),
    'NEXUS_TASK_TIMEOUT_MS must default to "15000" via NEXUS_TIMEOUT_MS env var',
  );
  assert(
    source.includes("const NEXUS_TASK_TIMEOUT_MS"),
    "NEXUS_TASK_TIMEOUT_MS must be a named module-level constant",
  );
});

Deno.test("T22: AbortController is constructed per-attempt inside the retry loop", () => {
  // The while loop and AbortController construction must appear in source order:
  // while ... { ... new AbortController() ... }
  const whileIdx = source.indexOf("while (attempt < 5)");
  const abortIdx = source.indexOf("new AbortController()", whileIdx);
  const closeLoopIdx = source.indexOf("throw new Error(lastError", whileIdx);
  assert(whileIdx > 0, "retry loop must exist");
  assert(abortIdx > whileIdx, "AbortController must be inside the retry loop");
  assert(abortIdx < closeLoopIdx, "AbortController must be before the loop ends");
});

Deno.test("T23: AbortController signal is passed to the fetch call", () => {
  assert(
    source.includes("signal: controller.signal"),
    "fetch must receive signal: controller.signal",
  );
});

Deno.test("T24: timer is cleared in a finally block to prevent leak", () => {
  // Verify finally { clearTimeout(timer); } appears after the fetch call
  const fetchIdx = source.indexOf("signal: controller.signal");
  const finallyIdx = source.indexOf("} finally {", fetchIdx);
  const clearIdx = source.indexOf("clearTimeout(timer)", fetchIdx);
  assert(finallyIdx > fetchIdx, "finally block must follow the fetch");
  assert(clearIdx > finallyIdx, "clearTimeout must be inside the finally block");
});

Deno.test("T25: timeout constant is module-level, not hardcoded inline", () => {
  // The fetch call must reference the named constant, not a literal number
  const fetchBlock = source.slice(
    source.indexOf("while (attempt < 5)"),
    source.indexOf("throw new Error(lastError"),
  );
  assertEquals(
    fetchBlock.includes("setTimeout(() => controller.abort(), 15000)"),
    false,
    "hardcoded 15000 must not appear inside the retry loop",
  );
  assert(
    fetchBlock.includes("setTimeout(() => controller.abort(), NEXUS_TASK_TIMEOUT_MS)"),
    "setTimeout must use the named NEXUS_TASK_TIMEOUT_MS constant",
  );
});
