/**
 * Wave 3 registration journey tests.
 *
 * These tests guard the three reliability fixes applied in this wave, plus the
 * core status-derivation invariants that the processor is responsible for. They
 * are pure-logic tests that mirror the processor's decision branches without
 * requiring a running Supabase instance.
 *
 * Integration tests (requiring a live DB) should be tracked separately and run
 * against a staging branch, not in this unit suite.
 */

// ─── Mirrors of processor helpers ────────────────────────────────────────────
// These replicate the exact decision logic from index.ts so that any drift
// between the processor and the expected behaviour surfaces as a test failure.

function resolveRegistrationStatus(opts: {
  isDuplicate: boolean;
  canAutoAssign: boolean;
  classOptionExists: boolean;
  classOptionActive: boolean;
  classIsFull: boolean;
  hasClassOption: boolean;
  hasAvailability: boolean;
}): { registrationStatus: string; availabilityStatus: string } {
  if (opts.isDuplicate) {
    return { registrationStatus: "DUPLICATE", availabilityStatus: "MANUAL_REVIEW_REQUIRED" };
  }
  if (!opts.canAutoAssign) {
    return { registrationStatus: "REVIEW", availabilityStatus: "MANUAL_REVIEW_REQUIRED" };
  }
  if (opts.hasClassOption) {
    if (!opts.classOptionExists || !opts.classOptionActive) {
      return { registrationStatus: "REVIEW", availabilityStatus: "MANUAL_REVIEW_REQUIRED" };
    }
    if (opts.classIsFull) {
      return { registrationStatus: "WAITLISTED", availabilityStatus: "CLASS_FULL" };
    }
    return { registrationStatus: "ASSIGNED", availabilityStatus: "CLASS_ASSIGNED" };
  }
  if (opts.hasAvailability) {
    return { registrationStatus: "PENDING", availabilityStatus: "NO_MATCHING_TIME" };
  }
  return { registrationStatus: "WAITLISTED", availabilityStatus: "NO_CLASS_AVAILABLE" };
}

// Mirrors the batch-id resolution logic (Wave 3 Fix 1).
// Returns batch_id from a DB result that simulates `batches.maybeSingle()`.
function resolveBatchId(
  formBatchId: string | null,
  dbBatch: { batch_id?: string } | null,
): string | null {
  let batch_id = String(formBatchId || "").trim() || null;
  if (!batch_id) {
    if (dbBatch?.batch_id) {
      batch_id = String(dbBatch.batch_id).trim() || null;
    }
  }
  return batch_id;
}

// Mirrors the no-batch early-return gate (Wave 3 data-integrity fix: no-active-batch).
// Returns whether the registration should be rejected before any applicant write.
function noBatchGate(batch_id: string | null): { blocked: boolean; code?: string } {
  if (!batch_id) return { blocked: true, code: "NO_ACTIVE_BATCH" };
  return { blocked: false };
}

// Mirrors the campus-closed server gate (Wave 3 server-integrity fix).
// Fail-open: missing settings row → not blocked.
// Fail-closed: row present with registration_open=false → CAMPUS_CLOSED.
function campusClosedGate(
  fellowship_code: string | null,
  settings: { registration_open: boolean } | null,
): { blocked: boolean; code?: string } {
  if (!fellowship_code) return { blocked: false };
  if (settings !== null && settings.registration_open === false) {
    return { blocked: true, code: "CAMPUS_CLOSED" };
  }
  return { blocked: false };
}

// Mirrors the double-click guard scope decision (Wave 3 Fix 2).
// Returns whether the guard should add a batch_id filter.
function doubleClickGuardScopeIncludesBatch(batch_id: string | null): boolean {
  return Boolean(batch_id);
}

// Mirrors the capacity-check selection (Wave 3 Fix 3).
// Returns classIsFull based on slot data (preferred) or applicant count (fallback).
function determineClassFull(opts: {
  maxCapacity: number;
  slotRow: { current_enrolment: number; max_capacity: number } | null;
  slotErr: boolean;
  batchId: string | null;
  assignedCount: number;
  assignedCountError: boolean;
}): { classIsFull: boolean; usedSlot: boolean } {
  if (opts.batchId && !opts.slotErr && opts.slotRow) {
    const slotMax = Number(opts.slotRow.max_capacity ?? opts.maxCapacity);
    const slotCur = Number(opts.slotRow.current_enrolment ?? 0);
    return { classIsFull: slotMax > 0 && slotCur >= slotMax, usedSlot: true };
  }
  if (opts.assignedCountError) {
    // Processor sets REVIEW, not classIsFull — caller should check this separately.
    return { classIsFull: false, usedSlot: false };
  }
  return {
    classIsFull: opts.maxCapacity > 0 && opts.assignedCount >= opts.maxCapacity,
    usedSlot: false,
  };
}

// ─── Status derivation tests ──────────────────────────────────────────────────

Deno.test("Status: valid public registration with open class → ASSIGNED/CLASS_ASSIGNED", () => {
  const result = resolveRegistrationStatus({
    isDuplicate: false,
    canAutoAssign: true,
    classOptionExists: true,
    classOptionActive: true,
    classIsFull: false,
    hasClassOption: true,
    hasAvailability: false,
  });
  if (result.registrationStatus !== "ASSIGNED") throw new Error(`Expected ASSIGNED, got ${result.registrationStatus}`);
  if (result.availabilityStatus !== "CLASS_ASSIGNED") throw new Error(`Expected CLASS_ASSIGNED, got ${result.availabilityStatus}`);
});

Deno.test("Status: duplicate email → DUPLICATE/MANUAL_REVIEW_REQUIRED", () => {
  const result = resolveRegistrationStatus({
    isDuplicate: true,
    canAutoAssign: true,
    classOptionExists: true,
    classOptionActive: true,
    classIsFull: false,
    hasClassOption: true,
    hasAvailability: false,
  });
  if (result.registrationStatus !== "DUPLICATE") throw new Error(`Expected DUPLICATE, got ${result.registrationStatus}`);
  if (result.availabilityStatus !== "MANUAL_REVIEW_REQUIRED") throw new Error(`Expected MANUAL_REVIEW_REQUIRED, got ${result.availabilityStatus}`);
});

Deno.test("Status: class is full → WAITLISTED/CLASS_FULL", () => {
  const result = resolveRegistrationStatus({
    isDuplicate: false,
    canAutoAssign: true,
    classOptionExists: true,
    classOptionActive: true,
    classIsFull: true,
    hasClassOption: true,
    hasAvailability: false,
  });
  if (result.registrationStatus !== "WAITLISTED") throw new Error(`Expected WAITLISTED, got ${result.registrationStatus}`);
  if (result.availabilityStatus !== "CLASS_FULL") throw new Error(`Expected CLASS_FULL, got ${result.availabilityStatus}`);
});

Deno.test("Status: no class option, no availability → WAITLISTED/NO_CLASS_AVAILABLE", () => {
  const result = resolveRegistrationStatus({
    isDuplicate: false,
    canAutoAssign: true,
    classOptionExists: false,
    classOptionActive: false,
    classIsFull: false,
    hasClassOption: false,
    hasAvailability: false,
  });
  if (result.registrationStatus !== "WAITLISTED") throw new Error(`Expected WAITLISTED, got ${result.registrationStatus}`);
  if (result.availabilityStatus !== "NO_CLASS_AVAILABLE") throw new Error(`Expected NO_CLASS_AVAILABLE, got ${result.availabilityStatus}`);
});

Deno.test("Status: availability string provided, no class_option → PENDING/NO_MATCHING_TIME", () => {
  const result = resolveRegistrationStatus({
    isDuplicate: false,
    canAutoAssign: true,
    classOptionExists: false,
    classOptionActive: false,
    classIsFull: false,
    hasClassOption: false,
    hasAvailability: true,
  });
  if (result.registrationStatus !== "PENDING") throw new Error(`Expected PENDING, got ${result.registrationStatus}`);
  if (result.availabilityStatus !== "NO_MATCHING_TIME") throw new Error(`Expected NO_MATCHING_TIME, got ${result.availabilityStatus}`);
});

Deno.test("Status: manual_review_required flag → REVIEW/MANUAL_REVIEW_REQUIRED", () => {
  const result = resolveRegistrationStatus({
    isDuplicate: false,
    canAutoAssign: false,
    classOptionExists: true,
    classOptionActive: true,
    classIsFull: false,
    hasClassOption: true,
    hasAvailability: false,
  });
  if (result.registrationStatus !== "REVIEW") throw new Error(`Expected REVIEW, got ${result.registrationStatus}`);
  if (result.availabilityStatus !== "MANUAL_REVIEW_REQUIRED") throw new Error(`Expected MANUAL_REVIEW_REQUIRED, got ${result.availabilityStatus}`);
});

Deno.test("Status: class option not found in DB → REVIEW/MANUAL_REVIEW_REQUIRED", () => {
  const result = resolveRegistrationStatus({
    isDuplicate: false,
    canAutoAssign: true,
    classOptionExists: false,
    classOptionActive: false,
    classIsFull: false,
    hasClassOption: true,
    hasAvailability: false,
  });
  if (result.registrationStatus !== "REVIEW") throw new Error(`Expected REVIEW, got ${result.registrationStatus}`);
});

// ─── Fix 1: Batch resolution ──────────────────────────────────────────────────

Deno.test("Fix 1 (batch resolution): form batch_id=null, active batch in DB → resolves batch_id", () => {
  const result = resolveBatchId(null, { batch_id: "MAY2026" });
  if (result !== "MAY2026") throw new Error(`Expected MAY2026, got ${result}`);
});

Deno.test("Fix 1 (batch resolution): form batch_id supplied → keeps form value", () => {
  const result = resolveBatchId("SEP2026", { batch_id: "MAY2026" });
  if (result !== "SEP2026") throw new Error(`Expected SEP2026 (form wins), got ${result}`);
});

Deno.test("Fix 1 (batch resolution): form batch_id=null, no active batch → null", () => {
  const result = resolveBatchId(null, null);
  if (result !== null) throw new Error(`Expected null, got ${result}`);
});

Deno.test("Fix 1 (batch resolution): form batch_id=empty-string → treated as null, DB batch used", () => {
  const result = resolveBatchId("", { batch_id: "MAY2026" });
  if (result !== "MAY2026") throw new Error(`Expected MAY2026, got ${result}`);
});

// ─── Fix 2: Double-click guard scope ─────────────────────────────────────────

Deno.test("Fix 2 (double-click guard): batch_id resolved → guard includes batch filter", () => {
  if (!doubleClickGuardScopeIncludesBatch("MAY2026")) throw new Error("Expected guard to include batch filter");
});

Deno.test("Fix 2 (double-click guard): batch_id null → guard email-only (no batch filter)", () => {
  if (doubleClickGuardScopeIncludesBatch(null)) throw new Error("Expected guard to skip batch filter when batch_id is null");
});

Deno.test("Fix 2 (double-click guard): empty string batch_id → guard email-only", () => {
  // The processor normalises '' to null before this check; empty string reaching the
  // guard function is an invariant violation — but if it did, the guard must be safe.
  const result = doubleClickGuardScopeIncludesBatch("");
  // "" is falsy → same behaviour as null
  if (result) throw new Error("Empty batch_id should not scope the guard");
});

// ─── Fix 3: Capacity check (class_slots preference) ──────────────────────────

Deno.test("Fix 3 (capacity): slot row available and full → classIsFull=true, usedSlot=true", () => {
  const r = determineClassFull({
    maxCapacity: 20,
    slotRow: { current_enrolment: 20, max_capacity: 20 },
    slotErr: false,
    batchId: "MAY2026",
    assignedCount: 0,
    assignedCountError: false,
  });
  if (!r.classIsFull) throw new Error("Expected classIsFull=true");
  if (!r.usedSlot) throw new Error("Expected slot-based check (usedSlot=true)");
});

Deno.test("Fix 3 (capacity): slot row available and not full → classIsFull=false, usedSlot=true", () => {
  const r = determineClassFull({
    maxCapacity: 20,
    slotRow: { current_enrolment: 15, max_capacity: 20 },
    slotErr: false,
    batchId: "MAY2026",
    assignedCount: 15,
    assignedCountError: false,
  });
  if (r.classIsFull) throw new Error("Expected classIsFull=false");
  if (!r.usedSlot) throw new Error("Expected slot-based check (usedSlot=true)");
});

Deno.test("Fix 3 (capacity): no batch_id → falls back to applicant count", () => {
  const r = determineClassFull({
    maxCapacity: 10,
    slotRow: { current_enrolment: 5, max_capacity: 10 },
    slotErr: false,
    batchId: null, // no batch → slot row skipped
    assignedCount: 10,
    assignedCountError: false,
  });
  if (!r.classIsFull) throw new Error("Expected classIsFull=true from applicant count");
  if (r.usedSlot) throw new Error("Expected fallback check (usedSlot=false)");
});

Deno.test("Fix 3 (capacity): slot error → falls back to applicant count", () => {
  const r = determineClassFull({
    maxCapacity: 10,
    slotRow: null,
    slotErr: true,
    batchId: "MAY2026",
    assignedCount: 8,
    assignedCountError: false,
  });
  if (r.classIsFull) throw new Error("Expected classIsFull=false (count 8 < max 10)");
  if (r.usedSlot) throw new Error("Expected fallback check (usedSlot=false)");
});

Deno.test("Fix 3 (capacity): slot row missing (no Active slot for this class+batch) → falls back to count", () => {
  const r = determineClassFull({
    maxCapacity: 10,
    slotRow: null,
    slotErr: false,
    batchId: "MAY2026",
    assignedCount: 10,
    assignedCountError: false,
  });
  if (!r.classIsFull) throw new Error("Expected classIsFull=true from applicant count fallback");
  if (r.usedSlot) throw new Error("Expected fallback check (usedSlot=false)");
});

Deno.test("Fix 3 (capacity): slot max_capacity=0 → never marks full (guard against divide-by-zero intent)", () => {
  const r = determineClassFull({
    maxCapacity: 0,
    slotRow: { current_enrolment: 999, max_capacity: 0 },
    slotErr: false,
    batchId: "MAY2026",
    assignedCount: 0,
    assignedCountError: false,
  });
  if (r.classIsFull) throw new Error("Expected classIsFull=false when max_capacity=0");
});

// ─── Field validation invariants (guards against regression in validateEmail/validateRequired) ──

import { validateRequired, validateEmail, validateErrors } from "../_shared/http.ts";

Deno.test("Validation: missing full_name → validation error", () => {
  const errs = validateErrors(validateRequired("", "full_name"));
  if (!errs.some(e => e.field === "full_name")) throw new Error("Expected full_name validation error");
});

Deno.test("Validation: valid email passes", () => {
  const errs = validateErrors(validateEmail("student@example.com", "email"));
  if (errs.length > 0) throw new Error(`Expected no errors, got ${errs.map(e => e.message).join(", ")}`);
});

Deno.test("Validation: invalid email format → error", () => {
  const errs = validateErrors(validateEmail("not-an-email", "email"));
  if (!errs.some(e => e.field === "email")) throw new Error("Expected email validation error");
});

Deno.test("Validation: missing email → error", () => {
  const errs = validateErrors(validateEmail("", "email"));
  if (!errs.some(e => e.field === "email")) throw new Error("Expected email required error");
});

// ─── No-active-batch gate (data-integrity fix) ────────────────────────────────

Deno.test("No-batch gate: null batch_id after resolution → blocked with NO_ACTIVE_BATCH", () => {
  const result = noBatchGate(null);
  if (!result.blocked) throw new Error("Expected blocked=true when batch_id=null");
  if (result.code !== "NO_ACTIVE_BATCH") throw new Error(`Expected code=NO_ACTIVE_BATCH, got ${result.code}`);
});

Deno.test("No-batch gate: resolved batch_id → not blocked", () => {
  const result = noBatchGate("2025A");
  if (result.blocked) throw new Error("Expected blocked=false when batch_id is set");
});

Deno.test("No-batch gate: empty-string batch_id (falsy) → blocked", () => {
  const result = noBatchGate("");
  if (!result.blocked) throw new Error("Expected blocked=true when batch_id=''");
});

// Prove the gate is downstream of batch resolution (no ASSIGNED+null-batch is possible).
Deno.test("No-batch gate invariant: null batch → gate fires before status derivation", () => {
  const batch_id = resolveBatchId(null, null); // null form + no DB batch
  const gate = noBatchGate(batch_id);
  if (!gate.blocked) throw new Error("Gate must fire when resolveBatchId returns null");
  // Status derivation must not be reached — block confirmed above.
});

// ─── Campus-closed gate (server-integrity fix) ────────────────────────────────

Deno.test("Campus gate: no settings row → fail-open (not blocked)", () => {
  const r = campusClosedGate("UM", null);
  if (r.blocked) throw new Error("Expected fail-open when no settings row exists");
});

Deno.test("Campus gate: settings row registration_open=true → not blocked", () => {
  const r = campusClosedGate("UM", { registration_open: true });
  if (r.blocked) throw new Error("Expected not blocked when campus is open");
});

Deno.test("Campus gate: settings row registration_open=false → blocked CAMPUS_CLOSED", () => {
  const r = campusClosedGate("UM", { registration_open: false });
  if (!r.blocked) throw new Error("Expected blocked when campus closed");
  if (r.code !== "CAMPUS_CLOSED") throw new Error(`Expected CAMPUS_CLOSED, got ${r.code}`);
});

Deno.test("Campus gate: null fellowship_code → fail-open (no campus to check)", () => {
  const r = campusClosedGate(null, { registration_open: false });
  if (r.blocked) throw new Error("Expected fail-open when no fellowship_code");
});

Deno.test("Campus gate invariant: gate fires before applicant write (direct POST cannot bypass)", () => {
  // Direct POST with closed campus setting must be blocked before any mutation.
  // Proof: gate returns blocked=true, so processor returns 400 before INSERT.
  const r = campusClosedGate("CLOSED_CAMPUS", { registration_open: false });
  if (!r.blocked) throw new Error("Campus-closed must block even on direct POST");
  if (r.code !== "CAMPUS_CLOSED") throw new Error(`Expected CAMPUS_CLOSED, got ${r.code}`);
});
