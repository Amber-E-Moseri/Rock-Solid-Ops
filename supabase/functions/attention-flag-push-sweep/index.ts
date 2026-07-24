import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, safeLogAudit } from "../_shared/http.ts";
import { notifyProfilesPush, resolveStaffRecipients } from "../_shared/push-notify.ts";
import { vapidKeysFromEnv } from "../_shared/webpush.ts";

/*
 * attention-flag-push-sweep (PWA Phase C.2).
 *
 * "Attention flag raised" has no edge-function INSERT hook (rows land DB-side),
 * so push for it runs as a periodic sweep on the retry-worker cron pattern
 * (every 5 minutes). It is a SECONDARY nudge on top of the in-app attention
 * queue — near-real-time latency is not required.
 *
 * Idempotent: selects unresolved flags with push_notified_at IS NULL, sends ONE
 * batched push to admins (superadmin + admin, per the C.2 gate) so related flags
 * don't fragment into many notifications, then stamps push_notified_at so each
 * flag is nudged at most once. A skipped/failed run just picks them up next time.
 *
 * Schedule (configure like retry-worker): a pg_cron entry every 5 minutes
 * (cron expression "every 5 min") that net.http_post's this function's URL with
 * an Authorization: Bearer <service_role> header. See retry-worker's cron setup
 * for the exact net.http_post shape.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_FLAGS_PER_SWEEP = 200;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE);

  // If VAPID isn't configured yet, do nothing AND leave flags unstamped so
  // nudges begin once it is set up (rather than silently marking them pushed).
  try {
    vapidKeysFromEnv();
  } catch (_err) {
    return jsonResponse({ ok: true, skipped: true, reason: "VAPID not configured" });
  }

  // Unresolved, not-yet-pushed flags, oldest first.
  const { data: flags, error } = await db
    .from("attention_flags")
    .select("id, flag_type, entity_type")
    .eq("resolved", false)
    .is("push_notified_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_FLAGS_PER_SWEEP);

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 500);
  }
  if (!flags || flags.length === 0) {
    return jsonResponse({ ok: true, new_flags: 0, sent: 0 });
  }

  // One batched nudge summarizing the new flags (top types for context).
  const byType = new Map<string, number>();
  for (const f of flags) {
    const t = String(f.flag_type || "flag");
    byType.set(t, (byType.get(t) || 0) + 1);
  }
  const topTypes = [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => `${n} ${t.replace(/_/g, " ")}`)
    .join(", ");

  const admins = await resolveStaffRecipients(db, ["superadmin", "admin"]);
  let fanout = { attempted: 0, sent: 0, expired: 0, failed: 0, skipped: false };
  if (admins.length > 0) {
    fanout = await notifyProfilesPush(db, admins, {
      title: flags.length === 1 ? "1 item needs attention" : `${flags.length} items need attention`,
      body: topTypes ? `New: ${topTypes}.` : "New attention flags were raised.",
      url: "/staff/needs-attention",
      type: "attention_flag",
    });
  }

  // Stamp the swept flags so they are nudged at most once (VAPID is configured
  // here, so even with zero current subscribers we mark them — the in-app queue
  // still surfaces them, and we avoid a backlog burst when someone subscribes).
  const ids = flags.map((f) => f.id);
  const stampedAt = new Date().toISOString();
  const { error: stampErr } = await db
    .from("attention_flags")
    .update({ push_notified_at: stampedAt })
    .in("id", ids);

  await safeLogAudit(db, {
    actor_email: "attention-flag-push-sweep@system",
    action: "attention_flags_pushed",
    entity_type: "attention_flags",
    entity_id: String(ids.length),
    status: stampErr ? "FAILED" : "SUCCESS",
    details: { new_flags: flags.length, recipients: admins.length, ...fanout, stamp_error: stampErr?.message || null },
  });

  return jsonResponse({ ok: true, new_flags: flags.length, recipients: admins.length, ...fanout });
});
