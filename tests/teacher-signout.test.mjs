// Regression: the teacher portal must expose a visible Sign Out control that
// calls the existing logout() function (which signs out via Supabase Auth).
// Run: node --test tests/teacher-signout.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const teacherHtml = read("foundation/teacher/index.html");
const logoutJs = read("foundation/auth/logout.js");

test("teacher portal renders a visible Sign Out button in the header", () => {
  const header = teacherHtml.slice(teacherHtml.indexOf('class="tnav"'), teacherHtml.indexOf('id="ttabs"'));
  assert.match(header, /<button[^>]*id="signOutBtn"[^>]*>\s*Sign out\s*<\/button>/);
  assert.doesNotMatch(header, /id="signOutBtn"[^>]*hidden/, "button must not be hidden");
});

test("Sign Out button is wired to the existing logout() function", () => {
  assert.match(teacherHtml, /import \{ logout \} from "\.\.\/auth\/logout\.js";/);
  assert.match(teacherHtml, /\$\("signOutBtn"\)\.addEventListener\("click", \(\) => logout\(\)\);/);
});

test("logout() signs out via Supabase Auth and redirects to login", () => {
  assert.match(logoutJs, /export async function logout\(\)/);
  assert.match(logoutJs, /await supabase\.auth\.signOut\(\);/);
  assert.match(logoutJs, /resolveAppPath\("auth\/login\.html"\)\}\?next=/);
});

test("teacher portal does not reintroduce a second logout implementation", () => {
  assert.doesNotMatch(teacherHtml, /auth\.signOut\(/, "use logout() instead of calling signOut directly");
});

test("mobile header keeps the Sign Out control reachable (touch target and wrapping)", () => {
  const mobileRules = teacherHtml.slice(teacherHtml.indexOf("@media (max-width: 640px)"));
  assert.ok(mobileRules.includes(".tnav-top { flex-wrap: wrap; }"), "header must wrap on narrow screens");
  assert.ok(mobileRules.includes(".tnav-r .minibtn { padding: 8px 10px; min-height: 40px; }"), "Sign Out needs a 40px touch target");
});
