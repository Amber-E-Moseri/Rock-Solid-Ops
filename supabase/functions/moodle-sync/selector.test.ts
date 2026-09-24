// C3B selector tests — moodle_enrollment_sync automatic eligibility
//
// T01–T10  isMoodleSyncEligible pure-function (no DB/network)
// T11–T12  selector structure (source inspection)
// T17      stale PROCESSING recovery still runs before selection
// T18      FAILED/PERMANENTLY_FAILED/SYNCED stay out of auto selection
// T19      covered by C3A-2 in failure-persistence.test.ts
// T20      end-to-end: RETRYING+future not selected; PENDING is

import { assert, assertEquals } from "jsr:@std/assert@1";
import { handler, isMoodleSyncEligible } from "./index.ts";

const SECRET = "c3b-selector-secret";
const PAST = "2020-01-01T00:00:00.000Z";
const NOW = "2026-09-24T12:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

// ── T01–T10: eligibility unit tests ─────────────────────────────────────────

Deno.test("T01: PENDING ASSIGNED is eligible", () => {
  assert(isMoodleSyncEligible({ registration_status: "ASSIGNED", sync_status: "PENDING" }, NOW));
});

Deno.test("T02: RETRYING + next_retry_at NULL is eligible", () => {
  assert(isMoodleSyncEligible(
    { registration_status: "ASSIGNED", sync_status: "RETRYING", next_retry_at: null },
    NOW,
  ));
});

Deno.test("T03: RETRYING + next_retry_at in past is eligible", () => {
  assert(isMoodleSyncEligible(
    { registration_status: "ASSIGNED", sync_status: "RETRYING", next_retry_at: PAST },
    NOW,
  ));
});

Deno.test("T04: RETRYING + next_retry_at exactly now is eligible", () => {
  assert(isMoodleSyncEligible(
    { registration_status: "ASSIGNED", sync_status: "RETRYING", next_retry_at: NOW },
    NOW,
  ));
});

Deno.test("T05: RETRYING + next_retry_at in future is NOT eligible", () => {
  assertEquals(
    isMoodleSyncEligible(
      { registration_status: "ASSIGNED", sync_status: "RETRYING", next_retry_at: FUTURE },
      NOW,
    ),
    false,
  );
});

Deno.test("T06: FAILED retryable error is NOT automatically selected", () => {
  assertEquals(
    isMoodleSyncEligible(
      { registration_status: "ASSIGNED", sync_status: "FAILED", error_code: "TIMEOUT" },
      NOW,
    ),
    false,
  );
});

Deno.test("T07: FAILED non-retryable error is NOT automatically selected", () => {
  assertEquals(
    isMoodleSyncEligible(
      { registration_status: "ASSIGNED", sync_status: "FAILED", error_code: "MOODLE_REST_DISABLED" },
      NOW,
    ),
    false,
  );
});

Deno.test("T08: PERMANENTLY_FAILED is NOT selected", () => {
  assertEquals(
    isMoodleSyncEligible({ registration_status: "ASSIGNED", sync_status: "PERMANENTLY_FAILED" }, NOW),
    false,
  );
});

Deno.test("T09: SYNCED is NOT selected", () => {
  assertEquals(
    isMoodleSyncEligible({ registration_status: "ASSIGNED", sync_status: "SYNCED" }, NOW),
    false,
  );
});

Deno.test("T10: non-ASSIGNED registration_status is NOT selected", () => {
  for (const regStatus of ["WAITLISTED", "PENDING", "REVIEW", "INACTIVE", "DUPLICATE", ""]) {
    assertEquals(
      isMoodleSyncEligible({ registration_status: regStatus, sync_status: "PENDING" }, NOW),
      false,
      `registration_status "${regStatus}" should not be eligible`,
    );
  }
});

// ── T11–T12: selector structure ──────────────────────────────────────────────

Deno.test("T11: selector preserves updated_at ascending order", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(
    src.includes('.order("updated_at", { ascending: true })'),
    "expected ascending updated_at order in baseQuery",
  );
});

Deno.test("T12: selector preserves batch limit", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(src.includes(".limit(limit)"), "expected .limit(limit) in baseQuery");
});

// ── T18: terminal/non-eligible statuses stay out of auto selection ───────────

Deno.test("T18: FAILED, PERMANENTLY_FAILED, SYNCED, SKIPPED never automatically selected", () => {
  for (const sync_status of ["FAILED", "PERMANENTLY_FAILED", "SYNCED", "SKIPPED"]) {
    assertEquals(
      isMoodleSyncEligible({ registration_status: "ASSIGNED", sync_status }, NOW),
      false,
      `${sync_status} must not be automatically selected`,
    );
  }
});

// ── T17: stale PROCESSING recovery fires before normal selection ─────────────

Deno.test("T17: stale PROCESSING recovery PATCH is issued on every normal run", async () => {
  Deno.env.set("CRON_INVOKE_SECRET", SECRET);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key-t17");
  Deno.env.delete("MOODLE_URL");
  Deno.env.delete("MOODLE_TOKEN");

  let recoveryPatchSeen = false;

  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    const m = url.pathname.match(/\/rest\/v1\/([a-z_]+)$/);

    if (m?.[1] === "moodle_enrollment_sync" && req.method === "PATCH") {
      const idFilter = url.searchParams.get("id");
      if (!idFilter) {
        // Stale recovery: UPDATE WHERE sync_status=PROCESSING AND updated_at < threshold
        recoveryPatchSeen = true;
        return Response.json([{ id: "00000000-0000-0000-0000-000000000001" }]);
      }
      return Response.json([]);
    }
    if (m && req.method === "GET") return Response.json([]);
    if (req.method === "POST") {
      await req.json().catch(() => null);
      return new Response(null, { status: 201 });
    }
    return Response.json([]);
  });

  try {
    const port = (server.addr as Deno.NetAddr).port;
    Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${port}`);

    const res = await handler(
      new Request("https://x.supabase.co/functions/v1/moodle-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": SECRET },
        body: "{}",
      }),
    );
    await res.body?.cancel();
    assertEquals(recoveryPatchSeen, true, "stale PROCESSING recovery PATCH must be issued");
  } finally {
    await server.shutdown();
    for (const k of ["CRON_INVOKE_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
      Deno.env.delete(k);
    }
  }
});

// ── T20: next_retry_at controls subsequent eligibility ───────────────────────

Deno.test("T20: RETRYING+future is excluded; PENDING is processed", async () => {
  const FUTURE_TIME = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const PENDING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const RETRYING_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  const rows: Record<string, unknown>[] = [
    {
      id: PENDING_ID, email: "a@example.com", full_name: "A Student",
      registration_status: "ASSIGNED", sync_status: "PENDING",
      retry_count: 0, sync_attempts: 0, course_id: "42", status: "PENDING",
    },
    {
      id: RETRYING_ID, email: "b@example.com", full_name: "B Student",
      registration_status: "ASSIGNED", sync_status: "RETRYING", next_retry_at: FUTURE_TIME,
      retry_count: 1, sync_attempts: 1, course_id: "42", status: "RETRYING",
    },
  ];

  const processedIds: string[] = [];

  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url);

    if (url.pathname.endsWith("/webservice/rest/server.php")) {
      const form = new URLSearchParams(await req.text());
      const fn = form.get("wsfunction");
      if (fn === "core_user_get_users") return Response.json({ users: [{ id: 7, username: "test_user" }] });
      if (fn === "core_user_update_users") return Response.json({});
      return Response.json(null);
    }

    const m = url.pathname.match(/\/rest\/v1\/([a-z_]+)$/);
    if (!m) return new Response("not found", { status: 404 });

    if (m[1] === "moodle_enrollment_sync") {
      if (req.method === "GET") {
        const orParam = url.searchParams.get("or");
        const selectionNow = new Date().toISOString();
        // If handler uses the C3B or() filter, enforce eligibility.
        // If it still uses the old in() filter (no or= param), return all rows
        // so the test detects both rows were processed — which would fail T20.
        const result = orParam
          ? rows.filter((r) => isMoodleSyncEligible(r, selectionNow))
          : rows;
        return Response.json(result);
      }
      if (req.method === "PATCH") {
        const idFilter = url.searchParams.get("id");
        if (!idFilter) return Response.json([]); // stale recovery
        const id = idFilter.replace("eq.", "");
        const body = await req.json();
        if (String(body.sync_status || "").toUpperCase() === "PROCESSING") {
          processedIds.push(id);
        }
        return Response.json([{ id }]);
      }
    }

    if (req.method === "POST") {
      await req.json().catch(() => null);
      return new Response(null, { status: 201 });
    }
    return Response.json([]);
  });

  try {
    const port = (server.addr as Deno.NetAddr).port;
    Deno.env.set("CRON_INVOKE_SECRET", SECRET);
    Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${port}`);
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key-t20");
    Deno.env.set("MOODLE_URL", `http://127.0.0.1:${port}`);
    Deno.env.set("MOODLE_TOKEN", "fake-moodle-token");

    const res = await handler(
      new Request("https://x.supabase.co/functions/v1/moodle-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": SECRET },
        body: "{}",
      }),
    );
    const body = await res.json();
    assertEquals(body.ok, true, "handler should succeed");

    assert(
      processedIds.includes(PENDING_ID),
      "PENDING row must be selected and processed",
    );
    assertEquals(
      processedIds.includes(RETRYING_ID),
      false,
      "RETRYING row with future next_retry_at must not be selected",
    );
  } finally {
    await server.shutdown();
    for (const k of ["CRON_INVOKE_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MOODLE_URL", "MOODLE_TOKEN"]) {
      Deno.env.delete(k);
    }
  }
});
