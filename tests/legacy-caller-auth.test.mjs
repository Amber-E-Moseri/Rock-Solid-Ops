// Legacy /foundation callers of the authorization-enforced functions must send the signed-in session token,
// never the anon key. Static checks on the request blocks.
// Run: node --test tests/legacy-caller-auth.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("legacy waitlist run-check sends the session token, not the anon key", () => {
  const src = read("foundation/staff/waitlist.html");
  const start = src.indexOf('$("runCheckBtn").addEventListener("click"');
  const end = src.indexOf('$("studentsTableBody").addEventListener');
  assert.ok(start > 0 && end > start, "run-check handler block found");
  const block = src.slice(start, end);
  assert.equal(block.includes("ANON_KEY"), false, "run-check block must not use the anon key");
  assert.match(block, /supabase\.auth\.getSession\(\)/);
  assert.match(block, /"Authorization": `Bearer \$\{token\}`/);
  assert.match(block, /if \(!token\)/, "a missing session stops the call before any request");
});

test("legacy system-health Moodle check sends the session token, not the anon key", () => {
  const src = read("foundation/js/system-health.js");
  const start = src.indexOf("// Moodle API live connectivity check");
  const end = src.indexOf("const moodleData = await", start);
  assert.ok(start > 0 && end > start, "Moodle connectivity block found");
  const block = src.slice(start, end);
  assert.equal(/Authorization:\s*`Bearer \$\{anonKey\}`/.test(block), false, "no anon-key bearer");
  assert.match(block, /supabase\.auth\.getSession\(\)/);
  assert.match(block, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(block, /apikey:\s*anonKey/, "project key still identifies the project");
});
