// Adds the isolated SPA preview to the static publish output.
//
// netlify.toml runs two steps, in order:
//   1. node scripts/build-static-publish.mjs
//      The origin/main baseline, unchanged. It produces netlify-static-publish/ with
//      the static /foundation tree, _headers and a generated config.js, and verifies
//      that output.
//   2. node scripts/build-spa-publish.mjs   (this file)
//      Builds the SPA with base /app/, copies it to netlify-static-publish/app/, copies
//      the production-compatible root _redirects, then verifies the combined output.
//
// Nothing here changes a /foundation/ or production URL. The SPA lives only under /app/.
// Any verification failure stops the build.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "netlify-static-publish");
const SPA = path.join(ROOT, "foundation-spa");
const SPA_DIST = path.join(ROOT, "foundation-spa", "dist");
const ALLOWLIST = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts", "netlify-site-allowlist.json"), "utf8")
);

// Guard lists copied verbatim from scripts/build-static-publish.mjs (origin/main).
// tests/netlify-publish.test.mjs fails if they drift.
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

// Bypass flags are refused in every deployment context. The baseline checks the same,
// so this is a second check on the combined build.
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
    SPA_BASE: "/app/",
  };
  const res = spawnSync("npm", ["run", "build"], {
    cwd: SPA,
    env: spaEnv,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) fail("foundation-spa build failed.");
  if (!fs.existsSync(SPA_DIST)) fail("foundation-spa/dist is missing after the build.");
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

function addSpa() {
  if (!fs.existsSync(path.join(OUT, "foundation", "auth", "login.html"))) {
    fail("static publish output is missing. Run scripts/build-static-publish.mjs first.");
  }
  if (fs.existsSync(path.join(OUT, "app"))) fail("app/ already exists in the publish output.");
  if (fs.existsSync(path.join(OUT, "_redirects"))) fail("_redirects already exists in the publish output.");
  fs.mkdirSync(path.join(OUT, "app"), { recursive: true });
  copyTree(SPA_DIST, path.join(OUT, "app"));
  fs.copyFileSync(path.join(ROOT, "_redirects"), path.join(OUT, "_redirects"));
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base, out);
    else out.push(path.relative(base, abs).split(path.sep).join("/"));
  }
  return out;
}

// Every static HTML page in the repository that the baseline publishes.
function repoStaticHtml(dir = path.join(ROOT, "foundation"), out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) repoStaticHtml(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith(".html")) {
      out.push(path.relative(ROOT, path.join(dir, entry.name)).split(path.sep).join("/"));
    }
  }
  return out;
}

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

function verify(env) {
  const problems = [];
  const served = new Set(walk(OUT));
  const secrets = secretValues(env);

  // a. Forbidden paths and files, from the baseline lists and the allowlist.
  for (const f of served) {
    if (FORBIDDEN_PATH.some((re) => re.test(f))) problems.push(`forbidden file published: ${f}`);
    if (EXCLUDED_FILE.test(path.posix.basename(f))) problems.push(`excluded file published: ${f}`);
    if (ALLOWLIST.forbiddenFilePatterns.some((p) => new RegExp(p, "i").test(f))) {
      problems.push(`forbidden file published: ${f}`);
    }
  }

  // b. Text content: no privileged key material and no secret values.
  for (const f of served) {
    if (!/\.(html|m?js|css|json|txt|svg|webmanifest)$/i.test(f) && f !== "_headers" && f !== "_redirects") continue;
    const text = fs.readFileSync(path.join(OUT, f), "utf8");
    for (const re of FORBIDDEN_CONTENT) if (re.test(text)) problems.push(`forbidden content in ${f}: ${re}`);
    for (const { name, value } of secrets) if (text.includes(value)) problems.push(`value of ${name} found in ${f}`);
  }

  // c. Top level: only the static tree, the SPA and the root control files.
  const allowedTop = new Set(["foundation", "app", "_headers", "_redirects"]);
  for (const top of new Set([...served].map((f) => f.split("/")[0]))) {
    if (!allowedTop.has(top)) problems.push(`unexpected top-level entry: ${top}`);
  }

  // d. Required files.
  for (const req of [
    "_headers",
    "_redirects",
    "app/index.html",
    "app/sw.js",
    "app/manifest.webmanifest",
    "foundation/index.html",
    "foundation/auth/login.html",
    "foundation/js/config.js",
    "foundation/staff/_template.html",
  ]) {
    if (!served.has(req)) problems.push(`required file missing: ${req}`);
  }

  // e. No source maps in the SPA output.
  for (const f of served) if (f.startsWith("app/") && f.endsWith(".map")) problems.push(`source map published: ${f}`);

  // f. No static page is dropped: every repository page is published.
  for (const rel of repoStaticHtml()) {
    if (!served.has(rel)) problems.push(`static page missing from publish output: ${rel}`);
  }

  // g. Redirect targets that point at a static or SPA file must exist. Splat targets are checked by prefix.
  const rules = parseRedirects(path.join(OUT, "_redirects"));
  for (const r of rules) {
    if (!Number.isFinite(r.status)) problems.push(`bad status in _redirects rule: ${r.from}`);
    if (r.to.includes(":splat")) continue;
    if (r.to.startsWith("/foundation/") || r.to.startsWith("/app/")) {
      const p = r.to.split("?")[0].replace(/^\//, "");
      if (!served.has(p)) problems.push(`redirect target not published: ${r.from} -> ${r.to}`);
    }
  }

  // h. Runtime config never enables the role bypass.
  const cfg = fs.readFileSync(path.join(OUT, "foundation", "js", "config.js"), "utf8");
  if (!/BYPASS_ROLE: ""/.test(cfg)) problems.push("foundation/js/config.js does not have BYPASS_ROLE empty");

  // i. Contract URLs used by Edge Functions and emails resolve to a published file.
  for (const url of ALLOWLIST.externalContract) {
    const p = url.replace(/^\//, "");
    if (!served.has(p)) problems.push(`external contract URL does not resolve: ${url}`);
  }

  return { problems, served: [...served].sort() };
}

// Main
const env = { ...process.env };
const cfg = checkEnv(env);
buildSpa(cfg);
addSpa();
const { problems, served } = verify(env);
if (problems.length) {
  for (const p of problems) console.error(`[spa-publish] ${p}`);
  fail(`${problems.length} verification problem(s)`);
}
console.log(`[spa-publish] OK: ${served.length} files in netlify-static-publish/ (static baseline plus app/)`);
