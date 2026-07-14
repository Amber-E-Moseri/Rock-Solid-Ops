// Parity test for the consolidated "class now available" dedupe key.
//
// Guards the contract that the cron producer (waitlist-processor) and the DB
// trigger producer build BYTE-IDENTICAL dedupe keys for identical
// (applicant, batch, class_option) inputs.
//
// SQL side (source of truth for the format):
//   supabase/migrations/202607141000_waitlist_consolidate_dedup.sql,
//   queue_waitlisted_class_available_notifications():
//     format('class_available:%s:%s:%s', v_app.id, p_batch_id, p_class_option_id)
// Postgres format('%s') stringifies each argument verbatim with no quoting or
// escaping, exactly like a JS template literal, so mirroring the format string
// here is a faithful equivalence check.
//
// Imports dedupe.ts (not index.ts): index.ts creates a Supabase client at
// module scope from env vars, which is not import-safe under `deno test`.

import {
  buildClassAvailableDedupeKey,
  CANONICAL_TEMPLATE_KEY,
  DEDUPE_KEY_PREFIX,
} from "./dedupe.ts";

// Mirror of the SQL producer's format string (see header). If the migration's
// format string ever changes, this must change with it — and vice versa.
function sqlFormatMirror(applicantId: string, batchId: string, classOptionId: string): string {
  return "class_available:%s:%s:%s"
    .replace("%s", applicantId)
    .replace("%s", batchId)
    .replace("%s", classOptionId);
}

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("trigger and cron dedupe keys are byte-identical for the same tuple", () => {
  const applicantId = "3f2a9c44-7b1e-4d2a-9e0f-0a1b2c3d4e5f"; // applicants.id is UUID
  const batchId = "2025A"; // batches.batch_id TEXT (000_baseline_squash.sql:189)
  const classOptionId = "CO_TUES_1900"; // class_options.class_option_id TEXT (000_baseline_squash.sql:224)

  const cronKey = buildClassAvailableDedupeKey(applicantId, batchId, classOptionId);
  const sqlKey = sqlFormatMirror(applicantId, batchId, classOptionId);

  assertEquals(cronKey, sqlKey, "cron key must equal SQL format() output");
  assertEquals(
    cronKey,
    "class_available:3f2a9c44-7b1e-4d2a-9e0f-0a1b2c3d4e5f:2025A:CO_TUES_1900",
    "canonical key literal",
  );
});

Deno.test("key is timestamp-free and stable across calls", () => {
  const a = buildClassAvailableDedupeKey("id-1", "B3", "opt-1");
  const b = buildClassAvailableDedupeKey("id-1", "B3", "opt-1");
  assertEquals(a, b, "same inputs must always produce the same key (idempotent)");
  if (/\d{4}-\d{2}-\d{2}|\d{10,}/.test(a.replace("id-1", "").replace("B3", "").replace("opt-1", ""))) {
    throw new Error("key must not contain a timestamp component");
  }
});

Deno.test("prefix and template key constants", () => {
  assertEquals(DEDUPE_KEY_PREFIX, "class_available", "dedupe prefix");
  assertEquals(CANONICAL_TEMPLATE_KEY, "classes_now_available", "canonical template key");
  const key = buildClassAvailableDedupeKey("a", "b", "c");
  assertEquals(key, "class_available:a:b:c", "shape is prefix:applicant:batch:class_option");
});

Deno.test("empty components are preserved positionally (documented behavior)", () => {
  // Callers must not pass empty ids; if they do, the key still keeps four
  // colon-delimited positions rather than silently collapsing, matching what
  // SQL format('%s') does with an empty string.
  assertEquals(
    buildClassAvailableDedupeKey("", "", ""),
    "class_available:::",
    "empty components keep their delimiters",
  );
  assertEquals(
    sqlFormatMirror("", "", ""),
    "class_available:::",
    "SQL mirror agrees on empty components",
  );
});

Deno.test("colon inside a TEXT id is a documented theoretical collision, parity still holds", () => {
  // applicants.id is UUID (000_baseline_squash.sql:328) and can never contain
  // ':'. batch_id / class_option_id are TEXT (lines 189, 224) with no schema
  // constraint forbidding ':'. Components are interpolated raw, so
  // ("B", "1:C") and ("B:1", "C") for (batch, class_option) would collide:
  const k1 = buildClassAvailableDedupeKey("uuid", "B", "1:C");
  const k2 = buildClassAvailableDedupeKey("uuid", "B:1", "C");
  assertEquals(k1, k2, "documented: colon-bearing TEXT ids can collide");
  // No ID generator in this repo emits ':' (batch ids like '2025A'/'B3';
  // class option ids are preserved Apps Script text ids), so this is a
  // documented caveat, not a live risk. SQL behaves identically:
  assertEquals(sqlFormatMirror("uuid", "B", "1:C"), k1, "SQL mirror parity for colon case");
});
