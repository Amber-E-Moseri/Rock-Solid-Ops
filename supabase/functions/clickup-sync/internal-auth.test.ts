import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("C1: clickup-sync imports internal auth helper", () => {
  assert(source.includes('import { validateInternalAuth } from "../_shared/auth.ts";'));
});

Deno.test("C2: valid internal secret path is distinct from bearer user path", () => {
  assert(source.includes('req.headers.has("x-internal-secret")'));
  assert(source.includes("validateInternalAuth(req)"));
  assert(source.includes('actorEmail: "internal-service@system"'));
});

Deno.test("C3: missing both internal and bearer auth is rejected", () => {
  assert(source.includes('if (!authHeader.startsWith("Bearer ")) return { ok: false, reason: "Missing bearer token" };'));
});

Deno.test("C4: user/admin auth path remains present", () => {
  assert(source.includes("db.auth.getUser(token)"));
  assert(source.includes("await isAdmin(db, userData.user.id, userData.user.email)"));
});

Deno.test("C5: service-role bearer shortcuts are removed", () => {
  assertEquals(source.includes("token === serviceKey"), false);
  assertEquals(source.includes('claims?.role === "service_role"'), false);
});

Deno.test("C6: authorization happens before task/database work", () => {
  const authIndex = source.indexOf("const auth = await ensureAuthorized");
  const parseIndex = source.indexOf("const body = (await req.json()");
  const upsertIndex = source.indexOf('await db.from("rocksolid_task_links").upsert');
  assert(authIndex > 0);
  assert(parseIndex > authIndex);
  assert(upsertIndex > authIndex);
});
