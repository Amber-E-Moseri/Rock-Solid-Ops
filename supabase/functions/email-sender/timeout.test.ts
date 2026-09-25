// C6 email-sender timeout tests
//
// E01  normal Resend success remains success (null returned)
// E02  Resend non-2xx failure remains failure (error string returned)
// E03  Resend timeout aborts the request
// E04  timeout does not mark email Sent (returns non-null error)
// E05  timeout enters existing failure path (error string, not throw)
// E06  Processing claim happens before sendEmail (no double-accounting)
// E07  abort cannot create a duplicate delivery
// E08  timeout timer is cleaned up (clearTimeout in finally)

import { assert, assertEquals } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

// ── Source-inspection tests (E04–E08) ────────────────────────────────────────
//
// These verify structural invariants without importing the module.

Deno.test("E04: sendEmail return null is only reachable on 2xx — catch path returns error string", () => {
  // The catch block returns `e.message` (non-null) so the caller marks Failed.
  // return null (success) only follows if res.ok passes.
  const catchIdx       = src.indexOf("} catch (e) {");
  const returnNullIdx  = src.lastIndexOf("return null");
  const resOkIdx       = src.indexOf("if (!res.ok)");
  assert(catchIdx      !== -1, "catch block must be present");
  assert(returnNullIdx !== -1, "return null (success path) must be present");
  assert(resOkIdx      !== -1, "res.ok check must be present");
  // return null is after the res.ok check (i.e., only reachable on success)
  assert(returnNullIdx > resOkIdx, "return null must follow the res.ok check");
  // catch block returns an error string, so it cannot fall through to return null
  assert(
    src.includes("return e instanceof Error ? e.message : String(e)"),
    "catch must return error string (not rethrow) to prevent falling through to return null",
  );
});

Deno.test("E05: timeout enters existing failure path — caller marks Failed on non-null", () => {
  // Non-null return from sendEmail → caller marks status 'Failed'
  assert(src.includes("status: 'Failed'"), "handler must have a Failed update path");
  assert(src.includes("if (sendErr)"),     "handler must branch on sendErr");
  const sendErrIdx = src.indexOf("if (sendErr)");
  const sentIdx    = src.indexOf("status: 'Sent'");
  assert(sendErrIdx < sentIdx, "Failed branch must appear before Sent branch");
});

Deno.test("E06: Processing claim (Step 1b) happens before sendEmail call", () => {
  const claimIdx = src.indexOf("status: 'Processing'");
  const sendIdx  = src.indexOf("sendEmail(");
  assert(claimIdx !== -1, "Processing claim not found");
  assert(sendIdx  !== -1, "sendEmail call not found");
  assert(claimIdx < sendIdx, "Processing claim must appear before sendEmail call");
});

Deno.test("E07: signal attached to fetch — abort prevents Resend from receiving the request", () => {
  assert(src.includes("signal: controller.signal"), "fetch must carry controller.signal");
  assert(src.includes("controller.abort()"),        "AbortController.abort() must be called on timeout");
  // The abort fires before the server processes the POST body, so Resend never
  // delivers the email. The catch returns an error string (not null) which the
  // handler uses to mark the row Failed, not Sent.
  assert(
    src.includes("return e instanceof Error ? e.message : String(e)"),
    "catch must return error string ensuring row is not marked Sent on abort",
  );
});

Deno.test("E08: clearTimeout in finally block cleans up the abort timer", () => {
  assert(src.includes("clearTimeout(timer)"), "clearTimeout(timer) must be present");
  const finallyIdx = src.indexOf("} finally {");
  const clearIdx   = src.indexOf("clearTimeout(timer)");
  assert(finallyIdx !== -1, "finally block must be present");
  assert(clearIdx   !== -1, "clearTimeout(timer) must be present");
  assert(clearIdx > finallyIdx, "clearTimeout must appear after the finally opener");
});

// ── Runtime tests — E01, E02, E03 ────────────────────────────────────────────
//
// sendEmail is exported; tests drive it through a fake Resend endpoint.
// Module-level constants are initialised once at first import — env must be
// set before the dynamic import below.

Deno.env.set("SUPABASE_URL",              "http://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("RESEND_API_KEY",            "test-resend-key");

const { sendEmail } = await import("./index.ts");

function opts() {
  return {
    from:    "Foundation School Team <noreply@example.com>",
    replyTo: "",
    to:      "student@example.com",
    subject: "Test",
    html:    "<p>hello</p>",
  };
}

// ── E01: normal success ───────────────────────────────────────────────────────

Deno.test("E01: normal Resend 200 returns null (success)", async () => {
  const server = Deno.serve({ port: 0, onListen: () => {} }, (_req) =>
    new Response(JSON.stringify({ id: "email_abc123" }), { status: 200 })
  );
  try {
    const port = (server.addr as Deno.NetAddr).port;
    Deno.env.set("RESEND_API_URL", `http://127.0.0.1:${port}`);
    const result = await sendEmail(opts());
    assertEquals(result, null, "success must return null");
  } finally {
    await server.shutdown();
  }
});

// ── E02: Resend non-2xx failure ────────────────────────────────────────────

Deno.test("E02: Resend 422 returns error string (existing failure behavior)", async () => {
  const server = Deno.serve({ port: 0, onListen: () => {} }, (_req) =>
    new Response(JSON.stringify({ message: "Invalid from address" }), { status: 422 })
  );
  try {
    const port = (server.addr as Deno.NetAddr).port;
    Deno.env.set("RESEND_API_URL", `http://127.0.0.1:${port}`);
    const result = await sendEmail(opts());
    assert(result !== null,                  "failure must return non-null");
    assert(result.includes("422"),           "error must mention status code");
    assert(result.includes("Invalid from"), "error must include server message");
  } finally {
    await server.shutdown();
  }
});

// ── E03: timeout aborts ───────────────────────────────────────────────────────

Deno.test("E03: Resend timeout aborts the request and returns error string", async () => {
  // Use 100ms timeout so the test runs fast.
  Deno.env.set("RESEND_TIMEOUT_MS", "100");

  // Server never responds until the client disconnects, then resolves immediately.
  // This allows server.shutdown() to complete cleanly.
  const server = Deno.serve({ port: 0, onListen: () => {} }, (req) =>
    new Promise<Response>((resolve) => {
      // Resolve when client aborts (req.signal fires on connection close).
      req.signal.addEventListener("abort", () =>
        resolve(new Response("{}", { status: 200 }))
      );
      // Safety fallback: resolve after 2s in case signal never fires.
      setTimeout(() => resolve(new Response("{}", { status: 200 })), 2000);
    })
  );

  try {
    const port = (server.addr as Deno.NetAddr).port;
    Deno.env.set("RESEND_API_URL", `http://127.0.0.1:${port}`);
    const result = await sendEmail(opts());
    assert(result !== null, "timeout must return non-null error string");
    assert(
      result.toLowerCase().includes("abort") ||
      result.toLowerCase().includes("signal") ||
      result.toLowerCase().includes("cancel"),
      `timeout error must indicate an abort; got: "${result}"`,
    );
  } finally {
    Deno.env.delete("RESEND_TIMEOUT_MS");
    await server.shutdown();
  }
});
