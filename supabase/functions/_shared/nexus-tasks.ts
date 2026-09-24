// Shared Nexus task creation module.
// Callers: missed-class-detector, retry-worker.
// All task-creation logic lives here; no caller should POST directly to clickup-sync.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type RequestType = "missed_class" | "escalation";

export type MissedClassPayload = {
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

export type EscalationPayload = {
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

export interface NexusTaskConfig {
  nexusUrl: string;
  nexusApiKey: string;
  listId?: string;
  spaceId?: string;
  timeoutMs?: number;
}

export interface NexusTaskResult {
  ok: boolean;
  dedupe_key: string;
  nexus_task_id: string | null;
  reused: boolean;
  non_fatal?: boolean;
  error?: string;
}

// Default Nexus organizational identifiers (production values).
const DEFAULT_LIST_ID = "35cc9695-d49e-4584-8b60-2091c29d3f95";
const DEFAULT_SPACE_ID = "2aee687a-4dad-447b-ad6b-1e0239a6beb6";
export const NEXUS_TIMEOUT_MS = 15_000;

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeUpper(value: unknown): string {
  return normalizeText(value).toUpperCase();
}

function dayMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildDedupeKey(type: RequestType, payload: MissedClassPayload | EscalationPayload): string {
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

export function buildTask(
  type: RequestType,
  payload: MissedClassPayload | EscalationPayload,
  assigneeId: string,
): Record<string, unknown> {
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

export async function resolveAssignee(
  db: ReturnType<typeof createClient>,
  groupId: string,
  subgroupId: string,
  fallbackAssigneeId: string,
): Promise<string> {
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

// Single-attempt POST to the Nexus tasks endpoint, bounded by timeoutMs.
// No automatic retry: duplicate-task risk on timeout makes unbounded retry unsafe
// when no Nexus-side idempotency key is available. Callers rely on rocksolid_task_links
// FAILED status as the durable retry mechanism (next invocation tries again).
export async function createNexusTask(
  nexusUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs = NEXUS_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${nexusUrl}/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Nexus task create failed (${res.status}): ${text}`);
  }

  return await res.json();
}

async function updateSourceNexusTaskId(
  db: ReturnType<typeof createClient>,
  type: RequestType,
  payload: MissedClassPayload | EscalationPayload,
  nexusTaskId: string,
): Promise<void> {
  if (type === "escalation") {
    const p = payload as EscalationPayload;
    // Column named clickup_task_id for backward compat; stores Nexus task ID.
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

// Idempotent task creation: checks rocksolid_task_links before calling Nexus.
// Returns { ok: true, reused: true } if a task already exists for this event.
// Returns { ok: false, non_fatal: true } if Nexus is unreachable or unconfigured.
export async function ensureNexusTask(
  db: ReturnType<typeof createClient>,
  type: RequestType,
  payload: MissedClassPayload | EscalationPayload,
  actorEmail: string,
  config: NexusTaskConfig,
): Promise<NexusTaskResult> {
  const nexusUrl = config.nexusUrl;
  const nexusApiKey = config.nexusApiKey;
  const listId = config.listId || DEFAULT_LIST_ID;
  const spaceId = config.spaceId || DEFAULT_SPACE_ID;
  const timeoutMs = config.timeoutMs || NEXUS_TIMEOUT_MS;

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
    return { ok: true, dedupe_key: dedupeKey, nexus_task_id: existing.data.nexus_task_id, reused: true };
  }

  await db.from("rocksolid_task_links").upsert(
    { source_type: sourceType, source_id: sourceId || "unknown", dedupe_key: dedupeKey, status: "PENDING" },
    { onConflict: "dedupe_key" },
  );

  if (!nexusUrl || !nexusApiKey) {
    const msg = "Nexus API secrets are not configured";
    await db
      .from("rocksolid_task_links")
      .update({ status: "FAILED", error_message: msg, updated_at: new Date().toISOString() })
      .eq("dedupe_key", dedupeKey);
    await _logAudit(db, actorEmail, "NEXUS_TASK_FAILED", sourceType, sourceId || dedupeKey, { dedupe_key: dedupeKey, error: msg });
    return { ok: false, dedupe_key: dedupeKey, nexus_task_id: null, reused: false, non_fatal: true, error: msg };
  }

  const groupId = normalizeText((payload as MissedClassPayload).group_id || (payload as EscalationPayload).group_id);
  const subgroupId = normalizeText((payload as MissedClassPayload).subgroup_id || (payload as EscalationPayload).subgroup_id);
  const assigneeId = await resolveAssignee(db, groupId, subgroupId, "");

  const taskBody = { ...buildTask(type, payload, assigneeId), list_id: listId, space_id: spaceId };

  let created: Record<string, unknown> = {};
  try {
    created = await createNexusTask(nexusUrl, nexusApiKey, taskBody, timeoutMs);
  } catch (createErr) {
    const errMsg = createErr instanceof Error ? createErr.message : String(createErr);
    await db
      .from("rocksolid_task_links")
      .update({ status: "FAILED", error_message: errMsg, updated_at: new Date().toISOString() })
      .eq("dedupe_key", dedupeKey);
    await _logAudit(db, actorEmail, "NEXUS_TASK_FAILED", sourceType, sourceId || dedupeKey, { dedupe_key: dedupeKey, error: errMsg });
    return { ok: false, dedupe_key: dedupeKey, nexus_task_id: null, reused: false, non_fatal: true, error: errMsg };
  }

  const nexusTaskId = normalizeText(created?.id);

  await db
    .from("rocksolid_task_links")
    .update({ nexus_task_id: nexusTaskId || null, status: "CREATED", error_message: null, updated_at: new Date().toISOString() })
    .eq("dedupe_key", dedupeKey);

  if (nexusTaskId) {
    await updateSourceNexusTaskId(db, type, payload, nexusTaskId).catch(() => { /* non-fatal */ });
  }

  await _logAudit(db, actorEmail, "NEXUS_TASK_CREATED", sourceType, sourceId || dedupeKey, {
    dedupe_key: dedupeKey,
    nexus_task_id: nexusTaskId,
    type,
    assignee_id: assigneeId || null,
    due_date: toIsoDate(new Date(Number(taskBody.due_date || Date.now()))),
  });

  return { ok: true, dedupe_key: dedupeKey, nexus_task_id: nexusTaskId || null, reused: false };
}

async function _logAudit(
  db: ReturnType<typeof createClient>,
  actorEmail: string,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
): Promise<void> {
  await db.from("audit_logs").insert({
    actor_email: actorEmail,
    action,
    entity_type: entityType,
    entity_id: entityId,
    status: action.endsWith("FAILED") ? "FAILED" : "SUCCESS",
    details,
    logged_at: new Date().toISOString(),
  }).catch(() => { /* ignore log errors */ });
}
