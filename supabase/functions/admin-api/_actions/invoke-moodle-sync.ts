import { createServiceClient } from "../../_shared/supabase.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

/**
 * Admin-authorized proxy to moodle-sync.
 *
 * Caller (authenticated user with admin/superadmin role) sends:
 *   { action: "invoke-moodle-sync", moodle_action: "test", ...payload }
 *
 * This handler:
 *   1. Verifies caller is admin or superadmin (already done by admin-api resolveAuth)
 *   2. Validates moodle_action against allowlist (only "test" currently)
 *   3. Reads CRON_INVOKE_SECRET from env
 *   4. POSTs to moodle-sync with x-cron-secret header (server-side)
 *   5. Never exposes secret to browser
 *
 * Browser MUST NEVER receive CRON_INVOKE_SECRET or x-cron-secret.
 */

const ALLOWED_MOODLE_ACTIONS = new Set(["test"]);

export async function invokeMoodleSyncAction(
  ctx: { db: any; auth: any; params: any },
) {
  const { auth, params } = ctx;

  const callerRole = String(auth?.profile?.role || "").trim().toLowerCase();
  const allowedRoles = new Set(["admin", "superadmin"]);
  if (!allowedRoles.has(callerRole)) {
    return json({ ok: false, error: "Only admin/superadmin may invoke moodle-sync" }, 403);
  }

  const cronSecret = Deno.env.get("CRON_INVOKE_SECRET") ?? "";
  if (!cronSecret) {
    return json({ ok: false, error: "Service configuration error" }, 500);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  if (!supabaseUrl) {
    return json({ ok: false, error: "Service configuration error" }, 500);
  }

  // Validate and remap moodle_action to action.
  // The browser sends "moodle_action" (to avoid conflict with admin-api "action" field);
  // we remap it back to "action" for moodle-sync.
  const requestedAction = String(params?.moodle_action || "").trim();
  if (!requestedAction) {
    return json({ ok: false, error: "moodle_action is required" }, 400);
  }
  if (!ALLOWED_MOODLE_ACTIONS.has(requestedAction)) {
    return json({ ok: false, error: `Operation not allowed: ${requestedAction}` }, 403);
  }

  // Forward the moodle-sync operation payload.
  // All params except "action" (which is the admin-api action name) are passed to moodle-sync.
  const moodleSyncPayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (key === "action") continue;
    if (key === "moodle_action") {
      moodleSyncPayload.action = value;
    } else {
      moodleSyncPayload[key] = value;
    }
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/moodle-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": cronSecret,
      },
      body: JSON.stringify(moodleSyncPayload),
    });

    const data = await response.json().catch(() => ({}));
    const status = response.status;

    // Return the moodle-sync response as-is (success or failure).
    return json(data, status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || "Request failed");
    return json({ ok: false, error: message }, 500);
  }
}
