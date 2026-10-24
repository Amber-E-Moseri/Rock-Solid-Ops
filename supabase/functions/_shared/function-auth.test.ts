// Authorization helper: refusal paths, trusted-profile checks, service-role matching and the staff path.
// Dependency-free assertions so these run offline as well as in CI.
import {
  authorizeCaller,
  bearerToken,
  constantTimeEqual,
  denialResponse,
  supabaseCallerDeps,
  trustedProfileRole,
  type AuthDb,
  type CallerDeps,
  type VerifiedUser,
} from "./function-auth.ts";

function assertEq<T>(actual: T, expected: T, message = "") {
  if (actual !== expected) {
    throw new Error(`${message} expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }
}

const SERVICE = "service-role-test-credential";
const ADMIN_ROLES = ["admin", "superadmin"];

function makeDeps(opts: {
  users?: Record<string, string>;
  roles?: Record<string, string | null>;
  serviceKey?: string;
  allowedRoles?: string[];
  throwVerify?: boolean;
  throwRole?: boolean;
} = {}) {
  const calls = { verify: 0, role: 0 };
  const deps: CallerDeps = {
    serviceKey: opts.serviceKey ?? SERVICE,
    allowedRoles: opts.allowedRoles ?? ADMIN_ROLES,
    verifyUser: (jwt: string): Promise<VerifiedUser | null> => {
      calls.verify += 1;
      if (opts.throwVerify) return Promise.reject(new Error("auth backend unavailable"));
      const id = (opts.users ?? {})[jwt];
      return Promise.resolve(id ? { id, email: `${id}@example.test` } : null);
    },
    roleOf: (userId: string): Promise<string | null> => {
      calls.role += 1;
      if (opts.throwRole) return Promise.reject(new Error("profile lookup failed"));
      return Promise.resolve((opts.roles ?? {})[userId] ?? null);
    },
  };
  return { deps, calls };
}

Deno.test("bearerToken: missing, malformed and empty headers yield no token", () => {
  assertEq(bearerToken(null), "", "null header");
  assertEq(bearerToken(undefined), "", "undefined header");
  assertEq(bearerToken("Basic abc"), "", "non-bearer scheme");
  assertEq(bearerToken("Bearer    "), "", "blank bearer");
  assertEq(bearerToken("Bearer  tok  "), "tok", "trims token");
});

Deno.test("constantTimeEqual: exact match only", () => {
  assertEq(constantTimeEqual("abc", "abc"), true, "equal");
  assertEq(constantTimeEqual("abc", "abd"), false, "same length, different content");
  assertEq(constantTimeEqual("abc", "abcd"), false, "different length");
  assertEq(constantTimeEqual("", ""), true, "both empty compare equal; callers reject empty tokens first");
});

Deno.test("trustedProfileRole: missing, inactive or unset is_active fails closed", () => {
  assertEq(trustedProfileRole(null), null, "no profile row");
  assertEq(trustedProfileRole(undefined), null, "undefined profile");
  assertEq(trustedProfileRole({ role: "admin", is_active: false }), null, "inactive admin");
  assertEq(trustedProfileRole({ role: "admin" }), null, "is_active missing");
  assertEq(trustedProfileRole({ role: "admin", is_active: "true" }), null, "is_active not boolean true");
  assertEq(trustedProfileRole({ role: "  Admin ", is_active: true }), "admin", "active role normalised");
  assertEq(trustedProfileRole({ role: "", is_active: true }), null, "active but no role");
});

Deno.test("refuses a request with no credential before any lookup", async () => {
  const { deps, calls } = makeDeps({ users: { t: "u1" }, roles: { u1: "admin" } });
  const decision = await authorizeCaller(null, deps);
  assertEq(decision.ok, false, "ok");
  if (decision.ok) throw new Error("unreachable");
  assertEq(decision.status, 401, "status");
  assertEq(decision.code, "AUTH_REQUIRED", "code");
  assertEq(calls.verify, 0, "verifyUser must not run without a credential");
  assertEq(calls.role, 0, "roleOf must not run without a credential");
});

Deno.test("refuses a malformed credential with 401", async () => {
  const { deps } = makeDeps();
  const decision = await authorizeCaller("Token abc", deps);
  if (decision.ok) throw new Error("malformed header must not authorize");
  assertEq(decision.status, 401, "status");
});

Deno.test("accepts the exact service-role credential without verifying a user", async () => {
  const { deps, calls } = makeDeps();
  const decision = await authorizeCaller(`Bearer ${SERVICE}`, deps);
  assertEq(decision.ok, true, "ok");
  if (!decision.ok) throw new Error("unreachable");
  assertEq(decision.kind, "service_role", "kind");
  assertEq(calls.verify, 0, "service-role match must not call verifyUser");
});

Deno.test("a near-miss service credential is not trusted", async () => {
  const { deps } = makeDeps();
  const decision = await authorizeCaller(`Bearer ${SERVICE}x`, deps);
  if (decision.ok) throw new Error("near-miss must not authorize");
  assertEq(decision.status, 401, "status");
  assertEq(decision.code, "INVALID_SESSION", "falls through to user verification and fails");
});

Deno.test("an empty configured service credential never matches", async () => {
  const { deps } = makeDeps({ serviceKey: "" });
  const decision = await authorizeCaller("Bearer something", deps);
  if (decision.ok) throw new Error("empty service key must not authorize");
  assertEq(decision.status, 401, "status");
});

Deno.test("refuses the anon key: it does not verify as a user", async () => {
  // The anon key is a signed JWT, so a gateway check admits it. Here it is not a user session.
  const { deps, calls } = makeDeps({ users: {}, roles: {} });
  const decision = await authorizeCaller("Bearer anon-key-value", deps);
  if (decision.ok) throw new Error("anon key must not authorize");
  assertEq(decision.status, 401, "status");
  assertEq(decision.code, "INVALID_SESSION", "code");
  assertEq(calls.role, 0, "no role lookup for an unverified token");
});

Deno.test("refuses a token whose user cannot be verified", async () => {
  const { deps } = makeDeps({ users: { good: "u1" }, roles: { u1: "admin" }, throwVerify: true });
  const decision = await authorizeCaller("Bearer good", deps);
  if (decision.ok) throw new Error("verification error must not authorize");
  assertEq(decision.status, 401, "status");
});

Deno.test("refuses a verified non-staff user with 403", async () => {
  const { deps } = makeDeps({ users: { t: "u-teacher" }, roles: { "u-teacher": "teacher" } });
  const decision = await authorizeCaller("Bearer t", deps);
  if (decision.ok) throw new Error("teacher must not authorize");
  assertEq(decision.status, 403, "status");
  assertEq(decision.code, "STAFF_REQUIRED", "code");
});

Deno.test("refuses a verified user with no trusted profile with 403", async () => {
  const { deps } = makeDeps({ users: { t: "u-noprofile" }, roles: {} });
  const decision = await authorizeCaller("Bearer t", deps);
  if (decision.ok) throw new Error("missing profile must not authorize");
  assertEq(decision.status, 403, "status");
});

Deno.test("refuses when the profile lookup throws (fail closed)", async () => {
  const { deps } = makeDeps({ users: { t: "u1" }, roles: { u1: "admin" }, throwRole: true });
  const decision = await authorizeCaller("Bearer t", deps);
  if (decision.ok) throw new Error("profile error must not authorize");
  assertEq(decision.status, 403, "status");
});

Deno.test("authorizes an allowed staff role and returns the trusted role", async () => {
  const { deps } = makeDeps({
    users: { t: "u-admin" },
    roles: { "u-admin": "Admin" },
  });
  const decision = await authorizeCaller("Bearer t", deps);
  assertEq(decision.ok, true, "ok");
  if (!decision.ok || decision.kind !== "staff") throw new Error("expected staff decision");
  assertEq(decision.role, "admin", "role");
  assertEq(decision.actorEmail, "u-admin@example.test", "actor");
});

Deno.test("respects the per-function allowed role list", async () => {
  const roles = { u1: "regional_secretary" };
  const narrow = makeDeps({ users: { t: "u1" }, roles, allowedRoles: ["admin", "superadmin"] });
  const wide = makeDeps({
    users: { t: "u1" },
    roles,
    allowedRoles: ["admin", "superadmin", "regional_secretary"],
  });
  const refused = await authorizeCaller("Bearer t", narrow.deps);
  const allowed = await authorizeCaller("Bearer t", wide.deps);
  assertEq(refused.ok, false, "regional_secretary refused where not allowed");
  assertEq(allowed.ok, true, "regional_secretary allowed where listed");
});

// ── Production wiring: trusted-profile checks through the Supabase client surface ──

function fakeDb(opts: {
  user?: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null;
  getUserError?: unknown;
  profile?: { role?: string; is_active?: boolean } | null;
  profileError?: unknown;
  eqCalls?: Array<[string, unknown]>;
}): AuthDb {
  const eqCalls = opts.eqCalls ?? [];
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: opts.user ?? null }, error: opts.getUserError ?? null }),
    },
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          eqCalls.push([col, val]);
          return chain;
        },
        maybeSingle: () =>
          Promise.resolve(
            opts.profileError
              ? { data: null, error: opts.profileError }
              : { data: opts.profile ?? null, error: null },
          ),
      };
      return chain;
    },
  } as unknown as AuthDb;
}

Deno.test("production wiring: user_metadata cannot grant a role", async () => {
  const deps = supabaseCallerDeps(
    fakeDb({
      user: { id: "u1", email: "t@example.test", user_metadata: { role: "admin" }, },
      profile: { role: "teacher", is_active: true },
    }),
    { serviceKey: SERVICE, allowedRoles: ADMIN_ROLES },
  );
  const decision = await authorizeCaller("Bearer t", deps);
  if (decision.ok) throw new Error("user_metadata.role must not authorize");
  assertEq(decision.status, 403, "status");
});

Deno.test("production wiring: an inactive admin profile is refused", async () => {
  const deps = supabaseCallerDeps(
    fakeDb({ user: { id: "u1" }, profile: { role: "admin", is_active: false } }),
    { serviceKey: SERVICE, allowedRoles: ADMIN_ROLES },
  );
  const decision = await authorizeCaller("Bearer t", deps);
  if (decision.ok) throw new Error("inactive profile must not authorize");
  assertEq(decision.status, 403, "status");
});

Deno.test("production wiring: profile is looked up by the verified user id", async () => {
  const eqCalls: Array<[string, unknown]> = [];
  const deps = supabaseCallerDeps(
    fakeDb({ user: { id: "u-42" }, profile: { role: "superadmin", is_active: true }, eqCalls }),
    { serviceKey: SERVICE, allowedRoles: ADMIN_ROLES },
  );
  const decision = await authorizeCaller("Bearer t", deps);
  assertEq(decision.ok, true, "ok");
  assertEq(eqCalls.some(([c, v]) => c === "user_id" && v === "u-42"), true, "profile keyed by verified id");
});

Deno.test("production wiring: a rejected token is refused before any profile lookup", async () => {
  const eqCalls: Array<[string, unknown]> = [];
  const deps = supabaseCallerDeps(
    fakeDb({ user: null, getUserError: new Error("invalid jwt"), eqCalls }),
    { serviceKey: SERVICE, allowedRoles: ADMIN_ROLES },
  );
  const decision = await authorizeCaller("Bearer bad", deps);
  if (decision.ok) throw new Error("invalid token must not authorize");
  assertEq(decision.status, 401, "status");
  assertEq(eqCalls.length, 0, "no profile query for an invalid token");
});

Deno.test("production wiring: the service credential still bypasses the user path", async () => {
  const deps = supabaseCallerDeps(fakeDb({ user: null }), { serviceKey: SERVICE, allowedRoles: ADMIN_ROLES });
  const decision = await authorizeCaller(`Bearer ${SERVICE}`, deps);
  assertEq(decision.ok && decision.kind, "service_role", "service-role caller accepted");
});

Deno.test("denial response carries only status, code and a fixed message", async () => {
  const { deps } = makeDeps();
  const decision = await authorizeCaller(null, deps);
  if (decision.ok) throw new Error("unreachable");
  const res = denialResponse(decision, { "Access-Control-Allow-Headers": "authorization" });
  assertEq(res.status, 401, "status");
  assertEq(res.headers.get("Content-Type"), "application/json", "content type");
  const body = await res.json();
  assertEq(JSON.stringify(Object.keys(body).sort()), JSON.stringify(["code", "error", "ok"]), "body keys");
  assertEq(body.ok, false, "ok flag");
});
