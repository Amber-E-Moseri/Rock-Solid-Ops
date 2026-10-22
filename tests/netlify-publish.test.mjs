// Netlify publish allowlist, redirect, header and route regression tests.
// Run after a build: node --test tests/
//   1. Config tests read the repository only and always run.
//   2. Output tests and emulator tests need netlify-static-publish/ (run
//      `node scripts/build-spa-publish.mjs` first) and are skipped otherwise.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRedirects, createEmulator } from "../scripts/netlify-emulator.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Normalised to LF so line-based patterns match on Windows checkouts (CRLF).
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const ALLOWLIST = JSON.parse(read("scripts/netlify-site-allowlist.json"));
const OUT = path.join(ROOT, "netlify-static-publish");
const HAS_OUTPUT = fs.existsSync(path.join(OUT, "index.html"));
const SKIP_OUTPUT = HAS_OUTPUT ? false : "netlify-static-publish/ missing: run node scripts/build-spa-publish.mjs";

const REDIRECTS = parseRedirects(read("foundation-spa/public/_redirects"));
const findRule = (from) => REDIRECTS.find((r) => r.from === from);

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base, out);
    else out.push(path.relative(base, abs).split(path.sep).join("/"));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Configuration (repository only)

describe("netlify.toml", () => {
  const toml = read("netlify.toml");

  test("publishes the allowlisted directory, never the repository root", () => {
    assert.match(toml, /^\s*publish = "netlify-static-publish"\s*$/m);
    assert.doesNotMatch(toml, /publish = "\."/);
  });

  test("builds through the reviewed SPA publish script", () => {
    assert.match(toml, /node scripts\/build-spa-publish\.mjs/);
  });

  test("has one redirect source: no [[redirects]] block in netlify.toml", () => {
    assert.doesNotMatch(toml, /\[\[redirects\]\]/);
  });
});

describe("security baseline parity with scripts/build-static-publish.mjs", () => {
  const baseline = read("scripts/build-static-publish.mjs");
  const candidate = read("scripts/build-spa-publish.mjs");
  // Regex literal lines of the baseline guard lists, e.g. /\.sql$/i, or the EXCLUDED_FILE literal.
  const literals = baseline
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\/.+\/[a-z]*[,;]?$/.test(l))
    .map((l) => l.replace(/[,;]$/, ""));

  test("baseline guard lists were found", () => {
    assert.ok(literals.length >= 20, `found ${literals.length} literals`);
  });

  test("every baseline guard literal is kept verbatim", () => {
    for (const lit of literals) {
      assert.ok(candidate.includes(lit), `missing guard: ${lit}`);
    }
  });

  test("the allowlist's forbidden patterns cover the baseline file-name guards", () => {
    for (const pat of ["\\.sql$", "\\.md$", "\\.ts$", "\\.map$", "\\.env", "(^|/)node_modules/", "(^|/)supabase/"]) {
      assert.ok(ALLOWLIST.forbiddenFilePatterns.includes(pat), `missing pattern ${pat}`);
    }
  });
});

describe("bypass and key guards", () => {
  const script = read("scripts/build-spa-publish.mjs");

  test("refuse BYPASS_ROLE and VITE_BYPASS_ROLE in every context", () => {
    assert.match(script, /\["BYPASS_ROLE", "VITE_BYPASS_ROLE"\]/);
    assert.doesNotMatch(script, /CONTEXT/, "deployment context must not change the bypass rule");
  });

  test("refuse privileged anon keys and non-https Supabase URLs", () => {
    assert.match(script, /sb_secret_/);
    assert.match(script, /service_role/);
    assert.match(script, /must be an https URL/);
  });
});

describe("_redirects", () => {
  test("serves the SPA shell as the final fallback, and only as the final rule", () => {
    const last = REDIRECTS[REDIRECTS.length - 1];
    assert.deepEqual([last.from, last.to, last.status], ["/*", "/index.html", 200]);
  });

  test("entry points keep their legacy targets", () => {
    assert.equal(findRule("/").to, "/foundation/auth/login.html");
    assert.equal(findRule("/").status, 302);
    assert.equal(findRule("/staff").to, "/staff/admin-portal");
    assert.equal(findRule("/auth").to, "/auth/login");
  });

  test("legacy static auth URLs point at the SPA auth routes", () => {
    assert.equal(findRule("/auth/login.html").to, "/auth/login");
    assert.equal(findRule("/auth/reset-password.html").to, "/auth/reset-password");
    assert.equal(findRule("/foundation/staff/login.html").to, "/foundation/auth/login.html");
  });

  test("every retired staff page has a .html rule and a pretty-URL rule", () => {
    const staffHtml = fs.readdirSync(path.join(ROOT, "foundation/staff")).filter((f) => f.endsWith(".html"));
    const kept = new Set(ALLOWLIST.staticEntries);
    const redirected = staffHtml.filter((f) => !kept.has(`foundation/staff/${f}`));
    assert.ok(redirected.length >= 37, `expected at least 37 redirected staff pages, found ${redirected.length}`);
    for (const f of redirected) {
      const base = `/foundation/staff/${f}`;
      const pretty = base.replace(/\.html$/, "");
      for (const from of [base, pretty]) {
        const rule = REDIRECTS.find((r) => r.from === from);
        assert.ok(rule, `no rule for ${from}`);
        assert.equal(rule.status, 302, `${from} must be a 302`);
        assert.ok(rule.force, `${from} must be forced (!)`);
      }
    }
  });

  test("repository paths answer 404, forced, never the SPA shell", () => {
    for (const from of [
      "/README.md", "/CLAUDE.md", "/package.json", "/netlify.toml", "/.env", "/.env.local",
      "/scripts/*", "/docs/*", "/foundation-spa/*", "/foundation/sql/*", "/foundation/archive/*",
      "/foundation/edge-functions/*", "/node_modules/*", "/.git/*", "/netlify-static-publish/*",
    ]) {
      const rule = findRule(from);
      assert.ok(rule, `no rule for ${from}`);
      assert.equal(rule.status, 404, from);
      assert.ok(rule.force, `${from} must be forced`);
    }
  });

  test("the /foundation/* catch-all sits after the specific rules", () => {
    const idx = REDIRECTS.findIndex((r) => r.from === "/foundation/*");
    const sensitive = REDIRECTS.findIndex((r) => r.from === "/README.md");
    assert.ok(idx > sensitive && idx > REDIRECTS.findIndex((r) => r.from === "/foundation/docs/*"));
    assert.equal(REDIRECTS[idx].status, 404);
  });

  test("does not rewrite /auth/* or /staff/* to static files (the SPA owns them)", () => {
    for (const r of REDIRECTS) {
      assert.ok(!(r.from.startsWith("/auth/") && r.status === 200), `unexpected rewrite ${r.from}`);
      assert.ok(!(r.from.startsWith("/staff/") && r.status === 200), `unexpected rewrite ${r.from}`);
    }
  });
});

describe("_headers", () => {
  const headers = read("_headers");

  test("keeps the noindex and no-store rules for legacy and repository paths", () => {
    for (const block of ["/supabase/*", "/ai/*", "/archive/*", "/foundation/docs/*", "/*.sql"]) {
      assert.ok(headers.split("\n").some((l) => l.trim() === block), `missing block ${block}`);
    }
    assert.match(headers, /X-Robots-Tag: noindex/);
  });

  test("keeps the /foundation/* security headers", () => {
    assert.match(headers, /\/foundation\/\*\n(?:  .*\n)*?\s+X-Frame-Options: DENY/);
    assert.match(headers, /Content-Security-Policy: default-src 'self'/);
  });

  test("keeps the site-wide nosniff header", () => {
    assert.match(headers, /\/\*\n\s+X-Content-Type-Options: nosniff/);
  });
});

describe("allowlist", () => {
  test("every approved static entry exists in the repository", () => {
    for (const rel of [...ALLOWLIST.staticEntries, ...ALLOWLIST.staticAssets]) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing ${rel}`);
    }
  });

  test("the eight legacy pages stay in the candidate", () => {
    for (const rel of [
      "foundation/staff/_template.html",
      "foundation/staff/shell.html",
      "foundation/staff/acceptance-tests.html",
      "foundation/teacher/sections/attendance.html",
      "foundation/teacher/sections/availability.html",
      "foundation/teacher/sections/my-class.html",
      "foundation/teacher/sections/teacher-home.html",
      "foundation/teacher/sections/teacher-messages.html",
    ]) {
      assert.ok(ALLOWLIST.staticEntries.includes(rel), `not retained: ${rel}`);
    }
  });

  test("no retirement is approved", () => {
    assert.deepEqual(ALLOWLIST.approvedRetirements, []);
  });

  test("the only known missing reference is the scaffold placeholder", () => {
    assert.deepEqual(ALLOWLIST.knownMissingReferences, ["foundation/js/your-page.js"]);
  });
});

// ---------------------------------------------------------------------------
// 2. Published output

describe("published output", { skip: SKIP_OUTPUT }, () => {
  const files = HAS_OUTPUT ? walk(OUT) : [];

  test("no repository source, SQL, environment, docs or archive files", () => {
    const bad = files.filter((f) =>
      ALLOWLIST.forbiddenFilePatterns.some((p) => new RegExp(p, "i").test(f)) ||
      /\.(map|sql|md|ts)$/i.test(f) ||
      /(^|\/)\.env/i.test(f)
    );
    assert.deepEqual(bad, []);
  });

  test("top level contains only the SPA output, _headers and foundation/", () => {
    const allowed = new Set([...fs.readdirSync(path.join(ROOT, ALLOWLIST.spaOutput)), "_headers", "foundation"]);
    const tops = new Set(files.map((f) => f.split("/")[0]));
    for (const t of tops) assert.ok(allowed.has(t), `unexpected ${t}`);
  });

  test("no privileged key material in any text file", () => {
    const text = files.filter((f) => /\.(html|m?js|css|json|svg|txt)$/i.test(f));
    for (const f of text) {
      const body = fs.readFileSync(path.join(OUT, f), "utf8");
      assert.doesNotMatch(body, /sb_secret_|service_role|-----BEGIN [A-Z ]*PRIVATE KEY-----/, f);
    }
  });

  test("generated config never enables the role bypass", () => {
    const cfg = fs.readFileSync(path.join(OUT, "foundation/js/config.js"), "utf8");
    assert.match(cfg, /BYPASS_ROLE: ""/);
  });

  test("no source maps are published", () => {
    assert.deepEqual(files.filter((f) => f.endsWith(".map")), []);
  });
});

// ---------------------------------------------------------------------------
// 3. Route behaviour through the Netlify emulator

describe("routes through the emulator", { skip: SKIP_OUTPUT }, () => {
  let server;
  let base;

  before(async () => {
    server = createEmulator(OUT);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  // Keep-alive sockets from fetch would otherwise keep close() waiting.
  after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });

  const get = (p) => fetch(base + p, { redirect: "manual" });

  const expectations = [
    // [path, status, location-or-content-type-prefix]
    ["/", 302, "/foundation/auth/login.html"],
    ["/staff", 302, "/staff/admin-portal"],
    ["/auth", 302, "/auth/login"],
    ["/auth/login.html", 302, "/auth/login"],
    ["/foundation/staff/login.html", 302, "/foundation/auth/login.html"],
    ["/foundation/staff/dashboards.html?x=1", 302, "/staff/dashboards?x=1"],
    ["/foundation/staff/dashboards", 302, "/staff/dashboards"],
    ["/foundation/staff/attendance", 302, "/staff/attendance"],
    ["/foundation/staff/clickup-management.html", 302, "/staff/nexus-management"],
    ["/foundation/staff/StudentProgressView.html", 302, "/staff/student-progress"],
    ["/README.md", 404],
    ["/CLAUDE.md", 404],
    ["/package.json", 404],
    ["/netlify.toml", 404],
    ["/.env", 404],
    ["/_headers", 404],
    ["/scripts/build-spa-publish.mjs", 404],
    ["/docs/deployment.md", 404],
    ["/foundation-spa/src/App.jsx", 404],
    ["/foundation/sql/x.sql", 404],
    ["/foundation/archive/x.html", 404],
    ["/foundation/teacher/sections/unknown.html", 404],
    ["/foundation/auth/login.html", 200, "text/html"],
    ["/foundation/auth/reset-password.html", 200, "text/html"],
    ["/foundation/auth/teacher-register.html", 200, "text/html"],
    ["/foundation/index.html", 200, "text/html"],
    ["/foundation/teacher/index.html", 200, "text/html"],
    ["/foundation/teacher/roster.html", 200, "text/html"],
    ["/foundation/registration/class-selection.html", 200, "text/html"],
    ["/foundation/registration/registration-form.html", 200, "text/html"],
    ["/foundation/registration/canada_sr.png", 200, "image/png"],
    ["/foundation/staff/TeacherAttendancePortal.html", 200, "text/html"],
    ["/foundation/staff/env-check.html", 200, "text/html"],
    ["/foundation/staff/_template.html", 200, "text/html"],
    ["/foundation/staff/shell.html", 200, "text/html"],
    ["/foundation/staff/acceptance-tests.html", 200, "text/html"],
    ["/foundation/teacher/sections/attendance.html", 200, "text/html"],
    ["/foundation/teacher/sections/availability.html", 200, "text/html"],
    ["/foundation/teacher/sections/my-class.html", 200, "text/html"],
    ["/foundation/teacher/sections/teacher-home.html", 200, "text/html"],
    ["/foundation/teacher/sections/teacher-messages.html", 200, "text/html"],
    ["/foundation/js/config.js", 200, "text/javascript"],
    ["/auth/login", 200, "text/html"],
    ["/auth/reset-password", 200, "text/html"],
    ["/staff/dashboards", 200, "text/html"],
    ["/teacher/index", 200, "text/html"],
  ];

  for (const [p, status, expected] of expectations) {
    test(`GET ${p} -> ${status}`, async () => {
      const res = await get(p);
      assert.equal(res.status, status, `${p} returned ${res.status}`);
      if (status === 302) assert.equal(new URL(res.headers.get("location"), base).pathname + new URL(res.headers.get("location"), base).search, expected);
      if (status === 200) assert.match(res.headers.get("content-type") || "", new RegExp(expected));
    });
  }

  test("the generated config keeps BYPASS_ROLE empty in the served file", async () => {
    const body = await (await get("/foundation/js/config.js")).text();
    assert.match(body, /BYPASS_ROLE: ""/);
  });

  // Both /foundation/* and /* set X-Frame-Options in _headers (DENY and SAMEORIGIN). How
  // Netlify merges duplicate headers is not asserted here. It is an open check on a Deploy Preview.
  test("the /foundation/* Content-Security-Policy is served", async () => {
    const res = await get("/foundation/auth/login.html");
    assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/);
  });

  test("the site-wide nosniff header is served on the SPA shell", async () => {
    const res = await get("/staff/dashboards");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });

  // Every local script, stylesheet, image and module referenced by a retained static page loads.
  // Asset tags only. Anchors are navigation and are checked by the build verifier.
  const LOCAL = /<(?:script|img|link|source|iframe)\b[^>]*?\s(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  const retained = ALLOWLIST.staticEntries.filter((f) => f.endsWith(".html"));
  for (const rel of retained) {
    test(`required assets load for /${rel}`, async () => {
      const page = await get(`/${rel}`);
      assert.equal(page.status, 200, `/${rel}`);
      const html = await page.text();
      const pageDir = path.posix.dirname(`/${rel}`);
      const refs = new Set();
      for (const m of html.matchAll(LOCAL)) {
        const ref = m[1];
        if (/^(https?:|data:|mailto:|tel:|javascript:|#)/i.test(ref) || ref.startsWith("//")) continue;
        const clean = ref.split(/[?#]/)[0];
        if (!clean) continue;
        refs.add(clean.startsWith("/") ? clean : path.posix.normalize(path.posix.join(pageDir, clean)));
      }
      const missing = [];
      for (const ref of refs) {
        const res = await get(ref);
        if (res.status !== 200) missing.push(`${ref} -> ${res.status}`);
      }
      const known = ALLOWLIST.knownMissingReferences.map((k) => `/${k}`);
      const real = missing.filter((m) => !known.includes(m.split(" -> ")[0]));
      assert.deepEqual(real, []);
    });
  }
});
