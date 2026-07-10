import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const NEXUS_API_URL = Deno.env.get("NEXUS_API_URL") || "";
  const NEXUS_API_KEY = Deno.env.get("NEXUS_API_KEY") || "";

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ ok: false, error: "Missing Supabase config" }, 500);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    // Verify auth
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ ok: false, error: "Missing bearer token" }, 401);
    }

    const token = authHeader.slice("Bearer ".length).trim();
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "Invalid session" }, 401);
    }

    // If NEXUS_API_URL is configured, fetch from Nexus
    if (NEXUS_API_URL && NEXUS_API_KEY) {
      const nexusRes = await fetch(`${NEXUS_API_URL}/users`, {
        headers: {
          "Authorization": `Bearer ${NEXUS_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      if (!nexusRes.ok) {
        const msg = await nexusRes.text();
        return json({ ok: false, error: `Nexus API error: ${msg}` }, nexusRes.status);
      }

      const { users } = await nexusRes.json();
      return json({ ok: true, users: users || [] });
    }

    // Fallback: return empty list if Nexus API not configured
    return json({ ok: true, users: [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, 500);
  }
});
