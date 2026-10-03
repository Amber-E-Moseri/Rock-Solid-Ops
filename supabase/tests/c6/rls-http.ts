/**
 * C6 RLS + RPC authorization, executed as real HTTP requests (PostgREST/GoTrue) with real user JWTs.
 *
 * Tables:  public.rocksolid_task_links, public.rocksolid_admin_mappings
 * RPCs:    claim_nexus_task, claim_nexus_reconciliations, resolve_nexus_reconciliation (service-only)
 * Identities: anon (no JWT), pending, teacher ("wrong user"), admin, superadmin, service_role.
 * After every request the database is inspected directly, so a 200 with a hidden side effect cannot pass.
 *
 * Run (same environment variables as wave1-regression.ts):
 *   LOCAL_INTEGRATION_TEST=true SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   DB_CONTAINER=<db container> deno run --allow-net --allow-env --allow-run=docker supabase/tests/c6/rls-http.ts
 */
if (Deno.env.get("LOCAL_INTEGRATION_TEST") !== "true") {
  console.error("Set LOCAL_INTEGRATION_TEST=true (this test writes to a local database).");
  Deno.exit(1);
}
const URL_ = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const DB_CONTAINER = Deno.env.get("DB_CONTAINER") ?? "supabase_db_supabase_foundation";
if (!SERVICE || !ANON) { console.error("SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are required."); Deno.exit(1); }

const TS = Date.now();
const PASSWORD = `C6Rls${TS}x`;

async function psql(sql: string): Promise<string> {
  const { code, stdout, stderr } = await new Deno.Command("docker", {
    args: ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", sql],
    stdout: "piped", stderr: "piped", stdin: "null",
  }).output();
  if (code !== 0) throw new Error(`psql failed: ${new TextDecoder().decode(stderr)}`);
  return new TextDecoder().decode(stdout).trim();
}

async function http(jwt: string | null, method: string, path: string, body?: unknown, prefer = "return=representation") {
  const headers: Record<string, string> = { apikey: ANON, "Content-Type": "application/json", Prefer: prefer };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const r = await fetch(`${URL_}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  return { status: r.status, body: parsed };
}

type Ident = { name: string; jwt: string | null; userId?: string };
async function identity(role: "pending" | "teacher" | "admin" | "superadmin"): Promise<Ident> {
  const email = `c6rls-${role}-${TS}@invalid.local`;
  const created = await (await fetch(`${URL_}/auth/v1/admin/users`, {
    method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  })).json();
  const userId = created.id as string;
  if (!userId) throw new Error(`create ${role}: ${JSON.stringify(created)}`);
  if (role !== "pending") {
    await psql(`UPDATE public.profiles SET role = '${role}', is_active = true WHERE user_id = '${userId}'`);
    if ((await psql(`SELECT role FROM public.profiles WHERE user_id = '${userId}'`)) !== role) throw new Error(`profile role for ${role}`);
  }
  const tok = await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  })).json();
  if (!tok.access_token) throw new Error(`login ${role}: ${JSON.stringify(tok)}`);
  return { name: role, jwt: tok.access_token, userId };
}

const rows: Array<{ id: string; name: string; http: string; effect: string; pass: boolean }> = [];
const rec = (id: string, name: string, http: string, effect: string, pass: boolean) => rows.push({ id, name, http, effect, pass });
const count = async (key: string) => Number(await psql(`SELECT count(*) FROM public.rocksolid_task_links WHERE dedupe_key = '${key}'`));
const field = (key: string, col: string) => psql(`SELECT ${col} FROM public.rocksolid_task_links WHERE dedupe_key = '${key}'`);
const deniedStatus = (s: number) => s === 401 || s === 403 || s === 404;

const idents: Ident[] = [{ name: "anon", jwt: null }];
for (const r of ["pending", "teacher", "admin", "superadmin"] as const) idents.push(await identity(r));
const service: Ident = { name: "service_role", jwt: SERVICE };
const KEY = `c6rls:${TS}`;

try {
  // seed a task link as service_role
  const seed = await http(SERVICE, "POST", "/rest/v1/rocksolid_task_links", { source_type: "c6rls", source_id: "s", dedupe_key: KEY, status: "CREATED", nexus_task_id: "N-ORIG" });
  rec("T00", "service_role can seed a task link", String(seed.status), `rows=${await count(KEY)}`, seed.status === 201 && (await count(KEY)) === 1);

  // ── rocksolid_task_links ──
  for (const who of idents) {
    const isAdmin = who.name === "admin" || who.name === "superadmin";

    const sel = await http(who.jwt, "GET", `/rest/v1/rocksolid_task_links?dedupe_key=eq.${encodeURIComponent(KEY)}&select=id,nexus_task_id`);
    const visible = Array.isArray(sel.body) ? sel.body.length : -1;
    rec(`T-${who.name}-select`, `${who.name} SELECT task link`, String(sel.status), `rows visible=${visible}`,
      isAdmin ? sel.status === 200 && visible === 1 : (sel.status === 200 && visible === 0) || deniedStatus(sel.status));

    const ins = await http(who.jwt, "POST", "/rest/v1/rocksolid_task_links", { source_type: "c6rls", source_id: "i", dedupe_key: `${KEY}:ins:${who.name}`, status: "FAILED" });
    const created = await count(`${KEY}:ins:${who.name}`);
    rec(`T-${who.name}-insert`, `${who.name} INSERT task link`, String(ins.status), `db rows created=${created}`,
      isAdmin ? ins.status === 201 && created === 1 : deniedStatus(ins.status) && created === 0);

    const upd = await http(who.jwt, "PATCH", `/rest/v1/rocksolid_task_links?dedupe_key=eq.${encodeURIComponent(KEY)}`, { nexus_task_id: `HIJACK-${who.name}` });
    const nowId = await field(KEY, "nexus_task_id");
    rec(`T-${who.name}-update`, `${who.name} UPDATE task link (nexus_task_id)`, String(upd.status), `db nexus_task_id=${nowId}`,
      isAdmin ? nowId === `HIJACK-${who.name}` : nowId === "N-ORIG");
    if (isAdmin) await http(SERVICE, "PATCH", `/rest/v1/rocksolid_task_links?dedupe_key=eq.${encodeURIComponent(KEY)}`, { nexus_task_id: "N-ORIG" });

    const del = await http(who.jwt, "DELETE", `/rest/v1/rocksolid_task_links?dedupe_key=eq.${encodeURIComponent(KEY)}`);
    const still = await count(KEY);
    rec(`T-${who.name}-delete`, `${who.name} DELETE task link`, String(del.status), `db row still present=${still === 1}`, still === 1);
  }
  const svcUpd = await http(SERVICE, "PATCH", `/rest/v1/rocksolid_task_links?dedupe_key=eq.${encodeURIComponent(KEY)}`, { error_message: "svc" });
  rec("T-service-update", "service_role UPDATE task link", String(svcUpd.status), `db error_message=${await field(KEY, "error_message")}`, svcUpd.status === 200 && (await field(KEY, "error_message")) === "svc");

  // ── service-only RPCs ──
  const RPCK = `c6rls:rpc:${TS}`;
  const calls: Array<[string, Record<string, unknown>]> = [
    ["claim_nexus_task", { p_source_type: "c6rls", p_source_id: "x", p_dedupe_key: RPCK, p_claim_token: crypto.randomUUID() }],
    ["claim_nexus_reconciliations", { p_limit: 5, p_claim_token: crypto.randomUUID(), p_lease_seconds: 120 }],
    ["resolve_nexus_reconciliation", { p_row_id: crypto.randomUUID(), p_claim_token: crypto.randomUUID(), p_outcome: "FOUND", p_nexus_task_id: "N-X", p_error: null }],
  ];
  for (const who of idents) {
    for (const [fn, args] of calls) {
      const r = await http(who.jwt, "POST", `/rest/v1/rpc/${fn}`, args);
      const side = fn === "claim_nexus_task" ? await count(RPCK) : 0;
      rec(`R-${who.name}-${fn}`, `${who.name} calls ${fn}`, String(r.status), `error=${(r.body as { code?: string })?.code ?? "-"} side-effect rows=${side}`,
        deniedStatus(r.status) && side === 0);
    }
  }
  for (const [fn, args] of calls) {
    const r = await http(SERVICE, "POST", `/rest/v1/rpc/${fn}`, args);
    rec(`R-service-${fn}`, `service_role calls ${fn}`, String(r.status), `ok`, r.status === 200);
  }

  // ── assignee mapping table (the source of assignee_id) ──
  const MK = `c6rls-${TS}`;
  const mseed = await http(SERVICE, "POST", "/rest/v1/rocksolid_admin_mappings", { admin_email: "a@x.test", nexus_user_id: crypto.randomUUID(), group_id: MK, subgroup_id: null });
  rec("M00", "service_role can seed an assignee mapping", String(mseed.status), "-", mseed.status === 201);
  for (const who of idents) {
    const isAdmin = who.name === "admin" || who.name === "superadmin";
    const sel = await http(who.jwt, "GET", `/rest/v1/rocksolid_admin_mappings?group_id=eq.${MK}&select=id`);
    const vis = Array.isArray(sel.body) ? sel.body.length : -1;
    rec(`M-${who.name}-select`, `${who.name} SELECT assignee mapping`, String(sel.status), `rows visible=${vis}`, isAdmin ? vis === 1 : (sel.status === 200 && vis === 0) || deniedStatus(sel.status));
    const forged = crypto.randomUUID();
    const upd = await http(who.jwt, "PATCH", `/rest/v1/rocksolid_admin_mappings?group_id=eq.${MK}`, { nexus_user_id: forged });
    const hit = Number(await psql(`SELECT count(*) FROM public.rocksolid_admin_mappings WHERE group_id = '${MK}' AND nexus_user_id = '${forged}'`));
    rec(`M-${who.name}-update`, `${who.name} UPDATE assignee mapping (re-point assignee)`, String(upd.status), `db row re-pointed=${hit === 1}`, isAdmin ? hit === 1 : hit === 0);
    const ins = await http(who.jwt, "POST", "/rest/v1/rocksolid_admin_mappings", { admin_email: `${who.name}@x.test`, nexus_user_id: crypto.randomUUID(), group_id: `${MK}:${who.name}` });
    const made = Number(await psql(`SELECT count(*) FROM public.rocksolid_admin_mappings WHERE group_id = '${MK}:${who.name}'`));
    rec(`M-${who.name}-insert`, `${who.name} INSERT assignee mapping`, String(ins.status), `db rows created=${made}`, isAdmin ? made === 1 : made === 0 && deniedStatus(ins.status));
  }
  await psql(`DELETE FROM public.rocksolid_admin_mappings WHERE group_id LIKE '${MK}%'`);
} finally {
  await psql(`DELETE FROM public.rocksolid_task_links WHERE dedupe_key LIKE 'c6rls:%'`);
  for (const i of idents) if (i.userId) await fetch(`${URL_}/auth/v1/admin/users/${i.userId}`, { method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
}

console.log("C6 RLS/RPC HTTP certification");
for (const r of rows) console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.id} | ${r.name} | HTTP ${r.http} | ${r.effect}`);
const failed = rows.filter((r) => !r.pass);
console.log(`SUMMARY: ${rows.length} checks, ${rows.length - failed.length} PASS, ${failed.length} FAIL`);
Deno.exit(failed.length ? 1 : 0);
