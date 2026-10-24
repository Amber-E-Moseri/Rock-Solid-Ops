// Static wiring guard for the two functions whose handlers cannot be imported in unit tests (they start a
// server at import time). It checks that the authorization gate runs before the body is read and before any
// database query or Moodle call, that forceId uses the selectable-status filter, and that the production
// Moodle host is not hardcoded. Requires --allow-read. Dependency-free so it runs offline as well as in CI.
function assertTrue(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function handlerSource(relativePath: string): Promise<string> {
  const text = await Deno.readTextFile(new URL(relativePath, import.meta.url));
  const start = text.indexOf("Deno.serve(");
  assertTrue(start >= 0, `${relativePath}: Deno.serve handler not found`);
  return text.slice(start);
}

function indexOfOrFail(haystack: string, needle: string, label: string): number {
  const at = haystack.indexOf(needle);
  assertTrue(at >= 0, `${label}: missing "${needle}"`);
  return at;
}

Deno.test("waitlist-processor: authorization runs before the body is read and before any query", async () => {
  const handler = await handlerSource("../waitlist-processor/index.ts");
  const gate = indexOfOrFail(handler, "authorizeCaller(", "waitlist gate");
  assertTrue(gate < handler.indexOf("req.json()"), "gate must precede the body read");
  assertTrue(gate < handler.indexOf("withTimeout("), "gate must precede any batch or slot query");
  assertTrue(gate < handler.indexOf("sb.from("), "gate must precede any database access in the handler");
  assertTrue(handler.includes("WAITLIST_PROCESS_ROLES"), "waitlist gate must use the waitlist role policy");
});

Deno.test("moodle-sync: authorization runs before the body read, stuck-row reset and Moodle calls", async () => {
  const handler = await handlerSource("../moodle-sync/index.ts");
  const gate = indexOfOrFail(handler, "authorizeCaller(", "moodle gate");
  assertTrue(gate < handler.indexOf("req.json()"), "gate must precede the body read");
  assertTrue(
    gate < handler.indexOf("MOODLE_SYNC_STUCK_RESET"),
    "gate must precede the stuck-row reset (a database write)",
  );
  assertTrue(gate < handler.indexOf('from("moodle_enrollment_sync")'), "gate must precede every queue query");
  assertTrue(gate < handler.indexOf('payload?.action'), "gate must precede action=test");
  assertTrue(gate < handler.indexOf("callMoodle("), "gate must precede any Moodle call, including action=test");
  assertTrue(handler.includes("MOODLE_SYNC_STAFF_ROLES"), "moodle gate must use the manual staff role policy");
});

Deno.test("moodle-sync: forceId is filtered to selectable ASSIGNED rows", async () => {
  const handler = await handlerSource("../moodle-sync/index.ts");
  const forced = indexOfOrFail(handler, ".eq(\"id\", forceId)", "forceId query");
  const window = handler.slice(forced, forced + 260);
  assertTrue(window.includes('.eq("registration_status", "ASSIGNED")'), "forceId must require ASSIGNED");
  assertTrue(window.includes(".in(\"sync_status\", SELECTABLE_SYNC_STATUSES)"), "forceId must exclude SYNCED rows");
});

Deno.test("moodle-sync: rows are claimed before any Moodle account or password call", async () => {
  const handler = await handlerSource("../moodle-sync/index.ts");
  const claim = indexOfOrFail(handler, "claimSyncRow(db, id)", "row claim");
  const moodleUser = indexOfOrFail(handler, "await findOrCreateMoodleUser(", "moodle account call");
  assertTrue(claim < moodleUser, "a row must be claimed before any Moodle account or password call");
  assertTrue(handler.includes("isSelectableSyncRow(row)"), "a non-selectable row must be skipped before work");
});

Deno.test("moodle-sync: no hardcoded production Moodle host", async () => {
  const text = await Deno.readTextFile(new URL("../moodle-sync/index.ts", import.meta.url));
  assertTrue(!text.includes("rocksolid.lwcanada.org"), "moodle-sync must take its host from MOODLE_URL");
});
