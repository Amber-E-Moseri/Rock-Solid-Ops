// Builds the Netlify publish directory for the existing static Rock Solid site.
//
// Production previously published the repository root ("."). This script builds
// an allowlisted directory instead, so that only the static /foundation tree and
// the security headers are deployed. URLs are unchanged: /foundation/... still
// maps to foundation/..., and the redirects in netlify.toml are untouched.
//
// It does not build or publish foundation-spa/.
//
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/build-static-publish.mjs

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sourceFoundation = path.join(repoRoot, "foundation");
const outDir = path.join(repoRoot, "netlify-static-publish");

// Top-level entries that may appear in the publish root. Anything else is a violation.
const ROOT_ALLOWLIST = new Set(["_headers", "foundation"]);

// Directories under foundation/ that are never published.
const EXCLUDED_DIRS = new Set(["archive", "docs", "sql", "edge-functions", "node_modules"]);

// Files under foundation/ that are never published.
const EXCLUDED_FILE =
  /(\.md|\.txt|\.sql|\.example|\.claspignore|\.map|\.test\.[cm]?[jt]sx?|\.bak[^/]*)$|^(README|serve\.json|__|_template\.html$|\.env)/i;

// Patterns that must not appear in any published path.
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

// Patterns that must not appear in any published text content.
const FORBIDDEN_CONTENT = [
  /sb_secret_/,
  /service_role/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /VAPID_PRIVATE_KEY/,
  /CRON_INVOKE_SECRET|INTERNAL_INVOKE_SECRET|NEXUS_TASK_API_KEY/,
];

function fail(message) {
  console.error(`[static-publish] ${message}`);
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

const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
const bypassRole = String(process.env.BYPASS_ROLE || "").trim();

if (!supabaseUrl || !supabaseAnonKey) {
  fail("Missing SUPABASE_URL and/or SUPABASE_ANON_KEY.");
}
if (!/^https:\/\//.test(supabaseUrl)) {
  fail("SUPABASE_URL must be an https URL.");
}
if (bypassRole) {
  fail("BYPASS_ROLE must not be set for a production publish.");
}
if (/^sb_secret_/.test(supabaseAnonKey) || jwtRole(supabaseAnonKey) === "service_role") {
  fail("SUPABASE_ANON_KEY is a privileged key. Refusing to publish it to the browser.");
}
if (jwtRole(supabaseAnonKey) !== null && jwtRole(supabaseAnonKey) !== "anon") {
  fail(`SUPABASE_ANON_KEY has role "${jwtRole(supabaseAnonKey)}"; expected "anon".`);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 1. Security headers in the publish root.
fs.copyFileSync(path.join(repoRoot, "_headers"), path.join(outDir, "_headers"));

// 2. Allowlisted static tree under /foundation.
fs.cpSync(sourceFoundation, path.join(outDir, "foundation"), {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(sourceFoundation, src);
    if (rel === "") return true;
    const [top] = rel.split(path.sep);
    if (EXCLUDED_DIRS.has(top)) return false;
    const base = path.basename(src);
    if (fs.statSync(src).isDirectory()) return !EXCLUDED_DIRS.has(base);
    return !EXCLUDED_FILE.test(base);
  },
});

// 3. Browser-safe runtime config, generated into the publish copy only.
const configPath = path.join(outDir, "foundation", "js", "config.js");
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(
  configPath,
  `window.FS_CONFIG = {\n  SUPABASE_URL: ${JSON.stringify(supabaseUrl)},\n  SUPABASE_ANON_KEY: ${JSON.stringify(supabaseAnonKey)},\n  BYPASS_ROLE: "",\n};\n`,
  "utf8",
);

// Verification.
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(path.relative(outDir, full).split(path.sep).join("/"));
  }
})(outDir);

const topLevel = new Set(files.map((f) => f.split("/")[0]));
const unexpectedTop = [...topLevel].filter((t) => !ROOT_ALLOWLIST.has(t));
if (unexpectedTop.length > 0) {
  fail(`Unexpected top-level entries in publish output: ${unexpectedTop.join(", ")}`);
}

const pathViolations = files.filter((f) => FORBIDDEN_PATH.some((re) => re.test(f)));
if (pathViolations.length > 0) {
  fail(`Forbidden files in publish output:\n  ${pathViolations.join("\n  ")}`);
}

const textExts = /\.(html|js|css|json|txt|svg|webmanifest)$/i;
const contentViolations = [];
for (const f of files.filter((x) => textExts.test(x) || x === "_headers")) {
  const text = fs.readFileSync(path.join(outDir, f), "utf8");
  for (const re of FORBIDDEN_CONTENT) {
    if (re.test(text)) contentViolations.push(`${f} matches ${re}`);
  }
}
if (contentViolations.length > 0) {
  fail(`Forbidden content in publish output:\n  ${contentViolations.join("\n  ")}`);
}

for (const required of [
  "_headers",
  "foundation/index.html",
  "foundation/auth/login.html",
  "foundation/staff/admin-portal.html",
  "foundation/registration/registration-form.html",
  "foundation/registration/class-selection.html",
  "foundation/teacher/index.html",
  "foundation/js/config.js",
]) {
  if (!files.includes(required)) fail(`Publish output is missing ${required}.`);
}

console.log(`[static-publish] ${files.length} files written to netlify-static-publish/ (allowlist verified).`);
