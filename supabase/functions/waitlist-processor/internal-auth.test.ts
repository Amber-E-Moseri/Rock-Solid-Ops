import { assert } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("W1: waitlist-processor accepts internal auth path", () => {
  assert(source.includes('import { validateInternalAuth } from "../_shared/auth.ts";'));
  assert(source.includes('req.headers.has("x-internal-secret")'));
  assert(source.includes("validateInternalAuth(req)"));
});

Deno.test("W2/W3: wrong internal auth returns before processing", () => {
  const authIndex = source.indexOf("const internalFailure = validateInternalAuth(req)");
  const bodyIndex = source.indexOf("const body = await req.json()");
  assert(authIndex > 0);
  assert(bodyIndex > authIndex);
});

Deno.test("W4: existing non-internal path remains for E2", () => {
  assert(source.includes("if (body.class_option_id && body.batch_id)"));
  assert(source.includes("sb.from(\"batches\")"));
});
