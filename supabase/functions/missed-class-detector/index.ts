import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateCronAuth } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalizeText(v: unknown) {
  return String(v || "").trim();
}

function dayNameToIso(day: string) {
  const normalized = normalizeText(day).toLowerCase();
  const map: Record<string, number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 7,
  };
  return map[normalized] || 0;
}

function mostRecentIsoWeekdayDate(targetIsoDow: number, now = new Date()) {
  if (targetIsoDow < 1 || targetIsoDow > 7) return null;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const currentIsoDow = Number(d.toISOString().slice(0, 10) ? ((d.getUTCDay() + 6) % 7) + 1 : 0);
  const diff = (currentIsoDow - targetIsoDow + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function toIsoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function classNumberForDate(batchStartDate: string, classDate: Date) {
  const start = new Date(`${batchStartDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return "";
  const deltaDays = Math.floor((classDate.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (deltaDays < 0) return "";
  const weekNum = Math.floor(deltaDays / 7) + 1;
  if (weekNum < 1 || weekNum > 7) return "";
  return String(weekNum);
}

async function invokeClickupSync(
  supabaseUrl: string,
  body: Record<string, unknown>,
) {
  const internalSecret = Deno.env.get("INTERNAL_INVOKE_SECRET") || "";
  if (!internalSecret) throw new Error("Missing INTERNAL_INVOKE_SECRET");

  const res = await fetch(`${supabaseUrl}/functions/v1/clickup-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": internalSecret,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String(data?.error || `clickup-sync failed (${res.status})`));
  }
  return data as Record<string, unknown>;
}

async function logAudit(db: ReturnType<typeof createClient>, action: string, status: string, details: Record<string, unknown>) {
  await db.from("audit_logs").insert({
    actor_email: "missed-class-detector@system",
    action,
    entity_type: "ops",
    entity_id: "missed-class-detector",
    status,
    details,
    logged_at: new Date().toISOString(),
  });
}

Deno.serve(async (req) => {
  applyAllowedOrigin(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authFailure = validateCronAuth(req);
  if (authFailure) return authFailure;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "Missing Supabase env" }, 500);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const summary = {
      checked_count: 0,
      missed_count: 0,
      task_created_count: 0,
      skipped_duplicate_count: 0,
      review_escalation_candidates: 0,
      review_escalation_created: 0,
      schedule_derivation_errors: 0,
    };

    const rosterRes = await db
      .from("class_roster")
      .select("student_id,class_option_id,group_id,subgroup_id,status,batch_id")
      .eq("status", "Active")
      .limit(5000);
    if (rosterRes.error) throw rosterRes.error;
    const roster = rosterRes.data || [];

    const studentIds = [...new Set(roster.map((r) => normalizeText(r.student_id)).filter(Boolean))];
    const classOptionIds = [...new Set(roster.map((r) => normalizeText(r.class_option_id)).filter(Boolean))];
    const batchIds = [...new Set(roster.map((r) => normalizeText(r.batch_id)).filter(Boolean))];

    const studentsMap = new Map<string, { full_name: string; email: string }>();
    if (studentIds.length) {
      const studentsRes = await db.from("students").select("student_id,full_name,email").in("student_id", studentIds);
      if (studentsRes.error) throw studentsRes.error;
      for (const s of studentsRes.data || []) {
        studentsMap.set(String(s.student_id), { full_name: String(s.full_name || ""), email: String(s.email || "") });
      }
    }

    const classMap = new Map<string, { day: string; class_time: string; group_id: string; subgroup_id: string }>();
    if (classOptionIds.length) {
      const classRes = await db.from("class_options").select("class_option_id,day,class_time,group_id,subgroup_id").in("class_option_id", classOptionIds);
      if (classRes.error) throw classRes.error;
      for (const c of classRes.data || []) {
        classMap.set(String(c.class_option_id), {
          day: String(c.day || ""),
          class_time: String(c.class_time || ""),
          group_id: String(c.group_id || ""),
          subgroup_id: String(c.subgroup_id || ""),
        });
      }
    }

    const batchMap = new Map<string, { start_date: string }>();
    if (batchIds.length) {
      const batchRes = await db.from("batches").select("batch_id,start_date").in("batch_id", batchIds);
      if (batchRes.error) throw batchRes.error;
      for (const b of batchRes.data || []) {
        batchMap.set(String(b.batch_id), { start_date: String(b.start_date || "") });
      }
    }

    for (const row of roster) {
      summary.checked_count += 1;

      const studentId = normalizeText(row.student_id);
      const classOptionId = normalizeText(row.class_option_id);
      const groupId = normalizeText(row.group_id);
      const subgroupId = normalizeText(row.subgroup_id);
      const classDef = classMap.get(classOptionId);
      const student = studentsMap.get(studentId);
      const batch = batchMap.get(normalizeText(row.batch_id));

      if (!classDef?.day || !batch?.start_date) {
        summary.schedule_derivation_errors += 1;
        continue;
      }

      const dayIso = dayNameToIso(classDef.day);
      const classDateObj = mostRecentIsoWeekdayDate(dayIso);
      if (!classDateObj) {
        summary.schedule_derivation_errors += 1;
        continue;
      }
      const classDate = toIsoDate(classDateObj);

      if (classDate < batch.start_date) {
        continue;
      }

      const classNumber = classNumberForDate(batch.start_date, classDateObj);
      if (!classNumber) {
        // Out of expected 1..7 class range; skip to avoid noisy false positives.
        continue;
      }

      const attendanceRes = await db
        .from("attendance_log")
        .select("attendance_id")
        .eq("student_id", studentId)
        .eq("class_option_id", classOptionId)
        .eq("class_date", classDate)
        .limit(1)
        .maybeSingle();
      if (attendanceRes.error) throw attendanceRes.error;
      if (attendanceRes.data?.attendance_id) continue;

      summary.missed_count += 1;

      const clickupRes = await invokeClickupSync(SUPABASE_URL, {
        type: "missed_class",
        payload: {
          student_id: studentId,
          student_name: student?.full_name || studentId,
          email: student?.email || "",
          group_id: groupId || classDef.group_id,
          subgroup_id: subgroupId || classDef.subgroup_id,
          class_option_id: classOptionId,
          class_number: classNumber,
          class_date: classDate,
          reason: "No attendance record for passed session",
        },
      });

      if (clickupRes?.reused) summary.skipped_duplicate_count += 1;
      if (clickupRes?.clickup_task_id) summary.task_created_count += 1;

      // Send missed-class check-in email when student has missed >= 2 sessions in this batch.
      const studentEmail = student?.email || "";
      const batchId = normalizeText(row.batch_id);
      if (studentEmail && batchId) {
        const missedCountRes = await db
          .from("attendance_log")
          .select("attendance_id", { count: "exact", head: true })
          .eq("student_id", studentId)
          .eq("class_option_id", classOptionId)
          .eq("present", false);

        const totalMissed = missedCountRes.count ?? 0;

        if (totalMissed >= 2) {
          const dedupeKey = `missed_class_checkin::${studentId}::${batchId}`;
          const { data: existing } = await db
            .from("email_queue")
            .select("id")
            .eq("recipient_email", studentEmail)
            .eq("template_key", "missed_class_checkin")
            .eq("dedupe_key", dedupeKey)
            .limit(1)
            .maybeSingle();

          if (!existing) {
            const nameParts = (student?.full_name || "").trim().split(/\s+/);
            const firstName = nameParts[0] || student?.full_name || "Friend";
            const traceId = crypto.randomUUID();

            // Resolve class_time from class_options
            const classInfo = classMap.get(classOptionId);
            const classTime = classInfo?.class_time
              ? `${classInfo.day || ""}s at ${classInfo.class_time}`.trim()
              : classInfo?.day ? `${classInfo.day}s` : "your scheduled class";

            await db.from("email_queue").insert({
              recipient_email: studentEmail,
              recipient_name: student?.full_name || "",
              template_key: "missed_class_checkin",
              subject: "We missed you at Foundation School",
              status: "Pending",
              dedupe_key: dedupeKey,
              trace_id: traceId,
              payload: {
                trace_id: traceId,
                first_name: firstName,
                class_time: classTime,
                teacher_name: "your Foundation School teacher",
                missed_count: totalMissed,
                batch_id: batchId,
              },
            });

            await logAudit(db, "MISSED_CLASS_CHECKIN_QUEUED", "SUCCESS", {
              trace_id: traceId,
              student_id: studentId,
              recipient_email: studentEmail,
              batch_id: batchId,
              class_option_id: classOptionId,
            });
          }
        }
      }
    }

    if (summary.checked_count > 0 && summary.schedule_derivation_errors === summary.checked_count) {
      const msg = "Expected class schedule could not be derived (missing class_options.day and/or batches.start_date). No missed-class tasks were generated.";
      await logAudit(db, "MISSED_CLASS_DETECTOR_SUMMARY", "FAILED", { ...summary, error: msg });
      return json({ ok: false, error: msg, ...summary }, 200);
    }

    const reviewRes = await db
      .from("applicants")
      .select("id,first_name,last_name,email,group_id,fellowship_code,class_option_id,created_at,reviewed_at,clickup_task_id,registration_status")
      .eq("registration_status", "REVIEW")
      .is("clickup_task_id", null)
      .limit(1000);
    if (reviewRes.error) throw reviewRes.error;

    const candidates = (reviewRes.data || []).filter((a) => {
      const base = new Date(String(a.reviewed_at || a.created_at || ""));
      if (Number.isNaN(base.getTime())) return false;
      return (Date.now() - base.getTime()) >= 48 * 60 * 60 * 1000;
    });

    summary.review_escalation_candidates = candidates.length;

    const fellowshipCodes = [...new Set(candidates.map((c) => normalizeText(c.fellowship_code)).filter(Boolean))];
    const fellowshipMap = new Map<string, string>();
    if (fellowshipCodes.length) {
      const fRes = await db.from("fellowship_map").select("fellowship_code,subgroup_id").in("fellowship_code", fellowshipCodes);
      if (fRes.error) throw fRes.error;
      for (const f of fRes.data || []) fellowshipMap.set(String(f.fellowship_code), String(f.subgroup_id || ""));
    }

    for (const a of candidates) {
      const subgroupId = fellowshipMap.get(normalizeText(a.fellowship_code)) || "";
      const fullName = `${normalizeText(a.first_name)} ${normalizeText(a.last_name)}`.trim();
      const clickupRes = await invokeClickupSync(SUPABASE_URL, {
        type: "escalation",
        payload: {
          source: "applicants",
          source_id: String(a.id),
          student_name: fullName,
          email: normalizeText(a.email),
          group_id: normalizeText(a.group_id),
          subgroup_id: subgroupId,
          reason: "Registration stuck in REVIEW for more than 48 hours",
          error_code: "REVIEW_STALE_48H",
          error_message: "Applicant remained in REVIEW beyond 48h operational threshold",
        },
      });

      if (clickupRes?.clickup_task_id) {
        summary.review_escalation_created += 1;
      }
    }

    await logAudit(db, "MISSED_CLASS_DETECTOR_SUMMARY", "SUCCESS", summary);
    return json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logAudit(db, "MISSED_CLASS_DETECTOR_SUMMARY", "FAILED", { error: message });
    return json({ ok: false, error: message }, 200);
  }
});
