import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  type AdminDb,
  isActiveAdminProfile,
  isActiveLegacyAdmin,
  RETRY_ADMIN_ROLES,
  resolveRetryAdmin,
} from "./retry-admin-lookup.ts";

// ── Fake query builder that records every call. Tables are scripted per test. ───────────────────
// A scripted table is a result object, or "absent" to simulate a missing relation.

type Scripted = { data: unknown; error: unknown } | "absent";
type Call = { table: string; method: string; args: unknown[] };

function fakeDb(script: Record<string, Scripted>) {
  const calls: Call[] = [];
  const db: AdminDb = {
    from(table: string) {
      const filters: unknown[] = [];
      const builder = {
        select(...args: unknown[]) {
          calls.push({ table, method: "select", args });
          return builder;
        },
        eq(column: string, value: string) {
          calls.push({ table, method: "eq", args: [column, value] });
          filters.push([column, value]);
          return builder;
        },
        or(...args: unknown[]) {
          calls.push({ table, method: "or", args });
          return builder;
        },
        maybeSingle: async () => {
          const s = script[table];
          if (s === undefined || s === "absent") {
            return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
          }
          return s;
        },
      };
      return builder;
    },
  };
  return { db, calls };
}

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_EMAIL = "admin@example.org";

const tablesQueried = (calls: Call[]) => [...new Set(calls.map((c) => c.table))];

// ── Profiles are authoritative ─────────────────────────────────────────────────────────────────

Deno.test("active admin profile is authorized and admin_users is never consulted", async () => {
  const { db, calls } = fakeDb({ profiles: { data: { role: "admin", is_active: true }, error: null } });
  assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), true);
  assertEquals(tablesQueried(calls), ["profiles"]);
});

for (const role of ["admin", "superadmin"]) {
  Deno.test(`active ${role} profile is authorized`, async () => {
    const { db } = fakeDb({ profiles: { data: { role, is_active: true }, error: null } });
    assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), true);
  });
}

// Manual retry and resolve are limited to admin and superadmin. These roles were authorized before the
// release restriction, and must be denied now, with no fallback to admin_users.
for (const role of ["subgroup_admin", "pastor", "principal", "regional_secretary", "teacher", "pending", ""]) {
  Deno.test(`active ${JSON.stringify(role)} profile is denied and never falls back to admin_users`, async () => {
    const { db, calls } = fakeDb({
      profiles: { data: { role, is_active: true }, error: null },
      admin_users: { data: { role: "admin", status: "active", active: true }, error: null },
    });
    assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), false);
    assertEquals(tablesQueried(calls), ["profiles"]);
  });
}

Deno.test("the retry role set is exactly admin and superadmin", () => {
  assertEquals([...RETRY_ADMIN_ROLES], ["admin", "superadmin"]);
});

Deno.test("legacy admin_users role is narrowed the same way: superadmin allowed, subgroup_admin denied", async () => {
  const allowed = fakeDb({
    profiles: { data: null, error: null },
    admin_users: { data: { role: "superadmin", status: "active", active: true }, error: null },
  });
  assertEquals(await resolveRetryAdmin(allowed.db, ADMIN_ID, ADMIN_EMAIL), true);

  const denied = fakeDb({
    profiles: { data: null, error: null },
    admin_users: { data: { role: "subgroup_admin", status: "active", active: true }, error: null },
  });
  assertEquals(await resolveRetryAdmin(denied.db, ADMIN_ID, ADMIN_EMAIL), false);
});

Deno.test("role comparison ignores case and surrounding whitespace", async () => {
  const { db } = fakeDb({ profiles: { data: { role: "  ADMIN ", is_active: true }, error: null } });
  assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), true);
});

Deno.test("inactive admin profile is denied and does NOT fall back to admin_users", async () => {
  const { db, calls } = fakeDb({
    profiles: { data: { role: "admin", is_active: false }, error: null },
    admin_users: { data: { role: "admin", status: "active", active: true }, error: null },
  });
  assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), false);
  assertEquals(tablesQueried(calls), ["profiles"]);
});

Deno.test("profile with a null is_active is denied (not treated as active)", async () => {
  const { db } = fakeDb({ profiles: { data: { role: "admin", is_active: null }, error: null } });
  assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), false);
});

Deno.test("profile with a non-admin role is denied and does not fall back", async () => {
  for (const role of ["teacher", "pending", "regional_secretary", "", "superuser"]) {
    const { db, calls } = fakeDb({
      profiles: { data: { role, is_active: true }, error: null },
      admin_users: { data: { role: "admin", status: "active", active: true }, error: null },
    });
    assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), false, `role ${JSON.stringify(role)}`);
    assertEquals(tablesQueried(calls), ["profiles"], `role ${JSON.stringify(role)}`);
  }
});

Deno.test("profiles query error is denied and does not fall back", async () => {
  const { db, calls } = fakeDb({
    profiles: { data: null, error: { code: "42501", message: "permission denied" } },
    admin_users: { data: { role: "admin", status: "active", active: true }, error: null },
  });
  assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), false);
  assertEquals(tablesQueried(calls), ["profiles"]);
});

// ── No profile row: legacy admin_users, by verified id then verified email ──────────────────────

Deno.test("no profile, legacy active admin matched by verified user id is authorized", async () => {
  const { db, calls } = fakeDb({
    profiles: { data: null, error: null },
    admin_users: { data: { role: "admin", status: "active", active: true }, error: null },
  });
  assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), true);
  assert(calls.some((c) => c.table === "admin_users" && c.method === "eq" && c.args[0] === "auth_user_id" && c.args[1] === ADMIN_ID));
  assertEquals(calls.filter((c) => c.table === "admin_users" && c.args[0] === "email").length, 0, "no email query needed");
});

Deno.test("no profile, legacy row that is suspended, inactive or disabled is denied", async () => {
  for (const status of ["suspended", "inactive", "disabled"]) {
    const { db } = fakeDb({
      profiles: { data: null, error: null },
      admin_users: { data: { role: "admin", status, active: true }, error: null },
    });
    assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), false, status);
  }
});

Deno.test("no profile, legacy row with active false is denied", async () => {
  const { db } = fakeDb({
    profiles: { data: null, error: null },
    admin_users: { data: { role: "admin", status: "active", active: false }, error: null },
  });
  assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), false);
});

Deno.test("no profile, legacy row with active null is denied (not treated as active)", async () => {
  const { db } = fakeDb({
    profiles: { data: null, error: null },
    admin_users: { data: { role: "admin", status: "active", active: null }, error: null },
  });
  assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), false);
});

Deno.test("no profile, legacy row with a non-admin role is denied", async () => {
  const { db } = fakeDb({
    profiles: { data: null, error: null },
    admin_users: { data: { role: "teacher", status: "active", active: true }, error: null },
  });
  assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), false);
});

Deno.test("no profile and no admin_users row by id: legacy row matched by verified email is authorized", async () => {
  // Per-call script: profiles miss, admin_users miss by id, then an active admin row by email.
  const perCall = fakeDbPerCall([
    { table: "profiles", result: { data: null, error: null } },
    { table: "admin_users", result: { data: null, error: null } },
    { table: "admin_users", result: { data: { role: "admin", status: "active", active: true }, error: null } },
  ]);
  assertEquals(await resolveRetryAdmin(perCall.db, ADMIN_ID, ADMIN_EMAIL), true);
  assert(perCall.calls.some((c) => c.args[0] === "email" && c.args[1] === ADMIN_EMAIL));
});

Deno.test("no profile and no legacy row by id or email is denied", async () => {
  const { db } = fakeDb({
    profiles: { data: null, error: null },
    admin_users: { data: null, error: null },
  });
  assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), false);
});

// ── Missing tables and query errors fail closed ────────────────────────────────────────────────

Deno.test("no profile and admin_users absent: denied, and no email lookup is attempted", async () => {
  const { db, calls } = fakeDb({
    profiles: { data: null, error: null },
    admin_users: "absent",
  });
  assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), false);
  assertEquals(calls.filter((c) => c.args[0] === "email").length, 0, "no email query after a table error");
});

Deno.test("no profile and admin_users query error: denied, and no email lookup is attempted", async () => {
  const { db, calls } = fakeDb({
    profiles: { data: null, error: null },
    admin_users: { data: null, error: { code: "42501", message: "permission denied" } },
  });
  assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), false);
  assertEquals(calls.filter((c) => c.args[0] === "email").length, 0);
});

Deno.test("email lookup error after an id miss is denied", async () => {
  const perCall = fakeDbPerCall([
    { table: "profiles", result: { data: null, error: null } },
    { table: "admin_users", result: { data: null, error: null } },
    { table: "admin_users", result: { data: null, error: { code: "PGRST116", message: "multiple rows" } } },
  ]);
  assertEquals(await resolveRetryAdmin(perCall.db, ADMIN_ID, ADMIN_EMAIL), false);
});

Deno.test("a thrown client error is denied, never authorized", async () => {
  const db: AdminDb = {
    from() {
      throw new Error("network down");
    },
  };
  assertEquals(await resolveRetryAdmin(db, ADMIN_ID, ADMIN_EMAIL), false);
});

Deno.test("an empty user id is denied without any query", async () => {
  const { db, calls } = fakeDb({ profiles: { data: { role: "admin", is_active: true }, error: null } });
  assertEquals(await resolveRetryAdmin(db, "", ADMIN_EMAIL), false);
  assertEquals(calls.length, 0);
});

// ── Email fallback is an exact value, never part of a filter expression ─────────────────────────

Deno.test("email containing PostgREST filter syntax is passed as an exact value, and .or() is never used", async () => {
  const hostile = `x@example.org,auth_user_id.eq.${ADMIN_ID}`;
  const perCall = fakeDbPerCall([
    { table: "profiles", result: { data: null, error: null } },
    { table: "admin_users", result: { data: null, error: null } },
    { table: "admin_users", result: { data: null, error: null } },
  ]);
  assertEquals(await resolveRetryAdmin(perCall.db, "22222222-2222-4222-8222-222222222222", hostile), false);
  assertEquals(perCall.calls.filter((c) => c.method === "or").length, 0, ".or() must not be used");
  const emailCall = perCall.calls.find((c) => c.args[0] === "email");
  assertEquals(emailCall?.args[1], hostile, "email is sent verbatim as one value");
});

Deno.test("with no verified email, the email fallback is not attempted", async () => {
  const perCall = fakeDbPerCall([
    { table: "profiles", result: { data: null, error: null } },
    { table: "admin_users", result: { data: null, error: null } },
  ]);
  assertEquals(await resolveRetryAdmin(perCall.db, ADMIN_ID, null), false);
  assertEquals(perCall.calls.filter((c) => c.args[0] === "email").length, 0);
});

// ── Row predicates ──────────────────────────────────────────────────────────────────────────────

Deno.test("isActiveAdminProfile requires an explicit true active flag and an admin role", () => {
  assertEquals(isActiveAdminProfile({ role: "admin", is_active: true }), true);
  assertEquals(isActiveAdminProfile({ role: "admin", is_active: "true" }), false);
  assertEquals(isActiveAdminProfile({ role: "admin" }), false);
  assertEquals(isActiveAdminProfile({ role: "teacher", is_active: true }), false);
  assertEquals(isActiveAdminProfile(null), false);
});

Deno.test("isActiveLegacyAdmin requires explicit active true and a non-terminal status", () => {
  assertEquals(isActiveLegacyAdmin({ role: "admin", status: "active", active: true }), true);
  assertEquals(isActiveLegacyAdmin({ role: "admin", status: null, active: true }), true);
  assertEquals(isActiveLegacyAdmin({ role: "admin", status: "suspended", active: true }), false);
  assertEquals(isActiveLegacyAdmin({ role: "admin", status: "active", active: null }), false);
  assertEquals(isActiveLegacyAdmin(undefined), false);
});

// ── Class options: the query must use the owner-verified key, class_option_id ────────────────────

const workerSrc = await Deno.readTextFile(new URL("../retry-worker/index.ts", import.meta.url));

Deno.test("retry-worker's class_options lookup filters on class_option_id, not id", () => {
  const start = workerSrc.indexOf('from("class_options")');
  assert(start > 0, "class_options query must exist");
  const statement = workerSrc.slice(start, workerSrc.indexOf(".maybeSingle()", start));
  assertStringIncludes(statement, '.eq("class_option_id", row.class_option_id)');
  assertEquals(/\.eq\("id"/.test(statement), false, "class_options has no id column");
  assertEquals(/\.select\("[^"]*\bid\b/.test(statement), false, "class_options has no id column to select");
});

Deno.test("retry-worker reads class_options only through that single statement", () => {
  const count = workerSrc.split('from("class_options")').length - 1;
  assertEquals(count, 1);
});

Deno.test("retry-worker authorization no longer builds a PostgREST filter string", () => {
  assertEquals(workerSrc.includes(".or("), false);
  assertStringIncludes(workerSrc, "resolveRetryAdmin(serviceDb, user.id, user.email)");
});

// ── helper: scripted per call, for sequences that depend on the earlier result ──────────────────

function fakeDbPerCall(steps: { table: string; result: { data: unknown; error: unknown } }[]) {
  const calls: Call[] = [];
  let i = 0;
  const db: AdminDb = {
    from(table: string) {
      const builder = {
        select(...args: unknown[]) {
          calls.push({ table, method: "select", args });
          return builder;
        },
        eq(column: string, value: string) {
          calls.push({ table, method: "eq", args: [column, value] });
          return builder;
        },
        or(...args: unknown[]) {
          calls.push({ table, method: "or", args });
          return builder;
        },
        maybeSingle: async () => {
          const step = steps[i++];
          if (!step) throw new Error("unexpected extra query");
          if (step.table !== table) throw new Error(`expected ${step.table}, got ${table}`);
          return step.result;
        },
      };
      return builder;
    },
  };
  return { db, calls };
}
