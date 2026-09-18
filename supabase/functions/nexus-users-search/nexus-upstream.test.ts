/**
 * NEXUS UPSTREAM ISOLATION CERTIFICATION
 *
 * Local integration test — never contacts production Nexus.
 * Verifies that unauthorized requests (no token, invalid token, pending, teacher)
 * never reach the Nexus upstream, and authorized requests (admin, superadmin) do.
 *
 * Requirements:
 *   LOCAL_INTEGRATION_TEST=true   (safety gate — never run in CI/CD automatically)
 *   Local Supabase stack running  (supabase start)
 *
 * Run from project root:
 *   LOCAL_INTEGRATION_TEST=true \
 *   SUPABASE_SERVICE_ROLE_KEY=$(supabase status --output env | grep SERVICE_ROLE_KEY | cut -d= -f2) \
 *   SUPABASE_ANON_KEY=$(supabase status --output env | grep ANON_KEY | cut -d= -f2) \
 *   deno run --allow-net --allow-env --allow-run \
 *     supabase/functions/nexus-users-search/nexus-upstream.test.ts
 *
 * Or set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY manually from `supabase status`.
 */

if (Deno.env.get("LOCAL_INTEGRATION_TEST") !== "true") {
  console.error("ERROR: Set LOCAL_INTEGRATION_TEST=true to run this test.");
  console.error("This test requires a local Supabase stack and must never run in production.");
  Deno.exit(1);
}

// ─────────────────────────────────────────────────────────────
//  Config  (local dev values only — never production)
// ─────────────────────────────────────────────────────────────
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
// Keys must be supplied via env (run `supabase status --output env` to obtain them).
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY       = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
if (!SERVICE_KEY || !ANON_KEY) {
  console.error("ERROR: Set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY before running.");
  console.error("  Run: supabase status --output env  to obtain the local dev keys.");
  Deno.exit(1);
}
const MOCK_PORT      = 9999;
const EDGE_PORT      = 8000;   // default Deno.serve port
const MOCK_API_KEY   = "test-mock-key-local";
const TEST_PASSWORD  = "TestPass123!";
// Path to the function under test, relative to project root
const EDGE_FN_PATH   = "supabase/functions/nexus-users-search/index.ts";

// ─────────────────────────────────────────────────────────────
//  Mock Nexus server
//  Runs in-process; counts every GET /users call.
// ─────────────────────────────────────────────────────────────
let mockCount = 0;

function buildMockHandler(): Deno.ServeHandler {
  return (req) => {
    const { method } = req;
    const { pathname } = new URL(req.url);

    if (method === "GET" && pathname === "/users") {
      mockCount++;
      return new Response(
        JSON.stringify({ users: [{ id: "mock-1", name: "Mock Nexus User" }] }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    if (method === "GET" && pathname === "/count") {
      return new Response(JSON.stringify({ count: mockCount }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (method === "POST" && pathname === "/reset") {
      mockCount = 0;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not Found", { status: 404 });
  };
}

// ─────────────────────────────────────────────────────────────
//  Edge function subprocess
//  Runs index.ts via plain `deno run`; injects mock env vars.
// ─────────────────────────────────────────────────────────────
async function startEdgeFn(): Promise<Deno.ChildProcess> {
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-net", "--allow-env", EDGE_FN_PATH],
    env: {
      // Inherit system env (PATH, HOME, DENO_DIR, etc.) so module cache works
      ...Deno.env.toObject(),
      // Override: point at local Supabase
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      // Override: point at local mock — NOT production Nexus
      NEXUS_API_URL: `http://127.0.0.1:${MOCK_PORT}`,
      NEXUS_API_KEY: MOCK_API_KEY,
    },
    stdout: "null",
    stderr: "null",
  }).spawn();

  // Poll until the function responds (up to 45 s for first-run module downloads)
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`http://127.0.0.1:${EDGE_PORT}`, {
        signal: AbortSignal.timeout(1_000),
      });
      await r.body?.cancel();
      return proc; // server is up
    } catch {
      // not ready yet
    }
  }
  proc.kill();
  throw new Error("Edge function subprocess did not become ready within 45 s");
}

// ─────────────────────────────────────────────────────────────
//  Supabase admin helpers
// ─────────────────────────────────────────────────────────────
async function adminReq(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function createUser(email: string, name: string): Promise<string> {
  const res = await adminReq("POST", "/auth/v1/admin/users", {
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`createUser(${email}) failed: ${JSON.stringify(data)}`);
  return data.id as string;
}

async function setRole(userId: string, role: string): Promise<void> {
  const res = await adminReq(
    "PATCH",
    `/rest/v1/profiles?user_id=eq.${userId}`,
    { role },
    { Prefer: "return=minimal" },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`setRole(${userId}, ${role}) failed: ${text}`);
  }
}

async function deleteUser(userId: string): Promise<void> {
  await adminReq("DELETE", `/auth/v1/admin/users/${userId}`);
}

async function signIn(email: string): Promise<string> {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    },
  );
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`signIn(${email}) failed: ${JSON.stringify(data)}`);
  }
  return data.access_token as string;
}

// ─────────────────────────────────────────────────────────────
//  Individual test case
// ─────────────────────────────────────────────────────────────
interface Result {
  name: string;
  http: number;
  before: number;
  after: number;
  delta: number;
  expectedHttp: number;
  expectedDelta: number;
}

async function runCase(
  name: string,
  token: string | null,
  expectedHttp: number,
  expectedDelta: number,
): Promise<Result> {
  const before = mockCount;
  const headers: Record<string, string> = {};
  if (token !== null) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`http://127.0.0.1:${EDGE_PORT}`, { headers });
  const http = res.status;
  await res.body?.cancel();

  const after = mockCount;
  return { name, http, before, after, delta: after - before, expectedHttp, expectedDelta };
}

// ─────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const createdIds: string[] = [];
  let edgeProc: Deno.ChildProcess | undefined;
  let mockServer: Deno.HttpServer | undefined;

  try {
    // ── Step 1: Start mock Nexus ──────────────────────────────
    mockServer = Deno.serve(
      { port: MOCK_PORT, hostname: "127.0.0.1", onListen: () => {} },
      buildMockHandler(),
    );
    await new Promise<void>((r) => setTimeout(r, 200));
    const initRes = await fetch(`http://127.0.0.1:${MOCK_PORT}/count`);
    const { count: initialCount } = await initRes.json() as { count: number };

    // ── Step 2: Start edge function subprocess ────────────────
    edgeProc = await startEdgeFn();

    // ── Step 3: Create test fixtures ──────────────────────────
    // pending: trigger sets role='pending' automatically
    const pId = await createUser("cert-pending@test.local", "Cert Pending");
    createdIds.push(pId);

    const tId = await createUser("cert-teacher@test.local", "Cert Teacher");
    createdIds.push(tId);
    await setRole(tId, "teacher");

    const aId = await createUser("cert-admin@test.local", "Cert Admin");
    createdIds.push(aId);
    await setRole(aId, "admin");

    const sId = await createUser("cert-super@test.local", "Cert Superadmin");
    createdIds.push(sId);
    await setRole(sId, "superadmin");

    const pendingToken = await signIn("cert-pending@test.local");
    const teacherToken = await signIn("cert-teacher@test.local");
    const adminToken   = await signIn("cert-admin@test.local");
    const superToken   = await signIn("cert-super@test.local");

    // ── Step 4: Six requests ──────────────────────────────────
    const results: Result[] = [
      await runCase("NO TOKEN",      null,                   401, 0),
      await runCase("INVALID TOKEN", "not-a-real-jwt-token", 401, 0),
      await runCase("PENDING",       pendingToken,           403, 0),
      await runCase("TEACHER",       teacherToken,           403, 0),
      await runCase("ADMIN",         adminToken,             200, 1),
      await runCase("SUPERADMIN",    superToken,             200, 1),
    ];

    // ── Totals ────────────────────────────────────────────────
    const total        = results.reduce((s, r) => s + r.delta, 0);
    const authorized   = results
      .filter((r) => r.expectedDelta === 1)
      .reduce((s, r) => s + r.delta, 0);
    const unauthorized = results
      .filter((r) => r.expectedDelta === 0)
      .reduce((s, r) => s + r.delta, 0);

    const allCasesPass = results.every(
      (r) => r.http === r.expectedHttp && r.delta === r.expectedDelta,
    );
    const pass =
      allCasesPass && total === 2 && authorized === 2 && unauthorized === 0;

    // ── Print report ──────────────────────────────────────────
    const out: string[] = [];
    const p = (s: string) => out.push(s);

    p("ROCK SOLID — NEXUS UPSTREAM CERTIFICATION");
    p("");
    p("MOCK");
    p(`  Running: YES`);
    p(`  URL: http://127.0.0.1:${MOCK_PORT}`);
    p(`  Initial count: ${initialCount}`);

    for (const r of results) {
      p("");
      p(r.name);
      p(`  HTTP: ${r.http}`);
      p(`  Counter before: ${r.before}`);
      p(`  Counter after: ${r.after}`);
      p(`  Delta: ${r.delta}`);
    }

    p("");
    p(`TOTAL UPSTREAM CALLS: ${total}`);
    p(`AUTHORIZED UPSTREAM CALLS: ${authorized}`);
    p(`UNAUTHORIZED UPSTREAM CALLS: ${unauthorized}`);
    p("");
    p("PERMANENT TEST: Created");
    p(
      "  supabase/functions/nexus-users-search/nexus-upstream.test.ts",
    );
    p("");
    p(`RESULT: ${pass ? "PASS" : "FAIL"}`);

    if (!pass) {
      p("");
      p("FAILED CASES:");
      for (const r of results) {
        if (r.http !== r.expectedHttp || r.delta !== r.expectedDelta) {
          p(
            `  ${r.name}: HTTP=${r.http} (want ${r.expectedHttp}), delta=${r.delta} (want ${r.expectedDelta})`,
          );
        }
      }
    }

    p("");
    p("FILES CHANGED:");
    p(
      "  supabase/functions/nexus-users-search/nexus-upstream.test.ts (created)",
    );

    console.log(out.join("\n"));
  } finally {
    // ── Cleanup ───────────────────────────────────────────────
    for (const id of createdIds) {
      try {
        await deleteUser(id);
      } catch {
        // best-effort
      }
    }
    if (edgeProc) {
      try {
        edgeProc.kill("SIGTERM");
      } catch {
        // best-effort
      }
    }
    if (mockServer) {
      try {
        await mockServer.shutdown();
      } catch {
        // best-effort
      }
    }
  }
}

main().catch((err) => {
  console.error("CERTIFICATION FAILED:", err);
  Deno.exit(1);
});
