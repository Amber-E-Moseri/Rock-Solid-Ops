// Moodle workflow compatibility regression checks. Run: node --test tests/
// Static checks: the legacy staff page and the browser sources must not issue Moodle retry requests
// or carry service-role credentials. Behavioural checks for the SPA live in foundation-spa/src/tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (rel) => readFileSync(join(root, rel), "utf8");

// The button elements, found by id, with their full opening tags.
function openingTag(html, id) {
  const m = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
  assert.ok(m, `button #${id} not found`);
  return m[0];
}

test("legacy dashboards: both Moodle retry buttons are disabled and labelled unavailable", () => {
  const html = read("foundation/staff/dashboards.html");
  for (const id of ["retryFailedSyncsBtn", "retryFailedSyncsBtn2"]) {
    const tag = openingTag(html, id);
    assert.match(tag, /\sdisabled[\s>]/, `#${id} must be disabled`);
    assert.match(tag, /aria-disabled="true"/, `#${id} must expose aria-disabled`);
    assert.match(tag, /temporarily unavailable/, `#${id} must explain why`);
  }
  assert.match(html, />Moodle retry unavailable</);
});

test("legacy dashboards: no handler issues a moodle-sync or invoke-moodle-sync request", () => {
  const html = read("foundation/staff/dashboards.html");
  assert.doesNotMatch(html, /functions\/v1\/moodle-sync/);
  assert.doesNotMatch(html, /invoke-moodle-sync/);
  assert.doesNotMatch(html, /retryAllFailedSyncs/, "retry handler and its listeners must be removed");
});

test("legacy dashboards: other dashboard controls are preserved", () => {
  const html = read("foundation/staff/dashboards.html");
  assert.match(html, /id="exportStudentsBtn"/);
  assert.match(html, /id="moodleSyncHealthGrid"/);
  assert.match(html, /function loadMoodleSyncHealth|loadMoodleSyncHealth\(/);
});

test("legacy system-health: Moodle connectivity test uses the session token, not the anon key, as bearer", () => {
  const js = read("foundation/js/system-health.js");
  const start = js.indexOf('"moodle-api-test"');
  assert.ok(start > 0, "moodle connectivity block not found");
  const block = js.slice(start, start + 400);
  assert.match(block, /Authorization: `Bearer \$\{token\}`/);
  assert.doesNotMatch(block, /Bearer \$\{anonKey\}/);
  assert.match(block, /apikey: anonKey/);
  assert.match(js, /Admin sign-in required to test Moodle connectivity/);
});

test("SPA system-health: Moodle connectivity test uses the session token, not the anon key, as bearer", () => {
  const js = read("foundation-spa/src/features/system-health/lib/system-health.js");
  const start = js.indexOf("'moodle-api-test'");
  assert.ok(start > 0, "moodle connectivity block not found");
  const block = js.slice(start, start + 400);
  assert.match(block, /Authorization: `Bearer \$\{token\}`/);
  assert.doesNotMatch(block, /Bearer \$\{anonKey\}/);
  assert.match(block, /apikey: anonKey/);
  assert.match(js, /Admin sign-in required to test Moodle connectivity/);
});

test("SPA dashboard retry goes through retry-worker, not a direct moodle-sync request", () => {
  const js = read("foundation-spa/src/features/dashboards/lib/dashboard.js");
  assert.doesNotMatch(js, /functions\/v1\/moodle-sync/);
  assert.match(js, /functions\.invoke\('retry-worker'/);
  assert.match(js, /isMoodleRetryHeld\('retry', source, MOODLE_RETRY_CERTIFIED\)/);
});

// Walk browser sources (legacy and SPA), skipping tests and build output.
function browserFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (["node_modules", "dist", "tests", "__tests__"].includes(name)) continue;
      browserFiles(p, out);
    } else if (/\.(js|jsx|html|mjs)$/.test(name) && !/\.test\./.test(name)) {
      out.push(p);
    }
  }
  return out;
}

test("no service-role credential or cron secret appears in browser code", () => {
  const dirs = [join(root, "foundation"), join(root, "foundation-spa", "src")];
  const forbidden = /SUPABASE_SERVICE_ROLE|service_role|CRON_INVOKE_SECRET|x-cron-secret/;
  const hits = [];
  for (const dir of dirs) {
    for (const file of browserFiles(dir)) {
      if (forbidden.test(readFileSync(file, "utf8"))) hits.push(relative(root, file));
    }
  }
  assert.deepEqual(hits, [], `browser code must not carry service-role material: ${hits.join(", ")}`);
});
