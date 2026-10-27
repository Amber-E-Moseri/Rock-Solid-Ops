import { assert, assertEquals } from "jsr:@std/assert@1";
import { authorizeWaitlistCaller, type StaffLookup } from "./auth.ts";

const SERVICE_KEY = "service-role-test-key-0123456789";

function input(authHeader: string | null, verifyStaff: (jwt: string) => Promise<StaffLookup | null>) {
  return { authHeader, serviceKey: SERVICE_KEY, verifyStaff };
}

const notCalled = async (): Promise<StaffLookup | null> => {
  throw new Error("verifyStaff must not run for this request");
};

function staff(role: string, overrides: Partial<StaffLookup> = {}): () => Promise<StaffLookup> {
  return async () => ({ id: "u-1", email: "staff@example.test", role, isActive: true, ...overrides });
}

Deno.test("missing Authorization is refused before any lookup", async () => {
  const d = await authorizeWaitlistCaller(input(null, notCalled));
  assertEquals(d.ok, false);
  if (!d.ok) assertEquals([d.status, d.code], [401, "AUTH_REQUIRED"]);
});

Deno.test("a bearer with no token is refused before any lookup", async () => {
  const d = await authorizeWaitlistCaller(input("Bearer    ", notCalled));
  assertEquals(d.ok, false);
  if (!d.ok) assertEquals(d.code, "AUTH_REQUIRED");
});

Deno.test("a non-Bearer scheme is refused before any lookup", async () => {
  const d = await authorizeWaitlistCaller(input(`Basic ${SERVICE_KEY}`, notCalled));
  assertEquals(d.ok, false);
});

Deno.test("the exact service-role bearer is accepted for the scheduled run", async () => {
  const d = await authorizeWaitlistCaller(input(`Bearer ${SERVICE_KEY}`, notCalled));
  assertEquals(d, { ok: true, caller: { via: "service_role" } });
});

Deno.test("a service key that differs in one character is not the service role", async () => {
  const almost = SERVICE_KEY.slice(0, -1) + "x";
  const d = await authorizeWaitlistCaller(input(`Bearer ${almost}`, async () => null));
  assertEquals(d.ok, false);
  if (!d.ok) assertEquals(d.code, "INVALID_SESSION");
});

Deno.test("a key of a different length is not the service role", async () => {
  const d = await authorizeWaitlistCaller(input(`Bearer ${SERVICE_KEY}x`, async () => null));
  assertEquals(d.ok, false);
});

Deno.test("an unverifiable bearer is refused as an invalid session", async () => {
  const d = await authorizeWaitlistCaller(input("Bearer anon-or-garbage", async () => null));
  assertEquals(d.ok, false);
  if (!d.ok) assertEquals([d.status, d.code], [401, "INVALID_SESSION"]);
});

Deno.test("a verifier that throws is treated as an invalid session", async () => {
  const d = await authorizeWaitlistCaller(input("Bearer bad", async () => { throw new Error("network"); }));
  assertEquals(d.ok, false);
  if (!d.ok) assertEquals(d.code, "INVALID_SESSION");
});

Deno.test("an active admin session is accepted as a staff caller", async () => {
  const d = await authorizeWaitlistCaller(input("Bearer admin-jwt", staff("admin")));
  assertEquals(d, { ok: true, caller: { via: "staff_jwt", actor: "staff@example.test" } });
});

Deno.test("superadmin and regional_secretary are accepted, as on the Waitlist page", async () => {
  for (const role of ["superadmin", "regional_secretary"]) {
    const d = await authorizeWaitlistCaller(input("Bearer jwt", staff(role)));
    assertEquals(d.ok, true, role);
  }
});

Deno.test("a teacher session is refused", async () => {
  const d = await authorizeWaitlistCaller(input("Bearer teacher-jwt", staff("teacher")));
  assertEquals(d.ok, false);
  if (!d.ok) assertEquals([d.status, d.code], [403, "ROLE_NOT_ALLOWED"]);
});

Deno.test("a pending session is refused", async () => {
  const d = await authorizeWaitlistCaller(input("Bearer pending-jwt", staff("pending")));
  assertEquals(d.ok, false);
});

Deno.test("a profile with no role is refused", async () => {
  const d = await authorizeWaitlistCaller(input("Bearer no-role", staff("")));
  assertEquals(d.ok, false);
});

Deno.test("an inactive admin is refused even with an allowed role", async () => {
  const d = await authorizeWaitlistCaller(input("Bearer inactive", staff("admin", { isActive: false })));
  assertEquals(d.ok, false);
  if (!d.ok) assertEquals([d.status, d.code], [403, "INACTIVE_ACCOUNT"]);
});

Deno.test("a profile with unknown active state is refused", async () => {
  const d = await authorizeWaitlistCaller(input("Bearer unknown", staff("admin", { isActive: null })));
  assertEquals(d.ok, false);
});

Deno.test("a role with different letter case is not treated as an allowed role", async () => {
  const d = await authorizeWaitlistCaller(input("Bearer case", staff("Admin")));
  assertEquals(d.ok, false);
  assert(!d.ok && d.code === "ROLE_NOT_ALLOWED");
});
