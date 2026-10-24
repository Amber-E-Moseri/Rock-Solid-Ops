// Legacy Teacher Management: teacher status and sign-in role writes.
//
// This is a transition helper, not the approval workflow. Teacher applications are approved through
// the P1 approval/activation contract, which is not built yet. Until it exists, the legacy "Approve"
// action is kept for authorized administrators, and it must never leave a teacher record ACTIVE
// when the sign-in role was not granted.
//
// Loads as a classic script (window.FSTeacherActivation) and as a CommonJS module for Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FSTeacherActivation = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  class ActivationError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "ActivationError";
      this.code = code;
    }
  }

  async function readProfile(db, userId) {
    const { data, error } = await db
      .from("profiles")
      .select("role,is_active")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  // Applies a profile patch and requires that exactly one row changed. A write that matches no row
  // (for example one hidden by policy) is a failure, not a success.
  async function patchProfile(db, userId, patch) {
    const { data, error } = await db
      .from("profiles")
      .update(patch)
      .eq("user_id", userId)
      .select("user_id");
    if (error) throw error;
    if (!Array.isArray(data) || data.length !== 1) {
      throw new ActivationError("PROFILE_NOT_UPDATED", "The sign-in account's role was not changed. Nothing was saved to the teacher record.");
    }
  }

  // Non-activation actions (suspend, reject, reactivate, inactivate). Errors are reported. A teacher with
  // no sign-in account has no profile to change, so that case is skipped rather than failed.
  async function updateProfileStrict(db, userId, patch) {
    if (!userId) return;
    const { error } = await db
      .from("profiles")
      .update(patch)
      .eq("user_id", userId);
    if (error) throw error;
  }

  // Activation: assign the sign-in role first, then write the teacher record. If the role cannot be
  // assigned, the teacher record is not touched. If the teacher write fails after the role was assigned,
  // the role is restored to its previous value.
  async function runActivation({ db, teacherUserId, profilePatch, writeTeacher }) {
    if (!teacherUserId) {
      throw new ActivationError(
        "NOT_LINKED",
        "This teacher is not linked to a sign-in account, so the teacher role cannot be assigned. Link the account first. Nothing was changed.",
      );
    }
    const prior = await readProfile(db, teacherUserId);
    if (!prior) {
      throw new ActivationError("NO_PROFILE", "This sign-in account has no profile record. Nothing was changed.");
    }

    await patchProfile(db, teacherUserId, profilePatch);

    try {
      await writeTeacher();
    } catch (teacherErr) {
      try {
        await patchProfile(db, teacherUserId, { role: prior.role, is_active: Boolean(prior.is_active) });
      } catch (revertErr) {
        throw new ActivationError(
          "REVERT_FAILED",
          `The teacher record was not updated, and the sign-in role could not be restored (${revertErr.message}). A superadmin must set this account's role back to "${prior.role}".`,
        );
      }
      throw teacherErr;
    }
  }

  return { ActivationError, runActivation, updateProfileStrict };
});
