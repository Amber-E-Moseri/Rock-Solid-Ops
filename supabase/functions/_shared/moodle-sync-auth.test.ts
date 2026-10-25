import { assert, assertEquals } from "jsr:@std/assert@1";
import { authorizeMoodleSyncCaller, constantTimeEquals } from "./moodle-sync-auth.ts";

const SERVICE = "service-key-for-tests-0000000000000000";
const ADMIN = { id: "admin-1", email: "admin@example.com" };

// verifyAdmin is a stub. Each call is counted, so a test can prove whether a credential was checked at all.
function input(authHeader: string | null, allowAdminJwt: boolean, verify?: (jwt: string) => Promise<{ id: string; email?: string | null } | null>) {
  const calls: string[] = [];
  return {
    calls,
    in: {
      authHeader,
      serviceKey: SERVICE,
      allowAdminJwt,
      verifyAdmin: async (jwt: string) => {
        calls.push(jwt);
        return verify ? verify(jwt) : null;
      },
    },
  };
}

Deno.test("no Authorization header is refused, never treated as internal", async () => {
  const { in: i, calls } = input(null, false);
  const d = await authorizeMoodleSyncCaller(i);
  assertEquals(d.ok, false);
  if (!d.ok) assertEquals([d.status, d.code], [401, "AUTH_REQUIRED"]);
  assertEquals(calls.length, 0);
});

Deno.test("empty and non-Bearer headers are refused", async () => {
  for (const h of ["", "Bearer ", "Bearer    ", "Basic abc", "bearer " + SERVICE]) {
    const d = await authorizeMoodleSyncCaller(input(h, true, async () => ADMIN).in);
    assertEquals(d.ok, false, `header ${JSON.stringify(h)} must be refused`);
  }
});

Deno.test("anon-style bearer (not the service key) is refused for normal sync", async () => {
  const { in: i, calls } = input("Bearer anon-public-key", false);
  const d = await authorizeMoodleSyncCaller(i);
  assertEquals(d.ok, false);
  if (!d.ok) assertEquals([d.status, d.code], [403, "SERVICE_ROLE_REQUIRED"]);
  assertEquals(calls.length, 0);
});

Deno.test("a verified admin JWT is refused for normal sync (only the test action accepts admins)", async () => {
  const { in: i } = input("Bearer user-jwt", false, async () => ADMIN);
  const d = await authorizeMoodleSyncCaller(i);
  assertEquals(d.ok, false);
});

Deno.test("a near-miss service key is refused", async () => {
  const d = await authorizeMoodleSyncCaller(input(`Bearer ${SERVICE}x`, false).in);
  assertEquals(d.ok, false);
  const d2 = await authorizeMoodleSyncCaller(input(`Bearer ${SERVICE.slice(0, -1)}`, false).in);
  assertEquals(d2.ok, false);
});

Deno.test("exact service-role bearer is accepted for internal callers", async () => {
  const { in: i, calls } = input(`Bearer ${SERVICE}`, false);
  const d = await authorizeMoodleSyncCaller(i);
  assertEquals(d.ok, true);
  if (d.ok) assertEquals(d.actor.via, "service_role");
  assertEquals(calls.length, 0, "service key must not need a database lookup");
});

Deno.test("test action accepts a verified admin, and only through verifyAdmin", async () => {
  const { in: i, calls } = input("Bearer admin-jwt", true, async () => ADMIN);
  const d = await authorizeMoodleSyncCaller(i);
  assertEquals(d.ok, true);
  if (d.ok) assertEquals([d.actor.via, d.actor.actor], ["admin_jwt", "admin@example.com"]);
  assertEquals(calls, ["admin-jwt"]);
});

Deno.test("test action refuses an unverified bearer", async () => {
  const d = await authorizeMoodleSyncCaller(input("Bearer junk", true, async () => null).in);
  assertEquals(d.ok, false);
  if (!d.ok) assertEquals(d.code, "INVALID_SESSION");
});

Deno.test("a throwing verifier fails closed", async () => {
  const d = await authorizeMoodleSyncCaller(input("Bearer x", true, async () => { throw new Error("down"); }).in);
  assertEquals(d.ok, false);
});

Deno.test("empty service key refuses every service bearer", async () => {
  const d = await authorizeMoodleSyncCaller({ authHeader: "Bearer ", serviceKey: "", allowAdminJwt: false, verifyAdmin: async () => null });
  assertEquals(d.ok, false);
});

Deno.test("constantTimeEquals compares exactly", () => {
  assert(constantTimeEquals("abc", "abc"));
  assert(!constantTimeEquals("abc", "abd"));
  assert(!constantTimeEquals("abc", "abcd"));
});
