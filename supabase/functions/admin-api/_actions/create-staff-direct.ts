import { createServiceClient } from "../../_shared/supabase.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // NOTE: admin-api uses a blanket `*` origin across all actions today. This is a
      // pre-existing deviation from CLAUDE.md (no `*` for authenticated endpoints) and is
      // intentionally left unchanged here to preserve parity with the existing
      // assign-applicant-admin endpoint. Tightening CORS is tracked as a separate follow-up.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

// Canonical profile.role enum (see migration 202605180006_regional_secretary_role.sql).
// `pending` is the non-elevated signup default and is never a valid creation target.
const CANONICAL_ROLES = new Set([
  "pending",
  "teacher",
  "principal",
  "admin",
  "superadmin",
  "subgroup_admin",
  "pastor",
  "regional_secretary",
]);

/**
 * Server-enforced permission boundary for direct staff creation.
 * Decision logged in docs/migration-log.md (2026-07-13, user-confirmed):
 *   - superadmin -> may create ANY staff role (except the `pending` default)
 *   - admin      -> may create `teacher` only
 *   - everyone else -> may not create staff at all
 * Higher-stakes elevated roles (admin/superadmin/subgroup_admin/pastor/principal)
 * can only be minted by a superadmin.
 */
export function allowedTargetRolesFor(callerRole: string): Set<string> {
  const r = String(callerRole || "").trim().toLowerCase();
  if (r === "superadmin") {
    return new Set([
      "teacher",
      "principal",
      "admin",
      "superadmin",
      "subgroup_admin",
      "pastor",
      "regional_secretary",
    ]);
  }
  if (r === "admin") return new Set(["teacher"]);
  return new Set();
}

export type StaffCreationDecision =
  | { ok: true }
  | { ok: false; error: string; status: number };

export function assertStaffCreationAllowed(
  callerRole: string,
  targetRole: string,
): StaffCreationDecision {
  const allowed = allowedTargetRolesFor(callerRole);
  if (allowed.size === 0) {
    return { ok: false, error: "Your role is not permitted to create staff accounts", status: 403 };
  }
  const target = String(targetRole || "").trim().toLowerCase();
  if (!target) return { ok: false, error: "role is required", status: 400 };
  if (!CANONICAL_ROLES.has(target) || target === "pending") {
    return { ok: false, error: `Invalid target role: ${targetRole}`, status: 400 };
  }
  if (!allowed.has(target)) {
    return { ok: false, error: `Your role may not create a '${target}' account`, status: 403 };
  }
  return { ok: true };
}

type CreateStaffDeps = { serviceClient?: any };

export async function createStaffDirectAction(
  ctx: { db: any; auth: any; params: any },
  deps?: CreateStaffDeps,
) {
  const { auth, params } = ctx;

  const callerRole = String(auth?.profile?.role || "").trim().toLowerCase();
  const fullName = String(params?.full_name || "").trim();
  const email = String(params?.email || "").trim().toLowerCase();
  const tempPassword = String(params?.temp_password || "");
  const targetRole = String(params?.role || "").trim().toLowerCase();
  const notes = String(params?.notes || "").trim() || null;
  const actorEmail = String(auth?.profile?.email || auth?.user?.email || "admin").trim().toLowerCase();

  // 1) Permission boundary (server-enforced, before any client creation or writes).
  const gate = assertStaffCreationAllowed(callerRole, targetRole);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  // 2) Payload validation (mirrors createTeacherDirect).
  if (!fullName) return json({ ok: false, error: "full_name is required" }, 400);
  if (!email || !email.includes("@")) return json({ ok: false, error: "valid email is required" }, 400);
  if (tempPassword.length < 8 || tempPassword.length > 72) {
    return json({ ok: false, error: "temp_password must be between 8 and 72 characters" }, 400);
  }

  const admin = deps?.serviceClient || createServiceClient();

  // 3) Friendly pre-check: reject if a profile already exists for this email.
  try {
    const { data: existing } = await admin
      .from("profiles")
      .select("user_id,email")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (existing?.user_id) {
      return json({ ok: false, error: "A user with this email already exists" }, 409);
    }
  } catch (_err) {
    // Non-fatal: if the pre-check fails, createUser below still guards against duplicates.
  }

  // 4) Create the Supabase Auth user (service role). A DB trigger inserts a matching
  //    profiles row with role=pending; step 5 promotes it to the requested role.
  let userId: string | null = null;
  try {
    const createRes = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        created_by: actorEmail,
        provisioned_direct: true,
      },
    });
    if (createRes.error || !createRes.data?.user?.id) {
      const reason = String(createRes.error?.message || "Unknown auth user creation error");
      return json({ ok: false, error: `Auth user creation failed: ${reason}` }, 500);
    }
    userId = String(createRes.data.user.id);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err || "Unknown auth user creation error");
    return json({ ok: false, error: `Auth user creation failed: ${reason}` }, 500);
  }

  // 5) Finalize the profile role. Upsert is idempotent and works whether or not the
  //    signup trigger has already inserted the pending row.
  const now = new Date().toISOString();
  try {
    const upsertRes = await admin.from("profiles").upsert(
      {
        user_id: userId,
        email,
        full_name: fullName,
        role: targetRole,
        is_active: true,
        updated_at: now,
      },
      { onConflict: "user_id" },
    );
    if (upsertRes.error) {
      // Roll back the orphaned auth user so a failed run leaves no half-provisioned account.
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch (rollbackErr) {
        console.warn("[createStaffDirect] auth user rollback failed", rollbackErr);
      }
      return json({ ok: false, error: `Profile finalize failed: ${upsertRes.error.message}` }, 500);
    }
  } catch (err) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (rollbackErr) {
      console.warn("[createStaffDirect] auth user rollback failed", rollbackErr);
    }
    const reason = err instanceof Error ? err.message : String(err || "Profile finalize failed");
    return json({ ok: false, error: `Profile finalize failed: ${reason}` }, 500);
  }

  // 6) Audit (best-effort; mirrors createTeacherDirect's final audit shape).
  try {
    await admin.from("audit_logs").insert({
      action: "staff_created_direct",
      actor_id: auth?.user?.id || null,
      entity_id: userId,
      entity_type: "profile",
      details: {
        email,
        role: targetRole,
        created_by: actorEmail,
        method: "direct_no_email",
        notes,
      },
    });
  } catch (err) {
    console.warn("[createStaffDirect] audit log failed", err);
  }

  return json({
    ok: true,
    user_id: userId,
    email,
    role: targetRole,
    temp_password: tempPassword,
  });
}
