import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  jsonResponse,
  classifyError,
  validateRequired,
  validateErrors,
  isValidString,
  safeLogAudit,
} from "../_shared/http.ts";
import { validateCronAuth } from "../_shared/auth.ts";
import { ensureNexusTask } from "../_shared/nexus-tasks.ts";

type RetryAction = "retry" | "resolve";
type RetrySource = "email_queue" | "scheduled_notifications" | "moodle_sync" | "moodle_enrollment_sync" | "failed_syncs";

type RetryRequest = {
  action?: RetryAction;
  source?: RetrySource;
  id?: string;
  limit?: number;
};

function canonicalSource(source: RetrySource): Exclude<RetrySource, "moodle_sync"> | "moodle_sync" {
  // Backward-compatibility shim: legacy moodle_sync requests now target canonical moodle_enrollment_sync.
  return source === "moodle_sync" ? "moodle_enrollment_sync" : source;
}

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
  return jsonResponse(
    {
      ok: (status >= 200 && status < 300) || (body as any)?.ok,
      ...(typeof body === "object" && body ? body : { data: body }),
      statusCode: status,
    },
    status,
  );
}

async function isAdmin(serviceDb: ReturnType<typeof createClient>, userId: string, email?: string) {
  try {
    const profile = await serviceDb
      .from("profiles")
      .select("role,is_active")
      .eq("user_id", userId)
      .maybeSingle();
    if (profile.error) return false;

    if (profile.data) {
      const role = String(profile.data?.role || "").toLowerCase();
      const active = profile.data?.is_active !== false;

      if (
        active &&
        ["admin", "superadmin", "subgroup_admin", "pastor", "principal"].includes(role)
      ) {
        return true;
      }
      return false;
    }

    const legacy = await serviceDb
      .from("admin_users")
      .select("role,status,active")
      .or(`auth_user_id.eq.${userId}${email ? `,email.eq.${email}` : ""}`)
      .maybeSingle();
    if (legacy.error) return false;

    const legacyRole = String(legacy.data?.role || "").toLowerCase();
    const active =
      legacy.data?.active !== false &&
      legacy.data?.status !== "suspended";

    if (
      active &&
      ["admin", "superadmin", "subgroup_admin", "pastor", "principal"].includes(legacyRole)
    ) {
      return true;
    }

    return false;
  } catch (_) {
    return false;
  }
}

async function authorizeRequest(
  req: Request,
  serviceDb: any,
): Promise<
  | { ok: true; mode: "cron"; actorEmail: string }
  | { ok: true; mode: "user"; actorEmail: string }
  | { ok: false; response: Response }
> {
  if (req.headers.has("x-cron-secret")) {
    const cronFailure = validateCronAuth(req);
    if (cronFailure) return { ok: false, response: cronFailure };
    return { ok: true, mode: "cron", actorEmail: "retry-worker@system" };
  }

  if (req.headers.has("x-internal-secret")) {
    return { ok: false, response: json({ ok: false, error: "Unsupported caller credential" }, 401) };
  }

  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, response: json({ ok: false, error: "Missing credentials" }, 401) };
  }

  const jwt = authHeader.slice("Bearer ".length).trim();
  const { data: userData, error: userErr } = await serviceDb.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return { ok: false, response: json({ ok: false, error: "Invalid session" }, 401) };
  }
  const allowed = await isAdmin(serviceDb, userData.user.id, userData.user.email);
  if (!allowed) {
    return { ok: false, response: json({ ok: false, error: "Admin access required" }, 403) };
  }
  return { ok: true, mode: "user", actorEmail: userData.user.email || "retry-worker@user" };
}

async function logAudit(
  db: ReturnType<typeof createClient>,
  actorEmail: string,
  action: string,
  entityType: string,
  entityId: string,
  status: string,
  details: Record<string, unknown>,
) {
  const statusCode = status === "SUCCESS" ? "SUCCESS" : status === "FAILED" ? "FAILED" : "SKIPPED";
  await safeLogAudit(db, {
    actor_email: actorEmail,
    action,
    entity_type: entityType,
    entity_id: entityId,
    status: statusCode as "SUCCESS" | "FAILED" | "SKIPPED",
    details,
  });
}

function isRetryableMoodleError(errorCode: unknown, lastError?: unknown) {
  const code = String(errorCode || "").trim().toUpperCase();
  const message = String(lastError || "").trim();

  // Explicit 403-cause codes take priority
  if (code === "MOODLE_WAF_BLOCK") return true;
  if (code === "MOODLE_REST_DISABLED") return false;
  if (code === "MOODLE_PERMISSION_DENIED") return false;
  if (code === "MOODLE_403_UNKNOWN") return false;

  const mappedMessage = (() => {
    if (code === "MOODLE_AUTH_OR_WAF_BLOCKED") return "forbidden";
    if (code === "COURSE_MAPPING_MISSING") return "missing course mapping";
    if (code === "AUTH") return "unauthorized";
    if (code === "ALREADY_EXISTS") return "already exists";
    if (code === "NOT_FOUND") return "not found";
    return message || code || "";
  })();
  if (!mappedMessage) return true;
  return classifyError(mappedMessage, true).retryable;
}

async function sweepMoodleEnrollmentRetries(
  db: ReturnType<typeof createClient>,
  limit = 25,
) {
  const { data, error } = await db
    .from("moodle_enrollment_sync")
    .select("id,error_code,last_error,sync_status,status,retry_requested_at,updated_at,retry_count,sync_attempts,clickup_task_id")
    .in("sync_status", ["RETRYING", "FAILED"])
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const candidates = (data || []).filter((row) => isRetryableMoodleError(row.error_code, row.last_error));
  let attempted = 0;
  for (const row of candidates) {
    const id = String(row.id || "").trim();
    if (!id) continue;
    await applyRetry(db, "moodle_enrollment_sync", id);
    attempted += 1;
  }
  return { selected: (data || []).length, attempted, candidates };
}

async function maybeEscalateMoodleFailure(
  db: ReturnType<typeof createClient>,
  rowId: string,
) {
  const { data: row, error } = await db
    .from("moodle_enrollment_sync")
    .select("id,email,full_name,error_code,last_error,retry_count,sync_attempts,sync_status,status,student_id,registration_id,clickup_task_id,class_option_id")
    .eq("id", rowId)
    .maybeSingle();
  if (error || !row) return { escalated: false, reason: "row_not_found" };

  const attempts = Math.max(Number(row.retry_count || 0), Number(row.sync_attempts || 0));
  const status = String(row.sync_status || row.status || "").toUpperCase();
  const errorCode = String(row.error_code || "").toUpperCase();
  if (attempts < 3) return { escalated: false, reason: "below_threshold" };
  if (status === "RESOLVED" || status === "SYNCED" || status === "SKIPPED") return { escalated: false, reason: "already_resolved" };
  if (!isRetryableMoodleError(errorCode, row.last_error)) return { escalated: false, reason: "non_retryable" };

  let groupId = "";
  let subgroupId = "";
  if (row.class_option_id) {
    const { data: classOpt } = await db
      .from("class_options")
      .select("group_id,subgroup_id")
      .eq("class_option_id", row.class_option_id)
      .maybeSingle();
    groupId = String(classOpt?.group_id || "");
    subgroupId = String(classOpt?.subgroup_id || "");
  }

  const payload = {
    source: "moodle_enrollment_sync",
    source_id: String(row.id),
    student_id: String(row.student_id || ""),
    student_name: String(row.full_name || ""),
    email: String(row.email || ""),
    group_id: groupId,
    subgroup_id: subgroupId,
    reason: "Moodle enrollment sync failed repeatedly (>=3 attempts)",
    error_code: errorCode || "UNKNOWN",
    error_message: String(row.last_error || ""),
  };

  const NEXUS_API_URL = Deno.env.get("NEXUS_API_URL") || "";
  const NEXUS_API_KEY = Deno.env.get("NEXUS_API_KEY") || "";
  const nexusRes = await ensureNexusTask(db, "escalation", payload, "retry-worker@system", {
    nexusUrl: NEXUS_API_URL,
    nexusApiKey: NEXUS_API_KEY,
  });
  const taskId = String(nexusRes?.nexus_task_id || "").trim();
  return { escalated: true, nexus_task_id: taskId || null };
}

async function applyRetry(
  db: ReturnType<typeof createClient>,
  source: RetrySource,
  id: string,
) {
  source = canonicalSource(source);
  const now = new Date().toISOString();

  if (source === "email_queue") {
    const { data: row, error: readErr } = await db
      .from("email_queue")
      .select("id,status,retry_count")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row) throw new Error("Row not found in email_queue");
    const st = String(row.status || "").trim().toUpperCase();
    if (!["FAILED", "ERROR", "PENDING"].includes(st)) {
      throw new Error(`email_queue row status "${row.status}" is not retryable`);
    }
    const { error } = await db
      .from("email_queue")
      .update({
        status: "Pending",
        error_message: null,
        last_error: null,
        retry_count: Number(row.retry_count || 0) + 1,
        last_retry_at: now,
        updated_at: now,
      })
      .eq("id", id);
    if (error) throw error;
    return;
  }

  if (source === "scheduled_notifications") {
    const { data: row, error: readErr } = await db
      .from("scheduled_notifications")
      .select("id,status,attempts")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row) throw new Error("Row not found in scheduled_notifications");
    const st = String(row.status || "").trim().toUpperCase();
    if (!["FAILED", "ERROR", "PENDING"].includes(st)) {
      throw new Error(`scheduled_notifications row status "${row.status}" is not retryable`);
    }
    const { error } = await db
      .from("scheduled_notifications")
      .update({
        status: "PENDING",
        scheduled_for: now,
        last_error: null,
        error_message: null,
        attempts: Number(row.attempts || 0) + 1,
        updated_at: now,
      })
      .eq("id", id);
    if (error) throw error;
    return;
  }

  if (source === "moodle_enrollment_sync") {
    const { error } = await db
      .from("moodle_enrollment_sync")
      .update({
        sync_status: "RETRYING",
        status: "RETRYING",
        last_error: null,
        error_message: null,
        error_code: null,
        retry_requested_at: now,
        updated_at: now,
      })
      .eq("id", id);
    if (error) throw error;
    return;
  }

  if (source === "failed_syncs") {
    const { error } = await db
      .from("failed_syncs")
      .update({ status: "PENDING", error_message: null, last_retry_at: now })
      .eq("id", id);
    if (error) throw error;
    return;
  }
}

async function applyResolve(
  db: ReturnType<typeof createClient>,
  source: RetrySource,
  id: string,
) {
  source = canonicalSource(source);
  const now = new Date().toISOString();

  if (source === "email_queue") {
    const { error } = await db
      .from("email_queue")
      .update({ status: "Resolved", updated_at: now })
      .eq("id", id);
    if (error) throw error;
    return;
  }

  if (source === "scheduled_notifications") {
    const { error } = await db
      .from("scheduled_notifications")
      .update({ status: "RESOLVED", updated_at: now })
      .eq("id", id);
    if (error) throw error;
    return;
  }

  if (source === "moodle_enrollment_sync") {
    const { error } = await db
      .from("moodle_enrollment_sync")
      .update({
        sync_status: "RESOLVED",
        status: "RESOLVED",
        updated_at: now,
      })
      .eq("id", id);
    if (error) throw error;
    return;
  }

  if (source === "failed_syncs") {
    const { error } = await db
      .from("failed_syncs")
      .update({ status: "RESOLVED", resolved_at: now })
      .eq("id", id);
    if (error) throw error;
    return;
  }
}

Deno.serve(async (req) => {
  applyAllowedOrigin(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "Missing Supabase env" }, 500);

    const serviceDb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const auth = await authorizeRequest(req, serviceDb);
    if (!auth.ok) return auth.response;
    const isCronCall = auth.mode === "cron";
    const actorEmail = auth.actorEmail;

    const body = (await req.json().catch(() => ({}))) as RetryRequest;
    
    // Input validation
    const action = String(body.action || "").toLowerCase().trim() as RetryAction;
    const sourceRaw = String(body.source || "").trim() as RetrySource;
    const source = canonicalSource(sourceRaw);
    const id = String(body.id || "").trim();
    const limitInput = Number(body.limit) || 25;
    const limit = Math.max(1, Math.min(100, limitInput));

    // Validate action
    if (action && !["retry", "resolve"].includes(action)) {
      return json({ ok: false, error: "action must be retry|resolve", code: "INVALID_ACTION" }, 400);
    }

    // Validate source if provided
    if (sourceRaw && !["email_queue", "scheduled_notifications", "moodle_sync", "moodle_enrollment_sync", "failed_syncs"].includes(sourceRaw)) {
      return json({ ok: false, error: "Unsupported source", code: "INVALID_SOURCE" }, 400);
    }

    // Validate id format if provided (non-empty string)
    const idErr = id ? validateRequired(id, "id") : null;
    if (idErr) {
      return json({ ok: false, error: idErr.message, code: "INVALID_ID" }, 400);
    }

    if (isCronCall && !id) {
      const sweep = await sweepMoodleEnrollmentRetries(serviceDb, limit);
      let escalated = 0;
      for (const row of sweep.candidates || []) {
        try {
          const outcome = await maybeEscalateMoodleFailure(serviceDb, String(row.id || ""));
          if (outcome.escalated) escalated += 1;
        } catch (err) {
          console.error("RETRY_SWEEP_ESCALATION_ERROR", err);
        }
      }
      await logAudit(
        serviceDb,
        actorEmail,
        "RETRY_SWEEP_EXECUTED",
        "moodle_enrollment_sync",
        "batch",
        "SUCCESS",
        { source: "moodle_enrollment_sync", selected: sweep.selected, attempted: sweep.attempted, escalated, limit },
      );
      // Moodle rows marked RETRYING are durable — the scheduled */5 moodle-sync cron
      // discovers them on its next run. No function-to-function invocation required.
      return json({ ok: true, mode: "auto_sweep", source: "moodle_enrollment_sync", selected: sweep.selected, attempted: sweep.attempted, escalated, limit });
    }

    if (!id) return json({ ok: false, error: "id is required", code: "MISSING_ID" }, 400);

    if (action === "retry") {
      if (source === "moodle_enrollment_sync") {
        const { data: row } = await serviceDb
          .from("moodle_enrollment_sync")
          .select("error_code,last_error")
          .eq("id", id)
          .maybeSingle();
        if (!isRetryableMoodleError(row?.error_code, row?.last_error)) {
          return json({ ok: false, error: `Non-retryable error_code: ${String(row?.error_code || "UNKNOWN")}` }, 409);
        }
      }

      await applyRetry(serviceDb, source, id);

      if (source === "moodle_enrollment_sync") {
        try {
          await maybeEscalateMoodleFailure(serviceDb, id);
        } catch (escalationErr) {
          console.error("RETRY_WORKER_NEXUS_ESCALATION_ERROR", escalationErr);
        }
        // Row is now RETRYING — the scheduled */5 moodle-sync cron picks it up.
        // No function-to-function invocation needed; durable state drives processing.
      }
    }
    else await applyResolve(serviceDb, source, id);

    await logAudit(
      serviceDb,
      actorEmail,
      action === "retry"
        ? (source === "moodle_enrollment_sync" ? "MOODLE_SYNC_RETRIED" : "RETRY_REQUESTED")
        : "RETRY_MARK_RESOLVED",
      source,
      id,
      "SUCCESS",
      { action, source, id },
    );

    return json({ ok: true, action, source, id });
  } catch (error) {
    const c = classifyError(error);
    return json({ ok: false, error: c.message, code: c.code }, c.statusCode);
  }
});


