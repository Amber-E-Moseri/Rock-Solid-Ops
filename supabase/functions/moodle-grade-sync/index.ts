/**
 * moodle-grade-sync — Edge Function
 *
 * PREREQUISITE (manual Moodle admin step — do this before deploying):
 *   Site admin → Server → Web services → External services → [your service] → Add functions:
 *     - core_completion_get_course_completion_status
 *     - gradereport_user_get_grade_items
 *   Then enable completion tracking:
 *     Site admin → Advanced features → Enable completion tracking = ON
 *
 * Checks Moodle course completion for all SYNCED enrollments and upserts
 * student_milestone_status (milestone_code = 'HOLY_SPIRIT') when a course is completed.
 * Also fetches and stores per-item grades from gradereport_user_get_grade_items.
 * Processes in batches of 20 to avoid timeouts.
 *
 * Manual trigger per student (used by the Sync Gradebook button in student profile drawer):
 *   POST { "email": "student@example.com" }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, safeLogAudit } from "../_shared/http.ts";
import { validateCronAuth } from "../_shared/auth.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BATCH_SIZE           = 20;
const CALL_TIMEOUT_MS      = 15_000;

function authJson(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

async function authorizeRequest(
  req: Request,
  serviceDb: any,
): Promise<Response | null> {
  if (req.headers.has("x-cron-secret")) {
    return validateCronAuth(req);
  }

  if (req.headers.has("x-internal-secret")) {
    return authJson({ ok: false, error: "Unsupported caller credential" }, 401);
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return authJson({ ok: false, error: "Missing credentials" }, 401);
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const { data: userData, error: userErr } = await serviceDb.auth.getUser(token);
  if (userErr || !userData?.user) {
    return authJson({ ok: false, error: "Invalid session" }, 401);
  }

  const allowed = await isAuthorizedStaff(serviceDb, userData.user.id, userData.user.email);
  if (!allowed) return authJson({ ok: false, error: "Forbidden" }, 403);
  return null;
}

// Minimal callMoodle — POST to /webservice/rest/server.php with wstoken + wsfunction + json format.
async function callMoodle(
  wsfunction: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const MOODLE_URL = Deno.env.get("MOODLE_URL") || "";
  const MOODLE_TOKEN = Deno.env.get("MOODLE_TOKEN") || "";
  const body = new URLSearchParams({
    wstoken: MOODLE_TOKEN,
    wsfunction,
    moodlewsrestformat: "json",
    ...params,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${MOODLE_URL}/webservice/rest/server.php`, {
      method: "POST",
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Moodle HTTP ${res.status}`);
    const json = await res.json();
    if (json?.exception) {
      throw new Error(
        `Moodle error: ${json.message || json.exception} [${json.errorcode || ""}]`,
      );
    }
    return json as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const authFailure = await authorizeRequest(req, supabase);
  if (authFailure) return authFailure;

  if (!Deno.env.get("MOODLE_URL") || !Deno.env.get("MOODLE_TOKEN")) {
    return jsonResponse(
      { ok: false, error: "MOODLE_URL and MOODLE_TOKEN must be configured" },
      500,
    );
  }

  // Optional per-student filter — used by the Sync Gradebook button in the student profile drawer.
  let filterEmail: string | null = null;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.email === "string") filterEmail = body.email;
    }
  } catch { /* ignore */ }

  // Fetch all SYNCED rows that have a Moodle user and course assigned.
  let query = supabase
    .from("moodle_enrollment_sync")
    .select("id,email,moodle_user_id,course_id,batch_id,class_option_id")
    .eq("sync_status", "SYNCED")
    .not("moodle_user_id", "is", null)
    .not("course_id", "is", null)
    .limit(200);

  if (filterEmail) query = query.eq("email", filterEmail);

  const { data: rows, error: fetchErr } = await query;

  if (fetchErr) return jsonResponse({ ok: false, error: fetchErr.message }, 500);

  const synced              = rows || [];
  let checked               = 0;
  let newly_completed       = 0;
  let grades_synced         = 0;
  const errors: string[]        = [];
  const grades_errors: string[] = [];

  for (let i = 0; i < synced.length; i += BATCH_SIZE) {
    const batch = synced.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (row) => {
        checked++;
        try {
          // ── 1. Completion check ──────────────────────────────────────────
          const result = await callMoodle("core_completion_get_course_completion_status", {
            userid:   String(row.moodle_user_id),
            courseid: String(row.course_id),
          });

          const completed =
            (result as { completionstatus?: { completed?: boolean } })
              ?.completionstatus?.completed === true;

          // ── 2. Resolve applicant (needed for both milestone and grade sync) ──
          const { data: applicant } = await supabase
            .from("applicants")
            .select("id,full_name,email")
            .eq("email", row.email)
            .eq("batch_id", row.batch_id)
            .limit(1)
            .maybeSingle();

          if (!applicant) return;

          // ── 3. Milestone update (unchanged logic) ────────────────────────
          if (completed) {
            // Skip if milestone already recorded.
            const { data: existing } = await supabase
              .from("student_milestone_status")
              .select("status")
              .eq("applicant_id", applicant.id)
              .eq("milestone_code", "HOLY_SPIRIT")
              .maybeSingle();

            if (existing?.status !== "completed") {
              const { error: upsertErr } = await supabase
                .from("student_milestone_status")
                .upsert(
                  {
                    applicant_id:   applicant.id,
                    milestone_code: "HOLY_SPIRIT",
                    status:         "completed",
                    completed_at:   new Date().toISOString(),
                    updated_at:     new Date().toISOString(),
                  },
                  { onConflict: "applicant_id,milestone_code" },
                );

              if (upsertErr) throw upsertErr;

              newly_completed++;

              // Non-fatal in-app notification for admins.
              supabase.from("in_app_notifications").insert({
                recipient_role: "admin",
                title:          "Course completed",
                body:           `${applicant.full_name || applicant.email} completed the Moodle course`,
                type:           "success",
              }).catch(() => {});
            }
          }

          // ── 4. Grade sync ────────────────────────────────────────────────
          try {
            const gradeResult = await callMoodle("gradereport_user_get_grade_items", {
              userid:   String(row.moodle_user_id),
              courseid: String(row.course_id),
            });

            // deno-lint-ignore no-explicit-any
            const userGrade = (gradeResult as any)?.usergrades?.[0];
            // deno-lint-ignore no-explicit-any
            const gradeItems: any[] = userGrade?.gradeitems ?? [];

            const now        = new Date().toISOString();
            let rowsSynced   = 0;

            for (const item of gradeItems) {
              if (item.graderaw == null) continue;

              const { error: gradeErr } = await supabase
                .from("student_grades")
                .upsert(
                  {
                    student_id:       applicant.id,
                    applicant_id:     applicant.id,
                    email:            row.email,
                    course_id:        String(row.course_id),
                    moodle_course_id: String(row.course_id),
                    course_name:      item.itemname || `Grade Item ${item.id}`,
                    grade:            parseFloat(item.graderaw),
                    grade_max:        item.grademax != null ? parseFloat(item.grademax) : null,
                    last_synced_at:   now,
                    raw_response:     item,
                  },
                  { onConflict: "student_id,moodle_course_id,course_name" },
                );

              if (gradeErr) throw gradeErr;
              rowsSynced++;
            }

            // Overall course grade summary — separate row with a fixed course_name so it
            // is easy to query and does not conflict with Moodle's internal "Course total" item.
            // deno-lint-ignore no-explicit-any
            const courseItem = gradeItems.find((it: any) => it.itemtype === "course");
            if (courseItem?.graderaw != null && courseItem?.grademax) {
              const pct = (parseFloat(courseItem.graderaw) / parseFloat(courseItem.grademax)) * 100;
              const { error: overallErr } = await supabase
                .from("student_grades")
                .upsert(
                  {
                    student_id:       applicant.id,
                    applicant_id:     applicant.id,
                    email:            row.email,
                    course_id:        String(row.course_id),
                    moodle_course_id: String(row.course_id),
                    course_name:      "Overall Course Grade",
                    grade:            Math.round(pct * 100) / 100,
                    grade_max:        100,
                    last_synced_at:   now,
                    raw_response:     courseItem,
                  },
                  { onConflict: "student_id,moodle_course_id,course_name" },
                );
              if (overallErr) throw overallErr;
              rowsSynced++;
            }

            grades_synced += rowsSynced;
          } catch (gradeErr) {
            const msg = gradeErr instanceof Error ? gradeErr.message : String(gradeErr);
            // If gradereport_user_get_grade_items is not enabled on this Moodle instance,
            // flag the enrollment row so we can skip/warn on future runs.
            if (
              msg.includes("invalidfunction") ||
              msg.includes("accessdenied") ||
              msg.includes("not available")
            ) {
              supabase
                .from("moodle_enrollment_sync")
                .update({ grade_sync_available: false })
                .eq("id", row.id)
                .catch(() => {});
            }
            grades_errors.push(`${row.email}: ${msg}`);
          }
        } catch (err) {
          errors.push(`${row.email}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );
  }

  await safeLogAudit(supabase, {
    action:      "MOODLE_GRADE_SYNC",
    entity_type: "system",
    status:      "SUCCESS",
    details:     {
      checked,
      newly_completed,
      grades_synced,
      errors_count:        errors.length,
      grades_errors_count: grades_errors.length,
    },
  });

  return jsonResponse({ ok: true, checked, newly_completed, grades_synced, grades_errors, errors });
});
