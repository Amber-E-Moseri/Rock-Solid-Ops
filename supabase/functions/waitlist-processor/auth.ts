// Inbound authorization for waitlist-processor. It runs before any body read, database read or write.
// A request is authorized only by an explicit credential:
//   - the service-role bearer, exactly equal to SUPABASE_SERVICE_ROLE_KEY (the scheduled run); or
//   - a bearer that verifies as an active staff profile with a role allowed to use the Waitlist page.
// Absence of Authorization is never permission. Anon-key, teacher, pending and other bearers are refused.

import { constantTimeEquals } from "../_shared/moodle-sync-auth.ts";

export const WAITLIST_STAFF_ROLES: readonly string[] = ["superadmin", "admin", "regional_secretary"];

export type WaitlistCaller = { via: "service_role" } | { via: "staff_jwt"; actor: string };

export type WaitlistAuthDecision =
  | { ok: true; caller: WaitlistCaller }
  | { ok: false; status: 401 | 403; code: string; error: string };

export type StaffLookup = { id: string; email?: string | null; role?: string | null; isActive?: boolean | null };

export type WaitlistAuthInput = {
  authHeader: string | null | undefined;
  serviceKey: string;
  verifyStaff: (jwt: string) => Promise<StaffLookup | null>;
};

export async function authorizeWaitlistCaller(input: WaitlistAuthInput): Promise<WaitlistAuthDecision> {
  const header = String(input.authHeader ?? "");
  if (!header.startsWith("Bearer ")) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Authorization required" };
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Authorization required" };
  }

  if (input.serviceKey && constantTimeEquals(token, input.serviceKey)) {
    return { ok: true, caller: { via: "service_role" } };
  }

  let staff: StaffLookup | null = null;
  try {
    staff = await input.verifyStaff(token);
  } catch {
    staff = null;
  }
  if (!staff || !staff.id) {
    return { ok: false, status: 401, code: "INVALID_SESSION", error: "Invalid session" };
  }
  if (staff.isActive !== true) {
    return { ok: false, status: 403, code: "INACTIVE_ACCOUNT", error: "Account is not active" };
  }
  if (!WAITLIST_STAFF_ROLES.includes(String(staff.role || ""))) {
    return { ok: false, status: 403, code: "ROLE_NOT_ALLOWED", error: "Role not permitted" };
  }
  return { ok: true, caller: { via: "staff_jwt", actor: staff.email || staff.id } };
}
