import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, safeLogAudit } from "../_shared/http.ts";

type Dict = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP_BASE_URL = "https://rocksolidsuite.netlify.app";

function json(body: Dict, status = 200): Response {
  return jsonResponse(
    {
      ok: status >= 200 && status < 300 ? true : false,
      statusCode: status,
      ...body,
    },
    status,
  );
}

function firstName(fullName: string): string {
  return String(fullName || "Student").trim().split(/\s+/)[0] || "Student";
}

function parseJwtClaims(token: string): Dict | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload || typeof payload !== "object") return null;
    return payload as Dict;
  } catch (_) {
    return null;
  }
}

async function loadTokenContext(db: ReturnType<typeof createClient>, token: string) {
  const { data: tokenRow, error: tokenErr } = await db
    .from("class_selection_tokens")
    .select("id,token,applicant_id,batch_id,fellowship_code,expires_at,used_at,used_class_option_id")
    .eq("token", token)
    .maybeSingle();

  if (tokenErr) throw new Error(tokenErr.message || "Token lookup failed");
  if (!tokenRow) return { ok: false, code: "INVALID_TOKEN", message: "This link is invalid. Please contact support." } as const;
  if (tokenRow.used_at) return { ok: false, code: "TOKEN_USED", message: "You have already selected a class. Check your email for your confirmation." } as const;
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) return { ok: false, code: "TOKEN_EXPIRED", message: "This link has expired. Please contact foundation@lwcanada.org to request a new one." } as const;

  const { data: applicant, error: appErr } = await db
    .from("applicants")
    .select("id,full_name,email,fellowship_code,class_option_id,registration_status")
    .eq("id", tokenRow.applicant_id)
    .maybeSingle();

  if (appErr) throw new Error(appErr.message || "Applicant lookup failed");
  if (!applicant) return { ok: false, code: "APPLICANT_NOT_FOUND", message: "Applicant record not found." } as const;

  return { ok: true, tokenRow, applicant } as const;
}

async function getAllowedClasses(db: ReturnType<typeof createClient>, fellowshipCode: string, batchId: string) {
  const { data: options, error: optionsErr } = await db
    .from("class_options")
    .select("class_option_id,teacher_name,fellowship_codes,group_id,subgroup_id,day,class_time,active,enrollment_open,deleted_at")
    .eq("active", true)
    .eq("enrollment_open", true)
    .is("deleted_at", null);

  if (optionsErr) throw new Error(optionsErr.message || "Class options query failed");

  const allowed = (options || []).filter((row) => {
    const codes = Array.isArray(row.fellowship_codes) ? row.fellowship_codes.map((v) => String(v || "")) : [];
    return codes.includes(fellowshipCode) || codes.includes("REGIONAL");
  });

  const classOptionIds = allowed.map((x) => x.class_option_id).filter(Boolean);
  if (!classOptionIds.length) return [];

  const { data: slots, error: slotsErr } = await db
    .from("class_slots")
    .select("class_option_id,batch_id,current_enrolment,max_capacity")
    .in("class_option_id", classOptionIds)
    .eq("batch_id", batchId);

  if (slotsErr) throw new Error(slotsErr.message || "Class slots query failed");

  const slotMap = new Map<string, { current_enrolment: number; max_capacity: number | null }>();
  for (const s of slots || []) {
    slotMap.set(String(s.class_option_id), {
      current_enrolment: Number(s.current_enrolment || 0),
      max_capacity: s.max_capacity == null ? null : Number(s.max_capacity),
    });
  }

  return allowed
    .map((co) => {
      const slot = slotMap.get(String(co.class_option_id));
      if (!slot) return null;
      const availableSpots = slot.max_capacity == null ? null : Math.max(slot.max_capacity - slot.current_enrolment, 0);
      if (slot.max_capacity != null && slot.current_enrolment >= slot.max_capacity) return null;
      return {
        class_option_id: co.class_option_id,
        teacher_name: co.teacher_name,
        day: co.day,
        class_time: co.class_time,
        fellowship_codes: co.fellowship_codes || [],
        available_spots: availableSpots,
      };
    })
    .filter((x) => x !== null);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Missing service configuration" }, 500);

    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const body = (await req.json().catch(() => ({}))) as Dict;
    const action = String(body.action || "").trim();

    if (action === "get_options") {
      const token = String(body.token || "").trim();
      if (!token) return json({ error: "token is required", code: "INVALID_INPUT" }, 400);

      const ctx = await loadTokenContext(db, token);
      if (!ctx.ok) return json({ ok: false, code: ctx.code, error: ctx.message }, 200);

      const classes = await getAllowedClasses(db, String(ctx.tokenRow.fellowship_code), String(ctx.tokenRow.batch_id));
      return json({
        ok: true,
        applicant: {
          first_name: firstName(String(ctx.applicant.full_name || "Student")),
          email: ctx.applicant.email,
          fellowship_code: ctx.tokenRow.fellowship_code,
        },
        classes,
      });
    }

    if (action === "select_class") {
      const token = String(body.token || "").trim();
      const classOptionId = String(body.class_option_id || "").trim();
      if (!token || !classOptionId) return json({ error: "token and class_option_id are required", code: "INVALID_INPUT" }, 400);

      const ctx = await loadTokenContext(db, token);
      if (!ctx.ok) return json({ ok: false, code: ctx.code, error: ctx.message }, 200);

      const classes = await getAllowedClasses(db, String(ctx.tokenRow.fellowship_code), String(ctx.tokenRow.batch_id));
      if (!classes.find((c) => c.class_option_id === classOptionId)) {
        return json({ ok: false, code: "CLASS_NOT_ALLOWED", error: "Selected class is not available for your fellowship." }, 400);
      }

      const { data: finalizeRows, error: finalizeErr } = await db.rpc("class_selection_finalize", {
        p_token: token,
        p_class_option_id: classOptionId,
      });
      if (finalizeErr) throw new Error(finalizeErr.message || "Finalization failed");

      const result = Array.isArray(finalizeRows) ? finalizeRows[0] : finalizeRows;
      if (!result?.ok) {
        const code = String(result?.error || "SELECTION_FAILED");
        const msg = code === "CLASS_FULL" ? "That class just filled up. Please choose another option." : "Unable to confirm your class selection.";
        return json({ ok: false, code, error: msg }, 409);
      }

      const { error: emailErr } = await db.from("email_queue").insert({
        recipient_email: ctx.applicant.email,
        recipient_name: ctx.applicant.full_name,
        template_key: "class_assigned_confirmation",
        subject: "Your Foundation School class is confirmed!",
        status: "Pending",
        payload: {
          first_name: firstName(String(ctx.applicant.full_name || "Student")),
          full_name: ctx.applicant.full_name,
          email: ctx.applicant.email,
          class_day: result.class_day,
          class_time: result.class_time,
          teacher_name: result.teacher_name,
          fellowship_code: result.fellowship_code,
          batch_id: result.batch_id,
          class_option_id: classOptionId,
          moodle_url: "https://rocksolid.lwcanada.org/",
        },
      });
      if (emailErr) throw new Error(`Failed to queue confirmation email: ${emailErr.message}`);

      await safeLogAudit(db, {
        actor_email: ctx.applicant.email,
        action: "CLASS_SELECTED_BY_STUDENT",
        entity_type: "applicant",
        entity_id: String(ctx.applicant.id),
        status: "SUCCESS",
        details: {
          class_option_id: classOptionId,
          fellowship_code: result.fellowship_code,
          batch_id: result.batch_id,
        },
      });

      return json({
        ok: true,
        class: {
          teacher_name: result.teacher_name,
          day: result.class_day,
          class_time: result.class_time,
        },
        message: "Your class has been confirmed!",
      });
    }

    // MANUAL-ONLY OPERATOR ESCAPE HATCH (2026-07-14 consolidation gate
    // decision — see docs/migration-log.md, waitlist dedup consolidation).
    // This third producer of 'classes_now_available' deliberately BYPASSES the
    // scheduled_notifications dedupe (it writes straight to email_queue with
    // no dedupe key), so an operator can force a re-send that the canonical
    // class_available:{applicant_id}:{batch_id}:{class_option_id} key would
    // suppress. Known payload gaps, acceptable for a manual tool: it does not
    // supply class_day / class_time / teacher_name, so those render as empty
    // strings in the canonical template's class-details block (email-sender
    // substitutes missing {{tags}} with ""). Do not wire this into any
    // automated flow without adding the shared dedupe key first.
    if (action === "notify_waitlisted") {
      const authHeader = String(req.headers.get("Authorization") || "");
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const claims = parseJwtClaims(token);
      if (!claims || String(claims.role || "") !== "service_role") {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }

      const fellowshipCodesRaw = Array.isArray(body.fellowship_codes) ? body.fellowship_codes : [];
      const fellowshipCodes = fellowshipCodesRaw.map((v) => String(v || "").trim()).filter(Boolean);
      const batchId = String(body.batch_id || "").trim();
      if (!fellowshipCodes.length || !batchId) {
        return json({ ok: false, error: "fellowship_codes and batch_id are required", code: "INVALID_INPUT" }, 400);
      }

      const { data: applicants, error: appErr } = await db
        .from("applicants")
        .select("id,full_name,email,fellowship_code,batch_id")
        .eq("registration_status", "WAITLISTED")
        .in("fellowship_code", fellowshipCodes)
        .eq("batch_id", batchId)
        .is("class_option_id", null)
        .limit(5000);

      if (appErr) throw new Error(appErr.message || "Waitlisted lookup failed");

      let notified = 0;
      let emailsQueued = 0;

      for (const ap of applicants || []) {
        const { data: tokenRow, error: tokenErr } = await db
          .from("class_selection_tokens")
          .insert({
            applicant_id: ap.id,
            batch_id: ap.batch_id,
            fellowship_code: ap.fellowship_code,
          })
          .select("token")
          .single();
        if (tokenErr || !tokenRow?.token) throw new Error(tokenErr?.message || "Failed to create selection token");

        const selectionUrl = `${APP_BASE_URL}/foundation/registration/class-selection.html?token=${encodeURIComponent(tokenRow.token)}`;
        const { error: queueErr } = await db.from("email_queue").insert({
          recipient_email: ap.email,
          recipient_name: ap.full_name,
          template_key: "classes_now_available",
          subject: "Good news � Foundation School classes are now available for you!",
          status: "Pending",
          payload: {
            first_name: firstName(String(ap.full_name || "Student")),
            selection_url: selectionUrl,
            fellowship_code: ap.fellowship_code,
            expires_days: 7,
          },
        });
        if (queueErr) throw new Error(`Failed to queue email for ${ap.email}: ${queueErr.message}`);

        await safeLogAudit(db, {
          actor_email: "class-selection@system",
          action: "CLASS_SELECTION_EMAIL_SENT",
          entity_type: "applicant",
          entity_id: String(ap.id),
          status: "SUCCESS",
          details: {
            fellowship_code: ap.fellowship_code,
            batch_id: ap.batch_id,
            selection_url: selectionUrl,
          },
        });

        notified += 1;
        emailsQueued += 1;
      }

      return json({ ok: true, notified, emails_queued: emailsQueued });
    }

    return json({ ok: false, error: "Invalid action" }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message }, 500);
  }
});


