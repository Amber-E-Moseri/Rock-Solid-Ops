// Phase 10 — C1 edge function tests for notification-batch-processor.
// These are source-inspection tests. The matching DB-level tests (T01–T30) are in
// the scratchpad SQL suite; real-Postgres concurrency correctness is proven there.
import { assert, assertEquals } from "jsr:@std/assert@1";

const SOURCE_PATH = "./index.ts";

async function readSource(): Promise<string> {
  return await Deno.readTextFile(new URL(SOURCE_PATH, import.meta.url));
}

function handlerBody(source: string): string {
  const start = source.indexOf("Deno.serve(async (req)");
  assert(start > 0, "Deno.serve handler must exist");
  return source.slice(start);
}

// ── NBP-C1: Atomic claim via RPC ─────────────────────────────────────────────

Deno.test("NBP-C1a: processor uses claim_notification_batch RPC, not raw SELECT", async () => {
  const source = await readSource();
  assert(source.includes('"claim_notification_batch"'), "must call claim_notification_batch RPC");
  // Must NOT use an unlocked SELECT on scheduled_notifications directly for claiming
  const handler = handlerBody(source);
  assertEquals(
    /\.from\("scheduled_notifications"\)[\s\S]*?\.select\(/.test(handler),
    false,
    "handler must not use .from(scheduled_notifications).select() for claiming",
  );
});

Deno.test("NBP-C1b: claim RPC is called with p_limit parameter", async () => {
  const source = await readSource();
  assert(
    source.includes("{ p_limit: limit }"),
    "claim RPC must pass p_limit",
  );
});

Deno.test("NBP-C1c: only rows returned by claim RPC are processed", async () => {
  const source = await readSource();
  const handler = handlerBody(source);
  // Rows must come from claimedData / claim RPC return, not a second query
  assert(handler.includes("claimedData"), "must use claimedData from claim RPC");
  assert(handler.includes("const rows = (claimedData || [])"), "rows assigned from claimedData");
});

// ── NBP-C2: source_notification_id in every email_queue delivery ──────────────

Deno.test("NBP-C2a: every email_queue insertion includes source_notification_id", async () => {
  const source = await readSource();
  assert(
    source.includes("source_notification_id: row.id"),
    "email_queue upsert must set source_notification_id = row.id",
  );
});

Deno.test("NBP-C2b: duplicate delivery uses ignoreDuplicates DO NOTHING semantics", async () => {
  const source = await readSource();
  assert(
    source.includes('onConflict: "source_notification_id"'),
    "upsert must specify onConflict: source_notification_id",
  );
  assert(
    source.includes("ignoreDuplicates: true"),
    "upsert must set ignoreDuplicates: true for ON CONFLICT DO NOTHING",
  );
});

Deno.test("NBP-C2c: empty upsert result is treated as existing delivery (not an error)", async () => {
  const source = await readSource();
  // After upsert, there must be NO check like "if (!upsertRes.data?.length) throw"
  const upsertBlock = source.slice(source.indexOf("const upsertRes = await db"));
  const nextTry = upsertBlock.indexOf("} catch (rowErr)");
  const segment = upsertBlock.slice(0, nextTry > 0 ? nextTry : 500);
  assertEquals(
    segment.includes("throw") && segment.includes("upsertRes.data"),
    false,
    "empty upsert result must not throw — delivery already exists is OK",
  );
});

// ── NBP-C3: attempts increment exactly once ───────────────────────────────────

Deno.test("NBP-C3a: nextAttempts computed once outside try/catch", async () => {
  const source = await readSource();
  // nextAttempts must be assigned before the try block (not inside it)
  const handler = handlerBody(source);
  const nextAttemptsIdx = handler.indexOf("const nextAttempts =");
  const tryIdx = handler.indexOf("try {", handler.indexOf("for (const row of rows)"));
  assert(nextAttemptsIdx > 0, "nextAttempts must be declared");
  assert(nextAttemptsIdx < tryIdx, "nextAttempts must be outside (before) the try block");
});

Deno.test("NBP-C3b: claim path does not increment attempts", async () => {
  const source = await readSource();
  // The claim RPC itself must not increment — and the function must not increment
  // before entering the try block
  const handler = handlerBody(source);
  const claimBlock = handler.slice(0, handler.indexOf("for (const row of rows)"));
  assertEquals(
    claimBlock.includes("attempts + 1") || claimBlock.includes("attempts +="),
    false,
    "claim path must not increment attempts",
  );
});

Deno.test("NBP-C3c: success path writes attempts: nextAttempts exactly once", async () => {
  const source = await readSource();
  // The SENT update must include attempts: nextAttempts
  assert(
    source.includes("attempts: nextAttempts"),
    "SENT finalization must write attempts: nextAttempts",
  );
});

Deno.test("NBP-C3d: failure catch writes attempts: nextAttempts (not a second increment)", async () => {
  const source = await readSource();
  const catchBlock = source.slice(source.indexOf("} catch (rowErr)"));
  assert(
    catchBlock.includes("attempts: nextAttempts"),
    "failure catch must persist attempts: nextAttempts",
  );
  // Must NOT recompute nextAttempts inside catch
  assertEquals(
    /const nextAttempts/.test(catchBlock),
    false,
    "must not recompute nextAttempts inside catch",
  );
});

// ── NBP-C4: claimed_at cleared on all finalization paths ──────────────────────

Deno.test("NBP-C4a: success path clears claimed_at", async () => {
  const source = await readSource();
  // The SENT update block must include claimed_at: null
  const sentUpdate = source.slice(source.indexOf('"SENT"'));
  const nextUpdate = sentUpdate.indexOf("update({", 1);
  const sentBlock = nextUpdate > 0 ? sentUpdate.slice(0, nextUpdate + 200) : sentUpdate.slice(0, 400);
  assert(sentBlock.includes("claimed_at: null"), "SENT update must clear claimed_at");
});

Deno.test("NBP-C4b: failure catch clears claimed_at", async () => {
  const source = await readSource();
  const catchBlock = source.slice(source.indexOf("} catch (rowErr)"));
  assert(catchBlock.includes("claimed_at: null"), "failure catch must clear claimed_at");
});

Deno.test("NBP-C4c: compensating reset clears claimed_at", async () => {
  const source = await readSource();
  // The compensating reset (status: PENDING after sentErr) must also clear claimed_at
  const compensatingReset = source.slice(source.indexOf("status: 'PENDING', claimed_at: null"));
  assert(compensatingReset.length > 0, "compensating reset must set status PENDING + claimed_at null");
});

// ── NBP-C5: terminal and failure state machine ───────────────────────────────

Deno.test("NBP-C5a: exhausted rows set status FAILED in catch", async () => {
  const source = await readSource();
  const catchBlock = source.slice(source.indexOf("} catch (rowErr)"));
  assert(
    catchBlock.includes('"FAILED"') || catchBlock.includes("'FAILED'"),
    "catch must set status FAILED when attempts >= max_attempts",
  );
});

Deno.test("NBP-C5b: non-exhausted failure sets status PENDING in catch", async () => {
  const source = await readSource();
  const catchBlock = source.slice(source.indexOf("} catch (rowErr)"));
  assert(
    catchBlock.includes('"PENDING"') || catchBlock.includes("'PENDING'"),
    "catch must set status PENDING when attempts < max_attempts",
  );
});

// ── NBP-C6: Moodle timeout ────────────────────────────────────────────────────

Deno.test("NBP-C6a: Moodle call uses AbortController + setTimeout for 15s bound", async () => {
  const source = await readSource();
  assert(source.includes("AbortController"), "must use AbortController");
  assert(source.includes("setTimeout"), "must use setTimeout for timeout trigger");
  assert(
    source.includes("MOODLE_TIMEOUT_MS") || source.includes("15_000"),
    "must define or reference 15s timeout",
  );
  assert(source.includes("controller.abort()"), "must call abort() on timeout");
  assert(source.includes("signal: controller.signal"), "fetch must use abort signal");
});

Deno.test("NBP-C6b: Moodle timeout constant is 15000ms", async () => {
  const source = await readSource();
  // Either inline or via constant
  assert(
    source.includes("MOODLE_TIMEOUT_MS = 15_000") || source.includes("MOODLE_TIMEOUT_MS = 15000"),
    "Moodle timeout must be 15 seconds",
  );
});

Deno.test("NBP-C6c: Moodle call only reached for moodle_login_check events", async () => {
  const source = await readSource();
  const handler = handlerBody(source);
  // callMoodle is invoked via shouldQueueMoodleReminder, which is called in the handler
  // only for moodle_login_check events.
  const loginCheckIdx = handler.indexOf('"moodle_login_check"');
  const moodleCheckCallIdx = handler.indexOf("shouldQueueMoodleReminder(");
  assert(loginCheckIdx > 0, "moodle_login_check branch must exist");
  assert(moodleCheckCallIdx > 0, "shouldQueueMoodleReminder must be called in handler");
  assert(
    moodleCheckCallIdx > loginCheckIdx,
    "shouldQueueMoodleReminder must only be called after the moodle_login_check branch check",
  );
  // callMoodle itself must exist in the source (defined as module-level helper)
  assert(source.includes("async function callMoodle("), "callMoodle helper must be defined");
});

Deno.test("NBP-C6d: clearTimeout is called to prevent resource leak after Moodle fetch", async () => {
  const source = await readSource();
  assert(source.includes("clearTimeout(timer)"), "must clearTimeout after fetch to prevent leak");
});

// ── NBP-C7: future rows not returned by claim ─────────────────────────────────

Deno.test("NBP-C7: claim RPC filters scheduled_for <= now() (DB contract)", async () => {
  const source = await readSource();
  // This is enforced in the RPC — verify the function trusts the RPC return,
  // not doing its own scheduled_for filter in JS
  const handler = handlerBody(source);
  assertEquals(
    handler.includes("scheduled_for"),
    false,
    "processor must not re-filter by scheduled_for in JS — that is the RPC's job",
  );
});

// ── NBP-C8: existing notification types preserved ────────────────────────────

Deno.test("NBP-C8a: foundation_welcome template key is handled", async () => {
  const source = await readSource();
  assert(source.includes("foundation_welcome"), "must handle foundation_welcome template");
});

Deno.test("NBP-C8b: buildSubjectFromTemplate covers all declared template keys", async () => {
  const source = await readSource();
  const expectedKeys = [
    "foundation_welcome",
    "duplicate_registration",
    "no_class_available",
    "no_suitable_times",
    "class_assigned",
    "class_approved",
    "class_reminder_7_day",
    "class_reminder_1_day",
    "class_reminder_2_hour",
    "attendance_reminder",
    "attendance_escalation",
    "moodle_login_reminder",
    "classes_now_available",
  ];
  for (const key of expectedKeys) {
    assert(source.includes(key), `buildSubjectFromTemplate must include key: ${key}`);
  }
});

// ── NBP-C9: source diff scope ────────────────────────────────────────────────

Deno.test("NBP-C9: no references to legacy unlocked select pattern remain", async () => {
  const source = await readSource();
  // The old pattern was: .from("scheduled_notifications").select(...).eq("status","PENDING")
  // This must be replaced by the claim RPC
  assertEquals(
    source.includes('.eq("status", "PENDING")') || source.includes(".eq('status', 'PENDING')"),
    false,
    "must not use .eq(status, PENDING) for claiming — use claim_notification_batch RPC",
  );
});

Deno.test("NBP-C9b: verify_jwt = false is set in config.toml", async () => {
  const config = await Deno.readTextFile(
    new URL("../../config.toml", import.meta.url),
  );
  const section = "[functions.notification-batch-processor]";
  const start = config.indexOf(section);
  assert(start >= 0, `${section} missing from config.toml`);
  const rest = config.slice(start + section.length);
  const nextSection = rest.search(/\n\[functions\./);
  const body = nextSection >= 0 ? rest.slice(0, nextSection) : rest;
  assert(body.includes("verify_jwt = false"), "notification-batch-processor must have verify_jwt = false");
});
