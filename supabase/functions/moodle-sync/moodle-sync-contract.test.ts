import { assert } from "jsr:@std/assert@1";

// Source-contract checks. moodle-sync calls Deno.serve at module load, so the handler cannot be imported
// in a unit test. These checks fix the order of operations: authorization must precede every mutation
// and every Moodle request, and the claim must be conditional.
const raw = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const src = raw.replaceAll("\r\n", "\n");

function at(needle: string): number {
  const i = src.indexOf(needle);
  assert(i >= 0, `missing: ${needle}`);
  return i;
}

Deno.test("authorization runs before the stuck-row reset (first database write)", () => {
  const auth = at("authorizeMoodleSyncCaller({");
  assert(auth < at('.update({ sync_status: "PENDING"'), "auth must precede the reset write");
  assert(auth < at('"MOODLE_SYNC_STUCK_RESET"'), "auth must precede the reset audit");
});

Deno.test("authorization runs before payload validation and before any Moodle call", () => {
  const auth = at("authorizeMoodleSyncCaller({");
  assert(auth < at("isValidPayload(payload)"));
  assert(auth < at('callMoodle(MOODLE_URL, MOODLE_TOKEN, "core_webservice_get_site_info"'));
  assert(auth < at("const { data: rows, error: rowsError } = forceId"));
});

Deno.test("the processing claim is conditional on a claimable status", () => {
  const literal = '.update({ sync_status: "PROCESSING"';
  assert(src.split(literal).length === 2, "exactly one PROCESSING claim statement");
  const start = src.indexOf(literal);
  const statement = src.slice(start, src.indexOf(";", start));
  assert(statement.includes('.in("sync_status", ["PENDING", "RETRYING", "FAILED"])'), "claim must be guarded");
  assert(statement.includes('.select("id")'), "claim must return the claimed id");
});

Deno.test("the test action is the only admin-JWT path", () => {
  assert(src.includes('allowAdminJwt: String(payload?.action || "").trim() === "test"'));
});
