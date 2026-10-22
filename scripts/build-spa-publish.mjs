// Builds the Netlify publish directory for the SPA cutover.
//
// Security baseline: scripts/build-static-publish.mjs on origin/main, the
// allowlist that is live on production. The guard lists below are copied from
// it verbatim, and tests/netlify-publish.test.mjs fails if they drift.
//
// The publish directory is an allowlist, never the repository root:
//   1. foundation-spa/dist (Vite build; includes public/_redirects and 404.html)
//   2. _headers from the repository root
//   3. the approved static compatibility closure from scripts/netlify-site-allowlist.json:
//      each approved page plus every local file it loads (scripts, styles, images, modules)
//   4. a generated foundation/js/config.js, written to the publish directory only
//
// Any verification failure stops the build. Netlify runs this via netlify.toml.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "netlify-static-publish");
const ALLOWLIST = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts", "netlify-site-allowlist.json"), "utf8")
);
const SPA = path.join(ROOT, "foundation-spa");
const SPA_DIST = path.join(ROOT, ALLOWLIST.spaOutput);
const GENERATED = ALLOWLIST.generatedConfig;
const KNOWN_MISSING = new Set(ALLOWLIST.knownMissingReferences || []);

// Guard lists copied verbatim from scripts/build-static-publish.mjs (origin/main).
const FORBIDDEN_PATH = [
  /\.sql$/i,
  /\.md$/i,
  /\.ts$/i,
  /\.map$/i,
  /\.env/i,
  /(^|\/)\.git/i,
  /(^|\/)node_modules\//i,
  /(^|\/)(supabase|scripts|archive|docs|sql|edge-functions|ai|foundation-spa)\//i,
  /(^|\/)(netlify|vercel)\.(toml|json)$/i,
  /(^|\/)package(-lock)?\.json$/i,
  /(^|\/)(backup|data_backup|schema_backup)[^/]*$/i,
  /\.bak/i,
  /\.test\./i,
  /config\.js\.example$/i,
];
const FORBIDDEN_CONTENT = [
  /sb_secret_/,
  /service_role/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /VAPID_PRIVATE_KEY/,
  /CRON_INVOKE_SECRET|INTERNAL_INVOKE_SECRET|NEXUS_TASK_API_KEY/,
];
const EXCLUDED_DIRS = new Set(["archive", "docs", "sql", "edge-functions", "node_modules"]);
const EXCLUDED_FILE = /(\.md|\.txt|\.sql|\.example|\.claspignore|\.map|\.test\.[cm]?[jt]sx?|\.bak[^/]*)$|^(README|serve\.json|__|\.env)/i;

function fail(message) {
  console.error(`[spa-publish] FAILED: ${message}`);
  process.exit(1);
}

// Returns the role claim of a Supabase JWT, or null if the value is not a JWT.
function jwtRole(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

// Environment guards. Bypass flags are refused in every deployment context, not only production.
function checkEnv(env) {
  const supabaseUrl = String(env.SUPABASE_URL || "").trim();
  const anonKey = String(env.SUPABASE_ANON_KEY || "").trim();
  if (!supabaseUrl || !anonKey) fail("Missing SUPABASE_URL and/or SUPABASE_ANON_KEY.");
  if (!/^https:\/\//.test(supabaseUrl)) fail("SUPABASE_URL must be an https URL.");
  if (/^sb_secret_/.test(anonKey) || jwtRole(anonKey) === "service_role") {
    fail("SUPABASE_ANON_KEY is a privileged key. Refusing to publish it to the browser.");
  }
  if (jwtRole(anonKey) !== null && jwtRole(anonKey) !== "anon") {
    fail(`SUPABASE_ANON_KEY has role "${jwtRole(anonKey)}"; expected "anon".`);
  }
  for (const name of ["BYPASS_ROLE", "VITE_BYPASS_ROLE"]) {
    if (String(env[name] ?? "").trim() !== "") {
      fail(`${name} is set. Bypass flags are refused in every deployment context.`);
    }
  }
  for (const [viteName, name] of [
    ["VITE_SUPABASE_URL", "SUPABASE_URL"],
    ["VITE_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"],
  ]) {
    const viteValue = String(env[viteName] ?? "").trim();
    if (viteValue && viteValue !== String(env[name]).trim()) fail(`${viteName} differs from ${name}.`);
  }
  return { supabaseUrl, anonKey };
}

// Secret values that must never appear in published text. Checked by value, not by name.
function secretValues(env) {
  const pattern = new RegExp(ALLOWLIST.secretEnvPattern);
  return Object.entries(env)
    .filter(([name, value]) => value && value.length >= 12 && !ALLOWLIST.publicEnvNames.includes(name) && pattern.test(name))
    .map(([name, value]) => ({ name, value: String(value) }));
}

function buildSpa(cfg) {
  const spaEnv = {
    ...process.env,
    VITE_SUPABASE_URL: cfg.supabaseUrl,
    VITE_SUPABASE_ANON_KEY: cfg.anonKey,
    VITE_VAPID_PUBLIC_KEY: process.env.VITE_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || "",
  };
  const res = spawnSync("npm", ["run", "build"], {
    cwd: SPA,
    env: spaEnv,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) fail("foundation-spa build failed.");
  if (!fs.existsSync(SPA_DIST)) fail(`SPA output missing: ${ALLOWLIST.spaOutput}`);
}

// Static closure: local files referenced by approved pages, resolved transitively.
// Inline <script type="module"> imports are scanned too, so their modules are published.
const LOCAL_ATTR = /<(script|img|link|source|iframe)\b[^>]*?\s(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const INLINE_MODULE = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/gi;
const JS_IMPORT = /(?:\bimport\s+(?:[^'"()]*?\sfrom\s+)?|\bimport\(\s*|\bexport\s+[^'"]*?\sfrom\s+)["']([^"']+)["']/g;
const CSS_REF = /@import\s+["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/g;

function isLocal(ref) {
  return Boolean(ref) && !/^(https?:|data:|mailto:|tel:|javascript:|#|\/\/)/i.test(ref);
}

// Resolves a reference found in repo file `fromRel` to a repo-relative path.
// Only the static foundation/ tree is pulled in.
function resolveRef(fromRel, ref) {
  const clean = ref.split(/[?#]/)[0];
  if (!clean) return null;
  const rel = clean.startsWith("/")
    ? clean.slice(1)
    : path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), clean));
  return rel.startsWith("foundation/") ? rel : null;
}

function scanRefs(rel) {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const refs = new Set();
  const add = (r) => {
    if (!isLocal(r)) return;
    const target = resolveRef(rel, r);
    if (target) refs.add(target);
  };
  if (rel.endsWith(".html")) {
    for (const m of text.matchAll(LOCAL_ATTR)) add(m[2]);
    for (const block of text.matchAll(INLINE_MODULE)) {
      for (const m of block[1].matchAll(JS_IMPORT)) add(m[1]);
    }
  } else if (/\.(m?js)$/.test(rel)) {
    for (const m of text.matchAll(JS_IMPORT)) add(m[1]);
  } else if (rel.endsWith(".css")) {
    for (const m of text.matchAll(CSS_REF)) add(m[1] || m[2]);
  }
  return refs;
}

function computeClosure() {
  const queue = [...ALLOWLIST.staticEntries, ...ALLOWLIST.staticAssets, GENERATED];
  const files = new Set();
  const missing = [];
  while (queue.length) {
    const rel = queue.shift();
    if (files.has(rel)) continue;
    // Written by this build from the environment. Never copied from the repository.
    if (rel === GENERATED) {
      files.add(rel);
      continue;
    }
    if (!fs.existsSync(path.join(ROOT, rel))) {
      // Placeholders that already 404 on production (for example the scaffold in
      // staff/_template.html). Listed explicitly, warned about, never silent.
      if (KNOWN_MISSING.has(rel)) {
        console.warn(`[spa-publish] known missing reference (already 404 in production): ${rel}`);
      } else {
        missing.push(rel);
      }
      continue;
    }
    files.add(rel);
    if (/\.(html|m?js|css)$/.test(rel)) for (const r of scanRefs(rel)) queue.push(r);
  }
  return { files: [...files].sort(), missing };
}

function copyTree(srcDir, destDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyTree(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function assemble(closure) {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  copyTree(SPA_DIST, OUT);
  fs.copyFileSync(path.join(ROOT, "_headers"), path.join(OUT, "_headers"));
  for (const rel of closure.files) {
    if (rel === GENERATED) continue;
    const dest = path.join(OUT, rel);
    if (fs.existsSync(dest)) fail(`publish collision: ${rel}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dest);
  }
}

// Browser-safe runtime config. BYPASS_ROLE is always empty in the publish output.
function writeConfig(cfg) {
  const dest = path.join(OUT, GENERATED);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(
    dest,
    `window.FS_CONFIG = {\n  SUPABASE_URL: ${JSON.stringify(cfg.supabaseUrl)},\n  SUPABASE_ANON_KEY: ${JSON.stringify(cfg.anonKey)},\n  BYPASS_ROLE: "",\n};\n`,
    "utf8"
  );
}

// Verification helpers.
function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base, out);
    else out.push(path.relative(base, abs).split(path.sep).join("/"));
  }
  return out;
}

function listRepoStaticHtml(dir = path.join(ROOT, "foundation"), out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) listRepoStaticHtml(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith(".html")) {
      out.push(path.relative(ROOT, path.join(dir, entry.name)).split(path.sep).join("/"));
    }
  }
  return out;
}

// Parses _redirects. A trailing "*" in `from` is a splat. A trailing "!" forces the rule.
function parseRedirects(file) {
  const rules = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [from, to, statusRaw] = t.split(/\s+/);
    rules.push({ from, to, status: parseInt(statusRaw, 10), force: statusRaw.endsWith("!") });
  }
  return rules;
}

function ruleMatches(rule, urlPath) {
  if (rule.from.endsWith("*")) return urlPath.startsWith(rule.from.slice(0, -1));
  return rule.from === urlPath;
}

// Route paths declared in App.jsx: exact paths and "/x/*" catch-alls.
function spaRoutes() {
  const src = fs.readFileSync(path.join(SPA, "src", "App.jsx"), "utf8");
  return [...src.matchAll(/path=["']([^"']+)["']/g)].map((m) => m[1]);
}

function spaRouteExists(target) {
  const pathOnly = target.split(/[?#]/)[0];
  return spaRoutes().some(
    (r) => r === pathOnly || (r.endsWith("/*") && pathOnly.startsWith(r.slice(0, -1)))
  );
}

function verify(closure, env) {
  const problems = [];
  const served = new Set(walk(OUT));
  const rules = parseRedirects(path.join(OUT, "_redirects"));
  const secrets = secretValues(env);

  const covered = (urlPath) => {
    const p = urlPath.replace(/^\//, "");
    return served.has(p) || served.has(`${p}.html`) || served.has(`${p.replace(/\/$/, "")}/index.html`);
  };
  // 404 rules do not count as routes. They only name the page shown for a missing path.
  const redirected = (urlPath) => rules.some((r) => r.status !== 404 && ruleMatches(r, urlPath));
  const resolvable = (urlPath) => covered(urlPath) || redirected(urlPath) || spaRouteExists(urlPath);

  // a. Forbidden paths and files never reach the publish directory.
  for (const f of served) {
    if (FORBIDDEN_PATH.some((re) => re.test(f))) problems.push(`forbidden file published: ${f}`);
    if (EXCLUDED_FILE.test(path.posix.basename(f))) problems.push(`excluded file published: ${f}`);
    if (ALLOWLIST.forbiddenFilePatterns.some((p) => new RegExp(p, "i").test(f))) {
      problems.push(`forbidden file published: ${f}`);
    }
  }

  // b. Text content: no privileged key material and no secret values.
  const textFile = /\.(html|m?js|css|json|txt|svg|webmanifest)$/i;
  for (const f of served) {
    if (!textFile.test(f) && f !== "_headers" && f !== "_redirects") continue;
    const text = fs.readFileSync(path.join(OUT, f), "utf8");
    for (const re of FORBIDDEN_CONTENT) if (re.test(text)) problems.push(`forbidden content in ${f}: ${re}`);
    for (const { name, value } of secrets) if (text.includes(value)) problems.push(`value of ${name} found in ${f}`);
  }

  // c. Top level: only the SPA output, _headers and foundation/.
  const allowedTop = new Set([...fs.readdirSync(SPA_DIST), "_headers", "foundation"]);
  for (const top of new Set([...served].map((f) => f.split("/")[0]))) {
    if (!allowedTop.has(top)) problems.push(`unexpected top-level entry: ${top}`);
  }

  // d. Required files.
  for (const req of [
    "index.html",
    "_headers",
    "_redirects",
    "404.html",
    "foundation/index.html",
    "foundation/auth/login.html",
    "foundation/auth/safe-next.js",
    "foundation/registration/class-selection.html",
    "foundation/teacher/index.html",
    "foundation/js/config.js",
    "foundation/staff/_template.html",
  ]) {
    if (!served.has(req)) problems.push(`required file missing: ${req}`);
  }

  // e. Every local reference of a published static file is published.
  for (const rel of closure.files) {
    if (rel === GENERATED || !/\.(html|m?js|css)$/.test(rel)) continue;
    for (const ref of scanRefs(rel)) {
      if (!served.has(ref) && !KNOWN_MISSING.has(ref)) problems.push(`${rel} loads unpublished ${ref}`);
    }
  }

  // f. Navigation links on published static pages resolve to a file, a redirect or an SPA route.
  for (const rel of closure.files.filter((f) => f.endsWith(".html"))) {
    const pageUrl = `/${rel}`;
    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*["']([^"']+)["']/gi)) {
      const ref = m[1];
      if (!isLocal(ref) || ref.startsWith("#")) continue;
      const target = ref.startsWith("/")
        ? ref
        : path.posix.normalize(path.posix.join(path.posix.dirname(pageUrl), ref));
      const urlPath = target.split(/[?#]/)[0];
      if (!urlPath.endsWith("/") && !resolvable(urlPath)) problems.push(`${rel} links to unresolved ${urlPath}`);
    }
  }

  // g. Contract URLs used by Edge Functions and emails keep resolving.
  for (const url of ALLOWLIST.externalContract) {
    if (!resolvable(url)) problems.push(`external contract URL does not resolve: ${url}`);
  }

  // h. Redirect rules are well formed and point at real targets.
  for (const r of rules) {
    if (!Number.isFinite(r.status)) problems.push(`bad status in _redirects rule: ${r.from}`);
    if (/^\/(staff|teacher|auth)(\/|$)/.test(r.to)) {
      if (!spaRouteExists(r.to)) problems.push(`redirect target has no SPA route: ${r.from} -> ${r.to}`);
    } else if (r.status >= 300 && r.status < 400 && r.to.startsWith("/foundation/")) {
      if (!covered(r.to)) problems.push(`redirect target not published: ${r.from} -> ${r.to}`);
    }
  }

  // i. Retained routes: every static page in the repo stays reachable, as a file or as a
  // redirect, both at its .html URL and its pretty URL. Retiring one needs approval.
  for (const rel of listRepoStaticHtml()) {
    if (closure.files.includes(rel)) continue;
    const url = `/${rel}`;
    const pretty = url.replace(/\.html$/, "");
    const reachable = redirected(url) && redirected(pretty);
    if (!reachable && !ALLOWLIST.approvedRetirements.includes(rel)) {
      problems.push(`static route would 404 without approval: ${url} (pretty URL ${pretty})`);
    }
  }

  return { problems, served: [...served].sort() };
}

// Main
const env = { ...process.env };
const cfg = checkEnv(env);
buildSpa(cfg);
const closure = computeClosure();
if (closure.missing.length) fail(`allowlisted or referenced files missing in repo: ${closure.missing.join(", ")}`);
assemble(closure);
writeConfig(cfg);
const { problems, served } = verify(closure, env);
if (problems.length) {
  for (const p of problems) console.error(`[spa-publish] ${p}`);
  fail(`${problems.length} verification problem(s)`);
}
console.log(`[spa-publish] OK: ${served.length} files in netlify-static-publish/ (static closure: ${closure.files.length} files)`);
