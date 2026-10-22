// Netlify publish, redirect, header and route regression tests for the /app/ preview.
// Run after a build (see docs/SPA_CUTOVER_CANDIDATE.md):
//   node --test tests/netlify-publish.test.mjs
// 1. Repository tests always run.
// 2. Output and emulator tests need netlify-static-publish/ and are skipped otherwise.
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
const HAS_OUTPUT = fs.existsSync(path.join(OUT, "app", "index.html"));
const SKIP_OUTPUT = HAS_OUTPUT ? false : "netlify-static-publish/ missing: run the two build steps first";
const ROOT_REDIRECTS = parseRedirects(read("_redirects"));
const find = (from) => ROOT_REDIRECTS.find((r) => r.from === from);
// Known pre-existing gap: staff/_template.html loads a placeholder script that 404s on production too.
// /foundation/images/canada_sr.png is referenced by staff/help-guide.html; the file lives at
// foundation/registration/canada_sr.png. Also already 404 on production (to confirm on a Deploy Preview).
const KNOWN_MISSING = new Set(["/foundation/js/your-page.js", "/foundation/images/canada_sr.png"]);

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base, out);
    else out.push(path.relative(base, abs).split(path.sep).join("/"));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Repository configuration

describe("netlify.toml", () => {
  const toml = read("netlify.toml");

  test("publishes the allowlisted directory, never the repository root", () => {
    assert.match(toml, /^\s*publish = "netlify-static-publish"\s*$/m);
    assert.doesNotMatch(toml, /publish = "\."/);
  });

  test("runs the origin/main baseline first, then the SPA layer", () => {
    const cmd = toml.match(/command = "([^"]+)"/)[1];
    assert.ok(cmd.indexOf("build-static-publish.mjs") < cmd.indexOf("build-spa-publish.mjs"), cmd);
  });

  test("has no [[redirects]]: redirects live only in the root _redirects", () => {
    assert.doesNotMatch(toml, /\[\[redirects\]\]/);
  });
});

describe("baseline and guard parity", () => {
  const baseline = read("scripts/build-static-publish.mjs");
  const spa = read("scripts/build-spa-publish.mjs");
  // Regex literal lines of the baseline guard lists.
  const literals = baseline
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\/.+\/[a-z]*[,;]?$/.test(l))
    .map((l) => l.replace(/[,;]$/, ""));

  test("baseline guard lists were found", () => {
    assert.ok(literals.length >= 20, `found ${literals.length} literals`);
  });

  test("every baseline guard literal is kept verbatim in the SPA layer", () => {
    for (const lit of literals) assert.ok(spa.includes(lit), `missing guard: ${lit}`);
  });

  test("the allowlist covers the baseline file-name guards", () => {
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

describe("root _redirects: production rules are unchanged", () => {
  // Copied from netlify.toml on origin/main (53a961c). Each must appear here with the same
  // target, status and force flag.
  const PRODUCTION = [
    ["/", "/foundation/auth/login.html", 302, true],
    ["/staff", "/foundation/staff/admin-portal.html", 302, true],
    ["/auth", "/foundation/auth/login.html", 302, true],
    ["/staff/*", "/foundation/staff/:splat", 200, false],
    ["/auth/*", "/foundation/auth/:splat", 200, false],
    ["/supabase/*", "/foundation/auth/login.html", 302, true],
    ["/ai/*", "/foundation/auth/login.html", 302, true],
    ["/archive/*", "/foundation/auth/login.html", 302, true],
    ["/foundation/docs/*", "/foundation/auth/login.html", 302, true],
  ];

  for (const [from, to, status, force] of PRODUCTION) {
    test(`${from} -> ${to} (${status}${force ? "!" : ""})`, () => {
      const rule = find(from);
      assert.ok(rule, `missing ${from}`);
      assert.equal(rule.to, to);
      assert.equal(rule.status, status);
      assert.equal(rule.force, force);
    });
  }

  test("no staff page is redirected: /foundation/staff/*.html stays static", () => {
    assert.deepEqual(
      ROOT_REDIRECTS.filter((r) => r.from.startsWith("/foundation/staff/")),
      []
    );
  });

  test("no root SPA catch-all: /* is not rewritten to the SPA", () => {
    assert.equal(find("/*"), undefined);
  });

  test("the SPA is served only under /app/", () => {
    assert.equal(find("/app").to, "/app/index.html");
    assert.equal(find("/app/*").to, "/app/index.html");
    assert.equal(find("/app/*").status, 200);
  });
});

describe("SPA base path and service worker", () => {
  const vite = read("foundation-spa/vite.config.js");
  const sw = read("foundation-spa/src/sw.js");
  const main = read("foundation-spa/src/main.jsx");

  test("Vite builds under /app/ and the manifest is scoped to /app/", () => {
    assert.match(vite, /base: '\/app\/'/);
    assert.match(vite, /start_url: '\/app\/'/);
    assert.match(vite, /scope: '\/app\/'/);
    assert.match(vite, /src: '\/app\/pwa-icon\.svg'/);
  });

  test("the router uses the Vite base as its basename", () => {
    assert.match(main, /basename=\{import\.meta\.env\.BASE_URL\.replace\(\/\\\/\$\/, ''\)\}/);
  });

  test("the service worker resolves shell and notification URLs from its scope", () => {
    assert.doesNotMatch(sw, /caches\.match\('\/index\.html'/);
    assert.doesNotMatch(sw, /caches\.match\('\/'\)/);
    assert.match(sw, /self\.registration\.scope/);
  });

  test("reset-password redirectTo follows the Vite base", () => {
    const login = read("foundation-spa/src/features/auth/LoginPage.jsx");
    assert.match(login, /\$\{import\.meta\.env\.BASE_URL\}auth\/reset-password/);
  });
});

describe("allowlist", () => {
  test("the SPA base in the allowlist matches the Vite base", () => {
    assert.equal(ALLOWLIST.spaBase, "/app/");
    assert.match(read("foundation-spa/vite.config.js"), /base: '\/app\/'/);
  });

  test("the external contract names only published static pages", () => {
    for (const url of ALLOWLIST.externalContract) assert.ok(url.startsWith("/foundation/"), url);
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

  test("top level is exactly foundation/, app/, _headers and _redirects", () => {
    const tops = [...new Set(files.map((f) => f.split("/")[0]))].sort();
    assert.deepEqual(tops, ["_headers", "_redirects", "app", "foundation"]);
  });

  test("every repository static page is published (none omitted)", () => {
    const published = new Set(files);
    const repo = [];
    const walkRepo = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (!["archive", "docs", "sql", "edge-functions", "node_modules"].includes(e.name)) walkRepo(path.join(dir, e.name));
        } else if (e.name.endsWith(".html")) {
          repo.push(path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join("/"));
        }
      }
    };
    walkRepo(path.join(ROOT, "foundation"));
    assert.ok(repo.length >= 58, `found ${repo.length} repository pages`);
    assert.deepEqual(repo.filter((p) => !published.has(p)), []);
  });

  test("no privileged key material in any text file", () => {
    for (const f of files.filter((x) => /\.(html|m?js|css|json|svg|txt|webmanifest)$/i.test(x))) {
      const body = fs.readFileSync(path.join(OUT, f), "utf8");
      assert.doesNotMatch(body, /sb_secret_|service_role|-----BEGIN [A-Z ]*PRIVATE KEY-----/, f);
    }
  });

  test("generated config keeps BYPASS_ROLE empty", () => {
    assert.match(fs.readFileSync(path.join(OUT, "foundation/js/config.js"), "utf8"), /BYPASS_ROLE: ""/);
  });

  test("no source maps are published", () => {
    assert.deepEqual(files.filter((f) => f.endsWith(".map")), []);
  });

  test("the SPA entry references its assets under /app/", () => {
    const html = fs.readFileSync(path.join(OUT, "app/index.html"), "utf8");
    assert.match(html, /\/app\/assets\//);
    assert.doesNotMatch(html, /(src|href)="\/assets\//);
  });

  test("the SPA registers its service worker with the /app/ scope", () => {
    const register = fs.readFileSync(path.join(OUT, "app/registerSW.js"), "utf8");
    assert.match(register, /\/app\/sw\.js/);
    assert.match(register, /scope:\s*["']\/app\/["']/);
  });
});

// ---------------------------------------------------------------------------
// 3. Routes through the Netlify emulator

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

  // [path, status, expected]. A 302 expects the Location path+query; a 200 expects a content-type prefix.
  const expectations = [
    // production behaviour
    ["/", 302, "/foundation/auth/login.html"],
    ["/staff", 302, "/foundation/staff/admin-portal.html"],
    ["/auth", 302, "/foundation/auth/login.html"],
    ["/supabase/anything", 302, "/foundation/auth/login.html"],
    ["/foundation/docs/x", 302, "/foundation/auth/login.html"],
    ["/staff/dashboards", 200, "text/html"],
    ["/foundation/staff/dashboards.html?x=1", 200, "text/html"],
    ["/foundation/staff/attendance.html", 200, "text/html"],
    ["/foundation/staff/clickup-management.html", 200, "text/html"],
    ["/foundation/staff/StudentProgressView.html", 200, "text/html"],
    ["/foundation/auth/login.html", 200, "text/html"],
    ["/foundation/auth/reset-password.html", 200, "text/html"],
    ["/foundation/auth/teacher-register.html", 200, "text/html"],
    ["/foundation/teacher/index.html", 200, "text/html"],
    ["/foundation/registration/class-selection.html", 200, "text/html"],
    ["/foundation/registration/registration-form.html", 200, "text/html"],
    ["/foundation/registration/canada_sr.png", 200, "image/png"],
    ["/foundation/staff/TeacherAttendancePortal.html", 200, "text/html"],
    ["/foundation/staff/env-check.html", 200, "text/html"],
    ["/foundation/staff/_template.html", 200, "text/html"],
    ["/foundation/staff/shell.html", 200, "text/html"],
    ["/foundation/staff/acceptance-tests.html", 200, "text/html"],
    ["/foundation/teacher/sections/attendance.html", 200, "text/html"],
    ["/foundation/teacher/sections/my-class.html", 200, "text/html"],
    ["/foundation/js/config.js", 200, "text/javascript"],
    // SPA under /app/
    ["/app", 200, "text/html"],
    ["/app/", 200, "text/html"],
    ["/app/auth/login", 200, "text/html"],
    ["/app/auth/reset-password", 200, "text/html"],
    ["/app/staff/dashboards", 200, "text/html"],
    ["/app/teacher/index", 200, "text/html"],
    ["/app/sw.js", 200, "text/javascript"],
    ["/app/manifest.webmanifest", 200, "application/manifest"],
    // Sensitive and unlisted paths
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
    ["/unknown-root-path", 404],
  ];

  for (const [p, status, expected] of expectations) {
    test(`GET ${p} -> ${status}`, async () => {
      const res = await get(p);
      assert.equal(res.status, status, `${p} returned ${res.status}`);
      if (status === 302) {
        const loc = new URL(res.headers.get("location"), base);
        assert.equal(loc.pathname + loc.search, expected);
      }
      if (status === 200) assert.match(res.headers.get("content-type") || "", new RegExp(expected));
    });
  }

  test("GET /staff/dashboards serves the static page, not the SPA", async () => {
    const body = await (await get("/staff/dashboards")).text();
    assert.doesNotMatch(body, /\/app\/assets\//);
  });

  test("the SPA entry's assets load under /app/", async () => {
    const html = await (await get("/app/")).text();
    const refs = [...html.matchAll(/(?:src|href)="(\/app\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length > 0, "no /app/ asset references found");
    for (const ref of refs) {
      const res = await get(ref);
      assert.equal(res.status, 200, ref);
    }
  });

  test("the /foundation/* Content-Security-Policy is served on static pages", async () => {
    const res = await get("/foundation/auth/login.html");
    assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/);
  });

  test("the site-wide nosniff header is served on the SPA", async () => {
    const res = await get("/app/auth/login");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });

  // Every static page in the repository loads its local scripts, styles, images and modules.
  // Known gaps (KNOWN_MISSING) are the only exceptions. Checked against the production set.
  const repoPages = [];
  const walkRepo = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!["archive", "docs", "sql", "edge-functions", "node_modules"].includes(e.name)) walkRepo(path.join(dir, e.name));
      } else if (e.name.endsWith(".html")) {
        repoPages.push(path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join("/"));
      }
    }
  };
  walkRepo(path.join(ROOT, "foundation"));
  const LOCAL = /<(?:script|img|link|source|iframe)\b[^>]*?\s(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  for (const rel of repoPages) {
    test(`assets load for /${rel}`, async () => {
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
      const failed = [];
      for (const ref of refs) {
        if (KNOWN_MISSING.has(ref)) continue;
        const res = await get(ref);
        if (res.status !== 200) failed.push(`${ref} -> ${res.status}`);
      }
      assert.deepEqual(failed, []);
    });
  }
});
