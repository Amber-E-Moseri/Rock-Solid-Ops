import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAnonClient, createServiceClient } from "../_shared/supabase.ts";
import { applyAllowedOrigin, corsHeaders, safeLogAudit } from "../_shared/http.ts";
import { notifyProfilesPush } from "../_shared/push-notify.ts";

/*
 * send-push (PWA Phase C.2) — authenticated push sender surface.
 *
 * This is the CALLABLE surface: it verifies a real user JWT and requires an
 * admin/superadmin role (JWT caller verification per the brief) and uses
 * ALLOWED_ORIGINS (never wildcard) CORS. It exists for manual/test sends and
 * admin-initiated broadcasts.
 *
 * The three automatic triggers (registration status, attention flag, teacher
 * availability/waitlist) do NOT go through here — they call
 * notifyProfilesPush() directly with the service-role client, avoiding an
 * edge-to-edge HTTP hop. Both paths share the same _shared/webpush core.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

async function resolveAdminCaller(req: Request, db: any) {
  const authHeader = String(req.headers.get("Authorization") || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) throw new Error("Missing bearer token");

  const anon = createAnonClient(token);
  const { data: userData, error: userErr } = await anon.auth.getUser(token);
  if (userErr || !userData?.user) throw new Error("Invalid session");
  const user = userData.user;

  const { data: profile } = await db
    .from("profiles")
    .select("role,email")
    .eq("user_id", user.id)
    .maybeSingle();

  const role = String(profile?.role || "").trim().toLowerCase();
  if (!ADMIN_ROLES.has(role)) throw new Error("Access denied");

  return { id: user.id, email: profile?.email || user.email || null, role };
}

Deno.serve(async (req) => {
  applyAllowedOrigin(req);

  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const db = createServiceClient();

  let caller;
  try {
    caller = await resolveAdminCaller(req, db);
  } catch (err) {
    const message = String((err as Error)?.message || "Unauthorized");
    return json({ ok: false, error: message }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const title = String(body?.title || "").trim();
  const message = String(body?.body || "").trim();
  const url = body?.url ? String(body.url) : "/";
  const type = body?.type ? String(body.type) : "manual";

  if (!title || !message) {
    return json({ ok: false, error: "title and body are required" }, 400);
  }

  // Recipients: an explicit user_ids array, or default to the caller (self-test).
  let userIds: string[] = Array.isArray(body?.user_ids)
    ? body.user_ids.map((v: unknown) => String(v)).filter(Boolean)
    : [];
  if (userIds.length === 0) userIds = [caller.id];

  const result = await notifyProfilesPush(db, userIds, { title, body: message, url, type });

  await safeLogAudit(db, {
    actor_email: caller.email || "admin",
    action: "push_sent_manual",
    entity_type: "push",
    entity_id: caller.id,
    status: result.skipped ? "SKIPPED" : "SUCCESS",
    details: { recipients: userIds.length, ...result, type },
  });

  return json({ ok: true, ...result });
});
