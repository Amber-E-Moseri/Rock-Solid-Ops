// missed-class-detector database-failure semantics (DD01–DD06).
//
// Certified defect: with its database unreachable the detector answered
//   HTTP 200 {"ok":false,"error":"[object Object]"}
// A scheduler treats 2xx as success, and the message was useless. Required: a meaningful, sanitized error,
// a non-2xx status, no credential leakage, and ZERO Nexus POSTs when the database prerequisite failed.
//
// The real handler runs in-process (Deno.serve is captured, as in _shared/auth-regression.test.ts).
import { assert, assertEquals, assertFalse, assertNotEquals, assertStringIncludes } from "jsr:@std/assert@1";

const SERVICE_KEY = "dd-service-role-key-SECRET-0123456789";
const CRON = "dd-cron-secret-0123456789";
const NEXUS_KEY = "blwk_0123456789abcdef0123456789abcdef";
const NEXUS_URL = "http://nexus.dd.test/task-api";
type Handler = (req: Request) => Promise<Response> | Response;

let cachedHandler: Handler | undefined;
async function loadHandler(): Promise<Handler> {
  if (cachedHandler) return cachedHandler; // the module is imported (and Deno.serve captured) only once
  const realServe = Deno.serve;
  let captured: Handler | undefined;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (arg: unknown, maybe?: unknown) => {
    captured = (typeof arg === "function" ? arg : maybe) as Handler;
    return { finished: Promise.resolve(), shutdown: () => Promise.resolve() };
  };
  try {
    await import("./index.ts");
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).serve = realServe;
  }
  if (!captured) throw new Error("no handler captured");
  cachedHandler = captured;
  return captured;
}

/** Counts every request aimed at Nexus and answers 500; everything else goes to the real fetch. */
function guardNexus() {
  const real = globalThis.fetch;
  const nexusCalls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("http://nexus.dd.test")) {
      nexusCalls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
      return Promise.resolve(new Response(JSON.stringify({ error: "should never be called" }), { status: 500 }));
    }
    return real(input, init);
  }) as typeof fetch;
  return { nexusCalls, restore: () => { globalThis.fetch = real; } };
}

function setEnv(supabaseUrl: string) {
  Deno.env.set("SUPABASE_URL", supabaseUrl);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  Deno.env.set("CRON_INVOKE_SECRET", CRON);
  Deno.env.set("NEXUS_TASK_API_URL", NEXUS_URL);
  Deno.env.set("NEXUS_TASK_API_KEY", NEXUS_KEY);
}
const call = (h: Handler) => Promise.resolve(h(new Request("http://localhost/fn", { method: "POST", headers: { "x-cron-secret": CRON } })));

/** A tiny PostgREST stand-in: `respond(table, method)` returns [status, body]. */
function fakePostgrest(respond: (table: string, method: string) => [number, unknown]) {
  const server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
    const table = new URL(req.url).pathname.split("/").pop() ?? "";
    const [status, body] = respond(table, req.method);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return { url: `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`, stop: () => server.shutdown() };
}

Deno.test("DD01: database UNREACHABLE -> 503, a real message, no secrets, zero Nexus calls", async () => {
  const g = guardNexus();
  try {
    setEnv("http://127.0.0.1:9"); // nothing listens: connection refused
    const res = await call(await loadHandler());
    const text = await res.text();
    const body = JSON.parse(text);
    assertEquals(res.status, 503, "a scheduler must see a non-2xx");
    assertEquals(body.ok, false);
    assertEquals(body.code, "DATABASE_UNAVAILABLE");
    assertNotEquals(body.error, "[object Object]");
    assertFalse(String(body.error).includes("[object Object]"));
    assert(String(body.error).length > 0);
    for (const secret of [SERVICE_KEY, CRON, NEXUS_KEY]) assertFalse(text.includes(secret), "no credential in the response");
    assertEquals(g.nexusCalls.length, 0, "database prerequisite failed -> Nexus must not be called");
  } finally {
    g.restore();
  }
});

Deno.test("DD02: a PostgREST ERROR OBJECT is described (not '[object Object]') and credentials inside it are redacted", async () => {
  const g = guardNexus();
  const pg = fakePostgrest(() => [500, { code: "XX000", message: `internal failure using key ${SERVICE_KEY} and ${NEXUS_KEY}` }]);
  try {
    setEnv(pg.url);
    const res = await call(await loadHandler());
    const text = await res.text();
    const body = JSON.parse(text);
    assertEquals(res.status, 500);
    assertEquals(body.code, "DETECTOR_ERROR");
    assertStringIncludes(body.error, "internal failure");
    assertStringIncludes(body.error, "[redacted");
    for (const secret of [SERVICE_KEY, NEXUS_KEY]) assertFalse(text.includes(secret), "credential redacted");
    assertEquals(g.nexusCalls.length, 0);
  } finally {
    g.restore();
    await pg.stop();
  }
});

Deno.test("DD03: a non-connectivity database error (missing relation) is a 500, not a 503", async () => {
  const g = guardNexus();
  const pg = fakePostgrest(() => [404, { code: "42P01", message: 'relation "public.class_roster" does not exist' }]);
  try {
    setEnv(pg.url);
    const res = await call(await loadHandler());
    const body = await res.json();
    assertEquals(res.status, 500);
    assertEquals(body.code, "DETECTOR_ERROR");
    assertStringIncludes(body.error, "class_roster");
    assertEquals(g.nexusCalls.length, 0);
  } finally {
    g.restore();
    await pg.stop();
  }
});

Deno.test("DD04: healthy control (empty roster) is still 200 ok:true", async () => {
  const g = guardNexus();
  const pg = fakePostgrest((_t, method) => (method === "POST" ? [201, []] : [200, []]));
  try {
    setEnv(pg.url);
    const res = await call(await loadHandler());
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals(body.ok, true);
    assertEquals(body.checked_count, 0);
    assertEquals(g.nexusCalls.length, 0);
  } finally {
    g.restore();
    await pg.stop();
  }
});

Deno.test("DD05: failure after partial progress still reports the progress counters", async () => {
  const g = guardNexus();
  // roster read succeeds with no rows, then the applicants read fails
  const pg = fakePostgrest((table, method) => method === "POST" ? [201, []] : table === "applicants" ? [500, { message: "applicants read failed" }] : [200, []]);
  try {
    setEnv(pg.url);
    const res = await call(await loadHandler());
    const body = await res.json();
    assertEquals(res.status, 500);
    assertEquals(body.checked_count, 0);
    assertStringIncludes(body.error, "applicants read failed");
  } finally {
    g.restore();
    await pg.stop();
  }
});

Deno.test("DD06: the catch block no longer uses String(error) on a PostgREST object", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertFalse(/error instanceof Error \? error\.message : String\(error\)/.test(src));
  assert(src.includes("describeError("), "uses the shared describer");
  assert(/unavailable \? 503 : 500/.test(src), "non-2xx on failure");
  assertFalse(/return json\(\{ ok: false, error: message \}, 200\)/.test(src), "the 200-on-failure path is gone");
});
