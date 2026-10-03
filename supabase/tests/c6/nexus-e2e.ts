/**
 * C6 end-to-end certification: REAL Rock Solid edge code -> REAL Rock Solid Postgres (via PostgREST)
 * -> REAL Nexus task-api -> REAL Nexus Postgres. A fault-injecting proxy sits in front of Nexus to create the
 * "request outcome unknown" scenarios without touching any real network.
 *
 * Environment (all local/staging, never production):
 *   RS_URL                 Rock Solid gateway (…/rest/v1 → PostgREST)        e.g. http://127.0.0.1:54321
 *   RS_SERVICE_KEY         Rock Solid service_role JWT
 *   RS_DB_CONTAINER        docker container running the Rock Solid DB         (psql -U postgres)
 *   NEXUS_TASK_API_URL     task-api base incl. /task-api                      e.g. http://127.0.0.1:8100/task-api
 *   NEXUS_TASK_API_KEY     key with tasks:write + tasks:read (department scoped, NO sprint)
 *   NEXUS_KEY_READONLY / NEXUS_KEY_WRITEONLY   keys lacking write / read
 *   NEXUS_DB_CONTAINER     docker container running the Nexus DB
 *   NEXUS_ASSIGNEE_ID      an existing Nexus users.id (the mapped admin)
 *   NEXUS_MEMBER_ID        another Nexus user in the key's department
 *   NEXUS_KEY_DEPARTMENT   the department id the key is scoped to
 * Run: deno run --allow-net --allow-env --allow-run=docker supabase/tests/c6/nexus-e2e.ts
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildDedupeKey, buildExternalUniqueKey, createNexusTask, ensureNexusTask } from "../../functions/_shared/nexus-tasks.ts";
import { reconcileUnknownNexusTasks } from "../../functions/_shared/nexus-reconcile.ts";

const env = (k: string) => { const v = Deno.env.get(k); if (!v) { console.error(`missing env ${k}`); Deno.exit(1); } return v; };
const RS_URL = env("RS_URL"), RS_SERVICE = env("RS_SERVICE_KEY"), RS_DB = env("RS_DB_CONTAINER");
const NEXUS_URL = env("NEXUS_TASK_API_URL"), NEXUS_KEY = env("NEXUS_TASK_API_KEY");
const KEY_RO = env("NEXUS_KEY_READONLY"), KEY_WO = env("NEXUS_KEY_WRITEONLY");
const NEXUS_DB = env("NEXUS_DB_CONTAINER"), ASSIGNEE = env("NEXUS_ASSIGNEE_ID"), MEMBER = env("NEXUS_MEMBER_ID"), KEY_DEPT = env("NEXUS_KEY_DEPARTMENT");

const db = createClient(RS_URL, RS_SERVICE, { auth: { persistSession: false } });
const TS = Date.now();

async function psql(container: string, sql: string): Promise<string> {
  const { code, stdout, stderr } = await new Deno.Command("docker", {
    args: ["exec", "-i", "-e", "PGPASSWORD=postgres", container, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", "postgres", "-t", "-A", "-c", sql],
    stdout: "piped", stderr: "piped", stdin: "null",
  }).output();
  if (code !== 0) throw new Error(`psql(${container}) failed: ${new TextDecoder().decode(stderr)}`);
  return new TextDecoder().decode(stdout).trim();
}
const rs = (sql: string) => psql(RS_DB, sql);
const nx = (sql: string) => psql(NEXUS_DB, sql);

// ── fault-injecting proxy in front of the real task-api ──
type Mode = { post?: "pass" | "hang_after_forward" | "hang_before_forward" | "ok_malformed"; get?: "pass" | "503" | "hang" };
const mode: Mode = { post: "pass", get: "pass" };
const seen = { postsForwarded: 0, postsReceived: 0, gets: 0 };
const proxy = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
  const u = new URL(req.url);
  const target = NEXUS_URL.replace(/\/task-api$/, "") + u.pathname + u.search;
  const hang = () => new Promise<Response>((_r, rej) => { req.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))); });
  const forward = async () => {
    const headers = new Headers(req.headers); headers.delete("host");
    return await fetch(target, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer() });
  };
  if (req.method === "POST") {
    seen.postsReceived++;
    if (mode.post === "hang_before_forward") return await hang();
    seen.postsForwarded++;
    const res = await forward();
    if (mode.post === "hang_after_forward") { await res.body?.cancel(); return await hang(); }
    if (mode.post === "ok_malformed") { await res.body?.cancel(); return new Response(JSON.stringify({ id: "wrong-shape" }), { status: 201 }); }
    return res;
  }
  if (req.method === "GET") {
    seen.gets++;
    if (mode.get === "503") return new Response("{}", { status: 503 });
    if (mode.get === "hang") return await hang();
    return await forward();
  }
  return new Response("{}", { status: 405 });
});
const PROXY = `http://127.0.0.1:${(proxy.addr as Deno.NetAddr).port}/task-api`;
const cfg = (over: Record<string, unknown> = {}) => ({ nexusUrl: PROXY, nexusApiKey: NEXUS_KEY, timeoutMs: 1500, ...over });
const resetProxy = () => { mode.post = "pass"; mode.get = "pass"; seen.postsForwarded = 0; seen.postsReceived = 0; seen.gets = 0; };

const results: Array<{ id: string; name: string; detail: string; pass: boolean | null }> = [];
// pass === null means UNVERIFIED (could not be determined): never counted as a pass.
const rec = (id: string, name: string, detail: string, pass: boolean | null) => results.push({ id, name, detail, pass });

const payload = (student: string) => ({
  student_id: `${student}-${TS}`, student_name: `E2E ${student}`, email: `${student}@example.test`,
  class_option_id: "CO-E2E", class_number: "3", class_date: "2026-09-20", group_id: `G-${TS}`, subgroup_id: `SG-${TS}`,
});
const keyFor = (student: string) => buildExternalUniqueKey(buildDedupeKey("missed_class", payload(student)));
const dk = (student: string) => buildDedupeKey("missed_class", payload(student));
const nexusCount = async (student: string) => Number(await nx(`select count(*) from public.tasks where external_unique_key = '${keyFor(student)}'`));
const link = async (student: string) => JSON.parse((await rs(`select coalesce((select row_to_json(t) from (select status, nexus_task_id, reconcile_attempts, claim_token is not null as has_claim, error_message, next_reconcile_at is not null as has_next from public.rocksolid_task_links where dedupe_key = '${dk(student)}') t), '{}'::json)`)) || "{}");
const makeDue = (student: string) => rs(`update public.rocksolid_task_links set next_reconcile_at = now() - interval '1 minute', reconcile_claimed_at = null where dedupe_key = '${dk(student)}'`);
// deno-lint-ignore no-explicit-any
const ensure = (student: string, over: Record<string, unknown> = {}) => ensureNexusTask(db as any, "missed_class", payload(student), "e2e@system", cfg(over));
// deno-lint-ignore no-explicit-any
const reconcile = (over: Record<string, unknown> = {}) => reconcileUnknownNexusTasks(db as any, cfg(over), "e2e@system");

const GROUP = `G-${TS}`, SUB = `SG-${TS}`;
try {
  await rs(`insert into public.rocksolid_admin_mappings(admin_email, nexus_user_id, group_id, subgroup_id) values ('e2e-admin@example.test', '${ASSIGNEE}', '${GROUP}', '${SUB}')`);

  // ───────── E1 happy path, assignment, scope ─────────
  resetProxy();
  const auditBefore = Number(await rs(`select count(*) from public.audit_logs where action = 'NEXUS_TASK_CREATED' and details->>'dedupe_key' = '${dk("e1")}'`));
  const r1 = await ensure("e1");
  if (!r1.ok) console.log("DIAG E1 ensure result:", JSON.stringify(r1), "audit:", await rs(`select string_agg(action||':'||coalesce(details->>'error',''), ' | ') from public.audit_logs where actor_email='e2e@system'`));
  const row1 = await nx(`select row_to_json(t) from (select id, title, assignee_id, department_id, sprint_id, task_type, source, source_name, source_type, priority, due_date::text, status from public.tasks where external_unique_key = '${keyFor("e1")}') t`);
  const t1 = row1 ? JSON.parse(row1) : {};
  const l1 = await link("e1");
  rec("E1a", "create: Nexus 201 parsed, id persisted in Rock Solid DB", `ok=${r1.ok} id=${r1.nexus_task_id} link=${JSON.stringify(l1)}`, r1.ok && !!r1.nexus_task_id && l1.status === "CREATED" && l1.nexus_task_id === t1.id);
  rec("E1b", "request used x-api-key, title, external_unique_key, assignee_id and Nexus stored them", `title="${t1.title}" key-present=${!!row1} source=${t1.source}/${t1.source_name}/${t1.source_type} priority=${t1.priority} due=${t1.due_date}`, t1.title === "Missed Class Follow-up: E2E e1" && t1.source === "api" && t1.source_name === "rocksolid" && t1.source_type === "missed_class" && t1.priority === "medium" && /^\d{4}-\d{2}-\d{2}$/.test(t1.due_date));
  rec("E1c", "assignment: rocksolid_admin_mappings.nexus_user_id -> tasks.assignee_id in Nexus", `assignee_id=${t1.assignee_id} expected=${ASSIGNEE}`, t1.assignee_id === ASSIGNEE);
  rec("E1d", "Sprint required = NO (sprint_id null; placed by the key's DEPARTMENT scope)", `sprint_id=${t1.sprint_id} department_id=${t1.department_id} task_type=${t1.task_type}`, t1.sprint_id === null && t1.department_id === KEY_DEPT && t1.task_type === "space");
  const audit = Number(await rs(`select count(*) from public.audit_logs where action = 'NEXUS_TASK_CREATED' and details->>'dedupe_key' = '${dk("e1")}'`)) - auditBefore;
  rec("E1e", "audit_logs row written in the real schema (NEXUS_TASK_CREATED)", `new rows=${audit}`, audit === 1);

  // assignee can actually see the task under Nexus RLS (admin belongs to a DIFFERENT department than the key)
  const visible = async (uid: string): Promise<number | string> => {
    try {
      const o = await nx(`begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true); select count(*) from public.tasks where id = '${t1.id}'; commit;`);
      return Number(o.split("\n").filter((l) => /^\d+$/.test(l)).pop() ?? "-1");
    } catch (e) { return `ERROR: ${String(e).split("\n")[0].slice(0, 90)}`; }
  };
  const stranger = "00000000-0000-4000-8000-000000000001";
  const [vA, vM, vS] = [await visible(ASSIGNEE), await visible(MEMBER), await visible(stranger)];
  const determinable = typeof vA === "number" && typeof vM === "number" && typeof vS === "number";
  rec("E1f", "Nexus RLS: the assignee (a different department than the key) can see the task", `assignee=${vA} dept-member=${vM} stranger=${vS}`, determinable ? (vA === 1 && vS === 0) : null);

  // ───────── E2 idempotency ─────────
  const before = seen.postsReceived;
  const r2 = await ensure("e1");
  rec("E2a", "repeat of the same logical task with the link present: no second POST, same id", `reused=${r2.reused} id=${r2.nexus_task_id} extra POSTs=${seen.postsReceived - before}`, r2.ok && r2.reused && r2.nexus_task_id === t1.id && seen.postsReceived === before);
  await rs(`delete from public.rocksolid_task_links where dedupe_key = '${dk("e1")}'`); // lose Rock Solid's memory entirely
  const r3 = await ensure("e1");
  rec("E2b", "link lost: POST with the SAME external_unique_key -> Nexus 200 duplicate, still ONE Nexus task", `second response reused=${r3.reused} id=${r3.nexus_task_id} first id=${t1.id} actual Nexus tasks=${await nexusCount("e1")}`, r3.ok && r3.reused && r3.nexus_task_id === t1.id && (await nexusCount("e1")) === 1);
  const c1 = await createNexusTask(NEXUS_URL, NEXUS_KEY, { title: "direct" }, `rocksolid:direct:${TS}`, 5000);
  const c2 = await createNexusTask(NEXUS_URL, NEXUS_KEY, { title: "direct again" }, `rocksolid:direct:${TS}`, 5000);
  const directCount = Number(await nx(`select count(*) from public.tasks where external_unique_key = 'rocksolid:direct:${TS}'`));
  rec("E2c", "raw client: same key twice -> first 201 {duplicate:false}, second 200 {duplicate:true}; tasks created = 1", `first=${JSON.stringify(c1)} second=${JSON.stringify(c2)} actual tasks=${directCount}`, !c1.duplicate && c2.duplicate && c1.id === c2.id && directCount === 1);

  // ───────── E3 request outcome unknown, task WAS created ─────────
  resetProxy(); mode.post = "hang_after_forward";
  const r4 = await ensure("e3", { timeoutMs: 700 });
  const l4 = await link("e3");
  rec("E3a", "timeout after Nexus created the task: recorded TIMEOUT_UNKNOWN, no id, reconcile scheduled", `ok=${r4.ok} link=${JSON.stringify(l4)} Nexus tasks=${await nexusCount("e3")}`, !r4.ok && l4.status === "TIMEOUT_UNKNOWN" && !l4.nexus_task_id && l4.has_next && (await nexusCount("e3")) === 1);
  mode.post = "pass";
  const postsBefore = seen.postsReceived;
  const r5 = await ensure("e3");
  rec("E3b", "producer rerun does NOT issue an uncontrolled second POST", `ok=${r5.ok} POSTs since=${seen.postsReceived - postsBefore} Nexus tasks=${await nexusCount("e3")}`, !r5.ok && seen.postsReceived === postsBefore && (await nexusCount("e3")) === 1);
  const early = await reconcile();
  rec("E3c", "not yet due: reconciler does not claim it nor call Nexus", `claimed=${early.claimed} gets=${seen.gets}`, early.claimed === 0 && seen.gets === 0);
  await makeDue("e3");
  const s3 = await reconcile();
  const l5 = await link("e3");
  rec("E3d", "reconcile: real GET /tasks finds the task by external_unique_key -> CREATED with Nexus id, NO POST", `summary=${JSON.stringify(s3)} link=${JSON.stringify(l5)} POSTs since=${seen.postsReceived - postsBefore}`, s3.found === 1 && l5.status === "CREATED" && !!l5.nexus_task_id && seen.postsReceived === postsBefore && (await nexusCount("e3")) === 1);

  // ───────── E4 request outcome unknown, task NOT created ─────────
  resetProxy(); mode.post = "hang_before_forward";
  const r6 = await ensure("e4", { timeoutMs: 700 });
  const l6 = await link("e4");
  mode.post = "pass";
  rec("E4a", "timeout before Nexus saw it: TIMEOUT_UNKNOWN, Nexus has nothing", `ok=${r6.ok} status=${l6.status} Nexus tasks=${await nexusCount("e4")}`, !r6.ok && l6.status === "TIMEOUT_UNKNOWN" && (await nexusCount("e4")) === 0);
  await makeDue("e4");
  const posts4 = seen.postsReceived;
  const s4 = await reconcile();
  const l7 = await link("e4");
  rec("E4b", "reconcile: key absent -> released as FAILED (RECONCILED_ABSENT); reconciler itself POSTs nothing", `summary=${JSON.stringify(s4)} status=${l7.status} err=${l7.error_message?.slice(0, 20)} POSTs=${seen.postsReceived - posts4}`, s4.absent_released === 1 && l7.status === "FAILED" && seen.postsReceived === posts4);
  const r7 = await ensure("e4");
  rec("E4c", "producer then re-POSTs the SAME key: exactly one Nexus task, assigned, id persisted", `ok=${r7.ok} Nexus tasks=${await nexusCount("e4")} POSTs=${seen.postsReceived - posts4}`, r7.ok && (await nexusCount("e4")) === 1 && (await link("e4")).status === "CREATED");
  const asg = await nx(`select assignee_id from public.tasks where external_unique_key = '${keyFor("e4")}'`);
  rec("E4d", "assignment preserved through unknown -> reconcile -> retry", `assignee_id=${asg}`, asg === ASSIGNEE);

  // ───────── E5 Nexus unavailable during reconciliation ─────────
  resetProxy(); mode.post = "hang_after_forward";
  await ensure("e5", { timeoutMs: 700 }); mode.post = "pass"; await makeDue("e5");
  mode.get = "503";
  const posts5 = seen.postsReceived;
  const s5 = await reconcile();
  const l8 = await link("e5");
  rec("E5", "Nexus lookup unavailable (503): stays TIMEOUT_UNKNOWN, attempts+1, backoff, no POST", `summary=${JSON.stringify(s5)} link=${JSON.stringify(l8)}`, s5.still_unknown === 1 && l8.status === "TIMEOUT_UNKNOWN" && l8.reconcile_attempts === 1 && seen.postsReceived === posts5);
  mode.get = "pass";

  // ───────── E6 real auth/scope failures ─────────
  resetProxy();
  const r8 = await ensure("e6", { nexusApiKey: "wrong-key" });
  const l9 = await link("e6");
  rec("E6a", "wrong x-api-key (real 401): FAILED, not unknown, nothing created", `ok=${r8.ok} status=${l9.status} err=${l9.error_message?.slice(0, 40)} Nexus tasks=${await nexusCount("e6")}`, !r8.ok && l9.status === "FAILED" && (await nexusCount("e6")) === 0);
  const r9 = await ensure("e6", { nexusApiKey: KEY_RO });
  rec("E6b", "key without tasks:write (real 403): FAILED, nothing created", `ok=${r9.ok} err=${(await link("e6")).error_message?.slice(0, 50)}`, !r9.ok && (await nexusCount("e6")) === 0);
  resetProxy(); mode.post = "hang_after_forward";
  await ensure("e7", { nexusApiKey: KEY_WO, timeoutMs: 700 }); mode.post = "pass"; await makeDue("e7");
  const s6 = await reconcile({ nexusApiKey: KEY_WO });
  const l10 = await link("e7");
  rec("E6c", "key without tasks:read: reconciliation lookup is refused (real 403) -> stays unknown, never 'absent'", `summary=${JSON.stringify(s6)} status=${l10.status} err=${l10.error_message?.slice(0, 45)}`, s6.still_unknown === 1 && l10.status === "TIMEOUT_UNKNOWN" && s6.absent_released === 0);

  // ───────── E7 invalid assignee at Nexus ─────────
  await rs(`update public.rocksolid_admin_mappings set nexus_user_id = '${crypto.randomUUID()}' where group_id = '${GROUP}'`);
  resetProxy();
  const r10 = await ensure("e8");
  // 202610030004: a CONFIRMED permanent rejection (400 "assignee not found" for a mapped id) is the terminal manual-attention
  // status ASSIGNEE_REJECTED (previously FAILED, which was re-POSTed on every run forever). Nothing is created.
  rec("E7", "mapped id that is not a Nexus user: real 400 'assignee not found' -> terminal ASSIGNEE_REJECTED, nothing created", `ok=${r10.ok} status=${(await link("e8")).status} err=${(await link("e8")).error_message?.slice(0, 55)} Nexus tasks=${await nexusCount("e8")}`, !r10.ok && (await link("e8")).status === "ASSIGNEE_REJECTED" && (await nexusCount("e8")) === 0);
  const postsBeforeRerun = seen.postsReceived;
  await ensure("e8"); await ensure("e8");
  rec("E7b", "the dead mapping is no longer hammered: two more producer runs send ZERO POSTs to Nexus", `POSTs since=${seen.postsReceived - postsBeforeRerun} status=${(await link("e8")).status}`, seen.postsReceived === postsBeforeRerun && (await link("e8")).status === "ASSIGNEE_REJECTED");
  await rs(`update public.rocksolid_admin_mappings set nexus_user_id = '${ASSIGNEE}' where group_id = '${GROUP}'`);
} finally {
  await rs(`delete from public.rocksolid_admin_mappings where group_id = '${GROUP}'`);
  await rs(`delete from public.rocksolid_task_links where dedupe_key like 'missed_class:e%-${TS}:CO-E2E:%'`);
  await rs(`delete from public.audit_logs where actor_email = 'e2e@system'`);
  await proxy.shutdown();
}

console.log("C6 Rock Solid <-> Nexus end-to-end certification (real DBs, real task-api)");
for (const r of results) console.log(`${r.pass === null ? "UNVERIFIED" : r.pass ? "PASS" : "FAIL"} | ${r.id} | ${r.name} | ${r.detail}`);
const failed = results.filter((r) => r.pass === false);
const unverified = results.filter((r) => r.pass === null);
console.log(`SUMMARY: ${results.length} checks, ${results.filter((r) => r.pass === true).length} PASS, ${failed.length} FAIL, ${unverified.length} UNVERIFIED`);
Deno.exit(failed.length || unverified.length ? 1 : 0);
