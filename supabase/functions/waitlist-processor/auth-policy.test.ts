// waitlist-processor policy: exact staff role set. Dependency-free assertions so these run offline as well as in CI.
import { WAITLIST_PROCESS_ROLES } from "./auth-policy.ts";

function assertEq<T>(actual: T, expected: T, message = "") {
  if (actual !== expected) {
    throw new Error(`${message} expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }
}

Deno.test("waitlist processing roles are exactly admin, superadmin and regional_secretary", () => {
  assertEq(
    JSON.stringify([...WAITLIST_PROCESS_ROLES]),
    JSON.stringify(["admin", "superadmin", "regional_secretary"]),
    "roles",
  );
});

Deno.test("other staff and non-staff roles are not waitlist processors", () => {
  for (const role of ["pastor", "principal", "subgroup_admin", "teacher", "pending", ""]) {
    assertEq(WAITLIST_PROCESS_ROLES.includes(role), false, `role ${role || "(empty)"}`);
  }
});
