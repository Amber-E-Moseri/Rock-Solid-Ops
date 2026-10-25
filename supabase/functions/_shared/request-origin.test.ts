import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { allowedOriginFor, parseAllowedOrigins, withRequestOrigin } from "./request-origin.ts";

const PRODUCTION = "https://rocksolid.lwcanada.org,https://rocksolidsuite.netlify.app";
const CONTROL = "https://evil.example.com";

function req(origin: string | null): Request {
  const headers: Record<string, string> = {};
  if (origin !== null) headers["Origin"] = origin;
  return new Request("https://example.test/functions/v1/moodle-sync", { method: "OPTIONS", headers });
}

Deno.test("production Moodle origin receives its own allow-origin header", () => {
  assertEquals(allowedOriginFor(req("https://rocksolid.lwcanada.org"), PRODUCTION), "https://rocksolid.lwcanada.org");
});

Deno.test("production staff origin receives its own allow-origin header", () => {
  assertEquals(allowedOriginFor(req("https://rocksolidsuite.netlify.app"), PRODUCTION), "https://rocksolidsuite.netlify.app");
});

Deno.test("unapproved control origin is not allowed", () => {
  assertEquals(allowedOriginFor(req(CONTROL), PRODUCTION), null);
});

Deno.test("staging origin is not allowed unless listed", () => {
  assertEquals(allowedOriginFor(req("https://rocksolid-staging.netlify.app"), PRODUCTION), null);
});

Deno.test("origin with a different scheme or port is not a match", () => {
  assertEquals(allowedOriginFor(req("http://rocksolidsuite.netlify.app"), PRODUCTION), null);
  assertEquals(allowedOriginFor(req("https://rocksolid.lwcanada.org:8443"), PRODUCTION), null);
});

Deno.test("missing Origin header gets no allow-origin header", () => {
  assertEquals(allowedOriginFor(req(null), PRODUCTION), null);
});

Deno.test("empty allowlist allows no origin", () => {
  assertEquals(allowedOriginFor(req("https://rocksolid.lwcanada.org"), ""), null);
  assertEquals(parseAllowedOrigins(" , "), []);
});

Deno.test("parser trims whitespace and ignores empty entries", () => {
  assertEquals(
    parseAllowedOrigins(" https://rocksolid.lwcanada.org , https://rocksolidsuite.netlify.app ,"),
    ["https://rocksolid.lwcanada.org", "https://rocksolidsuite.netlify.app"],
  );
});

Deno.test("authorization failure keeps the approved origin header", async () => {
  const failure = new Response(JSON.stringify({ ok: false, code: "AUTH_REQUIRED" }), {
    status: 401,
    headers: { "Access-Control-Allow-Headers": "authorization", "Content-Type": "application/json" },
  });
  const out = withRequestOrigin(failure, req("https://rocksolidsuite.netlify.app"), PRODUCTION);
  assertEquals(out.status, 401);
  assertEquals(out.headers.get("Access-Control-Allow-Origin"), "https://rocksolidsuite.netlify.app");
  assertEquals(out.headers.get("Access-Control-Allow-Headers"), "authorization");
  assertEquals((await out.json()).code, "AUTH_REQUIRED");
});

Deno.test("control origin gets no allow-origin header on any response", () => {
  const ok = new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  const out = withRequestOrigin(ok, req(CONTROL), PRODUCTION);
  assertFalse(out.headers.has("Access-Control-Allow-Origin"));
});

Deno.test("wildcard from an inner response is removed, never passed through", () => {
  const inner = new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  const out = withRequestOrigin(inner, req("https://rocksolid.lwcanada.org"), PRODUCTION);
  assertEquals(out.headers.get("Access-Control-Allow-Origin"), "https://rocksolid.lwcanada.org");
  assert(out.headers.get("Access-Control-Allow-Origin") !== "*");
});

Deno.test("Vary Origin is set so caches key on the requesting origin", () => {
  const out = withRequestOrigin(new Response("ok"), req("https://rocksolid.lwcanada.org"), PRODUCTION);
  assert((out.headers.get("Vary") || "").toLowerCase().includes("origin"));
});
