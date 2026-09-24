import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withTrace, writeAudit } from "../_shared/audit.ts";
import { validateCronAuth } from "../_shared/auth.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  claimed_at?: string | null;
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

// Bounded Moodle API call (C6-PREACTIVATION).
// Uses AbortController + setTimeout (established pattern in moodle-grade-sync)
// rather than AbortSignal.timeout() which may not be available in all runtimes.
const MOODLE_TIMEOUT_MS = 15_000;

async function callMoodle(
  wsfunction: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const MOODLE_URL = String(Deno.env.get("MOODLE_URL") || "").trim();
  const MOODLE_TOKEN = String(Deno.env.get("MOODLE_TOKEN") || "").trim();
  if (!MOODLE_URL || !MOODLE_TOKEN) throw new Error("MOODLE_URL and MOODLE_TOKEN are required");
  const body = new URLSearchParams({
    wstoken: MOODLE_TOKEN,
    wsfunction,
    moodlewsrestformat: "json",
    ...params,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MOODLE_TIMEOUT_MS);
  try {
    const res = await fetch(`${MOODLE_URL}/webservice/rest/server.php`, {
      method: "POST",
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Moodle HTTP ${res.status}`);
    const json = await res.json();
    if (json?.exception) throw new Error(`Moodle error: ${json.message || json.exception}`);
    return json as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
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

  const moodleUrl = String(Deno.env.get("MOODLE_URL") || "").trim();
  return {
    queue: true,
    email,
    payload: {
      ...(row.payload || {}),
      email,
      full_name: String((row.payload || {}).full_name || applicant?.full_name || "").trim(),
      moodle_url: String((row.payload || {}).moodle_url || moodleUrl),
    },
  };
}

Deno.serve(async (req) => {
  applyAllowedOrigin(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authFailure = validateCronAuth(req);
  if (authFailure) return authFailure;

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit || 10), 1), 200);

    // Claim rows atomically.
    // The RPC handles stale PROCESSING recovery, terminal-exhausted sweep,
    // and FOR UPDATE SKIP LOCKED — two concurrent workers receive non-overlapping rows.
    const { data: claimedData, error: claimErr } = await db.rpc(
      "claim_notification_batch",
      { p_limit: limit },
    );

    if (claimErr) {
      const message = claimErr.message || String(claimErr);
      return new Response(
        JSON.stringify({ ok: false, error: message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rows = (claimedData || []) as ScheduledNotificationRow[];

    let processed = 0;
    let queued = 0;
    let failed = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      processed += 1;
      // nextAttempts is computed once, outside try/catch, from the original row value.
      // It is incremented exactly once per processing invocation — not on claim,
      // not on stale recovery, only when the try-block is entered (real work attempted).
      const nextAttempts = (row.attempts || 0) + 1;

      try {
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
            // source_notification_id enforces at-most-one delivery per source row.
            // The partial unique index (WHERE source_notification_id IS NOT NULL)
            // means other producers writing NULL are unaffected.
            source_notification_id: row.id,
          };

          // ignoreDuplicates: true maps to ON CONFLICT ... DO NOTHING.
          // Empty RETURNING means the delivery already exists (a prior run or
          // concurrent worker created it). Treat as "delivery already complete."
          const upsertRes = await db.from("email_queue").upsert(
            emailQueueInsert,
            { onConflict: "source_notification_id", ignoreDuplicates: true },
          ).select("id");

          if (upsertRes.error) throw upsertRes.error;
          // Empty data = delivery already exists. Still proceed to finalization.
        }

        // Finalize: mark source notification as SENT and clear the claim.
        const { error: sentErr } = await db
          .from("scheduled_notifications")
          .update({
            status: "SENT",
            sent_at: new Date().toISOString(),
            attempts: nextAttempts,
            error_message: null,
            claimed_at: null,
          })
          .eq("id", row.id);

        if (sentErr) {
          // Delivery is durable in email_queue but finalization failed.
          // Try compensating reset so the row becomes re-claimable. If the
          // reset also fails, the row remains PROCESSING and the 15-minute
          // stale recovery sweep in claim_notification_batch will reset it.
          // Either way the unique constraint prevents a duplicate delivery.
          try {
            await db
              .from("scheduled_notifications")
              .update({ status: "PENDING", claimed_at: null })
              .eq("id", row.id);
          } catch (_resetErr) {
            // Stale recovery handles this.
          }
          throw sentErr;
        }

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
        const nextStatus = nextAttempts >= (row.max_attempts || 3) ? "FAILED" : "PENDING";

        await db
          .from("scheduled_notifications")
          .update({ attempts: nextAttempts, status: nextStatus, error_message: message, claimed_at: null })
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
