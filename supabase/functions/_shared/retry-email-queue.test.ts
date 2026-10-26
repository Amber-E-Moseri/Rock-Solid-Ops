// email_queue has no last_error column (the schema check returned it as the single missing column on staging).
// The retry worker must neither select nor write it. email_queue.error_message is the only error field, and
// the worker still clears it on retry. scheduled_notifications does have last_error, so its retry must keep it.
import { assertEquals, assertMatch, assertStringIncludes } from "jsr:@std/assert@1";

const workerSrc = await Deno.readTextFile(new URL("../retry-worker/index.ts", import.meta.url));

// Object body of the first `.from(table).update({ ... })` in the worker, which is that table's retry branch.
function firstUpdateBody(table: string): string {
  const match = workerSrc.match(new RegExp(`\\.from\\("${table}"\\)\\s*\\.update\\(\\{([\\s\\S]*?)\\}\\)`));
  if (!match) throw new Error(`no update for ${table} in retry-worker`);
  // Drop line comments so explanatory notes inside the object cannot satisfy or defeat the checks.
  return match[1].replace(/\/\/.*$/gm, "");
}

Deno.test("email_queue retry update does not write last_error", () => {
  const body = firstUpdateBody("email_queue");
  assertEquals(/\blast_error\b/.test(body), false, "email_queue has no last_error column");
  assertMatch(body, /\berror_message:\s*null/, "retry still clears error_message");
  assertMatch(body, /\bstatus:\s*"Pending"/, "retry still sets the row back to Pending");
  assertStringIncludes(body, "retry_count:");
  assertStringIncludes(body, "last_retry_at:");
});

Deno.test("email_queue read does not select last_error", () => {
  const match = workerSrc.match(/\.from\("email_queue"\)\s*\.select\("([^"]*)"\)/);
  if (!match) throw new Error("no select for email_queue in retry-worker");
  assertEquals(match[1].split(",").includes("last_error"), false);
});

Deno.test("scheduled_notifications retry still writes last_error (the column exists there)", () => {
  assertMatch(firstUpdateBody("scheduled_notifications"), /\blast_error:\s*null/);
});
