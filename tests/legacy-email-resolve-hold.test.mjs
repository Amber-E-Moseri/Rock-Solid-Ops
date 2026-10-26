// Legacy /foundation pages: email_queue Resolve is held. Retry is unaffected. Static checks on the request paths.
// Run: node --test tests/legacy-email-resolve-hold.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("admin-api refuses email_queue Resolve before any request", () => {
  const src = read("foundation/js/admin-api.js");
  const start = src.indexOf("async invokeRetryWorker(client, payload)");
  assert.ok(start > 0, "invokeRetryWorker found");
  const block = src.slice(start, src.indexOf("const { data, error }", start));
  assert.match(block, /payload\?\.action[\s\S]*"resolve"/);
  assert.match(block, /payload\?\.source[\s\S]*"email_queue"/);
  assert.match(block, /throw new Error\("Email Resolve is on hold/);
});

test("notification-center refuses email_queue Resolve in its local invoker", () => {
  const src = read("foundation/js/notification-center.js");
  const start = src.indexOf("const invokeRetryWorker = async (action, source, id) => {");
  assert.ok(start > 0, "local invokeRetryWorker found");
  const block = src.slice(start, src.indexOf("supabase.functions.invoke", start));
  assert.match(block, /"resolve"[\s\S]*"email_queue"/);
  assert.match(block, /throw new Error\("Email Resolve is on hold/);
});

test("notification-center bulk Resolve skips email rows and keeps the others", () => {
  const src = read("foundation/js/notification-center.js");
  assert.match(src, /action === "resolve" \? rows\.filter\(\(r\) => r\.source !== "email_queue"\) : rows/);
  assert.match(src, /for \(const row of runnable\) await invokeRetryWorker/);
});

test("failed-sync bulk Resolve skips email rows and keeps the others", () => {
  const src = read("foundation/js/failed-sync-retry-center.js");
  assert.match(src, /bulk: async \(action, rows\) => \{ const runnable = action === "resolve" \? rows\.filter\(\(r\) => r\.source !== "email_queue"\) : rows;/);
});

test("the shared legacy table renders no Resolve control for email rows", () => {
  const src = read("foundation/js/retry-table-module.js");
  assert.match(src, /\$\{r\.source === "email_queue" \? "" : `<button class="btn btn-xs" data-act="resolve"/);
});

test("legacy Retry for email_queue is not blocked by the hold", () => {
  const admin = read("foundation/js/admin-api.js");
  assert.doesNotMatch(admin.slice(admin.indexOf("async invokeRetryWorker(client, payload)"), admin.indexOf("const { data, error }", admin.indexOf("async invokeRetryWorker(client, payload)"))), /"retry"[\s\S]*throw/);
});
