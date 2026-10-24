// moodle-sync policy: staff roles, selectable rows (SYNCED and PROCESSING excluded), and the configured
// Moodle URL used in credential emails. Dependency-free assertions so these run offline as well as in CI.
import {
  isSelectableSyncRow,
  MOODLE_SYNC_STAFF_ROLES,
  moodleSiteUrl,
  SELECTABLE_SYNC_STATUSES,
} from "./auth-policy.ts";

function assertEq<T>(actual: T, expected: T, message = "") {
  if (actual !== expected) {
    throw new Error(`${message} expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }
}

Deno.test("manual moodle-sync roles are exactly admin and superadmin", () => {
  assertEq(JSON.stringify([...MOODLE_SYNC_STAFF_ROLES]), JSON.stringify(["admin", "superadmin"]), "roles");
});

Deno.test("selectable statuses exclude SYNCED, PROCESSING, SKIPPED and PERMANENTLY_FAILED", () => {
  assertEq(
    JSON.stringify([...SELECTABLE_SYNC_STATUSES]),
    JSON.stringify(["PENDING", "RETRYING", "FAILED"]),
    "selectable statuses",
  );
});

Deno.test("selects only ASSIGNED rows in a selectable status", () => {
  assertEq(isSelectableSyncRow({ sync_status: "PENDING", registration_status: "ASSIGNED" }), true, "pending");
  assertEq(isSelectableSyncRow({ sync_status: "RETRYING", registration_status: "ASSIGNED" }), true, "retrying");
  assertEq(isSelectableSyncRow({ sync_status: "failed", registration_status: "assigned" }), true, "case-insensitive");
  assertEq(isSelectableSyncRow({ sync_status: "PENDING", registration_status: "WAITLISTED" }), false, "waitlisted");
  assertEq(isSelectableSyncRow({ sync_status: "PENDING" }), false, "missing registration status");
  assertEq(isSelectableSyncRow(null), false, "null row");
  assertEq(isSelectableSyncRow(undefined), false, "undefined row");
});

// Regression: a forced id must never select an already-synchronized row. Selecting it would reach
// core_user_update_users and reset that student's Moodle password, then send new credentials.
Deno.test("regression: an already-SYNCED row is never selectable, even with an id", () => {
  assertEq(isSelectableSyncRow({ sync_status: "SYNCED", registration_status: "ASSIGNED" }), false, "synced");
});

Deno.test("regression: a row already claimed for processing is not selectable a second time", () => {
  // A row is claimed by moving PENDING to PROCESSING. A repeated request finds PROCESSING and skips it.
  const row = { sync_status: "PENDING", registration_status: "ASSIGNED" };
  assertEq(isSelectableSyncRow(row), true, "first request selects the row");
  const afterClaim = { ...row, sync_status: "PROCESSING" };
  assertEq(isSelectableSyncRow(afterClaim), false, "repeated request must skip the claimed row");
});

Deno.test("permanently failed rows are not selectable", () => {
  assertEq(
    isSelectableSyncRow({ sync_status: "PERMANENTLY_FAILED", registration_status: "ASSIGNED" }),
    false,
    "permanently failed",
  );
});

Deno.test("credential email URL comes from the configured base and keeps the trailing slash", () => {
  assertEq(moodleSiteUrl("https://moodle.example.test"), "https://moodle.example.test/", "no slash");
  assertEq(moodleSiteUrl("https://moodle.example.test/"), "https://moodle.example.test/", "one slash");
  assertEq(moodleSiteUrl("  https://moodle.example.test///  "), "https://moodle.example.test/", "many slashes");
  assertEq(moodleSiteUrl(""), "", "empty configuration yields no URL");
});

Deno.test("credential email URL is never the hardcoded production host", () => {
  const url = moodleSiteUrl("https://staging-moodle.example.test");
  assertEq(url.includes("rocksolid.lwcanada.org"), false, "must not contain the production host");
  assertEq(url, "https://staging-moodle.example.test/", "derived from configuration");
});
