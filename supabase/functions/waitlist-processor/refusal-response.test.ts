import { assertEquals } from "jsr:@std/assert@1";
import { jsonResponse } from "../_shared/http.ts";
import { authorizeWaitlistCaller, type StaffLookup, type WaitlistAuthDecision } from "./auth.ts";

// Builds the refusal exactly as index.ts does: the body carries the same statusCode the HTTP status uses,
// which satisfies the EdgeFunctionResponse contract that jsonResponse declares.
async function refusalFor(authHeader: string | null, verifyStaff: () => Promise<StaffLookup | null>): Promise<Response> {
  const decision: WaitlistAuthDecision = await authorizeWaitlistCaller({
    authHeader,
    serviceKey: "service-role-test-key-0123456789",
    verifyStaff,
  });
  if (decision.ok) throw new Error("expected a refusal");
  return jsonResponse({ ok: false, error: decision.code, statusCode: decision.status }, decision.status);
}

const none = async (): Promise<StaffLookup | null> => null;

Deno.test("a missing bearer is answered 401 with the AUTH_REQUIRED body", async () => {
  const res = await refusalFor(null, none);
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { ok: false, error: "AUTH_REQUIRED", statusCode: 401 });
});

Deno.test("an unverifiable bearer is answered 401 with the INVALID_SESSION body", async () => {
  const res = await refusalFor("Bearer not-a-session", none);
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { ok: false, error: "INVALID_SESSION", statusCode: 401 });
});

Deno.test("an inactive staff bearer is answered 403 with the INACTIVE_ACCOUNT body", async () => {
  const res = await refusalFor("Bearer staff-jwt", async () => ({ id: "u-1", role: "admin", isActive: false }));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { ok: false, error: "INACTIVE_ACCOUNT", statusCode: 403 });
});

Deno.test("a non-waitlist role is answered 403 with the ROLE_NOT_ALLOWED body", async () => {
  const res = await refusalFor("Bearer staff-jwt", async () => ({ id: "u-1", role: "teacher", isActive: true }));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { ok: false, error: "ROLE_NOT_ALLOWED", statusCode: 403 });
});

Deno.test("refusal responses are JSON", async () => {
  const res = await refusalFor(null, none);
  assertEquals(res.headers.get("Content-Type"), "application/json");
});
