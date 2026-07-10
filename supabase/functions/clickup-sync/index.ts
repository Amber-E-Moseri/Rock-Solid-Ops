import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestType = "missed_class" | "escalation";

type MissedClassPayload = {
  student_id?: string;
  student_name?: string;
  email?: string;
  group_id?: string;
  subgroup_id?: string;
  class_option_id?: string;
  class_number?: string;
  class_date?: string;
  reason?: string;
};

type EscalationPayload = {
  source?: "moodle_enrollment_sync" | "applicants";
  source_id?: string;
  student_id?: string;
  student_name?: string;
  email?: string;
  group_id?: string;
  subgroup_id?: string;
  reason?: string;
  error_code?: string;
  error_message?: string;
};

type SyncRequest = {
  type?: RequestType;
  payload?: Record<string, unknown>;
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

function dayMs(days: number) {
  return days * 24 * 60 * 60 * 1000;
}

function toIsoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeUpper(value: unknown) {
  return normalizeText(value).toUpperCase();
}

async function isAdmin(db: ReturnType<typeof createClient>, userId: string, email?: string) {
  const legacy = await db
    .from("admin_users")
    .select("role,status,active")
    .or(`auth_user_id.eq.${userId}${email ? `,email.eq.${email}` : ""}`)
    .maybeSingle();

  const legacyRole = String(legacy.data?.role || "").toLowerCase();
  const legacyActive = legacy.data?.active !== false && String(legacy.data?.status || "").toLowerCase() !== "suspended";
  if (legacyActive && ["admin", "superadmin", "subgroup_admin", "pastor", "principal"].includes(legacyRole)) {
    return true;
  }

  try {
    const profile = await db.from("profiles").select("role,is_active").eq("user_id", userId).maybeSingle();
    const role = String(profile.data?.role || "").toLowerCase();
    const active = profile.data?.is_active !== false;
    if (active && ["admin", "superadmin", "subgroup_admin", "pastor", "principal"].includes(role)) {
      return true;
    }
  } catch (_) {
    // profiles table might not exist in some environments
  }

  return false;
}

async function ensureAuthorized(req: Request, db: ReturnType<typeof createClient>, serviceKey: string) {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return { ok: false, reason: "Missing bearer token" };
  const token = authHeader.slice("Bearer ".length).trim();

  if (token === serviceKey) {
    return { ok: true, actorEmail: "service@system" };
  }

  // Also accept the service role JWT (decoded role claim = "service_role")
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const claims = JSON.parse(atob(parts[1]));
      if (claims?.role === "service_role") {
        return { ok: true, actorEmail: "service@system" };
      }
    }
  } catch (_) {}

  const { data: userData, error: userErr } = await db.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false, reason: "Invalid session" };

  const allowed = await isAdmin(db, userData.user.id, userData.user.email);
  if (!allowed) return { ok: false, reason: "Admin access required" };

  return { ok: true, actorEmail: userData.user.email || "admin@system" };
}

async function logAudit(
  db: ReturnType<typeof createClient>,
  action: string,
  status: string,
  actorEmail: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
) {
  await db.from("audit_logs").insert({
    actor_email: actorEmail,
    action,
    entity_type: entityType,
    entity_id: entityId,
    status,
    details,
    logged_at: new Date().toISOString(),
  });
}

async function resolveAssignee(
  db: ReturnType<typeof createClient>,
  groupId: string,
  subgroupId: string,
  fallbackAssigneeId: string,
) {
  if (subgroupId) {
    const { data } = await db
      .from("rocksolid_admin_mappings")
      .select("nexus_user_id")
      .eq("active", true)
      .eq("group_id", groupId)
      .eq("subgroup_id", subgroupId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.nexus_user_id) return String(data.nexus_user_id);
  }

  if (groupId) {
    const { data } = await db
      .from("rocksolid_admin_mappings")
      .select("nexus_user_id")
      .eq("active", true)
      .eq("group_id", groupId)
      .is("subgroup_id", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.nexus_user_id) return String(data.nexus_user_id);
  }

  return fallbackAssigneeId || "";
}

type Watcher = {
  nexus_user_id: string;
  watcher_name: string;
};

async function resolveWatchers(
  db: ReturnType<typeof createClient>,
  groupId: string,
  subgroupId: string,
): Promise<Watcher[]> {
  // Watchers not yet supported in Nexus integration
  return [] as Watcher[];
}

function buildDedupeKey(type: RequestType, payload: MissedClassPayload | EscalationPayload) {
  if (type === "missed_class") {
    const p = payload as MissedClassPayload;
    return `missed_class:${normalizeText(p.student_id)}:${normalizeText(p.class_option_id)}:${normalizeText(p.class_number)}:${normalizeText(p.class_date)}`;
  }
  const p = payload as EscalationPayload;
  const source = normalizeText(p.source);
  const sourceId = normalizeText(p.source_id);
  const err = normalizeUpper(p.error_code || "NO_CODE");
  return `escalation:${source}:${sourceId}:${err}`;
}

function buildTask(
  type: RequestType,
  payload: MissedClassPayload | EscalationPayload,
  assigneeId: string,
) {
  const now = new Date();
  const dueDate = new Date(now.getTime() + (type === "missed_class" ? dayMs(1) : dayMs(0.5)));

  if (type === "missed_class") {
    const p = payload as MissedClassPayload;
    const name = `Missed Class Follow-up: ${normalizeText(p.student_name || p.student_id || "Unknown Student")}`;
    const description = [
      "Automated operational escalation from Foundation School.",
      "",
      `Type: missed_class`,
      `Student: ${normalizeText(p.student_name)}`,
      `Student ID: ${normalizeText(p.student_id)}`,
      `Email: ${normalizeText(p.email)}`,
      `Group/Subgroup: ${normalizeText(p.group_id)} / ${normalizeText(p.subgroup_id)}`,
      `Class Option: ${normalizeText(p.class_option_id)}`,
      `Class Number: ${normalizeText(p.class_number)}`,
      `Class Date: ${normalizeText(p.class_date)}`,
      `Reason: ${normalizeText(p.reason || "No attendance record for passed session")}`,
    ].join("\n");

    return {
      name,
      description,
      due_date: dueDate.getTime(),
      priority: 3,
      assignees: assigneeId ? [assigneeId] : [],
    };
  }

  const p = payload as EscalationPayload;
  const high = ["MOODLE_AUTH_OR_WAF_BLOCKED", "AUTH", "TIMEOUT", "NETWORK", "REVIEW_STALE_48H"].includes(normalizeUpper(p.error_code));
  const entity = normalizeText(p.student_name || p.student_id || p.source_id || "Unknown");
  const name = `Ops Escalation: ${entity}`;
  const description = [
    "Automated operational escalation from Foundation School.",
    "",
    `Type: escalation`,
    `Source: ${normalizeText(p.source)}`,
    `Source ID: ${normalizeText(p.source_id)}`,
    `Student: ${normalizeText(p.student_name)}`,
    `Student ID: ${normalizeText(p.student_id)}`,
    `Email: ${normalizeText(p.email)}`,
    `Group/Subgroup: ${normalizeText(p.group_id)} / ${normalizeText(p.subgroup_id)}`,
    `Reason: ${normalizeText(p.reason)}`,
    `Error Code: ${normalizeText(p.error_code)}`,
    `Error: ${normalizeText(p.error_message)}`,
  ].join("\n");

  return {
    name,
    description,
    due_date: dueDate.getTime(),
    priority: high ? 2 : 3,
    assignees: assigneeId ? [assigneeId] : [],
  };
}

async function createNexusTaskWithBackoff(
  nexusUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
) {
  let attempt = 0;
  let lastError = "";

  while (attempt < 5) {
    attempt += 1;
    const res = await fetch(`${nexusUrl}/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return await res.json();

    const text = await res.text();
    lastError = `Nexus task create failed (${res.status}): ${text}`;
    const shouldRetry = res.status === 429 || res.status >= 500;
    if (!shouldRetry) break;

    const waitMs = Math.min(1000 * (2 ** (attempt - 1)), 10000);
    await sleep(waitMs);
  }

  throw new Error(lastError || "Nexus task create failed");
}

async function updateSourceTaskId(
  db: ReturnType<typeof createClient>,
  type: RequestType,
  payload: MissedClassPayload | EscalationPayload,
  nexusTaskId: string,
) {
  if (type === "escalation") {
    const p = payload as EscalationPayload;
    // clickup_task_id column retained on these tables for backwards compat
    if (p.source === "moodle_enrollment_sync" && p.source_id) {
      await db.from("moodle_enrollment_sync").update({ clickup_task_id: nexusTaskId }).eq("id", p.source_id);
    }
    if (p.source === "applicants" && p.source_id) {
      await db.from("applicants").update({ clickup_task_id: nexusTaskId }).eq("id", p.source_id);
    }
    return;
  }

  const p = payload as MissedClassPayload;
  if (p.student_id) {
    await db
      .from("students")
      .update({ updated_at: new Date().toISOString() })
      .eq("student_id", p.student_id);
  }
}

Deno.serve(async (req) => {
  applyAllowedOrigin(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const NEXUS_API_URL = Deno.env.get("NEXUS_API_URL") || "";
  const NEXUS_API_KEY = Deno.env.get("NEXUS_API_KEY") || "";
  const NEXUS_LIST_ID = "35cc9695-d49e-4584-8b60-2091c29d3f95";
  const NEXUS_SPACE_ID = "2aee687a-4dad-447b-ad6b-1e0239a6beb6";

  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "Missing Supabase env" }, 500);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const auth = await ensureAuthorized(req, db, SERVICE_KEY);
    if (!auth.ok) return json({ ok: false, error: auth.reason }, 401);

    const body = (await req.json().catch(() => ({}))) as SyncRequest;
    const type = normalizeText(body.type) as RequestType;
    if (type !== "missed_class" && type !== "escalation") {
      return json({ ok: false, error: "type must be missed_class|escalation" }, 400);
    }

    const payload = (body.payload || {}) as MissedClassPayload | EscalationPayload;
    const dedupeKey = buildDedupeKey(type, payload);
    const sourceType = type === "missed_class"
      ? "missed_class"
      : `escalation:${normalizeText((payload as EscalationPayload).source)}`;
    const sourceId = type === "missed_class"
      ? `${normalizeText((payload as MissedClassPayload).student_id)}:${normalizeText((payload as MissedClassPayload).class_option_id)}:${normalizeText((payload as MissedClassPayload).class_number)}:${normalizeText((payload as MissedClassPayload).class_date)}`
      : normalizeText((payload as EscalationPayload).source_id);

    const existing = await db
      .from("rocksolid_task_links")
      .select("id,nexus_task_id,status")
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();

    if (existing.data?.nexus_task_id) {
      return json({
        ok: true,
        dedupe_key: dedupeKey,
        nexus_task_id: existing.data.nexus_task_id,
        reused: true,
      });
    }

    await db.from("rocksolid_task_links").upsert(
      {
        source_type: sourceType,
        source_id: sourceId || "unknown",
        dedupe_key: dedupeKey,
        status: "PENDING",
      },
      { onConflict: "dedupe_key" },
    );

    if (!NEXUS_API_URL || !NEXUS_API_KEY) {
      const msg = "Nexus API secrets are not configured";
      await db
        .from("rocksolid_task_links")
        .update({ status: "FAILED", error_message: msg, updated_at: new Date().toISOString() })
        .eq("dedupe_key", dedupeKey);
      await logAudit(db, "NEXUS_TASK_FAILED", "FAILED", auth.actorEmail || "system", sourceType, sourceId || dedupeKey, {
        dedupe_key: dedupeKey,
        error: msg,
      });
      return json({ ok: false, dedupe_key: dedupeKey, error: msg, non_fatal: true });
    }

    const groupId = normalizeText((payload as MissedClassPayload).group_id || (payload as EscalationPayload).group_id);
    const subgroupId = normalizeText((payload as MissedClassPayload).subgroup_id || (payload as EscalationPayload).subgroup_id);
    const assigneeId = await resolveAssignee(db, groupId, subgroupId, "");

    const taskBody = { ...buildTask(type, payload, assigneeId), list_id: NEXUS_LIST_ID, space_id: NEXUS_SPACE_ID };
    let created: Record<string, unknown> = {};
    try {
      created = await createNexusTaskWithBackoff(NEXUS_API_URL, NEXUS_API_KEY, taskBody);
    } catch (createErr) {
      const errMsg = createErr instanceof Error ? createErr.message : String(createErr);
      await db
        .from("rocksolid_task_links")
        .update({
          status: "FAILED",
          error_message: errMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("dedupe_key", dedupeKey);
      await logAudit(db, "NEXUS_TASK_FAILED", "FAILED", auth.actorEmail || "system", sourceType, sourceId || dedupeKey, {
        dedupe_key: dedupeKey,
        error: errMsg,
      });
      return json({ ok: false, dedupe_key: dedupeKey, error: errMsg, non_fatal: true });
    }
    const nexusTaskId = normalizeText(created?.id);

    await db
      .from("rocksolid_task_links")
      .update({
        nexus_task_id: nexusTaskId || null,
        status: "CREATED",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("dedupe_key", dedupeKey);

    if (nexusTaskId) {
      await updateSourceTaskId(db, type, payload, nexusTaskId);
    }

    await logAudit(db, "NEXUS_TASK_CREATED", "SUCCESS", auth.actorEmail || "system", sourceType, sourceId || dedupeKey, {
      dedupe_key: dedupeKey,
      nexus_task_id: nexusTaskId,
      type,
      assignee_id: assigneeId || null,
      due_date: toIsoDate(new Date(Number(taskBody.due_date || Date.now()))),
    });

    return json({
      ok: true,
      dedupe_key: dedupeKey,
      nexus_task_id: nexusTaskId || null,
      assignee_id: assigneeId || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message, non_fatal: true }, 200);
  }
});

