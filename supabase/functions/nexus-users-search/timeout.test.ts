// C6 nexus-users-search timeout tests
//
// N01  normal Nexus success unchanged
// N02  ordinary Nexus HTTP failure unchanged
// N03  timeout aborts the request
// N04  timeout flows through failure path (504 response)
// N05  no internal retry count — request is a single attempt
// N06  timeout applies per request invocation (independent per attempt)
// N07  no duplicate side effect on timeout (read-only endpoint)
// N08  authorization behavior unchanged (401 before Nexus fetch)

import { assert, assertEquals } from "jsr:@std/assert@1";
import { handler } from "./index.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

const AUTH_HEADER = "Bearer test-token";

function makeRequest(extra: Record<string, string> = {}): Request {
  return new Request("https://x.supabase.co/functions/v1/nexus-users-search", {
    method: "GET",
    headers: {
      "Authorization": AUTH_HEADER,
      "Content-Type": "application/json",
      ...extra,
    },
  });
}

function makeNexusServer(
  nexusHandler: (req: Request) => Response | Promise<Response>,
  supabaseHandler?: (req: Request) => Response | Promise<Response>,
): Deno.HttpServer<Deno.NetAddr> {
  return Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname.includes("/users") && !url.pathname.includes("/auth")) {
      return await nexusHandler(req);
    }
    if (supabaseHandler) return await supabaseHandler(req);
    // Default Supabase mock: valid user + admin profile.
    // Profiles must be a plain object (not array) because .single() parses it directly.
    if (url.pathname.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ user: { id: "admin-user-id" } }), { status: 200 });
    }
    if (url.pathname.includes("/rest/v1/profiles")) {
      return new Response(JSON.stringify({ role: "admin" }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
}

// ── Source-inspection helpers ────────────────────────────────────────────────

function nexusFetchBlock(): string {
  const start = src.indexOf("if (NEXUS_API_URL && NEXUS_API_KEY)");
  if (start === -1) throw new Error("Nexus fetch block not found");
  let depth = 0; let i = start;
  while (i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
    i++;
  }
  throw new Error("Nexus fetch block not terminated");
}

// ── N08: auth guard ───────────────────────────────────────────────────────────

Deno.test("N08: missing Authorization header returns 401 before any Nexus call", async () => {
  const server = makeNexusServer(() => new Response("should not be called", { status: 200 }));
  try {
    const port = (server.addr as Deno.NetAddr).port;
    Deno.env.set("SUPABASE_URL",              `http://127.0.0.1:${port}`);
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    Deno.env.set("NEXUS_API_URL",             `http://127.0.0.1:${port}`);
    Deno.env.set("NEXUS_API_KEY",             "test-key");

    const res = await handler(new Request("https://x.supabase.co/functions/v1/nexus-users-search", {
      method: "GET",
    }));
    assertEquals(res.status, 401, "missing auth must return 401");
  } finally {
    await server.shutdown();
    Deno.env.delete("NEXUS_API_URL");
    Deno.env.delete("NEXUS_API_KEY");
  }
});

// ── N01: normal success ───────────────────────────────────────────────────────

Deno.test("N01: normal Nexus 200 returns users list", async () => {
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ user: { id: "admin-id" } }), { status: 200 });
    }
    if (url.pathname.includes("/rest/v1/profiles")) {
      return new Response(JSON.stringify({ role: "admin" }), { status: 200 });
    }
    if (url.pathname.endsWith("/users")) {
      return new Response(JSON.stringify({ users: [{ id: "u1", name: "Alice" }] }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const port = (server.addr as Deno.NetAddr).port;
    Deno.env.set("SUPABASE_URL",              `http://127.0.0.1:${port}`);
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    Deno.env.set("NEXUS_API_URL",             `http://127.0.0.1:${port}`);
    Deno.env.set("NEXUS_API_KEY",             "test-key");

    const res = await handler(makeRequest());
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals(body.ok, true);
    assertEquals(body.users.length, 1);
  } finally {
    await server.shutdown();
    Deno.env.delete("NEXUS_API_URL");
    Deno.env.delete("NEXUS_API_KEY");
  }
});

// ── N02: ordinary HTTP failure ────────────────────────────────────────────────

Deno.test("N02: Nexus 503 returns error response (existing failure behavior)", async () => {
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ user: { id: "admin-id" } }), { status: 200 });
    }
    if (url.pathname.includes("/rest/v1/profiles")) {
      return new Response(JSON.stringify({ role: "admin" }), { status: 200 });
    }
    if (url.pathname.endsWith("/users")) {
      return new Response("Service Unavailable", { status: 503 });
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const port = (server.addr as Deno.NetAddr).port;
    Deno.env.set("SUPABASE_URL",              `http://127.0.0.1:${port}`);
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    Deno.env.set("NEXUS_API_URL",             `http://127.0.0.1:${port}`);
    Deno.env.set("NEXUS_API_KEY",             "test-key");

    const res = await handler(makeRequest());
    const body = await res.json();
    assertEquals(body.ok, false);
    // Handler propagates the Nexus HTTP status code and prefixes "Nexus API error:"
    assertEquals(res.status, 503, "handler must propagate Nexus non-2xx status code");
    assert(String(body.error).includes("Nexus"), "error must mention Nexus as source");
  } finally {
    await server.shutdown();
    Deno.env.delete("NEXUS_API_URL");
    Deno.env.delete("NEXUS_API_KEY");
  }
});

// ── N03: timeout aborts ───────────────────────────────────────────────────────

Deno.test("N03: Nexus timeout aborts the request", async () => {
  Deno.env.set("NEXUS_TIMEOUT_MS", "100");
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ user: { id: "admin-id" } }), { status: 200 });
    }
    if (url.pathname.includes("/rest/v1/profiles")) {
      return new Response(JSON.stringify({ role: "admin" }), { status: 200 });
    }
    if (url.pathname.endsWith("/users")) {
      return new Promise<Response>((resolve) => {
        req.signal.addEventListener("abort", () =>
          resolve(new Response("{}", { status: 200 }))
        );
        setTimeout(() => resolve(new Response("{}", { status: 200 })), 2000);
      });
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const port = (server.addr as Deno.NetAddr).port;
    Deno.env.set("SUPABASE_URL",              `http://127.0.0.1:${port}`);
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    Deno.env.set("NEXUS_API_URL",             `http://127.0.0.1:${port}`);
    Deno.env.set("NEXUS_API_KEY",             "test-key");

    const res = await handler(makeRequest());
    const body = await res.json();
    assertEquals(body.ok, false, "timeout must return { ok: false }");
    assert(
      String(body.error).toLowerCase().includes("abort") ||
      String(body.error).toLowerCase().includes("signal") ||
      String(body.error).toLowerCase().includes("cancel"),
      `timeout error must indicate abort; got: "${body.error}"`,
    );
  } finally {
    Deno.env.delete("NEXUS_TIMEOUT_MS");
    await server.shutdown();
    Deno.env.delete("NEXUS_API_URL");
    Deno.env.delete("NEXUS_API_KEY");
  }
});

// ── N04: timeout failure path (504) ──────────────────────────────────────────

Deno.test("N04: Nexus timeout returns 504 status", async () => {
  Deno.env.set("NEXUS_TIMEOUT_MS", "100");
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ user: { id: "admin-id" } }), { status: 200 });
    }
    if (url.pathname.includes("/rest/v1/profiles")) {
      return new Response(JSON.stringify({ role: "admin" }), { status: 200 });
    }
    if (url.pathname.endsWith("/users")) {
      return new Promise<Response>((resolve) => {
        req.signal.addEventListener("abort", () =>
          resolve(new Response("{}", { status: 200 }))
        );
        setTimeout(() => resolve(new Response("{}", { status: 200 })), 2000);
      });
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const port = (server.addr as Deno.NetAddr).port;
    Deno.env.set("SUPABASE_URL",              `http://127.0.0.1:${port}`);
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    Deno.env.set("NEXUS_API_URL",             `http://127.0.0.1:${port}`);
    Deno.env.set("NEXUS_API_KEY",             "test-key");

    const res = await handler(makeRequest());
    assertEquals(res.status, 504, "timeout must return HTTP 504");
  } finally {
    Deno.env.delete("NEXUS_TIMEOUT_MS");
    await server.shutdown();
    Deno.env.delete("NEXUS_API_URL");
    Deno.env.delete("NEXUS_API_KEY");
  }
});

// ── N05: no internal retry on Nexus call ─────────────────────────────────────

Deno.test("N05: nexus-users-search makes exactly one Nexus attempt per request", () => {
  const block = nexusFetchBlock();
  // No retry loop (while/for) in the Nexus fetch block
  assert(!block.includes("while ("), "Nexus fetch block must not have a while loop");
  assert(!block.includes("for ("),   "Nexus fetch block must not have a for loop");
  assert(!block.includes("attempt"), "Nexus fetch block must not track retry attempts");
});

// ── N06: timeout per invocation ───────────────────────────────────────────────

Deno.test("N06: AbortController is created fresh per request", () => {
  const block = nexusFetchBlock();
  // Each handler invocation creates a new AbortController — the controller
  // is declared inside the if-block (scoped to this request), not at module level.
  assert(block.includes("new AbortController()"), "AbortController must be created inside the handler");
});

// ── N07: no duplicate side effect ────────────────────────────────────────────

Deno.test("N07: nexus-users-search makes no writes — timeout has no duplicate effect", () => {
  // This is a read-only endpoint (GET /users). No DB writes, no email sends,
  // no state mutations. Timeout or failure simply returns an error response.
  assert(!src.includes(".insert("),  "handler must not insert database rows");
  assert(!src.includes(".update("),  "handler must not update database rows");
  assert(!src.includes(".delete("),  "handler must not delete database rows");
});
