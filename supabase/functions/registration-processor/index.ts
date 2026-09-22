import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders as sharedCorsHeaders,
  jsonResponse,
  classifyError,
  validateRequired,
  validateEmail,
  validateErrors,
  isValidPayload,
  safeLogAudit,
} from "../_shared/http.ts";
import { assignApplicant } from "../_shared/lib/assign-applicant.ts";
import { notifyProfilesPush, resolveStaffRecipients } from "../_shared/push-notify.ts";

const allowedOrigins = [
  "https://rocksolidsuite.netlify.app",
  "https://rocksolid.lwcanada.org",
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = String(req.headers.get("origin") || req.headers.get("Origin") || "").trim();
  const matchedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    "Access-Control-Allow-Origin": matchedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  Object.assign(sharedCorsHeaders, corsHeaders);
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const db = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );
    const body = await req.json().catch(() => ({}));
    
    // Input validation
    if (!isValidPayload(body)) {
      return jsonResponse({ ok: false, error: "Invalid payload", code: "INVALID_PAYLOAD", statusCode: 400 }, 400);
    }

    const resolveAdminCaller = async () => {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!tokenMatch?.[1]) return { user: null, isAdmin: false };

      const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
      if (!SUPABASE_ANON_KEY) return { user: null, isAdmin: false };
      const authDb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${tokenMatch[1].trim()}` } },
      });
      const userRes = await authDb.auth.getUser();
      const user = userRes.data?.user || null;
      if (userRes.error || !user) return { user: null, isAdmin: false };

      const profileRes = await db
        .from("profiles")
        .select("role,is_active")
        .eq("user_id", user.id)
        .maybeSingle();
      const role = String(profileRes.data?.role || "").trim().toLowerCase();
      const isActive = profileRes.data?.is_active !== false;
      const allowed = new Set(["admin", "superadmin"]);
      return { user, isAdmin: Boolean(profileRes.data && isActive && allowed.has(role)) };
    };

    const adminOverrideFields = [
      "registration_status",
      "status",
      "availability_status",
      "assigned_at",
      "waitlisted_at",
      "reviewed_at",
      "review_notes",
      "retry_assignment",
      "assignment_attempts",
      "needs_admin_review",
      "admin_note",
    ];
    const hasAdminOverrideInput = adminOverrideFields.some((k) => Object.prototype.hasOwnProperty.call(body, k));
    if (hasAdminOverrideInput) {
      const caller = await resolveAdminCaller();
      if (!caller.isAdmin) {
        return jsonResponse({ ok: false, error: "Forbidden", code: "FORBIDDEN", statusCode: 403 }, 403);
      }
    }

    const full_name = String(body.full_name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const fellowship_code = String(body.fellowship_code || "").trim() || null;
    const class_option_id = String(body.class_option_id || "").trim() || null;
    let batch_id = String(body.batch_id || "").trim() || null;
    const availability = String(body.availability || "").trim() || null;

    // Validate required fields
    const validationErrors = validateErrors(
      validateRequired(full_name, "full_name"),
      validateEmail(email, "email"),
    );

    if (validationErrors.length > 0) {
      return jsonResponse({
        ok: false,
        error: validationErrors.map(e => e.message).join(", "),
        code: "VALIDATION_ERROR",
        statusCode: 400
      }, 400);
    }

    // ── Layer 2: Payload validation hardening (runs before any DB writes) ──
    if (full_name.length > 255 || email.length > 255) {
      return jsonResponse({ ok: false, error: "FIELD_TOO_LONG", code: "VALIDATION" }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ ok: false, error: "INVALID_EMAIL", code: "VALIDATION" }, 400);
    }
    if (phone && !/^[\d\s+\-().]+$/.test(phone)) {
      return jsonResponse({ ok: false, error: "INVALID_PHONE", code: "VALIDATION" }, 400);
    }

    // ── Resolve active batch when form did not supply one ─────────────────
    // The public registration form always sends batch_id: null. Without a
    // batch_id the double-click guard and same-batch duplicate check both
    // malfunction, and applicant records lose their batch association.
    if (!batch_id) {
      const { data: activeBatch } = await db
        .from("batches")
        .select("batch_id")
        .or("active.eq.true,registration_open.eq.true")
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (activeBatch?.batch_id) {
        batch_id = String(activeBatch.batch_id).trim() || null;
      }
    }

    // Registration without a batch is not meaningful: there is no intake to enroll into.
    // Return a controlled 400 rather than creating a partially-committed applicant row.
    if (!batch_id) {
      return jsonResponse({ ok: false, error: "Registration is not currently open.", code: "NO_ACTIVE_BATCH" }, 400);
    }

    // ── Campus registration gate (server-side; direct POST cannot bypass) ──
    // Authoritative key: the submitted fellowship_code resolved against
    // batch_campus_registration_settings for the active batch.
    // Fail-open semantics: missing setting row means campus is open.
    if (fellowship_code) {
      const { data: campusSettings } = await db
        .from("batch_campus_registration_settings")
        .select("registration_open")
        .eq("batch_id", batch_id)
        .eq("fellowship_code", fellowship_code)
        .maybeSingle();
      if (campusSettings !== null && campusSettings.registration_open === false) {
        return jsonResponse({
          ok: false,
          error: "Registration for your campus is currently closed.",
          code: "CAMPUS_CLOSED",
        }, 400);
      }
    }

    // ── Layer 3: Double-click / resubmission guard ────────────────────────
    // batch_id is always non-null here (early-return gate above ensures it).
    let recentQuery = db
      .from("applicants")
      .select("id")
      .eq("email", email)
      .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .limit(1);
    if (batch_id) {
      recentQuery = recentQuery.eq("batch_id", batch_id);
    }
    const { data: recentSubmission } = await recentQuery.maybeSingle();

    if (recentSubmission) {
      return jsonResponse({
        ok: true,
        isDuplicate: true,
        message: "Your registration was already received.",
      }, 200);
    }

    const nowIso = new Date().toISOString();
    const flowTraceId = crypto.randomUUID();
    const applicantId = crypto.randomUUID();
    const debugTrail: Record<string, unknown> = {
      started_at: nowIso,
      phase: "received",
      trace_id: flowTraceId,
    };

    const first_name = full_name.split(" ")[0] || full_name;
    const last_name = full_name.split(" ").slice(1).join(" ");

    // Duplicate detection is informational only; it must never block registration.
    const { count, error: countError } = await db
      .from("applicants")
      .select("*", { count: "exact", head: true })
      .eq("email", email);

    if (countError) {
      console.error("REGISTRATION_PROCESSOR_DUPLICATE_COUNT_ERROR", countError);
    }

    const existingCount = count || 0;
    const duplicateCount = existingCount + 1;
    const isDuplicate = existingCount > 0;

    let existingSameBatchApplicant: Record<string, unknown> | null = null;
    if (batch_id) {
      const { data: sameBatchApplicant, error: sameBatchError } = await db
        .from("applicants")
        .select("id, registration_status, status, batch_id, email, duplicate_count")
        .eq("email", email)
        .eq("batch_id", batch_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sameBatchError) {
        console.error("REGISTRATION_PROCESSOR_SAME_BATCH_DUPLICATE_CHECK_ERROR", sameBatchError);
      } else {
        existingSameBatchApplicant = sameBatchApplicant as Record<string, unknown> | null;
      }
    }

    const sameBatchStatus = String(
      existingSameBatchApplicant?.registration_status ||
      existingSameBatchApplicant?.status ||
      "",
    ).toUpperCase();
    const forceDuplicateByBatch = Boolean(existingSameBatchApplicant && sameBatchStatus.length > 0);
    const duplicateGuardExistingId = String(existingSameBatchApplicant?.id || "").trim();
    const duplicateGuardReason =
      forceDuplicateByBatch && sameBatchStatus === "DUPLICATE"
        ? "existing_duplicate_in_same_batch"
        : forceDuplicateByBatch
        ? "existing_registration_in_same_batch"
        : "";

    console.log("DUPLICATE_CHECK", {
      email,
      existingCount,
      duplicateCount,
      isDuplicate,
      batchId: batch_id,
      sameBatchExistingId: duplicateGuardExistingId || null,
      sameBatchStatus: sameBatchStatus || null,
      duplicateGuardReason: duplicateGuardReason || null,
    });

    const normalizeBool = (v: unknown) =>
      v === true || String(v ?? "").toLowerCase() === "true";

    const canAutoAssign = !normalizeBool(body.assignment_deferred) && !normalizeBool(body.manual_review_required);
    let registrationStatus = "PENDING";
    let availabilityStatus = "MANUAL_REVIEW_REQUIRED";
    let classIsFull = false;
    let assignedAt: string | null = null;
    let waitlistedAt: string | null = null;
    let reviewedAt: string | null = null;
    let reviewNotes: string | null = null;

    if (isDuplicate) {
      registrationStatus = "DUPLICATE";
      availabilityStatus = "MANUAL_REVIEW_REQUIRED";
      reviewedAt = nowIso;
      reviewNotes = `Duplicate registration detected. This email has submitted ${duplicateCount} times.`;
    } else if (!canAutoAssign) {
      registrationStatus = "REVIEW";
      availabilityStatus = "MANUAL_REVIEW_REQUIRED";
      reviewedAt = nowIso;
      reviewNotes = "Auto-assignment deferred for manual review.";
    } else if (class_option_id) {
      const { data: classOptionRow, error: classOptionError } = await db
        .from("class_options")
        .select("class_option_id,max_capacity,active,enrollment_open")
        .eq("class_option_id", class_option_id)
        .maybeSingle();

      if (classOptionError || !classOptionRow) {
        registrationStatus = "REVIEW";
        availabilityStatus = "MANUAL_REVIEW_REQUIRED";
        reviewedAt = nowIso;
        reviewNotes = classOptionError ? "Could not safely validate selected class option." : "Selected class option no longer exists.";
      } else {
        const maxCapacity = Number(classOptionRow.max_capacity || 0);
        // Prefer class_slots (batch-scoped, authoritative) when batch is known.
        // Fall back to counting assigned applicants when no slot record exists.
        let capacityChecked = false;
        if (batch_id) {
          const { data: slotRow, error: slotErr } = await db
            .from("class_slots")
            .select("current_enrolment,max_capacity")
            .eq("class_option_id", class_option_id)
            .eq("batch_id", batch_id)
            .eq("status", "Active")
            .maybeSingle();
          if (!slotErr && slotRow) {
            const slotMax = Number(slotRow.max_capacity ?? maxCapacity);
            const slotCur = Number(slotRow.current_enrolment ?? 0);
            classIsFull = slotMax > 0 && slotCur >= slotMax;
            capacityChecked = true;
          }
        }
        if (!capacityChecked) {
          const { count: assignedCount, error: assignedCountError } = await db
            .from("applicants")
            .select("*", { count: "exact", head: true })
            .eq("class_option_id", class_option_id)
            .eq("registration_status", "ASSIGNED");
          if (assignedCountError) {
            registrationStatus = "REVIEW";
            availabilityStatus = "MANUAL_REVIEW_REQUIRED";
            reviewedAt = nowIso;
            reviewNotes = "Could not validate class capacity safely.";
            capacityChecked = true;
          } else {
            classIsFull = maxCapacity > 0 && Number(assignedCount || 0) >= maxCapacity;
            capacityChecked = true;
          }
        }
        if (capacityChecked && registrationStatus === "PENDING") {
          if (classIsFull) {
            registrationStatus = "WAITLISTED";
            availabilityStatus = "CLASS_FULL";
            waitlistedAt = nowIso;
          } else {
            registrationStatus = "ASSIGNED";
            availabilityStatus = "CLASS_ASSIGNED";
            assignedAt = nowIso;
          }
        }
      }
    } else if (availability) {
      registrationStatus = "PENDING";
      availabilityStatus = "NO_MATCHING_TIME";
    } else {
      registrationStatus = "WAITLISTED";
      availabilityStatus = "NO_CLASS_AVAILABLE";
      waitlistedAt = nowIso;
    }

    let registrationStatusTyped = String(registrationStatus || "PENDING") as
      | "PENDING"
      | "ASSIGNED"
      | "WAITLISTED"
      | "DUPLICATE"
      | "REVIEW"
      | "INACTIVE"
      | "COMPLETED";
    let availabilityStatusTyped = String(availabilityStatus || "MANUAL_REVIEW_REQUIRED") as
      | "CLASS_ASSIGNED"
      | "NO_MATCHING_TIME"
      | "CLASS_FULL"
      | "MANUAL_REVIEW_REQUIRED"
      | "NO_CLASS_AVAILABLE";
    const legacyStatus =
      registrationStatusTyped === "ASSIGNED" ? "Enrolled" :
      registrationStatusTyped === "WAITLISTED" ? "Waitlisted" :
      registrationStatusTyped === "DUPLICATE" ? "Duplicate" :
      registrationStatusTyped === "REVIEW" ? "Review" : "Pending";

    if (forceDuplicateByBatch) {
      registrationStatusTyped = "DUPLICATE";
      availabilityStatusTyped = "MANUAL_REVIEW_REQUIRED";
      reviewNotes = duplicateGuardReason === "existing_duplicate_in_same_batch"
        ? "Duplicate registration rejected: email already has DUPLICATE status in this batch."
        : "Duplicate registration rejected: email already registered in this batch.";
    }
    let group_id: string | null = null;
    let subgroup_id: string | null = null;
    if (fellowship_code && fellowship_code.toUpperCase() !== "REGIONAL") {
      const { data: fellowshipRow } = await db
        .from("fellowship_map")
        .select("group_id,subgroup_id")
        .eq("fellowship_code", fellowship_code)
        .eq("active", true)
        .maybeSingle();
      group_id = String(fellowshipRow?.group_id || "").trim() || null;
      subgroup_id = String(fellowshipRow?.subgroup_id || "").trim() || null;
    }

    const applicantInsertBase = {
      id: applicantId,
      full_name,
      first_name,
      last_name,
      email,
      phone,
      fellowship_code: fellowship_code || null,
      group_id,
      subgroup_id,
      class_option_id: class_option_id || null,
      batch_id: batch_id || null,
      availability,
      status: legacyStatus,
      registration_status: registrationStatusTyped,
      availability_status: availabilityStatusTyped,
      assigned_at: assignedAt,
      waitlisted_at: waitlistedAt,
      reviewed_at: reviewedAt,
      review_notes: reviewNotes,
      retry_assignment: registrationStatusTyped === "WAITLISTED",
      assignment_attempts: 1,
      source: "registration_processor",
      raw_payload: body,
    };

    const applicantInsertWithDuplicateFlags = {
      ...applicantInsertBase,
      duplicate_count: duplicateCount,
      needs_admin_review: isDuplicate || registrationStatusTyped === "REVIEW",
      admin_note: reviewNotes,
    };

    let applicant: Record<string, unknown> | null = null;
    let applicantError: unknown = null;
    if (forceDuplicateByBatch && duplicateGuardExistingId) {
      const { data: existingApplicant, error: existingApplicantError } = await db
        .from("applicants")
        .select("*")
        .eq("id", duplicateGuardExistingId)
        .maybeSingle();
      if (existingApplicantError) {
        applicantError = existingApplicantError;
      } else {
        applicant = existingApplicant as Record<string, unknown> | null;
      }
    } else {
      // For ASSIGNED registrations with a known class+batch: use the atomic RPC.
      // It acquires SELECT ... FOR UPDATE on class_slots, rechecks capacity under
      // the lock, and inserts the applicant in the same transaction.  A concurrent
      // request that arrives while the lock is held must wait, then re-reads the
      // trigger-incremented counter — closing the TOCTOU race.
      if (registrationStatusTyped === "ASSIGNED" && class_option_id && batch_id) {
        const { data: rpcResult, error: rpcError } = await db.rpc(
          "insert_applicant_reserve_slot",
          { p_applicant: applicantInsertWithDuplicateFlags },
        );
        if (rpcError) {
          applicantError = rpcError;
        } else if (rpcResult?.ok === false && rpcResult?.reason === "CLASS_FULL") {
          // Concurrent request filled the slot between our stale read and the lock.
          // Downgrade to WAITLISTED so this applicant enters the retry queue.
          registrationStatusTyped = "WAITLISTED";
          availabilityStatusTyped = "CLASS_FULL";
          waitlistedAt = new Date().toISOString();
          assignedAt = null;
          ({
            data: applicant,
            error: applicantError,
          } = await db
            .from("applicants")
            .insert({
              ...applicantInsertWithDuplicateFlags,
              registration_status: "WAITLISTED",
              availability_status: "CLASS_FULL",
              status: "Waitlisted",
              assigned_at: null,
              waitlisted_at: waitlistedAt,
              retry_assignment: true,
            })
            .select("*")
            .single());
        } else if (rpcResult?.ok === false) {
          // NO_SLOT or unexpected result — fall through to direct insert.
          ({
            data: applicant,
            error: applicantError,
          } = await db
            .from("applicants")
            .insert(applicantInsertWithDuplicateFlags)
            .select("*")
            .single());
        } else if (rpcResult?.ok === true) {
          // RPC inserted the row; fetch the full record.
          ({
            data: applicant,
            error: applicantError,
          } = await db
            .from("applicants")
            .select("*")
            .eq("id", rpcResult.applicant_id)
            .single());
        }
      } else {
        // Non-ASSIGNED paths (WAITLISTED, DUPLICATE, REVIEW, PENDING):
        // no capacity lock needed, use direct insert.
        ({
          data: applicant,
          error: applicantError,
        } = await db
          .from("applicants")
          .insert(applicantInsertWithDuplicateFlags)
          .select("*")
          .single());
      }

      if (applicantError) {
        const msg = JSON.stringify(applicantError);
        const duplicateFlagColumnsMissing =
          msg.includes("duplicate_count") ||
          msg.includes("needs_admin_review") ||
          msg.includes("admin_note");

        if (duplicateFlagColumnsMissing) {
          console.error(
            "REGISTRATION_PROCESSOR_SCHEMA_MIGRATION_NEEDED",
            "Add duplicate_count, needs_admin_review, admin_note columns to applicants.",
          );

          ({
            data: applicant,
            error: applicantError,
          } = await db
            .from("applicants")
            .insert(applicantInsertBase)
            .select("*")
            .single());
        }
      }
    }

    if (applicantError) {
      throw new Error(
        (applicantError as { message?: string })?.message ||
        (applicantError as { details?: string })?.details ||
        (applicantError as { hint?: string })?.hint ||
        JSON.stringify(applicantError)
      );
    }

    const insertedApplicant = applicant as { id?: string } | null;
    debugTrail.phase = "applicant_created";
    debugTrail.applicant_id = insertedApplicant?.id || null;
    console.log("APPLICANT_CREATED", {
      applicantId: insertedApplicant?.id,
      email,
      duplicateCount,
    });

    let classDetails: {
      class_option_id?: string;
      class_id?: string;
      teacher_name?: string;
      day?: string;
      class_time?: string;
    } | null = null;

    if (class_option_id) {
      const { data, error } = await db
        .from("class_options")
        .select("class_option_id,class_id,teacher_name,day,class_time")
        .eq("class_option_id", class_option_id)
        .maybeSingle();

      if (error) {
        console.error("REGISTRATION_PROCESSOR_CLASS_LOOKUP_ERROR", error);
      } else {
        classDetails = data;
      }
    }

    let fellowshipDetails: {
      fellowship_code?: string;
      campus_name?: string;
      timezone?: string;
    } | null = null;

    if (fellowship_code) {
      const { data, error } = await db
        .from("fellowship_map")
        .select("fellowship_code,campus_name,timezone")
        .eq("fellowship_code", fellowship_code)
        .maybeSingle();

      if (error) {
        console.error("REGISTRATION_PROCESSOR_FELLOWSHIP_LOOKUP_ERROR", error);
      } else {
        fellowshipDetails = data;
      }
    }

    let templateKey = "";
    let statusMessage = "";
    if (registrationStatusTyped === "DUPLICATE") templateKey = "duplicate_registration";
    if (registrationStatusTyped === "PENDING" && availabilityStatusTyped === "NO_MATCHING_TIME") {
      templateKey = "registration_status_update";
      statusMessage = "We received your availability preference and are working on a class time that fits your schedule.";
    }
    if (registrationStatusTyped === "WAITLISTED" && (availabilityStatusTyped === "CLASS_FULL" || availabilityStatusTyped === "NO_CLASS_AVAILABLE")) {
      templateKey = "registration_status_update";
      statusMessage = "You are on our waitlist while we work to open a class for your fellowship. We'll update you as soon as one is available.";
    }
    if (registrationStatusTyped === "REVIEW") {
      templateKey = "registration_status_update";
      statusMessage = "Your registration is currently under review by our team, and we will update you shortly with next steps.";
    }
    if (registrationStatusTyped === "WAITLISTED" && !templateKey) {
      templateKey = "registration_status_update";
      statusMessage = "We received your registration and are actively working on your placement. You are on our waitlist, and we will update you as soon as a suitable class opens.";
    }

    console.log("EMAIL_TEMPLATE_SELECTED", {
      email,
      registrationStatus: registrationStatusTyped,
      availabilityStatus: availabilityStatusTyped,
      templateKey,
    });

    // Note: email-sender resolves subject from the notification_templates row only —
    // email_queue.subject is not read at send time, kept here for readability/debugging.
    const emailQueuePayload = {
      recipient_email: email,
      recipient_name: full_name,
      template_key: templateKey,
      subject:
        templateKey === "foundation_welcome"
          ? "Welcome to Foundation School"
          : templateKey === "duplicate_registration"
          ? "We received your additional registration"
          : templateKey === "registration_status_update"
          ? "An update on your Foundation School registration"
          : "Your Foundation School registration update",
      status: "Pending",
      trace_id: flowTraceId,
      payload: {
        trace_id: flowTraceId,
        first_name,
        last_name,
        full_name,
        email,
        phone,
        duplicate_count: duplicateCount,
        registration_status: registrationStatusTyped,
        availability_status: availabilityStatusTyped,
        fellowship_code,
        class_option_id,
        batch_id,
        campus:
          body.fellowship_name ||
          body.fellowship_code ||
          "",
        class_label:
          body.class_label ||
          "",
        class_time:
          body.class_time ||
          "",
        class_day:
          body.class_day ||
          "",
        class_date:
          body.class_date ||
          body.class_start_date ||
          "",
        teacher_name:
          body.teacher_name ||
          "",
        timezone:
          body.timezone ||
          "",
        availability:
          body.availability || "",
        status_message: statusMessage,
        template_key: templateKey,
      },
    };
    if (templateKey) {
      let emailQueueInsertError: { message?: string } | null = null;
      ({ error: emailQueueInsertError } = await db
        .from("email_queue")
        .insert(emailQueuePayload));
      if (emailQueueInsertError) {
        const emailQueueMsg = JSON.stringify(emailQueueInsertError);
        if (emailQueueMsg.includes("trace_id")) {
          const emailQueueLegacyPayload = { ...emailQueuePayload };
          delete (emailQueueLegacyPayload as Record<string, unknown>).trace_id;
          ({ error: emailQueueInsertError } = await db
            .from("email_queue")
            .insert(emailQueueLegacyPayload));
        }
      }
      if (emailQueueInsertError) {
        console.error("REGISTRATION_PROCESSOR_EMAIL_QUEUE_INSERT_ERROR", emailQueueInsertError);
        throw new Error(
          `Queue insertion failure: ${emailQueueInsertError.message || "email_queue insert failed"}`,
        );
      }
      debugTrail.phase = "email_queued";
    }

    let moodleSyncRowId = "";
    if (registrationStatusTyped === "ASSIGNED") {
      const assigned = await assignApplicant(String(insertedApplicant?.id || ""), String(class_option_id || ""), db, {
        batchId: batch_id || undefined,
        triggeredBy: "registration",
        actorEmail: "registration-processor@system",
      });
      batch_id = assigned.batchId;
      try {
        const { data: moodleRow } = await db
          .from("moodle_enrollment_sync")
          .select("id")
          .eq("dedupe_key", `moodle-enroll:${String(insertedApplicant?.id || "")}`)
          .maybeSingle();
        moodleSyncRowId = String(moodleRow?.id || "");
      } catch (_) {}

      try {
        await db
          .from("scheduled_notifications")
          .upsert(
            {
              dedupe_key: `moodle-sync:${String(insertedApplicant?.id || "")}`,
              trace_id: flowTraceId,
              recipient_email: email,
              applicant_id: insertedApplicant?.id || null,
              event_type: "MOODLE_SYNC_REQUESTED",
              template_key: "class_assigned",
              status: "PENDING",
              scheduled_for: nowIso,
              payload: {
                trace_id: flowTraceId,
                applicant_id: insertedApplicant?.id,
                email,
                batch_id,
                class_option_id,
                registration_status: "ASSIGNED",
              },
            },
            { onConflict: "dedupe_key" },
          );
      } catch (moodleQueueErr) {
        console.error("REGISTRATION_PROCESSOR_MOODLE_QUEUE_ERROR", moodleQueueErr);
      }
    }

    const writeAudit = async (
      action: string,
      status: "SUCCESS" | "FAILED",
      details: Record<string, unknown>,
    ) => {
      await safeLogAudit(db, {
        actor_email: "registration-processor@system",
        action,
        entity_type: "applicant",
        entity_id: String(applicant?.id || ""),
        status,
        details,
      });
    };

    const commonAuditDetails = {
      trace_id: flowTraceId,
      full_name,
      email,
      fellowship_code,
      class_option_id,
      batch_id,
      availability,
      registration_status: registrationStatusTyped,
      availability_status: availabilityStatusTyped,
      class_is_full: classIsFull,
      template_key: templateKey,
      debug_trail: debugTrail,
    };

    await writeAudit(
      "REGISTRATION_RECEIVED",
      "SUCCESS",
      commonAuditDetails,
    );
    if (registrationStatusTyped === "ASSIGNED") {
      await writeAudit("REGISTRATION_ASSIGNED", "SUCCESS", commonAuditDetails);
      if (moodleSyncRowId) {
        await writeAudit("MOODLE_SYNC_QUEUED", "SUCCESS", {
          ...commonAuditDetails,
          moodle_sync_id: moodleSyncRowId,
        });
      }
    } else if (registrationStatusTyped === "WAITLISTED") {
      await writeAudit("REGISTRATION_WAITLISTED", "SUCCESS", commonAuditDetails);
    } else if (registrationStatusTyped === "INACTIVE") {
      await writeAudit("REGISTRATION_INACTIVE", "SUCCESS", commonAuditDetails);
      // Fire-and-forget: decrement slot and check waitlist for next eligible student
      if (class_option_id && batch_id) {
        void fetch(`${SUPABASE_URL}/functions/v1/waitlist-processor`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            applicant_id:    String(insertedApplicant?.id || ""),
            class_option_id,
            batch_id,
          }),
        }).catch(() => {});
      }
    } else if (registrationStatusTyped === "DUPLICATE") {
      await writeAudit("REGISTRATION_DUPLICATE", "SUCCESS", commonAuditDetails);
    } else if (registrationStatusTyped === "REVIEW") {
      await writeAudit("REGISTRATION_REVIEW", "SUCCESS", commonAuditDetails);
    }

    // Complementary push channel (PWA Phase C.2): nudge admins for the two
    // staff-actionable outcomes. Recipients = admins only (superadmin + admin),
    // per the C.2 gate decision. Fire-and-forget: notifyProfilesPush never
    // throws and no-ops without VAPID, so this can never affect registration.
    if (registrationStatusTyped === "REVIEW" || registrationStatusTyped === "DUPLICATE") {
      try {
        const admins = await resolveStaffRecipients(db, ["superadmin", "admin"]);
        if (admins.length > 0) {
          const label = registrationStatusTyped === "DUPLICATE" ? "possible duplicate" : "manual review";
          await notifyProfilesPush(db, admins, {
            title: "Registration needs attention",
            body: `A new registration (${email}) was flagged for ${label}.`,
            url: "/staff/applicant-directory",
            type: "registration_status",
          });
        }
      } catch (_pushErr) {
        // Best-effort only — must not affect the registration response.
      }
    }

    return jsonResponse({
      ok: true,
      data: {
        applicant_id: String(applicant?.id || ""),
        registration_status: registrationStatusTyped,
        availability_status: availabilityStatusTyped,
        template_key: templateKey,
        debug_trail: debugTrail,
        message: "Registration processed",
      },
      statusCode: 200,
    });

  } catch (error) {
    const c = classifyError(error);
    return jsonResponse({ ok: false, error: c.message, code: c.code, statusCode: c.statusCode }, c.statusCode);
  }
});

