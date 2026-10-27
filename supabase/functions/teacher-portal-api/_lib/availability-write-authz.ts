import { ApiError } from "./errors.ts";
import { safeLower, withTimeout } from "./http.ts";
import { writeAudit } from "./teacher-auth.ts";
import type { AuthContext } from "./types.ts";

// Roles allowed to write availability for another teacher. Only verified, active targets; no client-supplied owner.
const ADMIN_WRITE_ROLES = new Set(["admin", "superadmin"]);

// Roles that may be authenticated but whose write paths stay refused until separately certified:
// pastor and subgroup_admin (staff scope not yet verified), principal and regional_secretary.
// Any unknown role is also refused (fail closed).
export interface AvailabilityWriteTarget {
  teacherId: string;
  teacherEmail: string;
}

async function refuseWrite(db: any, auth: AuthContext, reason: string, message: string): Promise<never> {
  // Denials are security-relevant, so they are audited (and awaited) before the refusal is returned.
  await writeAudit(db, {
    action: "TEACHER_ACCESS_DENIED",
    actorId: auth.user.id,
    actorEmail: auth.teacher.email,
    entityType: "teacher_availability",
    status: "FORBIDDEN",
    details: { reason, role: auth.role || null },
  });
  throw new ApiError("AVAILABILITY_WRITE_FORBIDDEN", message, 403);
}

export async function resolveAvailabilityWriteTarget(
  db: any,
  auth: AuthContext,
  params: any,
): Promise<AvailabilityWriteTarget> {
  const role = safeLower(auth?.role);
  const requestedId = String(params?.teacherId || "").trim();
  const ownId = String(auth?.teacher?.teacherId || "").trim();
  const ownEmail = safeLower(auth?.teacher?.email || "");

  if (ADMIN_WRITE_ROLES.has(role)) {
    if (!requestedId) {
      throw new ApiError("INVALID_PAYLOAD", "teacherId is required for admin availability writes", 400);
    }
    const res = await withTimeout(
      db
        .from("teachers")
        .select("teacher_id,email,active,status,deleted_at")
        .eq("teacher_id", requestedId)
        .maybeSingle(),
      "resolve availability target teacher",
    );
    if (res.error) throw new ApiError("INTERNAL_ERROR", "Failed to resolve target teacher", 500);
    const row = res.data;
    // Fail closed: missing, deleted, inactive or non-ACTIVE targets are all refused.
    if (!row) throw new ApiError("INVALID_TEACHER_MAPPING", "Target teacher not found", 403);
    const targetStatus = String(row.status || "").trim().toUpperCase();
    if (row.deleted_at || row.active !== true || targetStatus !== "ACTIVE") {
      throw new ApiError("TEACHER_NOT_ACTIVE", "Target teacher is not an active teacher", 403);
    }
    return { teacherId: String(row.teacher_id), teacherEmail: safeLower(row.email || "") };
  }

  if (role === "teacher") {
    if (!ownId) {
      throw new ApiError("INVALID_TEACHER_MAPPING", "No teacher record is mapped to this account", 403);
    }
    // Ownership comes from the authenticated session. A different supplied teacherId is a cross-teacher write.
    if (requestedId && requestedId !== ownId) {
      return refuseWrite(db, auth, "cross_teacher_write", "You may only submit your own availability");
    }
    return { teacherId: ownId, teacherEmail: ownEmail };
  }

  if (role === "pastor" || role === "subgroup_admin") {
    return refuseWrite(db, auth, "role_write_not_certified", "This role cannot submit availability until its scope is certified");
  }
  if (role === "principal" || role === "regional_secretary") {
    return refuseWrite(db, auth, "role_write_denied", "This role cannot submit teacher availability");
  }
  return refuseWrite(db, auth, "unknown_role", "This role cannot submit teacher availability");
}
