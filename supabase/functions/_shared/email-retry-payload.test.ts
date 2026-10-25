import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildEmailQueueRetryUpdate } from "./email-retry-payload.ts";

const NOW = "2026-10-25T10:00:00.000Z";

// Model of the email_queue columns the retry path names. last_error is not in it: the owner's staging
// schema check reported public.email_queue.last_error as missing. Like PostgREST, the fake rejects any
// UPDATE that names a column outside this set, so the whole write fails.
const STAGING_EMAIL_QUEUE_COLUMNS = new Set([
  "id",
  "recipient_email",
  "template_key",
  "subject",
  "status",
  "error_message",
  "retry_count",
  "last_retry_at",
  "created_at",
  "updated_at",
]);

function fakeEmailQueue(columns: Set<string>) {
  const writes: Record<string, unknown>[] = [];
  return {
    writes,
    from(_table: string) {
      return {
        update(payload: Record<string, unknown>) {
          return {
            eq(_column: string, _value: string) {
              const missing = Object.keys(payload).filter((key) => !columns.has(key));
              if (missing.length > 0) {
                return Promise.resolve({
                  error: { code: "PGRST204", message: `Could not find the '${missing[0]}' column of 'email_queue'` },
                });
              }
              writes.push(payload);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

// ── The retry payload is accepted by the staging schema ─────────────────────────────────────────

Deno.test("the retry payload names no last_error column", () => {
  const payload = buildEmailQueueRetryUpdate({ status: "FAILED", retry_count: 0 }, NOW);
  assertEquals(Object.keys(payload).sort(), ["error_message", "last_retry_at", "retry_count", "status", "updated_at"]);
  assertEquals("last_error" in payload, false);
});

Deno.test("the retry UPDATE succeeds against a schema without last_error", async () => {
  const db = fakeEmailQueue(STAGING_EMAIL_QUEUE_COLUMNS);
  const payload = buildEmailQueueRetryUpdate({ status: "FAILED", retry_count: 1 }, NOW);
  const { error } = await db.from("email_queue").update(payload).eq("id", "row-1");
  assertEquals(error, null);
  assertEquals(db.writes.length, 1);
});

Deno.test("control: a payload that names last_error is rejected by the same schema", async () => {
  const db = fakeEmailQueue(STAGING_EMAIL_QUEUE_COLUMNS);
  const legacyPayload = { ...buildEmailQueueRetryUpdate({ status: "FAILED", retry_count: 1 }, NOW), last_error: null };
  const { error } = await db.from("email_queue").update(legacyPayload).eq("id", "row-1");
  assert(error, "the old payload must fail, otherwise the schema model does not test the bug");
  assertStringIncludes(String(error.message), "last_error");
  assertEquals(db.writes.length, 0);
});

// ── Retry state: status, error cleared, counters and timestamps ─────────────────────────────────

Deno.test("a retry moves the row to Pending and clears error_message", () => {
  const payload = buildEmailQueueRetryUpdate({ status: "Failed", retry_count: 2 }, NOW);
  assertEquals(payload.status, "Pending");
  assertEquals(payload.error_message, null);
});

for (const [name, retryCount, expected] of [
  ["an absent count starts at 1", undefined, 1],
  ["a null count starts at 1", null, 1],
  ["a zero count becomes 1", 0, 1],
  ["a numeric string is incremented, not concatenated", "2", 3],
  ["an existing count is incremented by exactly one", 7, 8],
] as const) {
  Deno.test(`retry_count: ${name}`, () => {
    const payload = buildEmailQueueRetryUpdate({ status: "FAILED", retry_count: retryCount }, NOW);
    assertEquals(payload.retry_count, expected);
  });
}

Deno.test("last_retry_at and updated_at are both set to the retry time", () => {
  const payload = buildEmailQueueRetryUpdate({ status: "FAILED", retry_count: 0 }, NOW);
  assertEquals(payload.last_retry_at, NOW);
  assertEquals(payload.updated_at, NOW);
});

// ── Source contract: index.ts reads, guards and writes email_queue through the helper ───────────

const indexSrc = await Deno.readTextFile(new URL("../retry-worker/index.ts", import.meta.url));

function section(startNeedle: string, endNeedle: string): string {
  const start = indexSrc.indexOf(startNeedle);
  if (start < 0) throw new Error(`missing in index.ts: ${startNeedle}`);
  const end = indexSrc.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) throw new Error(`missing in index.ts: ${endNeedle}`);
  return indexSrc.slice(start, end);
}

// applyRetry and applyResolve each handle email_queue first, before scheduled_notifications.
const applyRetryEmail = section("async function applyRetry(", 'if (source === "scheduled_notifications") {');
const applyResolveEmail = section("async function applyResolve(", 'if (source === "scheduled_notifications") {');

Deno.test("index.ts imports the email retry payload helper", () => {
  assertStringIncludes(indexSrc, 'import { buildEmailQueueRetryUpdate } from "../_shared/email-retry-payload.ts";');
});

Deno.test("the email_queue retry block writes through the helper and names no last_error", () => {
  assertStringIncludes(applyRetryEmail, ".update(buildEmailQueueRetryUpdate(row, now))");
  assertEquals(/last_error/.test(applyRetryEmail), false);
});

Deno.test("the email_queue retry read selects only columns the retry needs", () => {
  assertStringIncludes(applyRetryEmail, '.select("id,status,retry_count")');
  assertEquals(/last_error/.test(applyRetryEmail), false);
});

Deno.test("a failed read or a missing row fails the retry instead of writing", () => {
  assertStringIncludes(applyRetryEmail, "if (readErr) throw readErr;");
  assertStringIncludes(applyRetryEmail, 'if (!row) throw new Error("Row not found in email_queue");');
});

Deno.test("a row in a non-retryable status fails the retry before any write", () => {
  const guard = applyRetryEmail.indexOf("is not retryable");
  const write = applyRetryEmail.indexOf(".update(");
  assert(guard > 0 && write > guard, "the status guard must precede the UPDATE");
});

Deno.test("the email_queue resolve block names no last_error", () => {
  assertEquals(/last_error/.test(applyResolveEmail), false);
});
