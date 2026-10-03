/**
 * TOMBSTONE — notification-dispatcher has been retired (October 2026).
 *
 * It turned `notification_events` rows into `scheduled_notifications` via `notification_rules`.
 * Repository evidence: no cron, webhook, function or frontend ever called it, and two independent
 * audits (docs/migration-log.md, foundation/docs/NOTIFICATION_PIPELINE.md) record the whole
 * rules/dispatcher path as dead machinery: every real send is a direct `email_queue` /
 * `scheduled_notifications` insert from application code or the waitlist DB trigger.
 *
 * It also had to go because it was the one privileged endpoint with NO caller authentication,
 * and because, if anything ever did run it, it would write `scheduled_notifications` rows under
 * a different dedupe key than the canonical waitlist path and could double-send the same
 * logical email.
 *
 * This stub does nothing but answer 410: no secrets, no database client, no outbound request.
 * The directory/config stay so a stray caller gets a clear answer, and so deploying this file
 * replaces any previously deployed (unauthenticated) copy.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  return new Response(
    JSON.stringify({
      ok: false,
      gone: true,
      error: "notification-dispatcher has been retired. Notifications are queued directly by the functions that produce them.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
