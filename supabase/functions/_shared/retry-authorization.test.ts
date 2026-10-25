import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { authorizeRetryRequest, type VerifiedUser } from "./retry-authorization.ts";

// Behavioral tests with fake verifiers. Each test counts verifier calls, so a rejected request is shown
// not to reach identity or admin checks beyond what the rule requires.

const ADMIN: VerifiedUser = { id: "admin-1", email: "admin@example.org" };
const STAFF: VerifiedUser = { id: "staff-1", email: "staff@example.org" };

function harness(opts: { user?: VerifiedUser | null; admin?: boolean; verifyThrows?: boolean; adminThrows?: boolean } = {}) {
  const calls = { verify: [] as string[], admin: [] as string[] };
  return {
    calls,
    input: (authHeader: string | null | undefined) => ({
      authHeader,
      verifyUser: async (jwt: string) => {
        calls.verify.push(jwt);
        if (opts.verifyThrows) throw new Error("network");
        return opts.user === undefined ? ADMIN : opts.user;
      },
      isAdmin: async (user: VerifiedUser) => {
        calls.admin.push(user.id);
        if (opts.adminThrows) throw new Error("db");
        return opts.admin ?? true;
      },
    }),
  };
}

// ── Missing or malformed credentials are rejected before any identity check ───────────────────

for (const [name, header] of [
  ["a missing header", null],
  ["an undefined header", undefined],
  ["an empty header", ""],
  ["a Basic credential", "Basic YWRtaW46c2VjcmV0"],
  ["a bare token with no scheme", "eyJhbGciOiJIUzI1NiJ9.e30.x"],
  ["a Bearer header with no token", "Bearer "],
  ["a Bearer header with only whitespace", "Bearer    "],
]) {
  Deno.test(`missing authorization is rejected: ${name}`, async () => {
    const h = harness();
    const decision = await authorizeRetryRequest(h.input(header));
    assertEquals(decision.ok, false);
    if (!decision.ok) {
      assertEquals(decision.status, 401);
      assertEquals(decision.code, "AUTH_REQUIRED");
    }
    assertEquals(h.calls.verify.length, 0, "no token is verified");
    assertEquals(h.calls.admin.length, 0, "no admin check runs");
  });
}

// ── Invalid credentials are rejected ──────────────────────────────────────────────────────────

Deno.test("an invalid session token is rejected with 401 and no admin check", async () => {
  const h = harness({ user: null });
  const decision = await authorizeRetryRequest(h.input("Bearer not-a-real-jwt"));
  assertEquals(decision.ok, false);
  if (!decision.ok) {
    assertEquals(decision.status, 401);
    assertEquals(decision.code, "INVALID_SESSION");
  }
  assertEquals(h.calls.verify, ["not-a-real-jwt"]);
  assertEquals(h.calls.admin.length, 0);
});

Deno.test("a token that fails verification with an error is rejected, not treated as a user", async () => {
  const h = harness({ verifyThrows: true });
  const decision = await authorizeRetryRequest(h.input("Bearer anon-or-service-key"));
  assertEquals(decision.ok, false);
  if (!decision.ok) assertEquals(decision.status, 401);
  assertEquals(h.calls.admin.length, 0);
});

Deno.test("a verified user with no id is rejected", async () => {
  const h = harness({ user: { id: "", email: "x@example.org" } });
  const decision = await authorizeRetryRequest(h.input("Bearer token"));
  assertEquals(decision.ok, false);
  if (!decision.ok) assertEquals(decision.status, 401);
});

Deno.test("a verified non-admin is refused with 403 ADMIN_REQUIRED", async () => {
  const h = harness({ user: STAFF, admin: false });
  const decision = await authorizeRetryRequest(h.input("Bearer staff-token"));
  assertEquals(decision.ok, false);
  if (!decision.ok) {
    assertEquals(decision.status, 403);
    assertEquals(decision.code, "ADMIN_REQUIRED");
  }
});

Deno.test("an admin check that throws fails closed (403), never authorizes", async () => {
  const h = harness({ adminThrows: true });
  const decision = await authorizeRetryRequest(h.input("Bearer admin-token"));
  assertEquals(decision.ok, false);
  if (!decision.ok) assertEquals(decision.status, 403);
});

// ── Authorized admin: unchanged behavior ──────────────────────────────────────────────────────

Deno.test("an authorized admin is authorized and the actor is the admin's email", async () => {
  const h = harness();
  const decision = await authorizeRetryRequest(h.input("Bearer admin-token"));
  assertEquals(decision, { ok: true, actorEmail: "admin@example.org" });
  assertEquals(h.calls.verify, ["admin-token"]);
  assertEquals(h.calls.admin, ["admin-1"]);
});

Deno.test("an authorized admin without an email is identified by user id", async () => {
  const h = harness({ user: { id: "admin-2", email: null } });
  const decision = await authorizeRetryRequest(h.input("Bearer admin-token"));
  assertEquals(decision, { ok: true, actorEmail: "admin-2" });
});

Deno.test("a bearer token is trimmed before verification", async () => {
  const h = harness();
  await authorizeRetryRequest(h.input("Bearer   spaced-token  "));
  assertEquals(h.calls.verify, ["spaced-token"]);
});

// ── Source contract: index.ts runs the gate before any body read, retry, resolve, sweep, Moodle call,
// escalation or audit write ─────────────────────────────────────────────────────────────────────────

const indexSrc = await Deno.readTextFile(new URL("../retry-worker/index.ts", import.meta.url));

function at(needle: string, from = 0): number {
  const i = indexSrc.indexOf(needle, from);
  if (i < 0) throw new Error(`missing in index.ts: ${needle}`);
  return i;
}

Deno.test("index.ts no longer recognises a missing Authorization header as a scheduler", () => {
  assertEquals(/isCronCall/.test(indexSrc), false);
});

Deno.test("index.ts applies the authorization gate and refuses on failure", () => {
  const gate = at("await authorizeRetryRequest({");
  assertStringIncludes(indexSrc.slice(gate, gate + 900), "authDecision.ok");
  assertStringIncludes(indexSrc.slice(gate, gate + 1200), "authDecision.status");
});

Deno.test("the gate precedes body parsing and every retry, resolve, sweep, Moodle, escalation and audit operation", () => {
  const handler = at("Deno.serve(async (req) => {");
  const gate = at("await authorizeRetryRequest({", handler);
  const sites = [
    "await req.json()",
    "await sweepMoodleEnrollmentRetries(serviceDb, limit)",
    "await applyRetry(serviceDb, source, id);",
    "await applyResolve(serviceDb, source, id);",
    "await maybeEscalateMoodleFailure(",
    "await triggerMoodleSync(SUPABASE_URL, SERVICE_KEY, id);",

    "await logAudit(",
  ];
  for (const site of sites) {
    const pos = at(site, handler);
    assert(gate < pos, `gate must precede: ${site}`);
  }
});

Deno.test("the scheduled sweep is disabled by a constant and cannot be reached by any caller", () => {
  assertStringIncludes(indexSrc, "const SCHEDULED_SWEEP_ENABLED = false;");
  assertStringIncludes(indexSrc, "if (SCHEDULED_SWEEP_ENABLED && !id) {");
  assertEquals(indexSrc.includes("if (!id) {\n      if (planSweep"), false);
});

Deno.test("the Moodle hold guard is still in place before applyRetry and triggerMoodleSync", () => {
  const handler = at("Deno.serve(async (req) => {");
  const hold = at("planDirectRetry(action, source) === \"refuse_held\"", handler);
  assert(hold < at("await applyRetry(serviceDb, source, id);", handler), "hold must precede applyRetry");
  assert(hold < at("await triggerMoodleSync(SUPABASE_URL, SERVICE_KEY, id);", handler), "hold must precede triggerMoodleSync");
});
