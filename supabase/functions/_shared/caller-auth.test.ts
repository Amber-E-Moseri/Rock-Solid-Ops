import { assertEquals } from "jsr:@std/assert@1";
import { authorizeCaller, isServiceRoleToken, timingSafeEqual } from "./caller-auth.ts";

const SERVICE = "service-key-for-tests";

// Forged JWT whose payload claims role=service_role but is NOT the service key.
const forged = `x.${btoa(JSON.stringify({ role: "service_role" }))}.y`;

const req = (auth?: string) =>
  new Request("http://localhost/fn", { method: "POST", headers: auth ? { Authorization: auth } : {} });

function fakeDb(user: { id: string; email: string } | null, profile: Record<string, unknown> | null) {
  return {
    auth: { getUser: (_t: string) => Promise.resolve({ data: { user }, error: user ? null : new Error("bad") }) },
    from: (_t: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: profile }) }) }),
    }),
  };
}

Deno.test("timingSafeEqual: equal / unequal / length mismatch", () => {
  assertEquals(timingSafeEqual("abc", "abc"), true);
  assertEquals(timingSafeEqual("abc", "abd"), false);
  assertEquals(timingSafeEqual("abc", "abcd"), false);
});

Deno.test("isServiceRoleToken rejects empty token and empty configured key", () => {
  assertEquals(isServiceRoleToken("", ""), false);
  assertEquals(isServiceRoleToken("x", ""), false);
  assertEquals(isServiceRoleToken(SERVICE, SERVICE), true);
});

Deno.test("no Authorization header → 401 (no implicit cron bypass)", async () => {
  const r = await authorizeCaller(req(), fakeDb(null, null), SERVICE, { allowStaff: true });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 401);
});

Deno.test("forged service_role JWT is rejected", async () => {
  const r = await authorizeCaller(req(`Bearer ${forged}`), fakeDb(null, null), SERVICE, { allowStaff: false });
  assertEquals(r.ok, false);
  const r2 = await authorizeCaller(req(`Bearer ${forged}`), fakeDb(null, null), SERVICE, { allowStaff: true });
  assertEquals(r2.ok, false);
  if (!r2.ok) assertEquals(r2.status, 401);
});

Deno.test("exact service key accepted", async () => {
  const r = await authorizeCaller(req(`Bearer ${SERVICE}`), fakeDb(null, null), SERVICE);
  assertEquals(r.ok && r.kind, "service");
});

Deno.test("service-only mode rejects a valid staff session", async () => {
  const db = fakeDb({ id: "u1", email: "a@x" }, { role: "admin", is_active: true });
  const r = await authorizeCaller(req("Bearer user-jwt"), db, SERVICE);
  assertEquals(r.ok, false);
});

Deno.test("staff mode: admin ok; teacher / inactive / missing profile forbidden", async () => {
  const user = { id: "u1", email: "a@x" };
  const ok = await authorizeCaller(req("Bearer j"), fakeDb(user, { role: "admin", is_active: true }), SERVICE, { allowStaff: true });
  assertEquals(ok.ok && ok.kind, "staff");
  for (const p of [{ role: "teacher", is_active: true }, { role: "admin", is_active: false }, null]) {
    const r = await authorizeCaller(req("Bearer j"), fakeDb(user, p), SERVICE, { allowStaff: true });
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.status, 403);
  }
});

Deno.test("staff mode: invalid session → 401", async () => {
  const r = await authorizeCaller(req("Bearer j"), fakeDb(null, null), SERVICE, { allowStaff: true });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 401);
});
