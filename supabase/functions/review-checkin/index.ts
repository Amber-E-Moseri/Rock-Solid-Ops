import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  jsonResponse,
  safeLogAudit,
} from "../_shared/http.ts";
import { validateCronAuth } from "../_shared/auth.ts";

function json(body: unknown, status = 200) {
  return jsonResponse(
    {
      ok: (status >= 200 && status < 300) || (body as any)?.ok,
      ...(typeof body === "object" && body ? body : { data: body }),
      statusCode: status,
    },
    status,
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authFailure = validateCronAuth(req);
  if (authFailure) return authFailure;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ ok: false, error: "Missing Supabase env" }, 500);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const summary = {
    scanned: 0,
    queued: 0,
    skipped_already_sent: 0,
    skipped_no_email: 0,
    errors: [] as string[],
  };

  try {
    // Applicants in REVIEW whose registration is 3–7 days old (reviewed_at preferred, created_at fallback).
    // The window avoids emailing too early (< 3 days) or chasing stale cases (> 7 days, handled by escalation).
    const { data: candidates, error: candidatesErr } = await db
      .from("applicants")
      .select("id,first_name,last_name,full_name,email,fellowship_code,created_at,reviewed_at,trace_id,registration_status")
      .eq("registration_status", "REVIEW")
      .limit(500);

    if (candidatesErr) throw candidatesErr;

    const nowMs = Date.now();
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    const inWindow = (candidates || []).filter((a) => {
      const base = new Date(String(a.reviewed_at || a.created_at || ""));
      if (isNaN(base.getTime())) return false;
      const ageMs = nowMs - base.getTime();
      return ageMs >= THREE_DAYS_MS && ageMs <= SEVEN_DAYS_MS;
    });

    summary.scanned = inWindow.length;

    for (const applicant of inWindow) {
      const email = String(applicant.email || "").trim().toLowerCase();
      if (!email) {
        summary.skipped_no_email += 1;
        continue;
      }

      // Dedupe: skip if we have already sent this template to this address.
      const { data: existing } = await db
        .from("email_queue")
        .select("id")
        .eq("recipient_email", email)
        .eq("template_key", "registration_under_review_checkin")
        .limit(1)
        .maybeSingle();

      if (existing) {
        summary.skipped_already_sent += 1;
        continue;
      }

      const firstName = String(
        applicant.first_name ||
        (applicant.full_name || "").split(/\s+/)[0] ||
        "Friend",
      ).trim();

      const fullName = String(
        applicant.full_name ||
        `${applicant.first_name || ""} ${applicant.last_name || ""}`.trim() ||
        email,
      );

      const traceId = String(applicant.trace_id || "").trim() || null;

      const { error: insertErr } = await db.from("email_queue").insert({
        recipient_email: email,
        recipient_name: fullName,
        template_key: "registration_under_review_checkin",
        subject: "An update on your Foundation School registration",
        status: "Pending",
        trace_id: traceId,
        payload: {
          first_name: firstName,
          full_name: fullName,
          email,
          fellowship_code: String(applicant.fellowship_code || ""),
          trace_id: traceId,
        },
      });

      if (insertErr) {
        summary.errors.push(`${email}: ${insertErr.message}`);
        continue;
      }

      await safeLogAudit(db, {
        actor_email: "review-checkin@system",
        action: "REVIEW_CHECKIN_QUEUED",
        entity_type: "applicant",
        entity_id: String(applicant.id),
        status: "SUCCESS",
        details: {
          email,
          fellowship_code: applicant.fellowship_code,
          ...(traceId ? { trace_id: traceId } : {}),
        },
      });

      summary.queued += 1;
    }

    return json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : (err as Record<string, unknown>)?.message
        ? String((err as Record<string, unknown>).message)
        : String(err);

    await safeLogAudit(db, {
      actor_email: "review-checkin@system",
      action: "REVIEW_CHECKIN_ERROR",
      entity_type: "ops",
      entity_id: "review-checkin",
      status: "FAILED",
      details: { error: message, ...summary },
    }).catch(() => {});

    return json({ ok: false, error: message, ...summary }, 200);
  }
});

