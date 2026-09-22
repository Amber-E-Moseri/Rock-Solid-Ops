import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAnonClient, createServiceClient } from "../_shared/supabase.ts";
import { assignApplicantAdminAction } from "./_actions/assign-applicant-admin.ts";
import { createStaffDirectAction } from "./_actions/create-staff-direct.ts";
import { invokeMoodleSyncAction } from "./_actions/invoke-moodle-sync.ts";

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

const actionMap: Record<string, (ctx: { db: any; auth: any; params: any }) => Promise<Response>> = {
  "assign-applicant-admin": assignApplicantAdminAction,
  "create-staff-direct": createStaffDirectAction,
  "invoke-moodle-sync": invokeMoodleSyncAction,
};

async function resolveAuth(req: Request, db: any) {
  const authHeader = String(req.headers.get("Authorization") || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) throw new Error("Missing bearer token");

  const anon = createAnonClient(token);
  const { data: userData, error: userErr } = await anon.auth.getUser(token);
  if (userErr || !userData?.user) throw new Error("Invalid session");
  const user = userData.user;

  const { data: profile } = await db
    .from("profiles")
    .select("role,email,full_name")
    .eq("user_id", user.id)
    .maybeSingle();

  const role = String(profile?.role || "").trim().toLowerCase();
  const allowed = new Set(["admin", "superadmin", "principal", "regional_secretary"]);
  if (!allowed.has(role)) throw new Error("Access denied");

  return {
    user: { id: user.id, email: user.email || profile?.email || null },
    profile: { role, email: profile?.email || user.email || null, full_name: profile?.full_name || null },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const db = createServiceClient();
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const params = body || {};
    if (!action) return json({ ok: false, error: "action is required" }, 400);
    const handler = actionMap[action];
    if (!handler) return json({ ok: false, error: `Unsupported action: ${action}` }, 400);

    const auth = await resolveAuth(req, db);
    return await handler({ db, auth, params });
  } catch (err) {
    const message = String((err as Error)?.message || "Request failed");
    const status = message === "Access denied" || message === "Invalid session" || message === "Missing bearer token" ? 401 : 500;
    return json({ ok: false, error: message }, status);
  }
});

