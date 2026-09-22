import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateCronAuth } from "../_shared/auth.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function dayNameToIso(day: string): number {
  const map: Record<string, number> = {
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
  };
  return map[String(day || "").trim().toLowerCase()] || 0;
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseYmd(ymd: string): Date | null {
  const v = String(ymd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function firstClassDateForBatch(batchStart: Date, targetIsoDay: number): Date {
  const first = new Date(batchStart.getTime());
  const startIsoDay = ((first.getUTCDay() + 6) % 7) + 1;
  const delta = (targetIsoDay - startIsoDay + 7) % 7;
  return addDays(first, delta);
}

function classLabel(classOptionId: string, day: string, classTime: string): string {
  const parts = [classOptionId, day, classTime].map((v) => String(v || "").trim()).filter(Boolean);
  return parts.join(" · ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authFailure = validateCronAuth(req);
  if (authFailure) return authFailure;

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const adminEmail = String(Deno.env.get("ATTENDANCE_ADMIN_EMAIL") || Deno.env.get("ADMIN_EMAIL") || "foundation@lwcanada.org").trim();
    const teacherPortalUrl = String(Deno.env.get("TEACHER_PORTAL_URL") || "https://rocksolid.lwcanada.org/foundation/staff/TeacherAttendancePortal.html").trim();
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "Missing Supabase env vars" }, 500);

    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const now = new Date();
    const nowMs = now.getTime();
    const todayYmd = toYmd(now);

    const slotRes = await db
      .from("class_slots")
      .select("class_option_id,batch_id,status,batches(batch_id,start_date,end_date,active,status),class_options(class_option_id,teacher_id,teacher_name,day,class_time,confirmed_start_date,active,deleted_at)")
      .eq("status", "Active")
      .limit(5000);
    if (slotRes.error) throw slotRes.error;

    const slots = (slotRes.data || []) as Array<Record<string, any>>;
    const teacherIds = [...new Set(slots.map((s) => String((Array.isArray(s.class_options) ? s.class_options[0] : s.class_options)?.teacher_id || "")).filter(Boolean))];
    const teacherMap = new Map<string, { email: string; full_name: string }>();
    if (teacherIds.length) {
      const tRes = await db.from("teachers").select("teacher_id,email,full_name").in("teacher_id", teacherIds);
      if (tRes.error) throw tRes.error;
      for (const t of tRes.data || []) teacherMap.set(String(t.teacher_id), { email: String(t.email || ""), full_name: String(t.full_name || "") });
    }

    let checkedSessions = 0;
    let remindersQueued = 0;
    let escalationsQueued = 0;
    let skippedNoConfirmedStart = 0;
    let skippedInactiveBatch = 0;
    let skippedNoTeacherEmail = 0;
    let skippedDuplicates = 0;

    for (const slot of slots) {
      const co = Array.isArray(slot.class_options) ? slot.class_options[0] : slot.class_options;
      const batch = Array.isArray(slot.batches) ? slot.batches[0] : slot.batches;
      if (!co || !batch) continue;
      if (co.active === false || co.deleted_at) continue;
      const batchActive = batch.active === true || String(batch.status || "").toUpperCase() === "ACTIVE";
      if (!batchActive) { skippedInactiveBatch += 1; continue; }
      if (!co.confirmed_start_date) { skippedNoConfirmedStart += 1; continue; }

      const isoDay = dayNameToIso(String(co.day || ""));
      const batchStart = parseYmd(String(batch.start_date || ""));
      if (!isoDay || !batchStart) continue;
      const batchEnd = parseYmd(String(batch.end_date || todayYmd)) || parseYmd(todayYmd)!;
      const confirmedStart = parseYmd(String(co.confirmed_start_date || ""));
      if (!confirmedStart) { skippedNoConfirmedStart += 1; continue; }

      const teacherMeta = teacherMap.get(String(co.teacher_id || ""));
      const teacherEmail = String(teacherMeta?.email || "").trim();
      if (!teacherEmail) { skippedNoTeacherEmail += 1; continue; }

      const firstSessionDate = firstClassDateForBatch(batchStart, isoDay);
      const stopDate = batchEnd.getTime() < nowMs ? batchEnd : parseYmd(todayYmd)!;
      let sessionNumber = 1;
      for (let sessionDate = firstSessionDate; sessionDate.getTime() <= stopDate.getTime(); sessionDate = addDays(sessionDate, 7), sessionNumber += 1) {
        if (sessionDate.getTime() < confirmedStart.getTime()) continue;
        checkedSessions += 1;

        const sessionDateYmd = toYmd(sessionDate);
        const numberStr = String(sessionNumber);
        const classStyle = `Class${sessionNumber}`;
        const attRes = await db
          .from("attendance_log")
          .select("attendance_id", { head: true, count: "exact" })
          .eq("class_option_id", String(co.class_option_id))
          .eq("batch_id", String(batch.batch_id))
          .in("class_number", [numberStr, classStyle])
          .limit(1);
        if (attRes.error) throw attRes.error;
        if (Number(attRes.count || 0) > 0) continue;

        const hoursSince = (nowMs - sessionDate.getTime()) / (1000 * 60 * 60);
        if (hoursSince <= 24) continue;

        const className = classLabel(String(co.class_option_id || ""), String(co.day || ""), String(co.class_time || ""));
        const teacherName = String(co.teacher_name || teacherMeta?.full_name || "");

        const reminderDedupe = `attendance-reminder::${co.class_option_id}::${batch.batch_id}::${sessionNumber}`;
        const reminderExists = await db
          .from("scheduled_notifications")
          .select("id")
          .eq("dedupe_key", reminderDedupe)
          .limit(1)
          .maybeSingle();
        if (reminderExists.error && !String(reminderExists.error.message || "").toLowerCase().includes("no rows")) throw reminderExists.error;
        if (!reminderExists.data) {
          const ins = await db.from("scheduled_notifications").insert({
            recipient_email: teacherEmail,
            event_type: "ATTENDANCE_REMINDER",
            template_key: "attendance_reminder",
            scheduled_for: new Date(nowMs).toISOString(),
            status: "PENDING",
            dedupe_key: reminderDedupe,
            payload: {
              class_name: className,
              session_number: sessionNumber,
              session_date: sessionDateYmd,
              class_option_id: String(co.class_option_id || ""),
              batch_id: String(batch.batch_id || ""),
              teacher_name: teacherName,
              portal_url: teacherPortalUrl,
            },
          });
          if (ins.error) throw ins.error;
          remindersQueued += 1;
        } else {
          skippedDuplicates += 1;
        }

        if (hoursSince > 48) {
          const escalationDedupe = `attendance-escalation::${co.class_option_id}::${batch.batch_id}::${sessionNumber}`;
          const escalationExists = await db
            .from("scheduled_notifications")
            .select("id")
            .eq("dedupe_key", escalationDedupe)
            .limit(1)
            .maybeSingle();
          if (escalationExists.error && !String(escalationExists.error.message || "").toLowerCase().includes("no rows")) throw escalationExists.error;
          if (!escalationExists.data) {
            const escIns = await db.from("scheduled_notifications").insert({
              recipient_email: adminEmail,
              event_type: "ATTENDANCE_ESCALATION",
              template_key: "attendance_escalation",
              scheduled_for: new Date(nowMs).toISOString(),
              status: "PENDING",
              dedupe_key: escalationDedupe,
              payload: {
                teacher_name: teacherName || "Unknown teacher",
                class_name: className,
                session_number: sessionNumber,
                session_date: sessionDateYmd,
                class_option_id: String(co.class_option_id || ""),
                batch_id: String(batch.batch_id || ""),
              },
            });
            if (escIns.error) throw escIns.error;
            escalationsQueued += 1;
          } else {
            skippedDuplicates += 1;
          }
        }
      }
    }

    return json({
      ok: true,
      checked_sessions: checkedSessions,
      reminders_queued: remindersQueued,
      escalations_queued: escalationsQueued,
      skipped_no_confirmed_start: skippedNoConfirmedStart,
      skipped_inactive_batch: skippedInactiveBatch,
      skipped_no_teacher_email: skippedNoTeacherEmail,
      skipped_duplicates: skippedDuplicates,
    });
  } catch (error) {
    const msg = error instanceof Error
      ? error.message
      : (error as Record<string, unknown>)?.message
        ? String((error as Record<string, unknown>).message)
        : JSON.stringify(error);
    return json({ ok: false, error: msg }, 500);
  }
});
