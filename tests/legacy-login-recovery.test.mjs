// Regression tests: the legacy /foundation login must not send password-reset emails directly from the
// browser, and its normal sign-in and safe-next redirect must be unchanged.
// Run: node --test tests/legacy-login-recovery.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoPath = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const loginSrc = readFileSync(repoPath("foundation/auth/login.html"), "utf8");

function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "archive") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else if (/\.(html|js)$/.test(name)) out.push(full);
  }
  return out;
}

test("login.html does not call resetPasswordForEmail, so no reset email is sent from the legacy page", () => {
  assert.doesNotMatch(loginSrc, /\.resetPasswordForEmail\(/);
});

test("no legacy foundation page sends a reset email directly", () => {
  const offenders = listFiles(repoPath("foundation"))
    .filter((file) => /\.resetPasswordForEmail\(/.test(readFileSync(file, "utf8")))
    .map((file) => file.slice(fileURLToPath(new URL("../", import.meta.url)).length));
  assert.deepEqual(offenders, []);
});

test("the forgot-password link points to the protected SPA recovery page", () => {
  assert.match(loginSrc, /<a id="forgotPasswordBtn" href="\/app\/auth\/forgot-password">Forgot password\?<\/a>/);
});

test("normal sign-in is unchanged", () => {
  assert.match(loginSrc, /signInWithPassword\(/);
});

test("safe-next validation is still imported and applied to the post-login redirect", () => {
  assert.match(loginSrc, /import \{ safeNextPath \} from "\.\/safe-next\.js";/);
  assert.match(loginSrc, /return safeNextPath\(raw\) \|\| appPath\("staff\/admin-dashboard\.html"\);/);
  assert.match(loginSrc, /window\.location\.href = safeNext\(\);/);
});
