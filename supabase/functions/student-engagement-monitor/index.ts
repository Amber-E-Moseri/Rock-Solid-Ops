import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  jsonResponse,
  safeLogAudit,
  withTimeout,
} from "../_shared/http.ts";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MOODLE_URL        = "https://rocksolid.lwcanada.org";
const BATCH_SIZE        = 20;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE);

// ── Config helpers ────────────────────────────────────────────────────────────
async function getConfig(): Promise<Record<string, number>> {
  const { data } = await sb.from("student_engagement_config").select("key,value");
  const map: Record<string, number> = {};
  for (const row of data || []) map[row.key] = Number(row.value) || 0;
  return {
    never_started_days:          map.never_started_days          ?? 7,
    dropoff_days:                map.dropoff_days                ?? 14,
    max_emails_per_scenario:     map.max_emails_per_scenario     ?? 2,
    never_started_email_enabled: map.never_started_email_enabled ?? 1,
    dropped_off_email_enabled:   map.dropped_off_email_enabled   ?? 1,
  };
}

// Check how many times we've already engaged this student for this scenario
async function countPriorEngagements(
  email: string,
  batchId: string,
  scenario: string,
): Promise<number> {
  const { count } = await sb
    .from("student_engagement_log")
    .select("id", { count: "exact", head: true })
    .eq("student_email", email)
    .eq("batch_id", batchId)
    .eq("scenario", scenario);
  return count ?? 0;
}

async function hasLogEntry(
  email: string,
  batchId: string,
  scenario: string,
): Promise<boolean> {
  const { data } = await sb
    .from("student_engagement_log")
    .select("id")
    .eq("student_email", email)
    .eq("batch_id", batchId)
    .eq("scenario", scenario)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function insertLog(
  email: string,
  batchId: string,
  scenario: string,
  action: string,
  notes?: string,
) {
  await sb.from("student_engagement_log").upsert(
    {
      student_email: email,
      batch_id:      batchId,
      scenario,
      action_taken:  action,
      email_sent_at: action === "email_queued" ? new Date().toISOString() : null,
      notes:         notes ?? null,
    },
    { onConflict: "student_email,batch_id,scenario" },
  );
}

async function queueEmail(
  recipientEmail: string,
  recipientName: string,
  templateKey: string,
  subject: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const traceId = String(payload?.trace_id || "").trim() || crypto.randomUUID();
  await sb.from("email_queue").insert({
    recipient_email: recipientEmail,
    recipient_name:  recipientName,
    template_key:    templateKey,
    subject,
    status:          "Pending",
    trace_id:        traceId,
    payload:         { ...payload, trace_id: traceId },
  });
  return traceId;
}

// ── Scenario A — Never Started ────────────────────────────────────────────────
async function processNeverStarted(
  batchId: string,
  batchStartDate: string,
  cfg: Record<string, number>,
): Promise<{ flagged: number; emails: number }> {
  const cutoff = new Date(batchStartDate);
  cutoff.setDate(cutoff.getDate() + cfg.never_started_days);
  if (new Date() < cutoff) return { flagged: 0, emails: 0 };

  // Applicants ASSIGNED in this batch who have a SYNCED moodle row
  const { data: applicants } = await withTimeout(
    sb
      .from("applicants")
      .select("id,email,full_name,fellowship_code,class_option_id,batch_id")
      .eq("batch_id", batchId)
      .eq("registration_status", "ASSIGNED")
      .limit(500),
    15000,
  );

  let flagged = 0; let emails = 0;

  for (let i = 0; i < (applicants?.length ?? 0); i += BATCH_SIZE) {
    const slice = applicants!.slice(i, i + BATCH_SIZE);
    await Promise.all(slice.map(async (app) => {
      if (!app.email) return;

      // Only fire never_started after Class 1 has been submitted by teacher.
      const { count: classOneSubmittedCount } = await sb
        .from("attendance_log")
        .select("attendance_id", { count: "exact", head: true })
        .eq("class_option_id", app.class_option_id)
        .eq("class_number", "1")
        .eq("submitted_by_teacher", true);
      if ((classOneSubmittedCount ?? 0) === 0) return;

      // Check Moodle SYNCED
      const { data: moodle } = await sb
        .from("moodle_enrollment_sync")
        .select("sync_status")
        .eq("email", app.email)
        .eq("batch_id", batchId)
        .limit(1);
      if (!moodle?.length || moodle[0].sync_status !== "SYNCED") return;

      // Check zero attendance
      const { count: attCount } = await sb
        .from("attendance_records")
        .select("id", { count: "exact", head: true })
        .eq("student_id", app.id)
        .eq("status", "present");
      if ((attCount ?? 0) > 0) return;

      const prior     = await countPriorEngagements(app.email, batchId, "never_started");
      if (prior >= cfg.max_emails_per_scenario) return;

      const cls = await getClassInfo(app.class_option_id);
      const firstName = String(app.full_name || "Student").split(/\s+/)[0];
      const payload = {
        first_name:      firstName,
        full_name:       app.full_name,
        class_time:      cls?.day ? `${cls.day} ${cls.class_time || ""}`.trim() : "your scheduled class time",
        teacher_name:    cls?.teacher_name || "your teacher",
        fellowship_code: app.fellowship_code || "",
        moodle_url:      MOODLE_URL,
      };

      if (prior === 0) {
        // First outreach — never_started template (email paused via student_engagement_config)
        const emailEnabled = !!cfg.never_started_email_enabled;
        let traceId = "";
        if (emailEnabled) {
          traceId = await queueEmail(app.email, app.full_name || "", "engagement_never_started",
            `We saved your spot at Foundation School — ${firstName}`, payload);
        }
        await insertLog(app.email, batchId, "never_started", emailEnabled ? "email_queued" : "skipped",
          emailEnabled ? "first outreach" : "email paused via student_engagement_config");
        await sb
          .from("students")
          .update({
            needs_attention_flag: true,
            needs_attention_reason: "Never started — enrolled but no attendance after 7 days",
            status: "At Risk",
            updated_at: new Date().toISOString(),
          })
          .eq("email", app.email)
          .or("needs_attention_flag.is.null,needs_attention_flag.eq.false");
        await safeLogAudit(sb, "ENGAGEMENT_NEVER_STARTED_FLAGGED", "applicant", String(app.id),
          { batch_id: batchId, email: app.email, trace_id: traceId, email_sent: emailEnabled });
        if (emailEnabled) emails++;
        flagged++;
      }
    }));
  }

  return { flagged, emails };
}

// ── Scenario B — Dropped Off ──────────────────────────────────────────────────
async function processDroppedOff(
  batchId: string,
  cfg: Record<string, number>,
): Promise<{ flagged: number; emails: number }> {
  const { data: students } = await withTimeout(
    sb
      .from("students")
      .select("student_id,email,full_name,fellowship_code,class_option_id,batch_id")
      .eq("batch_id", batchId)
      .eq("status", "Active")
      .is("deleted_at", null)
      .limit(500),
    15000,
  );

  let flagged = 0; let emails = 0;

  for (let i = 0; i < (students?.length ?? 0); i += BATCH_SIZE) {
    const slice = students!.slice(i, i + BATCH_SIZE);
    await Promise.all(slice.map(async (stu) => {
      if (!stu.email) return;

      // Get last present attendance
      const { data: lastAtt } = await sb
        .from("attendance_records")
        .select("class_date,class_number")
        .eq("student_id", stu.student_id)
        .eq("status", "present")
        .order("class_date", { ascending: false })
        .limit(1);

      if (!lastAtt?.length) return; // Never attended = handled by scenario A

      const lastDate    = new Date(lastAtt[0].class_date);
      const daysSinceLast = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
      if (daysSinceLast < cfg.dropoff_days) return;

      const prior     = await countPriorEngagements(stu.email, batchId, "dropped_off");
      if (prior >= cfg.max_emails_per_scenario) return;

      // Count missed sessions since last attendance
      const { count: missedCount } = await sb
        .from("attendance_records")
        .select("id", { count: "exact", head: true })
        .eq("student_id", stu.student_id)
        .gt("class_date", lastAtt[0].class_date);

      const cls = await getClassInfo(stu.class_option_id);
      const firstName = String(stu.full_name || "Student").split(/\s+/)[0];
      const payload = {
        first_name:         firstName,
        full_name:          stu.full_name,
        class_time:         cls?.day ? `${cls.day} ${cls.class_time || ""}`.trim() : "your class",
        teacher_name:       cls?.teacher_name || "your teacher",
        last_attended_date: lastDate.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }),
        sessions_missed:    String(missedCount ?? 0),
        moodle_url:         MOODLE_URL,
      };

      if (prior === 0) {
        // Email paused via student_engagement_config; flagging always proceeds
        const emailEnabled = !!cfg.dropped_off_email_enabled;
        let traceId = "";
        if (emailEnabled) {
          traceId = await queueEmail(stu.email, stu.full_name || "", "engagement_dropped_off",
            `We miss you at Foundation School — ${firstName}`, payload);
        }
        await insertLog(stu.email, batchId, "dropped_off", emailEnabled ? "email_queued" : "skipped",
          emailEnabled ? undefined : "email paused via student_engagement_config");
        await sb
          .from("students")
          .update({
            needs_attention_flag: true,
            needs_attention_reason: `Dropped off — no attendance in ${cfg.dropoff_days} days`,
            status: "At Risk",
            updated_at: new Date().toISOString(),
          })
          .eq("email", stu.email)
          .eq("status", "Active");
        await safeLogAudit(sb, "ENGAGEMENT_DROPPED_OFF_FLAGGED", "student", stu.student_id,
          { batch_id: batchId, days_since_last: daysSinceLast, trace_id: traceId, email_sent: emailEnabled });
        if (emailEnabled) emails++;
        flagged++;
      }
    }));
  }

  return { flagged, emails };
}

// ── Scenario C — Moodle No Login Proxy ───────────────────────────────────────
async function processMoodleNoLogin(
  batchId: string,
  cfg: Record<string, number>,
): Promise<{ flagged: number; emails: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);

  const { data: moodleRows } = await withTimeout(
    sb
      .from("moodle_enrollment_sync")
      .select("email,full_name,applicant_id")
      .eq("batch_id", batchId)
      .eq("sync_status", "SYNCED")
      .lt("synced_at", cutoff.toISOString())
      .not("moodle_user_id", "is", null)
      .limit(500),
    15000,
  );

  let flagged = 0; let emails = 0;

  for (let i = 0; i < (moodleRows?.length ?? 0); i += BATCH_SIZE) {
    const slice = moodleRows!.slice(i, i + BATCH_SIZE);
    await Promise.all(slice.map(async (row) => {
      if (!row.email) return;

      // Zero present attendance = proxy for no Moodle login
      const { count: attCount } = await sb
        .from("attendance_records")
        .select("id", { count: "exact", head: true })
        .eq("student_id", row.applicant_id)
        .eq("status", "present");
      if ((attCount ?? 0) > 0) return;

      if (await hasLogEntry(row.email, batchId, "moodle_no_login")) return;
      if (await hasLogEntry(row.email, batchId, "never_started")) return; // avoid duplicate

      // Shares the engagement_never_started template — same pause toggle applies
      const emailEnabled = !!cfg.never_started_email_enabled;
      const firstName = String(row.full_name || "Student").split(/\s+/)[0];
      let traceId = "";
      if (emailEnabled) {
        traceId = await queueEmail(row.email, row.full_name || "", "engagement_never_started",
          `We saved your spot at Foundation School — ${firstName}`, {
            first_name:  firstName,
            full_name:   row.full_name,
            class_time:  "your scheduled class time",
            teacher_name: "your teacher",
            moodle_url:  MOODLE_URL,
          });
      }
      await insertLog(row.email, batchId, "moodle_no_login", emailEnabled ? "email_queued" : "skipped",
        emailEnabled ? undefined : "email paused via student_engagement_config");
      await sb
        .from("students")
        .update({
          needs_attention_flag: true,
          needs_attention_reason: "Moodle account created but student has never logged in",
          updated_at: new Date().toISOString(),
        })
        .eq("email", row.email)
        .or("needs_attention_flag.is.null,needs_attention_flag.eq.false");
      await safeLogAudit(sb, "ENGAGEMENT_MOODLE_NO_LOGIN_FLAGGED", "applicant",
        row.applicant_id ?? row.email, { batch_id: batchId, trace_id: traceId, email_sent: emailEnabled });
      if (emailEnabled) emails++;
      flagged++;
    }));
  }

  return { flagged, emails };
}

// ── Class info cache ──────────────────────────────────────────────────────────
const _classCache = new Map<string, { day?: string; class_time?: string; teacher_name?: string }>();
async function getClassInfo(classOptionId: string | null) {
  if (!classOptionId) return null;
  if (_classCache.has(classOptionId)) return _classCache.get(classOptionId)!;
  const { data } = await sb
    .from("class_options")
    .select("day,class_time,teacher_name")
    .eq("class_option_id", classOptionId)
    .limit(1);
  const info = data?.[0] ?? null;
  if (info) _classCache.set(classOptionId, info);
  return info;
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const cfg = await getConfig();

    // Get active batches
    const { data: batches } = await withTimeout(
      sb.from("batches").select("batch_id,batch_name,start_date,start_sunday").eq("active", true).limit(20),
      10000,
    );

    let totalNeverStarted = 0;
    let totalDroppedOff   = 0;
    let totalMoodleLogin  = 0;
    let totalEmails       = 0;

    for (const batch of batches || []) {
      const startDate = batch.start_date || batch.start_sunday;

      const [a, b, c] = await Promise.all([
        processNeverStarted(batch.batch_id, startDate, cfg),
        processDroppedOff(batch.batch_id, cfg),
        processMoodleNoLogin(batch.batch_id, cfg),
      ]);

      totalNeverStarted += a.flagged;
      totalDroppedOff   += b.flagged;
      totalMoodleLogin  += c.flagged;
      totalEmails       += a.emails + b.emails + c.emails;
    }

    return jsonResponse({
      ok:                      true,
      batches_processed:       batches?.length ?? 0,
      never_started_flagged:   totalNeverStarted,
      dropped_off_flagged:     totalDroppedOff,
      moodle_no_login_flagged: totalMoodleLogin,
      emails_queued:           totalEmails,
    });
  } catch (err) {
    console.error("ENGAGEMENT_MONITOR_ERROR", err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});


