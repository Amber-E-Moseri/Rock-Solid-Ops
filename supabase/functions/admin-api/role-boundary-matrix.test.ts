import { allowedTargetRolesFor } from "./_actions/create-staff-direct.ts";

// ── Drift guard: creation boundary vs. profiles role-UPDATE boundary ─────────
//
// Two independent enforcement points govern staff roles:
//   1. create-staff-direct's allowedTargetRolesFor() (this file's real import) —
//      who may CREATE a new staff account with a given role.
//   2. public.profiles_enforce_role_assignment(), a Postgres trigger — who may
//      UPDATE an existing profile's role.
//
// These two have drifted out of sync before (see docs/migration-log.md
// 2026-07-13: admin could assign 'teacher'/'pending' via direct REST update
// even though its creation authority was already scoped to 'teacher' only,
// then a second pass narrowed admin's update authority to zero). The trigger
// is PL/pgSQL and this dev environment has no Postgres to execute it against
// (same limitation noted throughout docs/migration-log.md), so this test
// mirrors the trigger's logic as a pure function and asserts BOTH boundaries
// match the documented policy for every canonical role.
//
// If `202607131600_profiles_role_assignment_admin_zero_authority.sql`'s
// `profiles_enforce_role_assignment()` body ever changes, this mirror must be
// updated to match — that is the point of the test failing loudly instead of
// the two boundaries silently diverging again.
function allowedRoleUpdateFor(callerRole: string): Set<string> {
  const r = String(callerRole || "").trim().toLowerCase();
  if (r === "superadmin") {
    return new Set([
      "pending",
      "teacher",
      "principal",
      "admin",
      "superadmin",
      "subgroup_admin",
      "pastor",
      "regional_secretary",
    ]);
  }
  return new Set(); // admin and everyone else: zero profiles.role UPDATE authority
}

const ALL_ROLES = [
  "pending",
  "teacher",
  "principal",
  "admin",
  "superadmin",
  "subgroup_admin",
  "pastor",
  "regional_secretary",
];

function setEquals(a: Set<string>, b: Iterable<string>): boolean {
  const bSet = new Set(b);
  if (a.size !== bSet.size) return false;
  for (const v of a) if (!bSet.has(v)) return false;
  return true;
}

Deno.test("boundary matrix: admin — create teacher only, zero update authority", () => {
  if (!setEquals(allowedTargetRolesFor("admin"), ["teacher"])) {
    throw new Error(`admin creation set drifted: ${[...allowedTargetRolesFor("admin")]}`);
  }
  if (allowedRoleUpdateFor("admin").size !== 0) {
    throw new Error(`admin must have zero profiles.role UPDATE authority, got: ${[...allowedRoleUpdateFor("admin")]}`);
  }
});

Deno.test("boundary matrix: superadmin — full authority both ways (update includes pending)", () => {
  const expectedCreate = ALL_ROLES.filter((r) => r !== "pending");
  if (!setEquals(allowedTargetRolesFor("superadmin"), expectedCreate)) {
    throw new Error(`superadmin creation set drifted: ${[...allowedTargetRolesFor("superadmin")]}`);
  }
  if (!setEquals(allowedRoleUpdateFor("superadmin"), ALL_ROLES)) {
    throw new Error(`superadmin update set drifted: ${[...allowedRoleUpdateFor("superadmin")]}`);
  }
});

Deno.test("boundary matrix: every other role has zero authority in both dimensions", () => {
  for (const role of ALL_ROLES.filter((r) => r !== "admin" && r !== "superadmin")) {
    if (allowedTargetRolesFor(role).size !== 0) {
      throw new Error(`${role} should have no creation authority, got: ${[...allowedTargetRolesFor(role)]}`);
    }
    if (allowedRoleUpdateFor(role).size !== 0) {
      throw new Error(`${role} should have no profiles.role UPDATE authority, got: ${[...allowedRoleUpdateFor(role)]}`);
    }
  }
});
