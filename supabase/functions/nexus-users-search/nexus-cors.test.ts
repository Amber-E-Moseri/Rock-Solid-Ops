/**
 * CORS unit tests for nexus-users-search.
 *
 * All tests are deterministic and require no live Supabase or network access.
 * Tests cover:
 *   - Production allowed origins
 *   - Staging origin via env
 *   - localhost:5173, localhost:5174 (SPA dev ports)
 *   - Multiple comma-separated origins
 *   - Whitespace trimming and empty-entry handling
 *   - Disallowed hostile origin
 *   - Near-match / subdomain spoof / malicious suffix
 *   - Missing Origin header (null)
 *   - OPTIONS allowed and OPTIONS disallowed
 *   - Env variable absent / blank → builtin fallback
 *   - Exact-match guarantee (non-equivalent examples)
 */

import {
  buildAllowedOrigins,
  BUILTIN_ALLOWED_ORIGINS,
  getCORSHeaders,
} from "./cors.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertContains(set: Set<string>, item: string, label: string): void {
  if (!set.has(item)) throw new Error(`${label}: Set does not contain ${item}`);
}

function assertNotContains(set: Set<string>, item: string, label: string): void {
  if (set.has(item)) throw new Error(`${label}: Set unexpectedly contains ${item}`);
}

// Convenience: get the ACAO header from getCORSHeaders
function acao(origin: string | null, allowed?: Set<string>): string {
  return getCORSHeaders(origin, allowed)["Access-Control-Allow-Origin"];
}

// ─── buildAllowedOrigins ──────────────────────────────────────────────────────

Deno.test("buildAllowedOrigins: undefined/blank → builtin fallback", () => {
  assertEq(
    buildAllowedOrigins(undefined),
    BUILTIN_ALLOWED_ORIGINS,
    "undefined",
  );
  assertEq(buildAllowedOrigins(""), BUILTIN_ALLOWED_ORIGINS, "empty string");
  assertEq(buildAllowedOrigins("   "), BUILTIN_ALLOWED_ORIGINS, "all whitespace");
});

Deno.test("buildAllowedOrigins: single origin", () => {
  const s = buildAllowedOrigins("https://example.com");
  assertContains(s, "https://example.com", "single origin");
  assertEq(s.size, 1, "size=1");
});

Deno.test("buildAllowedOrigins: multiple comma-separated origins", () => {
  const s = buildAllowedOrigins(
    "https://prod.example,https://staging.example,http://localhost:5173",
  );
  assertContains(s, "https://prod.example", "prod");
  assertContains(s, "https://staging.example", "staging");
  assertContains(s, "http://localhost:5173", "5173");
  assertEq(s.size, 3, "size=3");
});

Deno.test("buildAllowedOrigins: whitespace trimming", () => {
  const s = buildAllowedOrigins(
    "  https://prod.example  ,  https://staging.example  ",
  );
  assertContains(s, "https://prod.example", "trimmed prod");
  assertContains(s, "https://staging.example", "trimmed staging");
  assertEq(s.size, 2, "size=2");
});

Deno.test("buildAllowedOrigins: empty entries discarded", () => {
  const s = buildAllowedOrigins("https://a.example,,https://b.example, ,");
  assertContains(s, "https://a.example", "a");
  assertContains(s, "https://b.example", "b");
  assertEq(s.size, 2, "size=2 (empty entries dropped)");
});

// ─── Builtin fallback contents ────────────────────────────────────────────────

Deno.test("builtin: production origins present", () => {
  assertContains(
    BUILTIN_ALLOWED_ORIGINS,
    "https://rocksolidsuite.netlify.app",
    "netlify",
  );
  assertContains(
    BUILTIN_ALLOWED_ORIGINS,
    "https://rocksolid.lwcanada.org",
    "lwcanada",
  );
});

Deno.test("builtin: SPA dev ports present (localhost:5173, localhost:5174)", () => {
  assertContains(BUILTIN_ALLOWED_ORIGINS, "http://localhost:5173", "5173");
  assertContains(BUILTIN_ALLOWED_ORIGINS, "http://localhost:5174", "5174");
});

Deno.test("builtin: legacy dev origins present", () => {
  assertContains(BUILTIN_ALLOWED_ORIGINS, "http://localhost:3000", "3000");
  assertContains(BUILTIN_ALLOWED_ORIGINS, "http://127.0.0.1:3000", "127.0.0.1:3000");
});

// ─── getCORSHeaders — allowed origins ─────────────────────────────────────────

Deno.test("getCORSHeaders: production netlify origin → ACAO = that origin", () => {
  assertEq(
    acao("https://rocksolidsuite.netlify.app"),
    "https://rocksolidsuite.netlify.app",
    "netlify ACAO",
  );
});

Deno.test("getCORSHeaders: production custom domain → ACAO = that origin", () => {
  assertEq(
    acao("https://rocksolid.lwcanada.org"),
    "https://rocksolid.lwcanada.org",
    "lwcanada ACAO",
  );
});

Deno.test("getCORSHeaders: localhost:5173 → ACAO = http://localhost:5173", () => {
  assertEq(acao("http://localhost:5173"), "http://localhost:5173", "5173 ACAO");
});

Deno.test("getCORSHeaders: localhost:5174 → ACAO = http://localhost:5174", () => {
  assertEq(acao("http://localhost:5174"), "http://localhost:5174", "5174 ACAO");
});

Deno.test("getCORSHeaders: configured staging origin (via explicit set)", () => {
  const staging = new Set(["https://staging.rocksolid.example"]);
  assertEq(
    acao("https://staging.rocksolid.example", staging),
    "https://staging.rocksolid.example",
    "staging ACAO",
  );
  // Production origin NOT in the custom set → denied
  assertEq(
    acao("https://rocksolidsuite.netlify.app", staging),
    "",
    "prod denied when only staging configured",
  );
});

Deno.test("getCORSHeaders: multiple origins in env set — each accepted independently", () => {
  const set = buildAllowedOrigins(
    "https://prod.example,https://staging.example,http://localhost:5173",
  );
  assertEq(acao("https://prod.example", set), "https://prod.example", "prod");
  assertEq(acao("https://staging.example", set), "https://staging.example", "staging");
  assertEq(acao("http://localhost:5173", set), "http://localhost:5173", "5173");
  assertEq(acao("https://hostile.example", set), "", "hostile denied");
});

// ─── getCORSHeaders — disallowed origins ──────────────────────────────────────

Deno.test("getCORSHeaders: hostile origin → ACAO = ''", () => {
  assertEq(acao("https://evil.example"), "", "hostile ACAO empty");
});

Deno.test("getCORSHeaders: near-match with malicious suffix → denied", () => {
  // https://example.com vs https://example.com.evil.test must NOT be equivalent
  const set = new Set(["https://example.com"]);
  assertEq(acao("https://example.com", set), "https://example.com", "real origin");
  assertEq(acao("https://example.com.evil.test", set), "", "suffix spoof denied");
  assertEq(acao("https://evil-example.com", set), "", "prefix mutation denied");
});

Deno.test("getCORSHeaders: subdomain spoof → denied", () => {
  const set = new Set(["https://rocksolidsuite.netlify.app"]);
  assertEq(
    acao("https://evil.rocksolidsuite.netlify.app", set),
    "",
    "subdomain spoof denied",
  );
});

Deno.test("getCORSHeaders: malicious origin suffix on production domain → denied", () => {
  assertEq(
    acao("https://rocksolid.lwcanada.org.evil.test"),
    "",
    "production domain suffix spoof denied",
  );
});

Deno.test("getCORSHeaders: exact-match non-equivalence examples", () => {
  // These three must all be distinct and only the exact one is allowed
  const set = new Set(["https://example.com"]);
  assertEq(acao("https://example.com", set), "https://example.com", "exact");
  assertEq(acao("https://example.com.evil.test", set), "", "suffix not equivalent");
  assertEq(acao("https://evil-example.com", set), "", "prefix not equivalent");
  assertEq(acao("https://sub.example.com", set), "", "subdomain not equivalent");
  assertEq(acao("http://example.com", set), "", "http:// not equivalent to https://");
  assertEq(acao("https://example.com:443", set), "", "explicit port not equivalent");
});

// ─── getCORSHeaders — no Origin ───────────────────────────────────────────────

Deno.test("getCORSHeaders: null Origin → ACAO = '' (server-to-server safe)", () => {
  assertEq(acao(null), "", "null origin ACAO empty");
});

// ─── OPTIONS response headers ─────────────────────────────────────────────────

Deno.test("getCORSHeaders: OPTIONS allowed origin — correct preflight headers present", () => {
  const headers = getCORSHeaders("https://rocksolidsuite.netlify.app");
  assertEq(
    headers["Access-Control-Allow-Origin"],
    "https://rocksolidsuite.netlify.app",
    "OPTIONS ACAO",
  );
  assertEq(headers["Access-Control-Allow-Methods"], "GET, OPTIONS", "OPTIONS methods");
  assertEq(
    headers["Vary"],
    "Origin",
    "OPTIONS Vary: Origin",
  );
});

Deno.test("getCORSHeaders: OPTIONS disallowed origin — ACAO empty", () => {
  const headers = getCORSHeaders("https://evil-actor.example");
  assertEq(headers["Access-Control-Allow-Origin"], "", "OPTIONS disallowed ACAO empty");
  // Vary and other headers still present (safe)
  assertEq(headers["Vary"], "Origin", "Vary: Origin still present");
});

// ─── Env-absent fallback ──────────────────────────────────────────────────────

Deno.test("env absent → builtin fallback allows production origins", () => {
  // buildAllowedOrigins(undefined) = BUILTIN_ALLOWED_ORIGINS
  const set = buildAllowedOrigins(undefined);
  assertEq(
    acao("https://rocksolidsuite.netlify.app", set),
    "https://rocksolidsuite.netlify.app",
    "builtin fallback: netlify",
  );
  assertEq(
    acao("https://rocksolid.lwcanada.org", set),
    "https://rocksolid.lwcanada.org",
    "builtin fallback: lwcanada",
  );
});

Deno.test("env absent → builtin fallback allows SPA dev ports", () => {
  const set = buildAllowedOrigins(undefined);
  assertEq(acao("http://localhost:5173", set), "http://localhost:5173", "5173");
  assertEq(acao("http://localhost:5174", set), "http://localhost:5174", "5174");
});

Deno.test("env absent → builtin fallback denies unknown origins", () => {
  const set = buildAllowedOrigins(undefined);
  assertEq(acao("https://attacker.example", set), "", "fallback: hostile denied");
});
