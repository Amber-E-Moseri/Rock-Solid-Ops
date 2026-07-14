import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withTrace, writeAudit } from "../_shared/audit.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MOODLE_URL = String(Deno.env.get("MOODLE_URL") || "").trim();
const MOODLE_TOKEN = String(Deno.env.get("MOODLE_TOKEN") || "").trim();

function applyAllowedOrigin(req: Request) {
  const allowed = String(Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const origin = String(req.headers.get("Origin") || "").trim();
  if (origin && allowed.includes(origin)) {
    corsHeaders["Access-Control-Allow-Origin"] = origin;
  } else {
    delete corsHeaders["Access-Control-Allow-Origin"];
  }
}

type ScheduledNotificationRow = {
  id: string;
  recipient_email: string;
  template_key: string;
  event_type?: string;
  applicant_id?: string;
  payload: Record<string, unknown> | null;
  status: string;
  attempts: number;
  max_attempts: number;
  scheduled_for: string;
  trace_id: string | null;
};

function buildSubjectFromTemplate(templateKey: string): string {
  const map: Record<string, string> = {
    foundation_welcome: "Welcome to Foundation School",
    duplicate_registration: "We received your additional registration",
    no_class_available: "Class options are not available yet",
    no_suitable_times: "We'll notify you when more class times open",
    class_assigned: "Your class has been assigned",
    class_approved: "New class options are now available",
    class_reminder_7_day: "Reminder: your class starts in 7 days",
    class_reminder_1_day: "Reminder: your class starts tomorrow",
    class_reminder_2_hour: "Reminder: your class starts in 2 hours",
    attendance_reminder: "Attendance reminder - {{class_name}} Session {{session_number}}",
    attendance_escalation: "Missing attendance - {{teacher_name}} {{class_name}}",
    moodle_login_reminder: "Your Foundation School class has started - log in to Moodle",
    classes_now_available: "Good news - a class is now available for you",
  };
  return map[templateKey] || "Foundation School Notification";
}

async function callMoodle(
  wsfunction: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  if (!MOODLE_URL || !MOODLE_TOKEN) throw new Error("MOODLE_URL and MOODLE_TOKEN are required");
  const body = new URLSearchParams({
    wstoken: MOODLE_TOKEN,
    wsfunction,
    moodlewsrestformat: "json",
    ...params,
  });
  const res = await fetch(`${MOODLE_URL}/webservice/rest/server.php`, { method: "POST", body });
  if (!res.ok) throw new Error(`Moodle HTTP ${res.status}`);
  const json = await res.json();
  if (json?.exception) throw new Error(`Moodle error: ${json.message || json.exception}`);
  return json as Record<string, unknown>;
}

async function shouldQueueMoodleReminder(db: any, row: ScheduledNotificationRow): Promise<{ queue: boolean; email: string; payload: Record<string, unknown> }> {
  const applicantId = String(row.applicant_id || "").trim();
  if (!applicantId) return { queue: false, email: "", payload: row.payload || {} };

  const { data: applicant } = await db
    .from("applicants")
    .select("id,email,full_name")
    .eq("id", applicantId)
    .maybeSingle();

  const email = String(applicant?.email || row.recipient_email || "").trim().toLowerCase();
  if (!email) return { queue: false, email: "", payload: row.payload || {} };

  const usersRes = await callMoodle("core_user_get_users", {
    "criteria[0][key]": "email",
    "criteria[0][value]": email,
  });
  const users = Array.isArray((usersRes as any)?.users) ? (usersRes as any).users : [];
  const firstUser = users[0] || null;
  const lastAccess = Number(firstUser?.lastaccess || 0);

  const classStartRaw = String((row.payload || {})?.class_start_date || "").trim();
  const classStartTs = classStartRaw ? new Date(`${classStartRaw}T00:00:00Z`).getTime() / 1000 : 0;

  if (lastAccess > 0 && classStartTs > 0 && lastAccess > classStartTs) {
    return { queue: false, email, payload: row.payload || {} };
  }

  return {
    queue: true,
    email,
    payload: {
      ...(row.payload || {}),
      email,
      full_name: String((row.payload || {}).full_name || applicant?.full_name || "").trim(),
      moodle_url: String((row.payload || {}).moodle_url || MOODLE_URL),
    },
  };
}

Deno.serve(async (req) => {
  applyAllowedOrigin(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit || 10), 1), 200);

    const nowIso = new Date().toISOString();
    let data: ScheduledNotificationRow[] | null = null;
    let error: { message?: string } | null = null;
    ({
      data,
      error,
    } = await db
      .from("scheduled_notifications")
      .select("id,recipient_email,template_key,event_type,applicant_id,payload,status,attempts,max_attempts,scheduled_for,trace_id")
      .eq("status", "PENDING")
      .lte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(limit));

    if (error) {
      const msg = JSON.stringify(error);
      if (msg.includes("trace_id")) {
        const legacyRes = await db
          .from("scheduled_notifications")
          .select("id,recipient_email,template_key,event_type,applicant_id,payload,status,attempts,max_attempts,scheduled_for")
          .eq("status", "PENDING")
          .lte("scheduled_for", nowIso)
          .order("scheduled_for", { ascending: true })
          .limit(limit);
        if (legacyRes.error) throw legacyRes.error;
        data = ((legacyRes.data || []) as Array<Record<string, unknown>>).map((row) => ({
          ...(row as ScheduledNotificationRow),
          trace_id: null,
        }));
      } else {
        throw error;
      }
    }

    const rows = (data || []) as ScheduledNotificationRow[];

    let processed = 0;
    let queued = 0;
    let failed = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      processed += 1;

      try {
        if ((row.attempts || 0) >= (row.max_attempts || 0)) {
          failed += 1;
          results.push({ id: row.id, status: "skipped_max_attempts" });
          continue;
        }

        const nextAttempts = (row.attempts || 0) + 1;
        const eventType = String(row.event_type || "").toLowerCase();
        let shouldQueue = true;
        let email = String(row.recipient_email || "").trim();
        let payload = (row.payload || {}) as Record<string, unknown>;

        if (eventType === "moodle_login_check") {
          const moodleCheck = await shouldQueueMoodleReminder(db, row);
          shouldQueue = moodleCheck.queue;
          email = moodleCheck.email || email;
          payload = moodleCheck.payload || payload;
        }

        if (shouldQueue) {
          const subject = buildSubjectFromTemplate(String(row.template_key || ""));
          const emailQueueInsert = {
            recipient_email: email,
            recipient_name: String(payload.full_name || ""),
            template_key: row.template_key,
            subject,
            status: "Pending",
            payload,
            trace_id: row.trace_id || null,
          };
          let queueErr: { message?: string } | null = null;
          ({ error: queueErr } = await db.from("email_queue").insert(emailQueueInsert));
          if (queueErr) {
            const queueMsg = JSON.stringify(queueErr);
            if (queueMsg.includes("trace_id")) {
              const legacyInsert = { ...emailQueueInsert } as Record<string, unknown>;
              delete legacyInsert.trace_id;
              ({ error: queueErr } = await db.from("email_queue").insert(legacyInsert));
            }
          }
          if (queueErr) throw queueErr;
        }

        const { error: sentErr } = await db
          .from("scheduled_notifications")
          .update({
            status: "SENT",
            sent_at: new Date().toISOString(),
            attempts: nextAttempts,
            error_message: null,
          })
          .eq("id", row.id);

        if (sentErr) throw sentErr;

        await writeAudit(
          db,
          "SCHEDULED_NOTIFICATION_QUEUED",
          row.id,
          withTrace(
            {
              recipient_email: email,
              template_key: row.template_key,
              event_type: row.event_type || null,
              queued: shouldQueue,
            },
            row.trace_id || null,
          ),
          {
            actor_email: "notification-batch-processor@system",
            entity_type: "scheduled_notification",
            status: "SUCCESS",
          },
        );

        if (shouldQueue) queued += 1;
        results.push({
          id: row.id,
          status: shouldQueue ? "queued" : "skipped",
          recipient_email: email,
          template_key: row.template_key,
          event_type: row.event_type || null,
        });
      } catch (rowErr) {
        const message = rowErr instanceof Error ? rowErr.message : String(rowErr);
        const nextAttempts = (row.attempts || 0) + 1;
        const nextStatus = nextAttempts >= (row.max_attempts || 0) ? "FAILED" : "PENDING";

        await db
          .from("scheduled_notifications")
          .update({ attempts: nextAttempts, status: nextStatus, error_message: message })
          .eq("id", row.id);

        failed += 1;
        results.push({ id: row.id, status: "failed", error: message, attempts: nextAttempts });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed, queued, failed, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
