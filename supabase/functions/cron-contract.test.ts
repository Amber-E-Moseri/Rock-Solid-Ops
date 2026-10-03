/**
 * Scheduled-invocation auth contract (static).
 *
 * Proves that the operator cutover script re-points every migration-defined cron
 * job to the x-cron-secret contract the hardened Edge Functions require, without a
 * secret in source and without inventing jobs or schedules. Needs --allow-read only;
 * no database, no network, no real secret.
 */
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";

const read = (rel: string) => Deno.readTextFile(new URL(rel, import.meta.url));

const OPS_PATH = "../ops/cron-cutover-x-cron-secret.sql";
const LEGACY_MIGRATIONS = [
  "202605171200_cron_review_checkin.sql",
  "202605170004_student_engagement_tracking.sql",
  "202605180002_waitlist_processor.sql",
  "202605172100_report_crons.sql",
  "202605171900_moodle_grade_sync_cron.sql",
  "202605190950_attendance_reminder_cron.sql",
];

type Job = { name: string; fn: string; body: string };

function parseLegacy(sql: string): Job[] {
  const jobs: Job[] = [];
  const re = /cron\.schedule\(%L, %L, %L\)',\s*'([^']+)',\s*'([^']+)',\s*'((?:[^']|'')*)'/g;
  for (const m of sql.matchAll(re)) {
    const cmd = m[3].replaceAll("''", "'");
    const fn = /functions\/v1\/([a-z-]+)/.exec(cmd)?.[1] ?? "";
    const body = /body := '(\{.*?\})'::jsonb/.exec(cmd)?.[1] ?? "";
    jobs.push({ name: m[1], fn, body });
  }
  return jobs;
}

function parseOps(sql: string): Job[] {
  const jobs: Job[] = [];
  const re = /^\s*\('([a-z-]+)',\s*'([a-z-]+)',\s*'(\{.*?\})'\)/gm;
  for (const m of sql.matchAll(re)) jobs.push({ name: m[1], fn: m[2], body: m[3] });
  return jobs;
}

// The command template is the format() string inside the script's DO block.
function commandTemplate(sql: string): string {
  const m = /v_command := format\(\s*'((?:[^']|'')*)'/.exec(sql);
  assert(m, "command template not found in ops script");
  return m![1].replaceAll("''", "'");
}

Deno.test("CR01: legacy cron migrations still define Bearer jobs (documents what is being replaced)", async () => {
  let total = 0;
  for (const f of LEGACY_MIGRATIONS) {
    const sql = await read(`../migrations/${f}`);
    const jobs = parseLegacy(sql);
    assert(jobs.length >= 1, `${f}: no cron job parsed`);
    assert(/Bearer <SERVICE_ROLE_KEY>/.test(sql), `${f}: expected legacy bearer placeholder`);
    total += jobs.length;
  }
  assertEquals(total, 9);
});

Deno.test("CR02: ops script is not a migration and lives outside supabase/migrations", async () => {
  const sql = await read(OPS_PATH);
  assert(/NOT A MIGRATION/.test(sql));
  const migrations = [...Deno.readDirSync(new URL("../migrations/", import.meta.url))].map((e) => e.name);
  assertFalse(migrations.some((n) => n.includes("cron-cutover")));
});

Deno.test("CR03: every legacy job is re-pointed with identical function and body", async () => {
  const ops = parseOps(await read(OPS_PATH));
  const byName = new Map(ops.map((j) => [j.name, j]));
  for (const f of LEGACY_MIGRATIONS) {
    for (const legacy of parseLegacy(await read(`../migrations/${f}`))) {
      const o = byName.get(legacy.name);
      assert(o, `ops script is missing legacy job ${legacy.name}`);
      assertEquals(o!.fn, legacy.fn, `${legacy.name}: function mismatch`);
      assertEquals(o!.body, legacy.body, `${legacy.name}: body mismatch`);
    }
  }
  // moodle-sync's job is defined only in CUTOVER_PLAN.md (no migration).
  assertEquals(byName.get("moodle-sync")?.fn, "moodle-sync");
  assertEquals(ops.length, 10);
});

Deno.test("CR04: command template sends x-cron-secret from Vault and no bearer/Authorization", async () => {
  const tpl = commandTemplate(await read(OPS_PATH));
  assert(tpl.includes("'x-cron-secret'"));
  assert(tpl.includes("vault.decrypted_secrets"));
  assert(tpl.includes("name = 'cron_invoke_secret'"));
  assertFalse(/authorization/i.test(tpl), "must not send Authorization");
  assertFalse(/bearer/i.test(tpl), "must not send a bearer credential");
});

Deno.test("CR05: no secret material or placeholder-to-substitute in the ops script", async () => {
  const sql = await read(OPS_PATH);
  assertFalse(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(sql), "JWT-looking literal");
  assertFalse(/<[A-Z_]*(SECRET|KEY)[A-Z_]*>/.test(sql.replace(/^--.*$/gm, "")), "placeholder to hand-edit in executable SQL");
  assertFalse(/create_secret\(\s*'[^<'][^']*'/i.test(sql.replace(/^--.*$/gm, "")), "executable create_secret with a literal");
});

Deno.test("CR06: script only re-points existing jobs — never schedules/creates or changes schedules", async () => {
  const code = (await read(OPS_PATH)).replace(/^--.*$/gm, "");
  assertFalse(/cron\.schedule\s*\(/.test(code), "must not call cron.schedule");
  assertFalse(/schedule\s*:=/.test(code), "must not change a schedule");
  assert(/cron\.alter_job\s*\(\s*job_id := v_id, command := v_command\s*\)/.test(code));
});

Deno.test("CR07: script fails loudly when prerequisites are absent", async () => {
  const code = await read(OPS_PATH);
  for (const needle of ["pg_cron is not installed", "pg_net is not installed", "Vault secret ''cron_invoke_secret'' is missing"]) {
    assert(code.includes(needle), `missing guard: ${needle}`);
  }
  assertEquals((code.match(/RAISE EXCEPTION/g) ?? []).length >= 3, true);
});

Deno.test("CR08: every function a cron job targets enforces validateCronAuth (header contract matches)", async () => {
  const ops = parseOps(await read(OPS_PATH));
  const fns = [...new Set(ops.map((j) => j.fn))];
  assertEquals(fns.length, 7);
  for (const fn of fns) {
    const src = await read(`./${fn}/index.ts`);
    assert(/validateCronAuth\s*\(/.test(src), `${fn} does not call validateCronAuth`);
    assertFalse(/role\s*===?\s*["']service_role["']|!==\s*["']service_role["']/.test(src), `${fn} trusts a decoded role claim`);
  }
});
