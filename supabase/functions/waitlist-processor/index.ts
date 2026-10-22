import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateCronAuth, validateInternalAuth } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse, safeLogAudit, withTimeout } from "../_shared/http.ts";
import { buildClassAvailableDedupeKey, CANONICAL_TEMPLATE_KEY } from "./dedupe.ts";
import { notifyProfilesPush, resolveStaffRecipients } from "../_shared/push-notify.ts";

// Same selection-link base the DB trigger path uses (202605191920 / 202607141000).
const SELECTION_URL_BASE = "https://rocksolidsuite.netlify.app/foundation/registration/class-selection.html?token=";

let sb: any;

function authJson(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function createServiceDb(): any {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE, { auth: { persistSession: false } });
}

async function isAuthorizedStaff(db: any, userId: string, email?: string) {
  const profile = await db
    .from("profiles")
    .select("role,is_active")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile.error && profile.data) {
    const role = String(profile.data.role || "").toLowerCase();
    const active = profile.data.is_active !== false;
    return active && ["admin", "superadmin", "subgroup_admin", "pastor", "principal"].includes(role);
  }

  const legacy = await db
    .from("admin_users")
    .select("role,status,active")
    .or(`auth_user_id.eq.${userId}${email ? `,email.eq.${email}` : ""}`)
    .maybeSingle();
  if (legacy.error || !legacy.data) return false;
  const role = String(legacy.data.role || "").toLowerCase();
  const active = legacy.data.active !== false && legacy.data.status !== "suspended";
  return active && ["admin", "superadmin", "subgroup_admin", "pastor", "principal"].includes(role);
}

async function authorizeRequest(req: Request): Promise<Response | null> {
  if (req.headers.has("x-cron-secret")) {
    return validateCronAuth(req);
  }

  if (req.headers.has("x-internal-secret")) {
    return validateInternalAuth(req);
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return authJson({ ok: false, error: "Missing credentials" }, 401);
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const serviceDb = createServiceDb();
  const { data: userData, error: userErr } = await serviceDb.auth.getUser(token);
  if (userErr || !userData?.user) {
    return authJson({ ok: false, error: "Invalid session" }, 401);
  }

  const allowed = await isAuthorizedStaff(serviceDb, userData.user.id, userData.user.email);
  if (!allowed) return authJson({ ok: false, error: "Forbidden" }, 403);
  sb = serviceDb;
  return null;
}

interface Slot {
  class_slot_id: string;
  class_option_id: string;
  batch_id: string;
  max_capacity: number | null;
  current_enrolment: number;
}

interface RunResults {
  slots_checked: number;
  notified: number;
  errors: string[];
}

type ClassInfo = {
  teacher_name: string | null;
  day: string | null;
  class_time: string | null;
  fellowship_codes?: string[] | null;
} | null;

async function getClassInfo(classOptionId: string): Promise<ClassInfo> {
  const { data } = await sb
    .from("class_options")
    .select("teacher_name,day,class_time,fellowship_codes")
    .eq("class_option_id", classOptionId)
    .limit(1)
    .maybeSingle();
  return data as ClassInfo;
}

async function notifyClassNowAvailable(slot: Slot, classInfo: ClassInfo, results: RunResults): Promise<number> {
  const classDay = String(classInfo?.day || "").trim();
  const classTime = String(classInfo?.class_time || "").trim();
  const teacherName = String(classInfo?.teacher_name || "").trim();
  const fellowshipCodes = Array.isArray(classInfo?.fellowship_codes)
    ? classInfo!.fellowship_codes!.map((v) => String(v || "").trim()).filter(Boolean)
    : [];

  if (!classDay || !fellowshipCodes.length) return 0;

  const { data: candidates, error } = await sb
    .from("applicants")
    .select("id,full_name,email,fellowship_code,batch_id,availability,availability_status")
    .eq("batch_id", slot.batch_id)
    .eq("availability_status", "NO_MATCHING_TIME")
    .in("fellowship_code", fellowshipCodes)
    .limit(500);

  if (error) {
    results.errors.push(`class_now_available lookup: ${error.message}`);
    return 0;
  }

  const dayNeedle = classDay.toLowerCase();
  const matched = (candidates || []).filter((c: any) => String(c.availability || "").toLowerCase().includes(dayNeedle));
  if (!matched.length) return 0;

  let notified = 0;
  for (const app of matched) {
    const firstName = String(app.full_name || "Student").split(/\s+/)[0];
    // Dedupe key format: see ai/statuses.md CLASS_AVAILABLE entry. Must be
    // identical in both trigger and cron. No timestamp component.
    const dedupeKey = buildClassAvailableDedupeKey(
      String(app.id),
      String(slot.batch_id),
      String(slot.class_option_id),
    );

    // Insert-if-absent: the previous blind upsert reset an existing row
    // (including SENT ones) back to PENDING on conflict, which could re-send.
    // Pre-check first so a suppressed duplicate never mints an orphan
    // selection token every 15 minutes.
    const { data: existing, error: existErr } = await sb
      .from("scheduled_notifications")
      .select("id")
      .eq("dedupe_key", dedupeKey)
      .limit(1)
      .maybeSingle();

    if (existErr) {
      results.errors.push(`class_available dedupe check ${app.id}: ${existErr.message}`);
      continue;
    }

    const flipAvailabilityStatus = async () => {
      await sb
        .from("applicants")
        .update({ availability_status: "CLASS_AVAILABLE", updated_at: new Date().toISOString() })
        .eq("id", app.id)
        .eq("availability_status", "NO_MATCHING_TIME");
    };

    const auditSuppressed = async () => {
      await safeLogAudit(sb, {
        actor_email: "waitlist-processor@system",
        action: "WAITLIST_DUPLICATE_SUPPRESSED",
        entity_type: "applicant",
        entity_id: app.id,
        status: "SUCCESS",
        details: {
          class_option_id: slot.class_option_id,
          batch_id: slot.batch_id,
          dedupe_key: dedupeKey,
          source: "cron",
        },
      });
    };

    if (existing) {
      await auditSuppressed();
      // Behavioral parity with the old upsert path, which also flipped the
      // status on conflict: the applicant already has a notification row for
      // this exact (applicant, batch, class_option), so flip them out of the
      // candidate pool rather than re-auditing every 15 minutes forever.
      await flipAvailabilityStatus();
      continue;
    }

    // Mint the selection token only after the dedupe check passes.
    const { data: tokenRow, error: tokenErr } = await sb
      .from("class_selection_tokens")
      .insert({
        applicant_id: app.id,
        batch_id: slot.batch_id,
        fellowship_code: String(app.fellowship_code || "").trim(),
      })
      .select("token")
      .single();

    if (tokenErr || !tokenRow?.token) {
      results.errors.push(`classes_now_available token ${app.id}: ${tokenErr?.message || "no token returned"}`);
      continue;
    }

    const selectionUrl = `${SELECTION_URL_BASE}${tokenRow.token}`;

    // ignoreDuplicates guards the small race window after the pre-check; a
    // conflicting concurrent insert is silently skipped (empty data array),
    // never overwritten.
    const queueRes = await sb.from("scheduled_notifications").upsert({
      dedupe_key: dedupeKey,
      recipient_email: String(app.email || "").trim().toLowerCase(),
      applicant_id: app.id,
      event_type: "CLASS_OPTIONS_AVAILABLE",
      template_key: CANONICAL_TEMPLATE_KEY,
      scheduled_for: new Date().toISOString(),
      status: "PENDING",
      payload: {
        first_name: firstName,
        full_name: app.full_name,
        email: app.email,
        selection_url: selectionUrl,
        class_day: classDay,
        class_time: classTime,
        class_label: `${classDay}${classTime ? ` at ${classTime}` : ""}`,
        teacher_name: teacherName,
        fellowship_code: app.fellowship_code || "",
        class_option_id: slot.class_option_id,
        batch_id: slot.batch_id,
        expires_days: 7,
      },
    }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");

    if (queueRes.error) {
      results.errors.push(`classes_now_available queue ${app.id}: ${queueRes.error.message}`);
      continue;
    }

    const inserted = Array.isArray(queueRes.data) && queueRes.data.length > 0;
    if (!inserted) {
      // Lost the race to a concurrent producer between pre-check and insert.
      // The freshly minted token is orphaned but harmless (expires in 7 days).
      await auditSuppressed();
      await flipAvailabilityStatus();
      continue;
    }

    await flipAvailabilityStatus();

    await safeLogAudit(sb, {
      actor_email: "waitlist-processor@system",
      action: "CLASS_NOW_AVAILABLE_NOTIFIED",
      entity_type: "applicant",
      entity_id: app.id,
      status: "SUCCESS",
      details: {
        class_option_id: slot.class_option_id,
        batch_id: slot.batch_id,
        class_day: classDay,
        class_time: classTime,
        dedupe_key: dedupeKey,
        template_key: CANONICAL_TEMPLATE_KEY,
      },
    });

    notified += 1;
  }

  results.notified += notified;
  return notified;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFailure = await authorizeRequest(req);
  if (authFailure) return authFailure;
  if (!sb) sb = createServiceDb();

  try {
    const body = await req.json().catch(() => ({})) as {
      class_option_id?: string;
      batch_id?: string;
    };

    const results: RunResults = {
      slots_checked: 0,
      notified: 0,
      errors: [],
    };

    let slots: Slot[] = [];

    if (body.class_option_id && body.batch_id) {
      const { data } = await withTimeout(
        sb
          .from("class_slots")
          .select("class_slot_id,class_option_id,batch_id,max_capacity,current_enrolment")
          .eq("class_option_id", body.class_option_id)
          .eq("batch_id", body.batch_id)
          .eq("status", "Active")
          .limit(1),
        10000,
      );
      slots = (data as Slot[]) || [];
    } else {
      const { data: batches } = await withTimeout(
        sb.from("batches").select("batch_id").eq("active", true).limit(20),
        10000,
      );
      const batchIds = ((batches as { batch_id: string }[]) || []).map((b) => b.batch_id);
      if (batchIds.length) {
        const { data } = await withTimeout(
          sb
            .from("class_slots")
            .select("class_slot_id,class_option_id,batch_id,max_capacity,current_enrolment")
            .in("batch_id", batchIds)
            .eq("status", "Active")
            .limit(200),
          15000,
        );
        slots = (data as Slot[]) || [];
      }
    }

    results.slots_checked = slots.length;

    for (const slot of slots) {
      const classInfo = await getClassInfo(slot.class_option_id);
      await notifyClassNowAvailable(slot, classInfo, results);
    }

    // Complementary push channel (PWA Phase C.2): one summary nudge to admins
    // per run when the waitlist actually moved. Recipients = admins only
    // (superadmin + admin) per the C.2 gate. One push per run (not per student)
    // to avoid fragmenting related movements. Fire-and-forget: never affects the run.
    if (results.notified > 0) {
      try {
        const admins = await resolveStaffRecipients(sb, ["superadmin", "admin"]);
        if (admins.length > 0) {
          await notifyProfilesPush(sb, admins, {
            title: "Waitlist moved",
            body: `${results.notified} waitlisted student${results.notified === 1 ? "" : "s"} matched a now-available class.`,
            url: "/staff/waitlist",
            type: "waitlist_movement",
          });
        }
      } catch (_pushErr) {
        // Best-effort only.
      }
    }

    return jsonResponse({ ok: true, ...results });
  } catch (err) {
    console.error("WAITLIST_PROCESSOR_ERROR", err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
