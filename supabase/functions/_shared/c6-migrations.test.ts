// Static guards for the post-certification C6 migrations (the behavioural proof is
// supabase/tests/security/c6-claim-concurrency.test.sh, which needs a live Postgres).
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";

const read = (name: string) => Deno.readTextFile(new URL(`../../migrations/${name}`, import.meta.url));
const strip = (sql: string) => sql.replace(/--[^\n]*/g, "");

Deno.test("CM01: 202610030002 makes the first claim an atomic INSERT ... ON CONFLICT, not check-then-insert", async () => {
  const sql = strip(await read("202610030002_claim_nexus_task_conflict_safe.sql"));
  assert(/insert into public\.rocksolid_task_links[\s\S]*?on conflict \(dedupe_key\) do nothing/i.test(sql));
  assert(/for update/i.test(sql), "the locked-row path (lease/fencing logic) is preserved");
  assert(sql.includes("'TIMEOUT_UNKNOWN', 'RECONCILE_FAILED'"), "reconcile-owned states stay excluded from re-claim");
  assert(sql.includes("make_interval(mins => v_ttl_minutes)") && sql.includes("v_ttl_minutes int := 2"), "2-minute lease preserved");
  assert(/security definer set search_path = 'public'/i.test(sql));
  assert(/grant execute on function public\.claim_nexus_task\(text, text, text, uuid\) to service_role/i.test(sql));
  assert(/revoke all on function public\.claim_nexus_task\(text, text, text, uuid\) from anon/i.test(sql));
  assertFalse(/grant execute[^;]*to (anon|authenticated|public)/i.test(sql), "no widening of EXECUTE");
});

Deno.test("CM02: the concurrency test is wired into the migration gate", async () => {
  const gate = await Deno.readTextFile(new URL("../../../scripts/test-migration.sh", import.meta.url));
  assert(gate.includes("supabase/tests/security/c6-claim-concurrency.test.sh"));
  const t = await Deno.readTextFile(new URL("../../tests/security/c6-claim-concurrency.test.sh", import.meta.url));
  assertEquals(t.includes("pg_advisory_lock_shared"), true, "uses a real advisory-lock barrier, not sequential calls");
});
