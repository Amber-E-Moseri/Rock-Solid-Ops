import { assert, assertEquals } from "jsr:@std/assert@1";
import { handler } from "./index.ts";

// Wave C3A: failure-state persistence for moodle_enrollment_sync.
//
// These tests run the real handler against a fake PostgREST + fake Moodle.
// The fake PostgREST enforces the column set that the repository migrations
// define for public.moodle_enrollment_sync (derived from the SQL, not
// hand-written), and rejects PATCH bodies containing unknown columns the way
// PostgREST does (PGRST204). That is what makes a missing column observable.

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const TABLE = "moodle_enrollment_sync";

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

// Column set (name -> declared type text) for the table, from top-level migrations.
function deriveSchemaFromMigrations(): Map<string, string> {
  const cols = new Map<string, string>();
  const files = [...Deno.readDirSync(MIGRATIONS_DIR)]
    .filter((e) => e.isFile && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();

  for (const name of files) {
    const sql = stripSqlComments(Deno.readTextFileSync(new URL(name, MIGRATIONS_DIR)));
    for (const stmt of sql.split(";")) {
      const create = stmt.match(
        new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+(?:public\\.)?${TABLE}\\s*\\(([\\s\\S]*)\\)`, "i"),
      );
      if (create) {
        for (const line of create[1].split("\n")) {
          const m = line.trim().match(/^([a-z_][a-z0-9_]*)\s+([a-z]+)/i);
          if (m && !["constraint", "primary", "unique", "check", "foreign"].includes(m[1].toLowerCase())) {
            cols.set(m[1].toLowerCase(), m[2].toLowerCase());
          }
        }
      }
      if (new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${TABLE}\\b`, "i").test(stmt)) {
        for (const m of stmt.matchAll(/add\s+column\s+if\s+not\s+exists\s+([a-z_][a-z0-9_]*)\s+([a-z]+)/gi)) {
          cols.set(m[1].toLowerCase(), m[2].toLowerCase());
        }
      }
    }
  }
  return cols;
}

type Row = Record<string, unknown>;

function startFakeBackend(opts: {
  schema: Set<string>;
  row: Row;
  moodle: "server_error" | "auth_error" | "success";
}) {
  const state = {
    row: { ...opts.row },
    patchRejections: [] as string[],
    inserts: [] as Array<{ table: string; body: unknown }>,
  };

  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url);

    if (url.pathname.endsWith("/webservice/rest/server.php")) {
      const form = new URLSearchParams(await req.text());
      const fn = form.get("wsfunction");
      if (opts.moodle === "server_error") return new Response("boom", { status: 500 });
      if (opts.moodle === "auth_error") {
        return Response.json({ exception: "moodle_exception", message: "Invalid token - access denied" });
      }
      if (fn === "core_user_get_users") return Response.json({ users: [{ id: 7, username: "a_b" }] });
      if (fn === "core_user_update_users") return Response.json({});
      return Response.json(null); // enrol_manual_enrol_users
    }

    const m = url.pathname.match(/\/rest\/v1\/([a-z_]+)$/);
    if (!m) return new Response("not found", { status: 404 });
    const table = m[1];

    if (table === TABLE) {
      if (req.method === "PATCH") {
        const body = (await req.json()) as Row;
        const unknown = Object.keys(body).filter((k) => !opts.schema.has(k));
        if (unknown.length) {
          state.patchRejections.push(unknown.join(","));
          return Response.json(
            { code: "PGRST204", message: `Could not find the '${unknown[0]}' column of '${TABLE}' in the schema cache` },
            { status: 400 },
          );
        }
        // Stuck-PROCESSING recovery selects by status without an id filter; nothing is stuck here.
        if (!url.searchParams.get("id")) return Response.json([]);
        state.row = { ...state.row, ...body };
        return Response.json([{ id: state.row.id }]);
      }
      if (req.method === "GET") return Response.json([state.row]);
    }

    if (req.method === "POST") {
      state.inserts.push({ table, body: await req.json().catch(() => null) });
      return new Response(null, { status: 201 });
    }
    return Response.json([]); // every other read: no rows
  });

  return {
    state,
    port: (server.addr as Deno.NetAddr).port,
    stop: () => server.shutdown(),
  };
}

const SECRET = "test-secret-c3a";
const BASE_ROW: Row = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "student@example.com",
  full_name: "Test Student",
  registration_status: "ASSIGNED",
  sync_status: "PENDING",
  status: "PENDING",
  retry_count: 0,
  sync_attempts: 0,
  course_id: "42",
};

async function runOnce(port: number) {
  Deno.env.set("CRON_INVOKE_SECRET", SECRET);
  Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${port}`);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key");
  Deno.env.set("MOODLE_URL", `http://127.0.0.1:${port}`);
  Deno.env.set("MOODLE_TOKEN", "fake-moodle-token");
  try {
    const res = await handler(
      new Request("https://x.supabase.co/functions/v1/moodle-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": SECRET },
        body: "{}",
      }),
    );
    await res.body?.cancel();
  } finally {
    for (const k of ["CRON_INVOKE_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MOODLE_URL", "MOODLE_TOKEN"]) {
      Deno.env.delete(k);
    }
  }
}

async function withConsoleErrors<T>(fn: () => Promise<T>): Promise<{ result: T; errors: unknown[][] }> {
  const errors: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => {
    errors.push(a);
  };
  try {
    return { result: await fn(), errors };
  } finally {
    console.error = orig;
  }
}

Deno.test("C3A-1: migrations define next_retry_at as timestamptz on moodle_enrollment_sync", () => {
  const schema = deriveSchemaFromMigrations();
  assertEquals(schema.get("next_retry_at"), "timestamptz");
  // Every column the failure patch writes must be defined by migrations.
  for (
    const c of [
      "sync_status", "status", "error_code", "last_error", "error_message",
      "retry_count", "retry_requested_at", "next_retry_at", "failure_reason", "updated_at",
    ]
  ) {
    assert(schema.has(c), `migrations do not define column ${c}`);
  }
});

Deno.test("C3A-2: retryable failure persists RETRYING + retry_count + next_retry_at under migration-defined schema", async () => {
  const schema = new Set(deriveSchemaFromMigrations().keys());
  const be = startFakeBackend({ schema, row: BASE_ROW, moodle: "server_error" });
  try {
    await withConsoleErrors(() => runOnce(be.port));
    assertEquals(be.state.patchRejections, []);
    assertEquals(be.state.row.sync_status, "RETRYING");
    assertEquals(be.state.row.status, "RETRYING");
    assertEquals(be.state.row.retry_count, 1);
    assert(typeof be.state.row.next_retry_at === "string", "next_retry_at should be persisted");
    assert(typeof be.state.row.retry_requested_at === "string", "retry_requested_at should be persisted");
  } finally {
    await be.stop();
  }
});

Deno.test("C3A-3: non-retryable failure persists FAILED + error_code under migration-defined schema", async () => {
  const schema = new Set(deriveSchemaFromMigrations().keys());
  const be = startFakeBackend({ schema, row: BASE_ROW, moodle: "auth_error" });
  try {
    await withConsoleErrors(() => runOnce(be.port));
    assertEquals(be.state.patchRejections, []);
    assertEquals(be.state.row.sync_status, "FAILED");
    assertEquals(be.state.row.retry_count, 1);
    assertEquals(be.state.row.next_retry_at, null);
    assertEquals(be.state.row.error_code, "AUTH");
  } finally {
    await be.stop();
  }
});

Deno.test("C3A-4: retry cap is reachable — PERMANENTLY_FAILED after max retries", async () => {
  const schema = new Set(deriveSchemaFromMigrations().keys());
  const be = startFakeBackend({ schema, row: BASE_ROW, moodle: "server_error" });
  try {
    for (let i = 0; i < 6; i++) await withConsoleErrors(() => runOnce(be.port));
    assertEquals(be.state.row.retry_count, 5);
    assertEquals(be.state.row.sync_status, "PERMANENTLY_FAILED");
    assertEquals(be.state.row.error_code, "MAX_RETRIES_EXCEEDED");
  } finally {
    await be.stop();
  }
});

Deno.test("C3A-5: success path is unchanged — SYNCED, no next_retry_at written", async () => {
  const schema = new Set(deriveSchemaFromMigrations().keys());
  const be = startFakeBackend({ schema, row: BASE_ROW, moodle: "success" });
  try {
    await withConsoleErrors(() => runOnce(be.port));
    assertEquals(be.state.patchRejections, []);
    assertEquals(be.state.row.sync_status, "SYNCED");
    assertEquals(be.state.row.moodle_user_id, "7");
    assertEquals("next_retry_at" in be.state.row, false);
    assertEquals(be.state.row.retry_count, 0);
  } finally {
    await be.stop();
  }
});

Deno.test("C3A-6: pre-fix production schema (no next_retry_at) drops the failure state and is now observable", async () => {
  const schema = new Set(deriveSchemaFromMigrations().keys());
  schema.delete("next_retry_at"); // the confirmed production state before the migration
  const be = startFakeBackend({ schema, row: BASE_ROW, moodle: "server_error" });
  try {
    const { errors } = await withConsoleErrors(() => runOnce(be.port));
    // Defect reproduced: row is stranded in PROCESSING and the counter never moves.
    assertEquals(be.state.row.sync_status, "PROCESSING");
    assertEquals(be.state.row.retry_count, 0);
    // Visibility: the swallowed patch failure is now logged, column names only.
    const logged = errors.find((e) => e[0] === "MOODLE_SYNC_PATCH_FAILED");
    assert(logged, "expected MOODLE_SYNC_PATCH_FAILED to be logged");
    const detail = logged[1] as { id: string; code: string | null; message: string; attempted_columns: string[] };
    assertEquals(detail.id, BASE_ROW.id);
    assertEquals(detail.code, "PGRST204");
    assert(detail.attempted_columns.includes("next_retry_at"));
    const flat = JSON.stringify(logged);
    assertEquals(flat.includes("fake-moodle-token"), false);
    assertEquals(flat.includes("fake-service-key"), false);
  } finally {
    await be.stop();
  }
});
