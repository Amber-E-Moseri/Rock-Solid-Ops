// Regression tests for the PR #41 / PR #47 reconciliation. Each assertion pins a conflict resolution that kept the
// candidate's established behaviour. A change that restores the PR #41 side must come with separate owner approval.
// Run: node --test tests/reconciliation-holds.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

test("release holds are all still in force (none removed by the PR #41 side)", () => {
  const holds = read("foundation-spa/src/releaseHolds.js");
  for (const flag of ["APPROVAL_CERTIFIED", "MOODLE_RETRY_CERTIFIED", "ATTENDANCE_SUBMIT_CERTIFIED", "TEACHER_ONBOARDING_CERTIFIED"]) {
    assert.match(holds, new RegExp(`export const ${flag} = false;`), `${flag} must stay false`);
  }
  assert.match(holds, /export const EMAIL_QUEUE_RESOLVE_HELD = true;/);
  assert.match(holds, /export function isEmailResolveHeld\(/);
});

test("email_queue Resolve hold is enforced in both retry paths", () => {
  for (const rel of [
    "foundation-spa/src/features/failed-sync-retry-center/lib/failed-syncs.js",
    "foundation-spa/src/features/notification-center/lib/notifications.js",
  ]) {
    const src = read(rel);
    assert.match(src, /isEmailResolveHeld\(action, source\)/, `${rel} must call isEmailResolveHeld`);
  }
});

test("server retry-worker keeps the email Resolve refusal and the audited Moodle hold", () => {
  const src = read("supabase/functions/retry-worker/index.ts");
  assert.match(src, /planResolve\(action, source\) === "refuse_held"/);
  assert.match(src, /"MOODLE_RETRY_HELD"/, "held Moodle retries must be audited");
  assert.match(src, /planDirectRetry\(action, source\) === "refuse_held"/);
});

test("manual retry and resolve stay limited to admin and superadmin (PR #41 widening not adopted)", () => {
  const src = read("supabase/functions/_shared/retry-admin-lookup.ts");
  assert.match(src, /RETRY_ADMIN_ROLES: readonly string\[\] = Object\.freeze\(\["admin", "superadmin"\]\)/);
  for (const role of ["subgroup_admin", "pastor", "principal"]) {
    assert.equal(src.includes(`"${role}"`), false, `${role} must not be a retry role`);
  }
});

test("retry-worker stays verify_jwt = true until the scheduler contract is certified", () => {
  const cfg = read("supabase/config.toml");
  const block = cfg.split("[functions.retry-worker]")[1].split("[functions.")[0];
  assert.match(block, /verify_jwt = true/);
});

test("legacy notification select does not read email_queue.last_error (commit 35a7ba4 kept)", () => {
  const src = read("foundation-spa/src/features/notification-center/lib/notifications.js");
  const selectLine = src.split("\n").find((line) => line.includes("selectSafe('email_queue'"));
  assert.ok(selectLine, "email_queue select found");
  assert.equal(selectLine.includes("last_error"), false);
});
