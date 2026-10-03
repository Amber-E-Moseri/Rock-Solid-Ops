// clickup-sync is a retired tombstone (410). It must never again create Nexus tasks.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

type Handler = (req: Request) => Promise<Response> | Response;
let cached: Handler | undefined;
async function load(): Promise<Handler> {
  if (cached) return cached;
  const realServe = Deno.serve;
  let captured: Handler | undefined;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (arg: unknown) => {
    captured = arg as Handler;
    return { finished: Promise.resolve(), shutdown: () => Promise.resolve() };
  };
  try {
    await import("./index.ts");
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).serve = realServe;
  }
  if (!captured) throw new Error("no handler captured");
  cached = captured;
  return captured;
}

Deno.test("CS01: every credential/method combination gets 410 and no outbound request or DB client is made", async () => {
  const h = await load();
  const realFetch = globalThis.fetch;
  let outbound = 0;
  globalThis.fetch = (() => {
    outbound += 1;
    return Promise.reject(new Error("no outbound request allowed"));
  }) as typeof fetch;
  Deno.env.set("NEXUS_API_URL", "http://nexus.invalid");
  Deno.env.set("NEXUS_TASK_API_KEY", "k");
  Deno.env.set("INTERNAL_INVOKE_SECRET", "internal");
  Deno.env.set("SUPABASE_URL", "http://127.0.0.1:9");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc");
  try {
    const body = JSON.stringify({ type: "escalation", payload: { source: "applicants", source_id: "A1" } });
    const cases: Array<[string, Record<string, string>]> = [
      ["POST", {}],
      ["POST", { "x-internal-secret": "internal" }],
      ["POST", { Authorization: "Bearer svc" }],
      ["POST", { Authorization: `Bearer x.${btoa('{"role":"service_role"}')}.y` }],
      ["GET", {}],
      ["PUT", {}],
    ];
    for (const [method, headers] of cases) {
      const res = await h(new Request("http://localhost/fn", { method, headers, ...(method === "POST" || method === "PUT" ? { body } : {}) }));
      assertEquals(res.status, 410, `${method} ${JSON.stringify(headers)}`);
      const j = await res.json();
      assertEquals(j.gone, true);
      assertEquals(j.ok, false);
      assertFalse(JSON.stringify(j).toLowerCase().includes("secret"), "no sensitive detail");
    }
    assertEquals(outbound, 0, "a retired writer must not call Nexus (or anything else)");
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("CS02: CORS preflight still answers", async () => {
  const h = await load();
  const res = await h(new Request("http://localhost/fn", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
  await res.body?.cancel();
});

Deno.test("CS03: the module contains no writer code: no Supabase client, no fetch, no Nexus, no retry loop", () => {
  const code = src.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
  for (const forbidden of ["createClient", "fetch(", "NEXUS", "rocksolid_task_links", "/tasks", "while (", "for (", "SUPABASE_SERVICE_ROLE_KEY"]) {
    assertFalse(code.includes(forbidden), `retired clickup-sync must not contain ${forbidden}`);
  }
  assert(code.includes("410"));
});
