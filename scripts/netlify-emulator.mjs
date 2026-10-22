// Local stand-in for Netlify's routing against a built publish directory.
// It applies _redirects and _headers the way Netlify documents them: forced
// rules first, then files (with pretty URLs), then non-forced rules. Query strings
// pass through redirects and rewrites. It is an approximation for local tests.
// Netlify behaviour must still be confirmed on a Deploy Preview.
//
// Usage: node scripts/netlify-emulator.mjs [publishDir] [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export function parseRedirects(text) {
  const rules = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [from, to, statusRaw] = t.split(/\s+/);
    rules.push({ from, to, status: parseInt(statusRaw, 10), force: statusRaw.endsWith("!") });
  }
  return rules;
}

function matchRule(rule, pathname) {
  if (rule.from.endsWith("*")) {
    const prefix = rule.from.slice(0, -1);
    return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : null;
  }
  return rule.from === pathname ? "" : null;
}

// Parses _headers into [{ pattern, headers: [[name, value]] }].
export function parseHeaders(text) {
  const blocks = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: [] };
      blocks.push(current);
    } else if (current) {
      const idx = raw.indexOf(":");
      current.headers.push([raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()]);
    }
  }
  return blocks;
}

function headerMatches(pattern, pathname) {
  if (pattern.endsWith("*")) return pathname.startsWith(pattern.slice(0, -1));
  return pattern === pathname;
}

// Netlify does not serve its control files as content (production returns 404 for /_headers).
const HIDDEN = new Set(["_headers", "_redirects"]);

export function resolveFile(root, urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  if (HIDDEN.has(rel)) return null;
  const abs = path.normalize(path.join(root, rel));
  if (!abs.startsWith(path.normalize(root))) return null;
  const candidates = [abs, `${abs}.html`, path.join(abs, "index.html")];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

export function createEmulator(root) {
  const publishRoot = path.resolve(root);
  const rules = parseRedirects(fs.readFileSync(path.join(publishRoot, "_redirects"), "utf8"));
  const headerBlocks = fs.existsSync(path.join(publishRoot, "_headers"))
    ? parseHeaders(fs.readFileSync(path.join(publishRoot, "_headers"), "utf8"))
    : [];

  function sendFile(res, file, status, pathname) {
    const ext = path.extname(file).toLowerCase();
    const headers = { "Content-Type": TYPES[ext] || "application/octet-stream" };
    for (const block of headerBlocks) {
      if (headerMatches(block.pattern, pathname)) {
        for (const [name, value] of block.headers) headers[name] = value;
      }
    }
    res.writeHead(status, headers);
    res.end(fs.readFileSync(file));
  }

  function notFound(res, pathname) {
    const page = path.join(publishRoot, "404.html");
    if (fs.existsSync(page)) sendFile(res, page, 404, pathname);
    else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  }

  function applyRule(rule, pathname, search, res) {
    const splat = matchRule(rule, pathname) ?? "";
    const target = rule.to.replace(":splat", splat);
    if (rule.status === 404) return notFound(res, pathname);
    if (rule.status === 301 || rule.status === 302) {
      const location = target.includes("?") || !search ? target : `${target}${search}`;
      res.writeHead(rule.status, { Location: location });
      return res.end();
    }
    // 200 rewrite: serve the target file, keep the requested URL.
    const file = resolveFile(publishRoot, target.split("?")[0]);
    if (!file) return notFound(res, pathname);
    return sendFile(res, file, 200, pathname);
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      return res.end("Bad request");
    }
    const search = url.search;
    const matching = (filter) =>
      rules.find((r) => filter(r) && matchRule(r, pathname) !== null);

    const forced = matching((r) => r.force);
    if (forced) return applyRule(forced, pathname, search, res);

    const file = resolveFile(publishRoot, pathname);
    if (file) return sendFile(res, file, 200, pathname);

    const fallback = matching((r) => !r.force);
    if (fallback) return applyRule(fallback, pathname, search, res);

    return notFound(res, pathname);
  });
}

// CLI: node scripts/netlify-emulator.mjs [publishDir] [port]
const isMain = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = process.argv[2] || path.join(here, "..", "netlify-static-publish");
  const port = Number(process.argv[3] || 8787);
  createEmulator(dir).listen(port, "127.0.0.1", () => {
    console.log(`[netlify-emulator] serving ${path.resolve(dir)} on http://127.0.0.1:${port}`);
  });
}
