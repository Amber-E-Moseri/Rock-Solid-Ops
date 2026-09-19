/**
 * CORS helper for nexus-users-search.
 *
 * Allowed origins are read from CORS_ALLOWED_ORIGINS (comma-separated).
 * When that variable is absent or blank, BUILTIN_ALLOWED_ORIGINS is used
 * so existing production deployments require no environment change.
 *
 * Matching is exact-string only. No wildcard. No reflection of arbitrary origins.
 */

export const BUILTIN_ALLOWED_ORIGINS = new Set<string>([
  "https://rocksolidsuite.netlify.app",
  "https://rocksolid.lwcanada.org",
  "http://localhost:3000",   // legacy dev
  "http://127.0.0.1:3000",  // legacy dev
  "http://localhost:5173",   // foundation-spa vite (primary dev port)
  "http://localhost:5174",   // foundation-spa vite (alt dev port)
]);

export function buildAllowedOrigins(envValue?: string): Set<string> {
  const raw = envValue ?? "";
  if (!raw.trim()) return BUILTIN_ALLOWED_ORIGINS;
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return new Set(parsed);
}

export function getAllowedOriginsFromEnv(): Set<string> {
  return buildAllowedOrigins(Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "");
}

export function getCORSHeaders(
  requestOrigin: string | null,
  allowedOrigins: Set<string> = getAllowedOriginsFromEnv(),
): Record<string, string> {
  const acao =
    requestOrigin !== null && allowedOrigins.has(requestOrigin)
      ? requestOrigin
      : "";
  return {
    "Access-Control-Allow-Origin": acao,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}
