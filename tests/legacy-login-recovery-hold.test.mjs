// Legacy login password reset is held: the page must not send an Auth reset request. Sign-in is unchanged.
// Run: node --test tests/legacy-login-recovery-hold.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../foundation/auth/login.html", import.meta.url), "utf8");

test("legacy login page never calls resetPasswordForEmail", () => {
  assert.equal(html.includes("resetPasswordForEmail"), false);
});

test("legacy password reset hold is set to true", () => {
  assert.match(html, /const LEGACY_PASSWORD_RESET_HOLD = true;/);
});

test("reset click handler returns while held, before any Auth call", () => {
  const handler = html.match(/forgotPasswordBtn\.addEventListener\("click", \(e\) => \{([\s\S]*?)\n {4}\}\);/);
  assert.ok(handler, "reset click handler found");
  const body = handler[1];
  assert.match(body, /if \(LEGACY_PASSWORD_RESET_HOLD\) \{[\s\S]*?return;\s*\}/);
  assert.equal(/supabase\.auth/.test(body), false, "handler body makes no Auth call");
});

test("sign-in path is unchanged: password sign-in and safe-next redirect remain wired", () => {
  assert.match(html, /supabase\.auth\.signInWithPassword\(\{ email, password \}\)/);
  assert.match(html, /window\.location\.href = safeNext\(\);/);
  assert.match(html, /import \{ safeNextPath \} from "\.\/safe-next\.js";/);
});
