// Shared Nexus task creation module.
// Callers: missed-class-detector, retry-worker (and _shared/nexus-reconcile.ts for recovery).
// All task-creation logic lives here; nothing else may POST tasks to Nexus.
//
// Nexus contract (verified against Amber-E-Moseri/Nexus @ 0611a28, supabase/functions/task-api):
//   POST {base}/tasks   header  x-api-key: <Nexus API key>   (NOT Authorization: Bearer)
//     body  { title, description?, priority: urgent|high|medium|low, due_date?: "YYYY-MM-DD",
//             assignee_id?: <users.id uuid>, source_name?, source_type?, external_unique_key? }
//     201 { task: { id, ... } }                                  created
//     200 { duplicate: true, task: { id, ... } }                 external_unique_key already exists
//     400/401/403/429/5xx { error }                              rejected / not created
//   One task per external_unique_key (unique index + find-or-create), so replaying a POST with
//   the same key is safe: it can never create a second task.
//   GET  {base}/tasks?source=api&limit=<=200   -> { tasks: [...] } (newest first; NO key filter)
// base = NEXUS_TASK_API_URL, default `${NEXUS_API_URL}/task-api`; key = NEXUS_TASK_API_KEY.
// Sprint/Team are NOT used: placement comes from the API key's own scope.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { describeError } from "./error-text.ts";

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
  timeoutMs?: number;
}

/** Task API configuration from the environment. Never falls back to NEXUS_API_KEY (a different credential). */
export function nexusTaskConfigFromEnv(): NexusTaskConfig {
  const explicit = (Deno.env.get("NEXUS_TASK_API_URL") || "").trim().replace(/\/+$/, "");
  const base = (Deno.env.get("NEXUS_API_URL") || "").trim().replace(/\/+$/, "");
  return {
    nexusUrl: explicit || (base ? `${base}/task-api` : ""),
    nexusApiKey: (Deno.env.get("NEXUS_TASK_API_KEY") || "").trim(),
  };
}

export interface NexusTaskResult {
  ok: boolean;
  dedupe_key: string;
  nexus_task_id: string | null;
  reused: boolean;
  non_fatal?: boolean;
  error?: string;
}

export const NEXUS_TIMEOUT_MS = 15_000;
/** A TIMEOUT_UNKNOWN row becomes eligible for reconciliation this long after the timeout. */
export const RECONCILE_FIRST_DELAY_MS = 5 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

// ── Typed failures: the caller must distinguish "definitely rejected" from "outcome unknown". ──
export class NexusTimeoutError extends Error {
  constructor(message: string) { super(message); this.name = "NexusTimeoutError"; }
}
/** Nexus answered with a non-2xx status: the request was refused (or failed) before/without a confirmed insert. */
export class NexusHttpError extends Error {
  status: number;
  /** Nexus's own `{ "error": "..." }` text when the body was JSON of that shape, else "". */
  detail: string;
  constructor(status: number, message: string, detail = "") {
    super(message);
    this.name = "NexusHttpError";
    this.status = status;
    this.detail = detail;
  }
}

/** The error string of a task-api `{ error }` body, or "" when the body is not that shape. */
export function nexusErrorText(body: string): string {
  try {
    const j = JSON.parse(body);
    return j && typeof j === "object" && typeof (j as Record<string, unknown>).error === "string" ? String((j as Record<string, unknown>).error) : "";
  } catch {
    return "";
  }
}

/**
 * A CONFIRMED permanent assignee rejection: task-api answers `400 { error: "assignee not found" }` only when the
 * supplied assignee_id is absent from public.users (task-api/index.ts: users.maybeSingle() returned no row).
 * Nothing about that is transient, so retrying the same mapping cannot succeed. Deliberately narrow: any other
 * 400 (validation of title/priority/due_date/...) or any other status is NOT classified here.
 */
export function isAssigneeNotFound(err: unknown): boolean {
  return err instanceof NexusHttpError && err.status === 400 && err.detail.trim().toLowerCase() === "assignee not found";
}
/** Nexus answered 2xx but the body does not confirm a task: the task MAY exist. */
export class NexusMalformedResponseError extends Error {
  constructor(message: string) { super(message); this.name = "NexusMalformedResponseError"; }
}

export interface NexusCreateResult {
  id: string;
  /** true when Nexus reported that the external_unique_key already existed (200 duplicate). */
  duplicate: boolean;
}

/** Strict parse of a task-api create response. Anything unconfirmed throws NexusMalformedResponseError. */
export function parseCreateResponse(status: number, json: unknown): NexusCreateResult {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const task = (j.task && typeof j.task === "object" ? j.task : {}) as Record<string, unknown>;
  const id = typeof task.id === "string" ? task.id.trim() : "";
  if (!id) throw new NexusMalformedResponseError(`Nexus ${status} response did not contain task.id`);
  if (status === 201) return { id, duplicate: false };
  if (status === 200 && j.duplicate === true) return { id, duplicate: true };
  throw new NexusMalformedResponseError(`Nexus ${status} response was not a recognised create/duplicate result`);
}

/** Request sent, outcome ambiguous (the task may exist) => TIMEOUT_UNKNOWN. Anything else => FAILED. */
export function classifyCreateFailure(err: unknown): "TIMEOUT_UNKNOWN" | "FAILED" {
  return err instanceof NexusTimeoutError || err instanceof NexusMalformedResponseError ? "TIMEOUT_UNKNOWN" : "FAILED";
}

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

export function buildExternalUniqueKey(dedupeKey: string): string {
  return `rocksolid:${dedupeKey}`;
}

export function buildTask(
  type: RequestType,
  payload: MissedClassPayload | EscalationPayload,
  assigneeId: string,
): Record<string, unknown> {
  const now = new Date();
  const dueDate = new Date(now.getTime() + (type === "missed_class" ? dayMs(1) : dayMs(0.5)));
  // Nexus `assignee_id` takes a single users.id. Omitted (not null) when there is no valid mapping.
  const assignee = assigneeId ? { assignee_id: assigneeId } : {};

  if (type === "missed_class") {
    const p = payload as MissedClassPayload;
    const title = `Missed Class Follow-up: ${normalizeText(p.student_name || p.student_id || "Unknown Student")}`;
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
      title,
      description,
      due_date: toIsoDate(dueDate),
      priority: "medium",
      source_name: "rocksolid",
      source_type: "missed_class",
      ...assignee,
    };
  }

  const p = payload as EscalationPayload;
  const high = ["MOODLE_AUTH_OR_WAF_BLOCKED", "AUTH", "TIMEOUT", "NETWORK", "REVIEW_STALE_48H"].includes(normalizeUpper(p.error_code));
  const entity = normalizeText(p.student_name || p.student_id || p.source_id || "Unknown");
  const title = `Ops Escalation: ${entity}`;
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
    title,
    description,
    due_date: toIsoDate(dueDate),
    priority: high ? "high" : "medium",
    source_name: "rocksolid",
    source_type: "escalation",
    ...assignee,
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

// Single-attempt POST to the Nexus task API, bounded by timeoutMs (the timer covers reading the body).
// No automatic retry here: a timed-out request may or may not have created the task. Recovery of that
// unknown outcome is the job of _shared/nexus-reconcile.ts (find by external_unique_key, then re-POST the
// SAME key, which Nexus guarantees cannot create a second task). Callers rely on the rocksolid_task_links
// status as the durable record.
export async function createNexusTask(
  nexusUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  externalUniqueKey: string,
  timeoutMs = NEXUS_TIMEOUT_MS,
): Promise<NexusCreateResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status = 0;
  let json: unknown;
  let text = "";
  try {
    const res = await fetch(`${nexusUrl}/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ ...body, external_unique_key: externalUniqueKey }),
      signal: controller.signal,
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if ((err as { name?: string })?.name === "AbortError" || /abort|timed? ?out/i.test(msg)) {
      throw new NexusTimeoutError(`Nexus task create timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (status < 200 || status >= 300) {
    throw new NexusHttpError(status, `Nexus task create failed (${status}): ${text.slice(0, 300)}`, nexusErrorText(text));
  }
  try {
    json = JSON.parse(text);
  } catch {
    throw new NexusMalformedResponseError(`Nexus ${status} response was not valid JSON`);
  }
  return parseCreateResponse(status, json);
}

/** Link an escalation source row to its Nexus task. Column is named clickup_task_id for backward compat. */
export async function linkEscalationSource(
  db: ReturnType<typeof createClient>,
  source: string,
  sourceId: string,
  nexusTaskId: string,
): Promise<void> {
  if (!sourceId) return;
  if (source === "moodle_enrollment_sync") {
    await db.from("moodle_enrollment_sync").update({ clickup_task_id: nexusTaskId }).eq("id", sourceId);
  }
  if (source === "applicants") {
    await db.from("applicants").update({ clickup_task_id: nexusTaskId }).eq("id", sourceId);
  }
}

async function updateSourceNexusTaskId(
  db: ReturnType<typeof createClient>,
  type: RequestType,
  payload: MissedClassPayload | EscalationPayload,
  nexusTaskId: string,
): Promise<void> {
  if (type === "escalation") {
    const p = payload as EscalationPayload;
    await linkEscalationSource(db, normalizeText(p.source), normalizeText(p.source_id), nexusTaskId);
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

// Validate dedupe identity fields before claiming or posting.
function validateDedupeFields(type: RequestType, payload: MissedClassPayload | EscalationPayload): string | null {
  if (type === "missed_class") {
    const p = payload as MissedClassPayload;
    const student = normalizeText(p.student_id);
    const classOpt = normalizeText(p.class_option_id);
    const classNum = normalizeText(p.class_number);
    const classDate = normalizeText(p.class_date);
    if (!student || !classOpt || !classNum || !classDate) {
      return `malformed missed_class payload: missing required fields (student_id, class_option_id, class_number, class_date)`;
    }
  } else {
    const p = payload as EscalationPayload;
    const source = normalizeText(p.source);
    const sourceId = normalizeText(p.source_id);
    if (!source || !sourceId) {
      return `malformed escalation payload: missing required fields (source, source_id)`;
    }
  }
  return null;
}

// Idempotent task creation: uses atomic Postgres claim to prevent concurrent duplicate POSTs.
// Returns { ok: true, reused: true } if a task already exists for this event.
// Returns { ok: false, non_fatal: true } if claim is not owned or Nexus is unreachable.
//
// Failure semantics once the claim is owned:
//   - timeout, or a 2xx that does not confirm a task  -> TIMEOUT_UNKNOWN (task MAY exist; never re-POSTed
//     by the producer path, resolved by nexus-reconcile)
//   - any other failure (4xx/5xx/network)             -> FAILED (re-claimable; the stable external key makes
//     a later POST safe)
// Persisting writes are guarded by claim_token so a worker whose lease was recovered cannot overwrite the
// new owner's result.
export async function ensureNexusTask(
  db: ReturnType<typeof createClient>,
  type: RequestType,
  payload: MissedClassPayload | EscalationPayload,
  actorEmail: string,
  config: NexusTaskConfig,
): Promise<NexusTaskResult> {
  const nexusUrl = config.nexusUrl;
  const nexusApiKey = config.nexusApiKey;
  const timeoutMs = config.timeoutMs || NEXUS_TIMEOUT_MS;

  const dedupeKey = buildDedupeKey(type, payload);
  const sourceType = type === "missed_class"
    ? "missed_class"
    : `escalation:${normalizeText((payload as EscalationPayload).source)}`;
  const sourceId = type === "missed_class"
    ? `${normalizeText((payload as MissedClassPayload).student_id)}:${normalizeText((payload as MissedClassPayload).class_option_id)}:${normalizeText((payload as MissedClassPayload).class_number)}:${normalizeText((payload as MissedClassPayload).class_date)}`
    : normalizeText((payload as EscalationPayload).source_id);

  // Validate dedupe identity before claiming
  const validationErr = validateDedupeFields(type, payload);
  if (validationErr) {
    await _logAudit(db, actorEmail, "NEXUS_TASK_MALFORMED", sourceType, sourceId || dedupeKey, { dedupe_key: dedupeKey, error: validationErr });
    return { ok: false, dedupe_key: dedupeKey, nexus_task_id: null, reused: false, non_fatal: true, error: validationErr };
  }

  // Atomic claim: only one concurrent invocation per dedupe_key can proceed to POST
  const claimToken = crypto.randomUUID();
  const { data: claimResult, error: claimErr } = await db
    .rpc("claim_nexus_task", {
      p_source_type: sourceType,
      p_source_id: sourceId || "unknown",
      p_dedupe_key: dedupeKey,
      p_claim_token: claimToken,
    });

  if (claimErr) {
    await _logAudit(db, actorEmail, "NEXUS_TASK_CLAIM_ERROR", sourceType, sourceId || dedupeKey, { dedupe_key: dedupeKey, error: claimErr.message });
    return { ok: false, dedupe_key: dedupeKey, nexus_task_id: null, reused: false, non_fatal: true, error: claimErr.message };
  }

  const claim = (claimResult as unknown[])?.[0] as any;
  if (!claim) {
    await _logAudit(db, actorEmail, "NEXUS_TASK_CLAIM_EMPTY", sourceType, sourceId || dedupeKey, { dedupe_key: dedupeKey });
    return { ok: false, dedupe_key: dedupeKey, nexus_task_id: null, reused: false, non_fatal: true, error: "claim returned empty" };
  }

  // If task already completed, return existing nexus_task_id
  if (claim.nexus_task_id) {
    return { ok: true, dedupe_key: dedupeKey, nexus_task_id: claim.nexus_task_id, reused: true };
  }

  // If caller is not owner, another invocation claimed this (or the outcome is TIMEOUT_UNKNOWN /
  // RECONCILE_FAILED and awaits reconciliation); return in-progress without POSTing.
  if (!claim.is_owner) {
    return { ok: false, dedupe_key: dedupeKey, nexus_task_id: null, reused: false, non_fatal: true, error: `not claim owner (status ${claim.status ?? "unknown"})` };
  }

  const markFailed = async (
    status: "FAILED" | "TIMEOUT_UNKNOWN" | "ASSIGNEE_REJECTED",
    message: string,
    extra: Record<string, unknown> = {},
    auditAction = "NEXUS_TASK_FAILED",
  ) => {
    const patch: Record<string, unknown> = { status, error_message: message, updated_at: new Date().toISOString() };
    if (status === "TIMEOUT_UNKNOWN") {
      patch.reconcile_attempts = 0;
      patch.next_reconcile_at = new Date(Date.now() + RECONCILE_FIRST_DELAY_MS).toISOString();
    }
    // Fenced by claim_token. If this write itself fails the row stays CLAIMING and the 2-minute lease
    // recovers it (a same-key re-POST is safe); the audit row records whether the state was stored.
    const w = await writeFenced(db, patch, dedupeKey, claimToken);
    await _logAudit(db, actorEmail, auditAction, sourceType, sourceId || dedupeKey, {
      dedupe_key: dedupeKey,
      error: message,
      status,
      state_persisted: w.outcome === "written",
      ...extra,
    });
    return { ok: false, dedupe_key: dedupeKey, nexus_task_id: null, reused: false, non_fatal: true, error: message } as NexusTaskResult;
  };

  if (!nexusUrl || !nexusApiKey) {
    return await markFailed("FAILED", "Nexus task API is not configured (NEXUS_TASK_API_URL/NEXUS_API_URL and NEXUS_TASK_API_KEY)");
  }

  const groupId = normalizeText((payload as MissedClassPayload).group_id || (payload as EscalationPayload).group_id);
  const subgroupId = normalizeText((payload as MissedClassPayload).subgroup_id || (payload as EscalationPayload).subgroup_id);
  const assigneeId = await resolveAssignee(db, groupId, subgroupId, "");

  // A mapped id that is not a valid Nexus user id is a configuration error: fail safely, never POST a
  // malformed assignee and never silently create an unassigned task for a broken mapping.
  // (No mapping at all is legitimate: the task is created unassigned and the audit row says so.)
  if (assigneeId && !isUuid(assigneeId)) {
    return await markFailed("FAILED", `INVALID_ASSIGNEE_MAPPING: rocksolid_admin_mappings.nexus_user_id for group "${groupId}"/"${subgroupId}" is not a valid user id`);
  }

  const taskBody = buildTask(type, payload, assigneeId);
  const externalUniqueKey = buildExternalUniqueKey(dedupeKey);

  let created: NexusCreateResult;
  try {
    created = await createNexusTask(nexusUrl, nexusApiKey, taskBody, externalUniqueKey, timeoutMs);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    // Confirmed permanent: the mapped Nexus user does not exist. Stop re-POSTing; needs a human to fix the mapping.
    // Only when we actually sent an assignee, otherwise "assignee not found" cannot be about our mapping.
    if (assigneeId && isAssigneeNotFound(e)) {
      return await markFailed(
        "ASSIGNEE_REJECTED",
        `ASSIGNEE_NOT_FOUND: Nexus has no user ${assigneeId} (rocksolid_admin_mappings.nexus_user_id for group "${groupId}"/"${subgroupId}"); fix the mapping or create the user, then release this row`,
        { assignee_id: assigneeId, group_id: groupId, subgroup_id: subgroupId, needs_manual_attention: true },
        "NEXUS_TASK_ASSIGNEE_REJECTED",
      );
    }
    return await markFailed(classifyCreateFailure(e), e.message);
  }

  const nexusTaskId = created.id;

  // Nexus now holds this task (created, or returned as a duplicate). It is only a SUCCESS for the caller
  // once the canonical id is durably stored on OUR claimed row. Verify the write instead of assuming it:
  //   error      -> the local database failed: the remote task EXISTS but we cannot prove we recorded it.
  //                 Park the row as TIMEOUT_UNKNOWN so reconciliation resolves it (never re-POST blindly).
  //                 If even that write fails the row stays CLAIMING and the 2-minute lease re-claims it.
  //   zero rows  -> our claim_token no longer matches: a newer owner holds the row. Do not write, do not
  //                 report success; that owner persists its own result (same key => same remote task).
  const persisted = await writeFenced(
    db,
    { nexus_task_id: nexusTaskId, status: "CREATED", error_message: null, next_reconcile_at: null, updated_at: new Date().toISOString() },
    dedupeKey,
    claimToken,
  );

  if (persisted.outcome === "error") {
    return await markFailed(
      "TIMEOUT_UNKNOWN",
      `PERSISTENCE_FAILED: Nexus ${created.duplicate ? "returned existing" : "created"} task ${nexusTaskId} but the local link update failed (${persisted.message}); parked for reconciliation`.slice(0, 500),
      { persistence_failed: true, remote_nexus_task_id: nexusTaskId, remote_duplicate: created.duplicate },
    );
  }

  if (persisted.outcome === "lost") {
    await _logAudit(db, actorEmail, "NEXUS_TASK_CLAIM_LOST", sourceType, sourceId || dedupeKey, {
      dedupe_key: dedupeKey,
      remote_nexus_task_id: nexusTaskId,
      remote_duplicate: created.duplicate,
    });
    return {
      ok: false,
      dedupe_key: dedupeKey,
      nexus_task_id: null,
      reused: false,
      non_fatal: true,
      error: "claim lost before the Nexus task id could be stored (a newer claim owns this row)",
    };
  }

  await updateSourceNexusTaskId(db, type, payload, nexusTaskId).catch(() => { /* non-fatal */ });

  await _logAudit(db, actorEmail, "NEXUS_TASK_CREATED", sourceType, sourceId || dedupeKey, {
    dedupe_key: dedupeKey,
    nexus_task_id: nexusTaskId,
    type,
    remote_duplicate: created.duplicate,
    assignee_id: assigneeId || null,
    assignment: assigneeId ? "mapped_user" : "unassigned_no_mapping",
    due_date: taskBody.due_date,
  });

  return { ok: true, dedupe_key: dedupeKey, nexus_task_id: nexusTaskId, reused: created.duplicate };
}

type FencedWrite = { outcome: "written" } | { outcome: "lost" } | { outcome: "error"; message: string };

/**
 * UPDATE rocksolid_task_links ... WHERE dedupe_key = ? AND claim_token = ?, returning the touched rows so the
 * caller can tell the three outcomes apart: written (1 row), lost (0 rows: claim_token fencing rejected a
 * stale worker) and error (database/transport failure). Never throws.
 */
async function writeFenced(
  db: ReturnType<typeof createClient>,
  patch: Record<string, unknown>,
  dedupeKey: string,
  claimToken: string,
): Promise<FencedWrite> {
  try {
    const { data, error } = await db
      .from("rocksolid_task_links")
      .update(patch)
      .eq("dedupe_key", dedupeKey)
      .eq("claim_token", claimToken)
      .select("id");
    if (error) return { outcome: "error", message: describeError(error) };
    return Array.isArray(data) && data.length > 0 ? { outcome: "written" } : { outcome: "lost" };
  } catch (e) {
    return { outcome: "error", message: describeError(e) };
  }
}

async function _logAudit(
  db: ReturnType<typeof createClient>,
  actorEmail: string,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
): Promise<void> {
  // NOTE: the Supabase query builder is thenable but has NO .catch(); chaining one throws
  // "catch is not a function" at runtime. Await inside try/catch instead.
  try {
    await db.from("audit_logs").insert({
      actor_email: actorEmail,
      action,
      entity_type: entityType,
      entity_id: entityId,
      status: action.endsWith("FAILED") || action.endsWith("REJECTED") ? "FAILED" : "SUCCESS",
      details,
      logged_at: new Date().toISOString(),
    });
  } catch { /* audit failures must never break task creation */ }
}

export { _logAudit as logNexusAudit };
