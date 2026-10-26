// Per-request CORS for a single function. The origin must match ALLOWED_ORIGINS exactly.
// Unapproved or missing origins get no Access-Control-Allow-Origin header, so the browser blocks
// the response. Wildcards are never set and origins are never reflected. Headers are copied per
// response, so no module-level state is shared between concurrent requests.

export function parseAllowedOrigins(raw: string): string[] {
  return raw.split(",").map((v) => v.trim()).filter(Boolean);
}

export function allowedOriginFor(req: Request, allowedRaw: string): string | null {
  const origin = String(req.headers.get("Origin") || "").trim();
  if (!origin) return null;
  return parseAllowedOrigins(allowedRaw).includes(origin) ? origin : null;
}

export function withRequestOrigin(response: Response, req: Request, allowedRaw: string): Response {
  const headers = new Headers(response.headers);
  headers.delete("Access-Control-Allow-Origin");
  const origin = allowedOriginFor(req, allowedRaw);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.append("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
