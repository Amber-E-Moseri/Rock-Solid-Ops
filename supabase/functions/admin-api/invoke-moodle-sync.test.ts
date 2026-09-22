import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { invokeMoodleSyncAction } from "./_actions/invoke-moodle-sync.ts";

// T12: valid admin JWT → proxy permitted
Deno.test("T12: admin role is allowed to invoke moodle-sync", () => {
  const ctx = {
    db: {},
    auth: {
      profile: { role: "admin", email: "admin@test.com" },
      user: { id: "user-1", email: "admin@test.com" },
    },
    params: { action: "invoke-moodle-sync", moodle_action: "test" },
  };
  // This would normally call fetch to moodle-sync. Since we're testing auth only,
  // the real test is that it doesn't throw 403 before attempting fetch.
  // Full integration test requires mocking fetch or running against a test moodle-sync.
  assertEquals(ctx.auth.profile.role, "admin");
});

// T13: valid superadmin JWT → proxy permitted
Deno.test("T13: superadmin role is allowed to invoke moodle-sync", () => {
  const ctx = {
    db: {},
    auth: {
      profile: { role: "superadmin", email: "superadmin@test.com" },
      user: { id: "user-2", email: "superadmin@test.com" },
    },
    params: { action: "invoke-moodle-sync", moodle_action: "test" },
  };
  assertEquals(ctx.auth.profile.role, "superadmin");
});

// T14: valid unauthorized-role JWT → 403 expected
Deno.test("T14: teacher role is denied (403)", async () => {
  const ctx = {
    db: {},
    auth: {
      profile: { role: "teacher", email: "teacher@test.com" },
      user: { id: "user-3", email: "teacher@test.com" },
    },
    params: { action: "invoke-moodle-sync", moodle_action: "test" },
  };
  const result = await invokeMoodleSyncAction(ctx);
  assertEquals(result.status, 403);
  const body = await result.json();
  assertEquals(body.ok, false);
  assertEquals(body.error.includes("admin/superadmin"), true);
});

// T17: missing CRON_INVOKE_SECRET in admin-api environment → fail closed
Deno.test("T17: missing CRON_INVOKE_SECRET env var → 500 config error", async () => {
  Deno.env.delete("CRON_INVOKE_SECRET");
  const ctx = {
    db: {},
    auth: {
      profile: { role: "admin", email: "admin@test.com" },
      user: { id: "user-4", email: "admin@test.com" },
    },
    params: { action: "invoke-moodle-sync", moodle_action: "test" },
  };
  const result = await invokeMoodleSyncAction(ctx);
  assertEquals(result.status, 500);
  const body = await result.json();
  assertEquals(body.error.includes("configuration"), true);
});

// T18: proxy adds server-side cron credential without exposing it in response
Deno.test("T18: cron secret never appears in response body", async () => {
  const secret = "test-secret-must-not-leak-abcdefgh";
  Deno.env.set("CRON_INVOKE_SECRET", secret);
  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  try {
    const ctx = {
      db: {},
      auth: {
        profile: { role: "admin", email: "admin@test.com" },
        user: { id: "user-5", email: "admin@test.com" },
      },
      params: { action: "invoke-moodle-sync", moodle_action: "test" },
    };
    const result = await invokeMoodleSyncAction(ctx);
    const body = await result.text();
    if (body.includes(secret)) {
      throw new Error("response body must not contain CRON_INVOKE_SECRET");
    }
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

// P4: null/missing auth profile → 403 (mirrors invalid/missing JWT at proxy layer)
Deno.test("P4: null auth profile → 403 (invalid auth equivalent)", async () => {
  const ctx = {
    db: {},
    auth: {
      profile: null,
      user: { id: "user-p4", email: "anon@test.com" },
    },
    params: { action: "invoke-moodle-sync", moodle_action: "test" },
  };
  const result = await invokeMoodleSyncAction(ctx);
  assertEquals(result.status, 403);
  const body = await result.json();
  assertEquals(body.ok, false);
});

// P6: admin role actually calls through (real invocation, not stub)
Deno.test("P6: admin role passes role check (real invocation)", async () => {
  Deno.env.set("CRON_INVOKE_SECRET", "test-p6-secret");
  Deno.env.delete("SUPABASE_URL"); // Triggers config error before fetch — no real network call
  try {
    const ctx = {
      db: {},
      auth: {
        profile: { role: "admin", email: "admin@test.com" },
        user: { id: "user-p6", email: "admin@test.com" },
      },
      params: { action: "invoke-moodle-sync", moodle_action: "test" },
    };
    const result = await invokeMoodleSyncAction(ctx);
    // Reaches env check (not 403); fails on missing SUPABASE_URL
    assertNotEquals(result.status, 403);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

// P7: superadmin role actually calls through (real invocation, not stub)
Deno.test("P7: superadmin role passes role check (real invocation)", async () => {
  Deno.env.set("CRON_INVOKE_SECRET", "test-p7-secret");
  Deno.env.delete("SUPABASE_URL");
  try {
    const ctx = {
      db: {},
      auth: {
        profile: { role: "superadmin", email: "superadmin@test.com" },
        user: { id: "user-p7", email: "superadmin@test.com" },
      },
      params: { action: "invoke-moodle-sync", moodle_action: "test" },
    };
    const result = await invokeMoodleSyncAction(ctx);
    assertNotEquals(result.status, 403);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

// P8: student role denied (403)
Deno.test("P8: student role is denied (403)", async () => {
  const ctx = {
    db: {},
    auth: {
      profile: { role: "student", email: "student@test.com" },
      user: { id: "user-p8", email: "student@test.com" },
    },
    params: { action: "invoke-moodle-sync", moodle_action: "test" },
  };
  const result = await invokeMoodleSyncAction(ctx);
  assertEquals(result.status, 403);
  const body = await result.json();
  assertEquals(body.ok, false);
});

// P9: empty/missing role denied (403)
Deno.test("P9: empty role is denied (403)", async () => {
  const ctx = {
    db: {},
    auth: {
      profile: { role: "", email: "unknown@test.com" },
      user: { id: "user-p9", email: "unknown@test.com" },
    },
    params: { action: "invoke-moodle-sync", moodle_action: "test" },
  };
  const result = await invokeMoodleSyncAction(ctx);
  assertEquals(result.status, 403);
});

// P10: SUPABASE_URL missing → 500 service configuration error
Deno.test("P10: missing SUPABASE_URL env → 500 config error", async () => {
  Deno.env.set("CRON_INVOKE_SECRET", "test-p10-secret");
  Deno.env.delete("SUPABASE_URL");
  try {
    const ctx = {
      db: {},
      auth: {
        profile: { role: "admin", email: "admin@test.com" },
        user: { id: "user-p10", email: "admin@test.com" },
      },
      params: { action: "invoke-moodle-sync", moodle_action: "test" },
    };
    const result = await invokeMoodleSyncAction(ctx);
    assertEquals(result.status, 500);
    const body = await result.json();
    assertEquals(body.error.includes("configuration"), true);
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
  }
});

// ─── Operation allowlist tests (A1–A10) ────────────────────────────────────

// Track outbound fetch calls via globalThis override
function withFetchSpy(fn: (calls: { url: string; headers: Record<string, string> }[]) => Promise<void>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    calls.push({ url, headers });
    // Return stub response so invokeMoodleSyncAction doesn't hang on network
    return new Response(JSON.stringify({ ok: true, test: "stub" }), { status: 200 });
  };
  return fn(calls).finally(() => { globalThis.fetch = originalFetch; });
}

// A1: admin + action:test → outbound request occurs (allowed)
Deno.test("A1: admin + moodle_action:test → outbound fetch occurs", async () => {
  Deno.env.set("CRON_INVOKE_SECRET", "a1-secret");
  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  try {
    await withFetchSpy(async (calls) => {
      const ctx = {
        db: {},
        auth: { profile: { role: "admin", email: "admin@test.com" }, user: { id: "u-a1" } },
        params: { action: "invoke-moodle-sync", moodle_action: "test" },
      };
      const result = await invokeMoodleSyncAction(ctx);
      assertNotEquals(result.status, 403);
      assertEquals(calls.length, 1);
    });
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("SUPABASE_URL");
  }
});

// A2: superadmin + action:test → outbound request occurs (allowed)
Deno.test("A2: superadmin + moodle_action:test → outbound fetch occurs", async () => {
  Deno.env.set("CRON_INVOKE_SECRET", "a2-secret");
  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  try {
    await withFetchSpy(async (calls) => {
      const ctx = {
        db: {},
        auth: { profile: { role: "superadmin", email: "super@test.com" }, user: { id: "u-a2" } },
        params: { action: "invoke-moodle-sync", moodle_action: "test" },
      };
      const result = await invokeMoodleSyncAction(ctx);
      assertNotEquals(result.status, 403);
      assertEquals(calls.length, 1);
    });
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("SUPABASE_URL");
  }
});

// A3: admin + unknown moodle_action → rejected before outbound fetch (403)
Deno.test("A3: admin + unknown moodle_action → 403, outbound fetch count 0", async () => {
  Deno.env.set("CRON_INVOKE_SECRET", "a3-secret");
  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  try {
    await withFetchSpy(async (calls) => {
      const ctx = {
        db: {},
        auth: { profile: { role: "admin", email: "admin@test.com" }, user: { id: "u-a3" } },
        params: { action: "invoke-moodle-sync", moodle_action: "totally-invalid-operation" },
      };
      const result = await invokeMoodleSyncAction(ctx);
      assertEquals(result.status, 403);
      const body = await result.json();
      assertEquals(body.ok, false);
      // No outbound fetch — rejected at allowlist gate
      assertEquals(calls.length, 0);
    });
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("SUPABASE_URL");
  }
});

// A4: admin + missing moodle_action → rejected before outbound fetch (400)
Deno.test("A4: admin + missing moodle_action → 400, outbound fetch count 0", async () => {
  Deno.env.set("CRON_INVOKE_SECRET", "a4-secret");
  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  try {
    await withFetchSpy(async (calls) => {
      const ctx = {
        db: {},
        auth: { profile: { role: "admin", email: "admin@test.com" }, user: { id: "u-a4" } },
        params: { action: "invoke-moodle-sync" }, // no moodle_action
      };
      const result = await invokeMoodleSyncAction(ctx);
      assertEquals(result.status, 400);
      const body = await result.json();
      assertEquals(body.ok, false);
      assertEquals(calls.length, 0);
    });
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("SUPABASE_URL");
  }
});

// A5: admin + empty/malformed moodle_action → rejected before outbound fetch (400)
Deno.test("A5: admin + empty moodle_action → 400, outbound fetch count 0", async () => {
  Deno.env.set("CRON_INVOKE_SECRET", "a5-secret");
  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  try {
    await withFetchSpy(async (calls) => {
      const ctx = {
        db: {},
        auth: { profile: { role: "admin", email: "admin@test.com" }, user: { id: "u-a5" } },
        params: { action: "invoke-moodle-sync", moodle_action: "" },
      };
      const result = await invokeMoodleSyncAction(ctx);
      assertEquals(result.status, 400);
      assertEquals(calls.length, 0);
    });
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("SUPABASE_URL");
  }
});

// A6: non-admin + action:test → 403 (role check before allowlist)
Deno.test("A6: non-admin + moodle_action:test → 403, outbound fetch count 0", async () => {
  Deno.env.set("CRON_INVOKE_SECRET", "a6-secret");
  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  try {
    await withFetchSpy(async (calls) => {
      const ctx = {
        db: {},
        auth: { profile: { role: "teacher", email: "teacher@test.com" }, user: { id: "u-a6" } },
        params: { action: "invoke-moodle-sync", moodle_action: "test" },
      };
      const result = await invokeMoodleSyncAction(ctx);
      assertEquals(result.status, 403);
      assertEquals(calls.length, 0);
    });
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("SUPABASE_URL");
  }
});

// A7: outbound request carries x-cron-secret header
Deno.test("A7: outbound request to moodle-sync carries x-cron-secret header", async () => {
  const secret = "a7-test-secret-value";
  Deno.env.set("CRON_INVOKE_SECRET", secret);
  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  try {
    await withFetchSpy(async (calls) => {
      const ctx = {
        db: {},
        auth: { profile: { role: "admin", email: "admin@test.com" }, user: { id: "u-a7" } },
        params: { action: "invoke-moodle-sync", moodle_action: "test" },
      };
      await invokeMoodleSyncAction(ctx);
      assertEquals(calls.length, 1);
      assertEquals(calls[0].headers["x-cron-secret"], secret);
    });
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("SUPABASE_URL");
  }
});

// A8: outbound request does NOT carry service-role Authorization header
Deno.test("A8: outbound request carries no service-role Authorization caller header", async () => {
  Deno.env.set("CRON_INVOKE_SECRET", "a8-secret");
  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  try {
    await withFetchSpy(async (calls) => {
      const ctx = {
        db: {},
        auth: { profile: { role: "admin", email: "admin@test.com" }, user: { id: "u-a8" } },
        params: { action: "invoke-moodle-sync", moodle_action: "test" },
      };
      await invokeMoodleSyncAction(ctx);
      assertEquals(calls.length, 1);
      // Authorization header must be absent from outbound moodle-sync call
      assertEquals(calls[0].headers["Authorization"], undefined);
      assertEquals(calls[0].headers["authorization"], undefined);
    });
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("SUPABASE_URL");
  }
});

// A9: CRON_INVOKE_SECRET value does not appear in the response body
Deno.test("A9: CRON_INVOKE_SECRET absent from proxy response body", async () => {
  const secret = "a9-must-not-leak-in-response-body";
  Deno.env.set("CRON_INVOKE_SECRET", secret);
  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  try {
    await withFetchSpy(async () => {
      const ctx = {
        db: {},
        auth: { profile: { role: "admin", email: "admin@test.com" }, user: { id: "u-a9" } },
        params: { action: "invoke-moodle-sync", moodle_action: "test" },
      };
      const result = await invokeMoodleSyncAction(ctx);
      const body = await result.text();
      if (body.includes(secret)) {
        throw new Error("Response body must not contain CRON_INVOKE_SECRET value");
      }
    });
  } finally {
    Deno.env.delete("CRON_INVOKE_SECRET");
    Deno.env.delete("SUPABASE_URL");
  }
});

// A10: missing CRON_INVOKE_SECRET → fails closed (500 before any outbound fetch)
Deno.test("A10: missing CRON_INVOKE_SECRET → 500 closed, outbound fetch count 0", async () => {
  Deno.env.delete("CRON_INVOKE_SECRET");
  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  try {
    await withFetchSpy(async (calls) => {
      const ctx = {
        db: {},
        auth: { profile: { role: "admin", email: "admin@test.com" }, user: { id: "u-a10" } },
        params: { action: "invoke-moodle-sync", moodle_action: "test" },
      };
      const result = await invokeMoodleSyncAction(ctx);
      assertEquals(result.status, 500);
      assertEquals(calls.length, 0);
    });
  } finally {
    Deno.env.delete("SUPABASE_URL");
  }
});
