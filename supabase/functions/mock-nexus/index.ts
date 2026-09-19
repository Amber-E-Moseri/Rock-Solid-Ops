/**
 * MOCK NEXUS — staging-only fake Nexus endpoint.
 *
 * Serves deterministic fake user data and records hit counts.
 * NEVER proxies to production Nexus.
 * Accessible only with the staging MOCK_NEXUS_KEY secret.
 *
 * Routes:
 *   GET /users          — return fake users (increments counter)
 *   GET /count          — return current hit count
 *   POST /reset         — reset hit count to 0
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FAKE_USERS = [
  { id: "staging-user-001", name: "Staging Alpha", email: "alpha@staging.local", role: "student" },
  { id: "staging-user-002", name: "Staging Beta",  email: "beta@staging.local",  role: "student" },
  { id: "staging-user-003", name: "Staging Gamma", email: "gamma@staging.local", role: "admin"   },
];

Deno.serve(async (req) => {
  const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const MOCK_NEXUS_KEY    = Deno.env.get("MOCK_NEXUS_KEY") ?? "";
  const { pathname }      = new URL(req.url);

  // Simple key auth — staging only; no production Nexus credential is used here
  const authHeader = req.headers.get("Authorization") ?? "";
  const presentedKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!MOCK_NEXUS_KEY || presentedKey !== MOCK_NEXUS_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  if (req.method === "GET" && pathname.endsWith("/users")) {
    // Increment counter
    await db.rpc("mock_nexus_increment");
    const { data } = await db
      .from("mock_nexus_counter")
      .select("hit_count")
      .eq("id", 1)
      .single();
    return new Response(
      JSON.stringify({ users: FAKE_USERS, hit_count: data?.hit_count ?? -1 }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  if (req.method === "GET" && pathname.endsWith("/count")) {
    const { data } = await db
      .from("mock_nexus_counter")
      .select("hit_count, last_reset_at")
      .eq("id", 1)
      .single();
    return new Response(JSON.stringify(data ?? { hit_count: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "POST" && pathname.endsWith("/reset")) {
    await db
      .from("mock_nexus_counter")
      .update({ hit_count: 0, last_reset_at: new Date().toISOString() })
      .eq("id", 1);
    return new Response(JSON.stringify({ ok: true, reset_at: new Date().toISOString() }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
});
