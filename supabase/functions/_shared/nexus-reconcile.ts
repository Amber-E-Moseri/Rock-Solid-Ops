// Reconciliation of TIMEOUT_UNKNOWN Nexus task outcomes.
//
// Invariant: a TIMEOUT_UNKNOWN row converges to a known state without ever creating a duplicate task.
//
// What the Nexus API actually offers (Amber-E-Moseri/Nexus @ 0611a28, task-api):
//   * GET /tasks?source=api&limit=200 returns the newest <=200 API-created tasks, each with its
//     external_unique_key. There is NO filter by key, so a successful read can prove a task EXISTS
//     (found) but can only say "not in the newest 200" for a missing one.
//   * POST /tasks with an existing external_unique_key never creates a second task (unique index +
//     find-or-create; 200 { duplicate: true }).
// Therefore:
//   FOUND   -> persist the remote id, mark CREATED. No POST at all.
//   ABSENT  -> the read succeeded and the key is not there: release the row (FAILED). The normal
//              producer path then re-claims it and POSTs the SAME key; if the task was merely outside
//              the 200-row window Nexus answers duplicate:true and the id is persisted instead.
//              Duplicate-safety rests on the server-side unique key, not on the scan being exhaustive.
//   UNKNOWN -> the read failed, timed out, was rejected or was malformed. That is NOT evidence of
//              absence: the row stays TIMEOUT_UNKNOWN, attempts are counted, backoff applies, and
//              nothing is POSTed. After 24 inconclusive attempts the row becomes RECONCILE_FAILED
//              (terminal, never auto-claimed; operator action).
// All state transitions happen in SQL (resolve_nexus_reconciliation) under a claim token, so
// repeated or concurrent reconcilers are idempotent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildExternalUniqueKey,
  linkEscalationSource,
  logNexusAudit,
  NEXUS_TIMEOUT_MS,
  type NexusEndpointOptions,
  type NexusTaskConfig,
  storableNexusError,
  validateNexusTaskConfig,
} from "./nexus-tasks.ts";

export const NEXUS_LIST_WINDOW = 200;
export const RECONCILE_BATCH_LIMIT = 25;
export const RECONCILE_LEASE_SECONDS = 120;

export type NexusWindow =
  | { ok: true; byKey: Map<string, string>; size: number; truncated: boolean }
  | { ok: false; reason: string };

/** One read of the newest API-created Nexus tasks, indexed by external_unique_key. Fails closed. */
export async function fetchNexusTaskWindow(
  nexusUrl: string,
  apiKey: string,
  timeoutMs = NEXUS_TIMEOUT_MS,
  options: NexusEndpointOptions = {},
): Promise<NexusWindow> {
  // Validate before any request exists. A rejected configuration is a lookup failure, never a fetch.
  const endpoint = validateNexusTaskConfig({ nexusUrl, nexusApiKey: apiKey, allowLocalTestHttp: options.allowLocalTestHttp });
  if (!endpoint.ok) return { ok: false, reason: `lookup_config_${endpoint.problem}` };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status = 0;
  let text = "";
  try {
    const res = await fetch(`${endpoint.baseUrl}/tasks?source=api&limit=${NEXUS_LIST_WINDOW}`, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = (err as { name?: string })?.name === "AbortError" || /abort|timed? ?out/i.test(msg);
    return { ok: false, reason: timedOut ? "lookup_timeout" : "lookup_unreachable" };
  } finally {
    clearTimeout(timer);
  }

  if (status !== 200) return { ok: false, reason: `lookup_http_${status}` };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "lookup_malformed_json" };
  }
  const tasks = (json as { tasks?: unknown })?.tasks;
  if (!Array.isArray(tasks)) return { ok: false, reason: "lookup_malformed_shape" };

  const byKey = new Map<string, string>();
  for (const t of tasks) {
    if (!t || typeof t !== "object") return { ok: false, reason: "lookup_malformed_item" };
    const rec = t as Record<string, unknown>;
    const key = rec.external_unique_key;
    if (key === null || key === undefined || key === "") continue;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    if (typeof key !== "string" || !id) return { ok: false, reason: "lookup_malformed_item" };
    byKey.set(key, id);
  }
  return { ok: true, byKey, size: tasks.length, truncated: tasks.length >= NEXUS_LIST_WINDOW };
}

export interface ReconcileSummary {
  skipped?: string;
  claimed: number;
  found: number;
  absent_released: number;
  still_unknown: number;
  terminal_failed: number;
  not_applied: number;
  errors: number;
}

const emptySummary = (): ReconcileSummary => ({
  claimed: 0,
  found: 0,
  absent_released: 0,
  still_unknown: 0,
  terminal_failed: 0,
  not_applied: 0,
  errors: 0,
});

type ClaimedRow = {
  row_id: string;
  dedupe_key: string;
  source_type: string;
  source_id: string;
  reconcile_attempts: number;
};

/**
 * Lease a batch of due TIMEOUT_UNKNOWN rows, resolve them against one Nexus read, and persist each
 * verdict atomically. Never POSTs. Safe to call concurrently and repeatedly.
 */
export async function reconcileUnknownNexusTasks(
  db: ReturnType<typeof createClient>,
  config: NexusTaskConfig,
  actorEmail: string,
  opts: { limit?: number; leaseSeconds?: number } = {},
): Promise<ReconcileSummary> {
  const summary = emptySummary();

  // Without a valid endpoint and key a lookup would be "unavailable", which must not consume attempts.
  // Nothing is claimed and nothing is fetched in this branch.
  const endpoint = validateNexusTaskConfig(config);
  if (!endpoint.ok) {
    const missing = endpoint.problem === "missing_url" || endpoint.problem === "missing_api_key";
    summary.skipped = missing ? "nexus_task_api_not_configured" : `nexus_task_api_config_rejected:${endpoint.problem}`;
    return summary;
  }

  const limit = Math.max(1, Math.min(100, opts.limit ?? RECONCILE_BATCH_LIMIT));
  const claimToken = crypto.randomUUID();
  const { data, error } = await db.rpc("claim_nexus_reconciliations", {
    p_limit: limit,
    p_claim_token: claimToken,
    p_lease_seconds: opts.leaseSeconds ?? RECONCILE_LEASE_SECONDS,
  });
  if (error) {
    summary.errors += 1;
    summary.skipped = `claim_error: ${storableNexusError(error, config.nexusApiKey)}`;
    return summary;
  }

  const rows = (Array.isArray(data) ? data : []) as ClaimedRow[];
  summary.claimed = rows.length;
  if (!rows.length) return summary;

  const win = await fetchNexusTaskWindow(config.nexusUrl, config.nexusApiKey, config.timeoutMs || NEXUS_TIMEOUT_MS, {
    allowLocalTestHttp: config.allowLocalTestHttp,
  });

  for (const row of rows) {
    let outcome: "FOUND" | "ABSENT" | "UNKNOWN";
    let remoteId: string | null = null;
    let reason: string | null = null;

    if (!win.ok) {
      outcome = "UNKNOWN";
      reason = win.reason;
    } else {
      remoteId = win.byKey.get(buildExternalUniqueKey(row.dedupe_key)) ?? null;
      outcome = remoteId ? "FOUND" : "ABSENT";
    }

    const { data: res, error: resolveErr } = await db.rpc("resolve_nexus_reconciliation", {
      p_row_id: row.row_id,
      p_claim_token: claimToken,
      p_outcome: outcome,
      p_nexus_task_id: remoteId,
      p_error: reason,
    });
    if (resolveErr) {
      summary.errors += 1;
      continue;
    }
    const result = (Array.isArray(res) ? res[0] : res) as { status?: string; applied?: boolean } | undefined;
    if (!result?.applied) {
      summary.not_applied += 1; // already resolved / lease lost: no-op
      continue;
    }

    switch (result.status) {
      case "CREATED":
        summary.found += 1;
        if (row.source_type.startsWith("escalation:") && remoteId) {
          await linkEscalationSource(db, row.source_type.slice("escalation:".length), row.source_id, remoteId)
            .catch(() => { /* non-fatal: the task link row already holds the id */ });
        }
        break;
      case "FAILED":
        summary.absent_released += 1;
        break;
      case "RECONCILE_FAILED":
        summary.terminal_failed += 1;
        break;
      default:
        summary.still_unknown += 1;
    }

    await logNexusAudit(db, actorEmail, "NEXUS_TASK_RECONCILED", row.source_type, row.source_id || row.dedupe_key, {
      dedupe_key: row.dedupe_key,
      verdict: outcome,
      resulting_status: result.status,
      nexus_task_id: remoteId,
      reason,
      window_truncated: win.ok ? win.truncated : null,
    });
  }

  return summary;
}
