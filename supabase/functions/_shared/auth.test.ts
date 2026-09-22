// Tests for validateCronAuth (Gate B/C0, P0 security remediation).
// Run: deno test --allow-env supabase/functions/_shared/auth.test.ts

import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { validateCronAuth, validateInternalAuth } from "./auth.ts";

// Synthetic test credentials only. Never reads production Edge Function Secrets or Vault.
const TEST_SECRET    = "test-cron-invoke-secret-value-abcdefgh"; // 38 chars
const WRONG_SAME_LEN = "test-cron-invoke-secret-value-ABCDEFGH"; // 38 chars, different
const WRONG_DIFF_LEN = "short";                                    //  5 chars
const VERY_SHORT     = "x";                                        //  1 char
const VERY_LONG      = "a".repeat(10_000);                         // 10000 chars
const TEST_INTERNAL_SECRET = "test-internal-invoke-secret-value";
const WRONG_INTERNAL_SECRET = "wrong-internal-invoke-secret-value";

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request("https://x.supabase.co/functions/v1/email-sender", {
    method: "POST",
    headers,
  });
}

// T1: Missing CRON_INVOKE_SECRET → 500; no business logic reached.
Deno.test("T1: missing CRON_INVOKE_SECRET env → 500", () => {
  Deno.env.delete("CRON_INVOKE_SECRET");
  const resp = validateCronAuth(makeReq({ "x-cron-secret": TEST_SECRET }));
  assertNotEquals(resp, null, "must return a Response (not null) when env is absent");
  assertEquals(resp!.status, 500);
});

// T2: Missing x-cron-secret header → 401; no business logic reached.
Deno.test("T2: missing x-cron-secret header → 401", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_SECRET);
  try {
    const resp = validateCronAuth(makeReq());
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

// T3: Incorrect credential (same length as expected) → 401; no business logic reached.
Deno.test("T3: incorrect credential (same length) → 401", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_SECRET);
  try {
    const resp = validateCronAuth(makeReq({ "x-cron-secret": WRONG_SAME_LEN }));
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

// T4: Correct credential → null; caller proceeds to business logic.
Deno.test("T4: correct credential → null (auth passes)", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_SECRET);
  try {
    const resp = validateCronAuth(makeReq({ "x-cron-secret": TEST_SECRET }));
    assertEquals(resp, null, "correct credential must yield null (pass-through to handler)");
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

// T5: Wrong-length credential → 401, no exception thrown.
// Verifies the length check prevents ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH.
Deno.test("T5: wrong-length credential → 401, no exception", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_SECRET);
  try {
    let resp: Response | null;
    try {
      resp = validateCronAuth(makeReq({ "x-cron-secret": WRONG_DIFF_LEN }));
    } catch (err) {
      throw new Error(`validateCronAuth must not throw on wrong-length input: ${err}`);
    }
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

// T6: Empty x-cron-secret value → 401.
Deno.test("T6: empty x-cron-secret header → 401", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_SECRET);
  try {
    const resp = validateCronAuth(makeReq({ "x-cron-secret": "" }));
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

// T7: Auth executes before first privileged operation (structural guarantee).
// validateCronAuth returns Response | null synchronously before any DB or Resend
// call. email-sender/index.ts calls it as the first statement inside Deno.serve:
//   const authFailure = validateCronAuth(req);
//   if (authFailure) return authFailure;
//   // first DB call follows
// A non-null return from this test confirms the request is terminated before any
// downstream side effect.
Deno.test("T7: auth blocks before business logic (config-fail case)", () => {
  Deno.env.delete("CRON_INVOKE_SECRET");
  const resp = validateCronAuth(makeReq({ "x-cron-secret": TEST_SECRET }));
  assertNotEquals(resp, null, "config failure must return a blocking Response");
  assertEquals(resp!.status, 500);
  // If this returns non-null, email-sender's handler returns it immediately —
  // no DB read, no Resend call, no queue mutation.
});

// T8: Failure responses contain no secret value and do not echo supplied credential.
Deno.test("T8: failure responses do not disclose secret or supplied value", async () => {
  const secret = "gate-b-secret-must-not-appear-in-response-body";
  Deno.env.set("CRON_INVOKE_SECRET", secret);
  try {
    const resp = validateCronAuth(makeReq({ "x-cron-secret": WRONG_DIFF_LEN }));
    assertNotEquals(resp, null);
    const body = await resp!.text();
    if (body.includes(secret)) {
      throw new Error("response body must not contain the expected secret value");
    }
    if (body.includes(WRONG_DIFF_LEN)) {
      throw new Error("response body must not echo the supplied credential");
    }
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

// ── C0 hardening tests ────────────────────────────────────────────────────────

// T9: Same-length wrong credential → 401 (hits SHA-256 + timingSafeEqual path).
Deno.test("T9: same-length wrong secret → 401", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_SECRET);
  try {
    assertEquals(TEST_SECRET.length, WRONG_SAME_LEN.length, "precondition: same length");
    const resp = validateCronAuth(makeReq({ "x-cron-secret": WRONG_SAME_LEN }));
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

// T10: Different-length wrong credential → 401, no exception (length no longer
// matters — SHA-256 produces equal-length digests regardless).
Deno.test("T10: different-length wrong secret → 401, no exception", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_SECRET);
  try {
    let resp: Response | null;
    try {
      resp = validateCronAuth(makeReq({ "x-cron-secret": WRONG_DIFF_LEN }));
    } catch (err) {
      throw new Error(`must not throw on different-length input: ${err}`);
    }
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

// T11: Very short credential (1 char) → 401, no exception.
Deno.test("T11: very short credential → 401", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_SECRET);
  try {
    let resp: Response | null;
    try {
      resp = validateCronAuth(makeReq({ "x-cron-secret": VERY_SHORT }));
    } catch (err) {
      throw new Error(`must not throw on 1-char input: ${err}`);
    }
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

// T12: Very long credential (10000 chars) → 401, no exception.
Deno.test("T12: very long credential → 401, no exception", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_SECRET);
  try {
    let resp: Response | null;
    try {
      resp = validateCronAuth(makeReq({ "x-cron-secret": VERY_LONG }));
    } catch (err) {
      throw new Error(`must not throw on 10000-char input: ${err}`);
    }
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

Deno.test("I1: missing x-internal-secret header -> rejected", () => {
  Deno.env.set("INTERNAL_INVOKE_SECRET", TEST_INTERNAL_SECRET);
  try {
    const resp = validateInternalAuth(makeReq());
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("INTERNAL_INVOKE_SECRET");
  }
});

Deno.test("I2: wrong internal secret -> rejected", () => {
  Deno.env.set("INTERNAL_INVOKE_SECRET", TEST_INTERNAL_SECRET);
  try {
    const resp = validateInternalAuth(makeReq({ "x-internal-secret": WRONG_INTERNAL_SECRET }));
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("INTERNAL_INVOKE_SECRET");
  }
});

Deno.test("I3: correct internal secret -> accepted", () => {
  Deno.env.set("INTERNAL_INVOKE_SECRET", TEST_INTERNAL_SECRET);
  try {
    const resp = validateInternalAuth(makeReq({ "x-internal-secret": TEST_INTERNAL_SECRET }));
    assertEquals(resp, null);
  } finally {
    Deno.env.delete("INTERNAL_INVOKE_SECRET");
  }
});

Deno.test("I4: cron secret does not satisfy internal auth", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_SECRET);
  Deno.env.set("INTERNAL_INVOKE_SECRET", TEST_INTERNAL_SECRET);
  try {
    const resp = validateInternalAuth(makeReq({ "x-internal-secret": TEST_SECRET }));
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("INTERNAL_INVOKE_SECRET");
  }
});

Deno.test("I5: service-role-like bearer does not satisfy internal auth", () => {
  Deno.env.set("INTERNAL_INVOKE_SECRET", TEST_INTERNAL_SECRET);
  try {
    const resp = validateInternalAuth(makeReq({ Authorization: "Bearer fake-service-role-token" }));
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("INTERNAL_INVOKE_SECRET");
  }
});

Deno.test("I6: internal auth failure response does not disclose secrets", async () => {
  Deno.env.set("INTERNAL_INVOKE_SECRET", TEST_INTERNAL_SECRET);
  try {
    const resp = validateInternalAuth(makeReq({ "x-internal-secret": WRONG_INTERNAL_SECRET }));
    assertNotEquals(resp, null);
    const body = await resp!.text();
    if (body.includes(TEST_INTERNAL_SECRET)) {
      throw new Error("response body must not contain internal secret");
    }
    if (body.includes(WRONG_INTERNAL_SECRET)) {
      throw new Error("response body must not echo supplied internal secret");
    }
  } finally {
    Deno.env.delete("INTERNAL_INVOKE_SECRET");
  }
});

Deno.test("I7: internal auth does not log secrets", () => {
  Deno.env.set("INTERNAL_INVOKE_SECRET", TEST_INTERNAL_SECRET);
  const calls: unknown[][] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (...args: unknown[]) => { calls.push(args); };
  console.warn = (...args: unknown[]) => { calls.push(args); };
  console.error = (...args: unknown[]) => { calls.push(args); };
  try {
    validateInternalAuth(makeReq({ "x-internal-secret": WRONG_INTERNAL_SECRET }));
    const logText = JSON.stringify(calls);
    if (logText.includes(TEST_INTERNAL_SECRET) || logText.includes(WRONG_INTERNAL_SECRET)) {
      throw new Error("console output must not contain internal secrets");
    }
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    Deno.env.delete("INTERNAL_INVOKE_SECRET");
  }
});

Deno.test("I8: internal secret does not satisfy cron auth", () => {
  Deno.env.set("CRON_INVOKE_SECRET", TEST_SECRET);
  Deno.env.set("INTERNAL_INVOKE_SECRET", TEST_INTERNAL_SECRET);
  try {
    const resp = validateCronAuth(makeReq({ "x-cron-secret": TEST_INTERNAL_SECRET }));
    assertNotEquals(resp, null);
    assertEquals(resp!.status, 401);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("INTERNAL_INVOKE_SECRET");
  }
});
