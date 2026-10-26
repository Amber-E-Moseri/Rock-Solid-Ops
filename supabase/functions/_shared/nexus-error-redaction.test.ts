// Nexus error redaction regressions (RD01–RD08). Layer 1, offline.
//
// Requirement: raw upstream response bodies, credentials and API keys must never be persisted to error_message,
// audit_logs.details, or any summary returned to a caller. Each test plants a unique sentinel in every place an
// error could come from (Nexus body, thrown fetch error, database error) and proves none of them is stored.

import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildDedupeKey,
  ensureNexusTask,
  isAssigneeNotFound,
  createNexusTask,
  NexusHttpError,
  redactAuditDetails,
  STORED_ERROR_MAX,
  storableNexusError,
} from "./nexus-tasks.ts";
import { reconcileUnknownNexusTasks } from "./nexus-reconcile.ts";
import { FakeNexus, FakeNexusDb } from "./nexus-test-support.ts";

const API_KEY = "nexus-api-key-LIVE-9f8e7d6c5b4a";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlMTIzNDU2";
const NEXUS_KEY = "blwk_0123456789abcdef";
const SENTINEL = "UPSTREAM_BODY_SENTINEL_MUST_NOT_PERSIST";
const SECRETS = [API_KEY, JWT, NEXUS_KEY, SENTINEL];

const CFG = { nexusUrl: "https://nexus.test/task-api", nexusApiKey: API_KEY, timeoutMs: 60 };
const payload = () => ({
  student_id: "S1", student_name: "Jane", email: "j@x.test",
  class_option_id: "CO1", class_number: "3", class_date: "2026-09-20", group_id: "G1", subgroup_id: "SG1",
});
const KEY = buildDedupeKey("missed_class", payload());

// deno-lint-ignore no-explicit-any
const ensure = (db: FakeNexusDb) => ensureNexusTask(db as any, "missed_class", payload(), "test@system", CFG);

/** Everything a row or audit trail could have stored, as one searchable string. */
function allStored(db: FakeNexusDb): string {
  return JSON.stringify({ links: db.links, audit: db.tables.audit_logs });
}

const CREDENTIALS = [API_KEY, JWT, NEXUS_KEY];

function assertNoSecrets(text: string, where: string, secrets: string[] = SECRETS) {
  for (const s of secrets) assertFalse(text.includes(s), `${where} must not contain ${s.slice(0, 12)}…`);
}

Deno.test("RD01: storableNexusError redacts JWTs, Nexus keys and the supplied secret, and is bounded", () => {
  const raw = `failed ${JWT} with ${NEXUS_KEY} for ${API_KEY} ${"x".repeat(2000)}`;
  const out = storableNexusError(raw, API_KEY);
  assertNoSecrets(out, "storableNexusError output");
  assertStringIncludes(out, "[redacted-jwt]");
  assertStringIncludes(out, "[redacted-key]");
  assertStringIncludes(out, "[redacted]");
  assert(out.length <= STORED_ERROR_MAX, `output must be bounded to ${STORED_ERROR_MAX}, got ${out.length}`);
});

Deno.test("RD02: NexusHttpError message carries status only; the upstream body and key never appear in it", async () => {
  const body = JSON.stringify({ error: `${SENTINEL} ${JWT} ${NEXUS_KEY} echoed ${API_KEY}` });
  const server = Deno.serve({ port: 0, onListen: () => {} }, () => new Response(body, { status: 400 }));
  try {
    const url = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    const err = await createNexusTask(url, API_KEY, {}, "rocksolid:t", 5000, { allowLocalTestHttp: true })
      .then(() => null, (e) => e);
    assert(err instanceof NexusHttpError, "must be a typed NexusHttpError");
    assertEquals(err.message, "Nexus task create failed (400)", "message is fixed: status only");
    assertNoSecrets(err.message, "NexusHttpError.message");
    assertNoSecrets(storableNexusError(err, API_KEY), "stored form of NexusHttpError");
  } finally {
    await server.shutdown();
  }
});

Deno.test("RD03: classification survives the redaction: an assignee rejection is still recognised from the body", async () => {
  const body = JSON.stringify({ error: "assignee not found" });
  const server = Deno.serve({ port: 0, onListen: () => {} }, () => new Response(body, { status: 400 }));
  try {
    const url = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    const err = await createNexusTask(url, API_KEY, {}, "rocksolid:t", 5000, { allowLocalTestHttp: true })
      .then(() => null, (e) => e);
    assert(isAssigneeNotFound(err), "classification uses the structured error field, not the message");
  } finally {
    await server.shutdown();
  }
});

Deno.test("RD04: a Nexus 400 whose body carries secrets is persisted with no body text, key, JWT or Nexus key", async () => {
  const db = new FakeNexusDb();
  const nexus = new FakeNexus().install();
  nexus.postMode = "http_400";
  nexus.badRequestMessage = `${SENTINEL} ${JWT} ${NEXUS_KEY} ${API_KEY}`;
  try {
    const r = await ensure(db);
    assertFalse(r.ok);
    assertNoSecrets(String(r.error), "returned error");
    assertNoSecrets(String(db.link(KEY)?.error_message), "rocksolid_task_links.error_message");
    assertNoSecrets(allStored(db), "all stored rows and audit details");
    assertEquals(db.link(KEY)?.status, "FAILED", "a plain 400 is FAILED, not an unknown outcome");
  } finally {
    nexus.restore();
  }
});

Deno.test("RD05: a thrown transport error that embeds the key is persisted redacted", async () => {
  const db = new FakeNexusDb();
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError(`error sending request for ${API_KEY} via ${JWT}`);
  }) as typeof fetch;
  try {
    const r = await ensure(db);
    assertFalse(r.ok);
    assertNoSecrets(String(r.error), "returned error");
    assertNoSecrets(allStored(db), "all stored rows and audit details");
  } finally {
    globalThis.fetch = real;
  }
});

Deno.test("RD06: a claim RPC error that embeds the key is audited and returned redacted", async () => {
  const audit: Record<string, unknown>[] = [];
  const stub = {
    rpc: async () => ({ data: null, error: { message: `claim failed for ${API_KEY} ${SENTINEL}`, code: "XX000" } }),
    from: () => ({ insert: async (row: Record<string, unknown>) => { audit.push(row); return { error: null }; } }),
  };
  // deno-lint-ignore no-explicit-any
  const r = await ensureNexusTask(stub as any, "missed_class", payload(), "test@system", CFG);
  assertFalse(r.ok);
  assertNoSecrets(String(r.error), "returned error", CREDENTIALS);
  assertNoSecrets(JSON.stringify(audit), "claim-error audit row", CREDENTIALS);
  assertEquals(audit.length, 1, "exactly one claim-error audit row");
});

Deno.test("RD07: reconcile claim error summary is redacted", async () => {
  const stub = {
    rpc: async () => ({ data: null, error: { message: `reconcile claim ${API_KEY} ${JWT}` } }),
  };
  // deno-lint-ignore no-explicit-any
  const s = await reconcileUnknownNexusTasks(stub as any, CFG, "test@system");
  assertStringIncludes(String(s.skipped), "claim_error:");
  assertNoSecrets(String(s.skipped), "reconcile summary.skipped", CREDENTIALS);
  assertEquals(s.errors, 1);
});

Deno.test("RD08: audit writer redacts every string field, bounds it, and leaves non-strings untouched", () => {
  const out = redactAuditDetails({
    error: `x ${JWT} ${NEXUS_KEY} ${"y".repeat(900)}`,
    count: 3,
    flag: true,
    missing: null,
  });
  assertFalse(String(out.error).includes(JWT), "JWT redacted in audit detail");
  assertFalse(String(out.error).includes(NEXUS_KEY), "Nexus key redacted in audit detail");
  assert(String(out.error).length <= STORED_ERROR_MAX, "audit string bounded");
  assertEquals(out.count, 3);
  assertEquals(out.flag, true);
  assertEquals(out.missing, null);
});
