/**
 * TOMBSTONE — clickup-sync has been retired (October 2026).
 *
 * It was the original (ClickUp-era) task writer. Nexus task creation now lives only in
 * `_shared/nexus-tasks.ts` (`ensureNexusTask`), called by missed-class-detector and retry-worker:
 * atomic Postgres claim, a stable external_unique_key, and TIMEOUT_UNKNOWN reconciliation
 * (`_shared/nexus-reconcile.ts`). The old implementation here had its own non-atomic
 * select/upsert path and a 5-attempt retry loop that could create duplicate tasks, so it must
 * not stay reachable as a second writer.
 *
 * This stub deliberately does nothing but answer 410. It performs no authentication-dependent
 * work, reads no secrets, creates no database client, and makes no outbound request. The
 * function directory and config are kept (not deleted) so any caller still pointed at the
 * deployed URL gets a clear answer instead of a 404.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-internal-secret, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  return new Response(
    JSON.stringify({
      ok: false,
      gone: true,
      error: "clickup-sync has been retired. Nexus tasks are created by the scheduled Rock Solid functions; there is no public endpoint for this.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
