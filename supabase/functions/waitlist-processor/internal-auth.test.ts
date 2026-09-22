import { assert } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("W1: waitlist-processor accepts internal auth path", () => {
  assert(source.includes('import { validateCronAuth, validateInternalAuth } from "../_shared/auth.ts";'));
  assert(source.includes('req.headers.has("x-internal-secret")'));
  assert(source.includes("validateInternalAuth(req)"));
});

Deno.test("W2/W3: wrong internal auth returns before processing", () => {
  const authIndex = source.indexOf("return validateInternalAuth(req)");
  const bodyIndex = source.indexOf("const body = await req.json()");
  assert(authIndex > 0);
  assert(bodyIndex > authIndex);
});

Deno.test("W4: explicit cron and user paths are present", () => {
  assert(source.includes('req.headers.has("x-cron-secret")'));
  assert(source.includes("validateCronAuth(req)"));
  assert(source.includes("serviceDb.auth.getUser(token)"));
  assert(source.includes("isAuthorizedStaff(serviceDb"));
});

Deno.test("W5: missing credentials are rejected before processing", () => {
  const rejectIndex = source.indexOf('"Missing credentials"');
  const bodyIndex = source.indexOf("const body = await req.json()");
  assert(rejectIndex > 0);
  assert(bodyIndex > rejectIndex);
});

Deno.test("W6: waitlist business path remains", () => {
  assert(source.includes("if (body.class_option_id && body.batch_id)"));
  assert(source.includes("sb.from(\"batches\")"));
});
