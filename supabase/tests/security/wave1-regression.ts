/**
 * WAVE 1 SECURITY REGRESSION
 *
 * Verifies all Wave 1 authorization boundaries after every schema change.
 * Covers: Teacher creation auth, Graduation override auth, Audit logs RLS,
 * and function ACL state.
 *
 * Requirements:
 *   LOCAL_INTEGRATION_TEST=true            (safety gate)
 *   SUPABASE_URL=http://127.0.0.1:54321    (or hosted equivalent)
 *   SUPABASE_SERVICE_ROLE_KEY=<key>        (from `supabase status`)
 *   SUPABASE_ANON_KEY=<key>               (from `supabase status`)
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
 *
 * Run:
 *   LOCAL_INTEGRATION_TEST=true \
 *   SUPABASE_SERVICE_ROLE_KEY=$(supabase status --output env | grep SERVICE_ROLE_KEY | cut -d= -f2) \
 *   SUPABASE_ANON_KEY=$(supabase status --output env | grep ANON_KEY | cut -d= -f2) \
 *   deno run --allow-net --allow-env --allow-run \
 *     supabase/tests/security/wave1-regression.ts
 *
 * Never embeds credentials. Never contacts production.
 */

if (Deno.env.get("LOCAL_INTEGRATION_TEST") !== "true") {
  console.error("ERROR: Set LOCAL_INTEGRATION_TEST=true to run this test.");
  console.error("This test modifies a local database and must never run against production.");
  Deno.exit(1);
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const DB_URL = Deno.env.get("DATABASE_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

if (!SERVICE_KEY || !ANON_KEY) {
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY must be set.");
  console.error("  Run: supabase status --output env");
  Deno.exit(1);
}

const TS = Date.now();
const PASSWORD = `W1Reg${TS}x`;

// ── Helpers ───────────────────────────────────────────────────────────────────

const DB_CONTAINER = Deno.env.get("DB_CONTAINER") ?? "supabase_db_supabase_foundation";

async function psql(sql: string): Promise<string> {
  // Call docker exec directly — avoids Windows CMD batch-file argument
  // escaping limitations (parentheses in SQL signatures cause "batch file
  // arguments are invalid" when going through a .cmd wrapper).
  const cmd = new Deno.Command("docker", {
    args: [
      "exec", "-i", DB_CONTAINER,
      "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", sql,
    ],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  const out = new TextDecoder().decode(stdout).trim();
  if (code !== 0) {
    const err = new TextDecoder().decode(stderr).trim();
    throw new Error(`psql failed (exit ${code}): ${err}`);
  }
  return out;
}

async function adminApi(method: string, path: string, body?: object): Promise<Response> {
  return fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function restAs(
  jwt: string | null,
  method: string,
  path: string,
  body?: object,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    apikey: ANON_KEY,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed: unknown;
  try { parsed = text.length ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: r.status, body: parsed };
}

async function signIn(email: string): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const d = await r.json() as { access_token?: string };
  if (!d.access_token) throw new Error(`signIn(${email}) failed`);
  return d.access_token;
}

// ── Identity management (psql for profile, admin API for auth) ────────────────

interface Identity { email: string; userId: string; jwt: string; }

async function createIdentity(role: string): Promise<Identity> {
  const email = `w1reg-${role}-${TS}@invalid.local`;
  const r = await adminApi("POST", "/auth/v1/admin/users", {
    email, password: PASSWORD, email_confirm: true,
  });
  const d = await r.json() as { id?: string };
  const userId = d.id;
  if (!userId) throw new Error(`createUser(${role}) failed: ${JSON.stringify(d)}`);

  await new Promise<void>((res) => setTimeout(res, 400));

  if (role !== "pending") {
    await psql(
      `UPDATE public.profiles SET role = '${role}' WHERE user_id = '${userId}';`,
    );
    const got = await psql(
      `SELECT role FROM public.profiles WHERE user_id = '${userId}';`,
    );
    if (got.trim() !== role) {
      throw new Error(`profile role mismatch for ${role}: got '${got}'`);
    }
  }

  const jwt = await signIn(email);
  return { email, userId, jwt };
}

async function deleteIdentity(id: Identity): Promise<void> {
  await adminApi("DELETE", `/auth/v1/admin/users/${id.userId}`, undefined);
}

// ── Result tracking ───────────────────────────────────────────────────────────

interface Finding { suite: string; check: string; pass: boolean; detail?: string; }
const findings: Finding[] = [];

function assert(
  suite: string,
  check: string,
  condition: boolean,
  detail?: string,
): void {
  findings.push({ suite, check, pass: condition, detail });
}

// ── Suite 1: Function ACL state ───────────────────────────────────────────────

async function suiteAcl(): Promise<void> {
  const SUITE = "ACL";

  // Teacher overloads
  for (const sig of [
    "admin_create_teacher_direct(text,text,text,text,text,text,text)",
    "admin_create_teacher_direct(text,text,text,text,text,text,text,text)",
  ]) {
    const shortSig = sig.split("(")[1].split(",").length + "-param";
    const anonEx = await psql(
      `SELECT has_function_privilege('anon', 'public.${sig}', 'EXECUTE');`,
    );
    const authEx = await psql(
      `SELECT has_function_privilege('authenticated', 'public.${sig}', 'EXECUTE');`,
    );
    assert(SUITE, `teacher-${shortSig} anon=NO`, anonEx.trim() === "f");
    assert(SUITE, `teacher-${shortSig} authenticated=YES`, authEx.trim() === "t");
  }

  // Graduation override
  const gradSig = "override_graduation_eligibility(uuid,text,boolean,text)";
  const gradAnon = await psql(
    `SELECT has_function_privilege('anon', 'public.${gradSig}', 'EXECUTE');`,
  );
  const gradAuth = await psql(
    `SELECT has_function_privilege('authenticated', 'public.${gradSig}', 'EXECUTE');`,
  );
  // proacl check: PUBLIC EXECUTE looks like "{=X/" or ",=X/" at an ACL entry
  // boundary. "postgres=X/postgres" etc. are role-specific grants, not PUBLIC.
  const gradPub = await psql(
    `SELECT p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace ` +
    `WHERE n.nspname = 'public' AND p.proname = 'override_graduation_eligibility' ` +
    `AND pg_catalog.pg_get_function_identity_arguments(p.oid) LIKE '%uuid%boolean%';`,
  );
  assert(SUITE, "graduation anon=NO", gradAnon.trim() === "f");
  assert(SUITE, "graduation public=NO", !/(?:\{|,)=X\//.test(gradPub));
  assert(SUITE, "graduation authenticated=YES", gradAuth.trim() === "t");

  // Stale audit policy absent
  const stalePolicy = await psql(
    `SELECT COUNT(*) FROM pg_policies WHERE tablename='audit_logs' AND policyname='audit_log_staff_select';`,
  );
  assert(SUITE, "audit_log_staff_select absent", stalePolicy.trim() === "0");
}

// ── Suite 2: Teacher creation authorization ───────────────────────────────────

async function suiteTeacher(
  ids: Record<string, Identity>,
): Promise<void> {
  const SUITE = "Teacher";
  const beforeCount = parseInt(
    await psql("SELECT COUNT(*) FROM public.teachers;"),
    10,
  );

  // Use 8-param overload with p_fellowship_code: null to force unambiguous overload
  // resolution (PostgREST returns 300 when both overloads match via defaults).
  // null fellowship_code skips the fellowship_map FK check inside the function.
  const payload = {
    p_full_name: `W1Reg Teacher ${TS}`,
    p_email: `w1reg-teacher-${TS}@invalid.local`,
    p_phone: "555-0100",
    p_group_id: "CE",
    p_subgroup_id: "CESGA",
    p_fellowship_code: null as unknown as string,
    p_notes: "wave1 regression",
    p_actor_email: ids.admin.email,
  };

  const cases: Array<{ role: string; expectDeny: boolean }> = [
    { role: "pending", expectDeny: true },
    { role: "teacher", expectDeny: true },
    { role: "admin", expectDeny: false },
    { role: "superadmin", expectDeny: false },
  ];

  for (const c of cases) {
    const res = await restAs(
      ids[c.role].jwt,
      "POST",
      "/rest/v1/rpc/admin_create_teacher_direct",
      payload,
    );
    const afterCount = parseInt(
      await psql("SELECT COUNT(*) FROM public.teachers;"),
      10,
    );
    const mutated = afterCount > beforeCount;
    if (mutated) {
      await psql(
        `DELETE FROM public.teachers WHERE email = 'w1reg-teacher-${TS}@invalid.local';`,
      );
    }
    const denied = !mutated;
    assert(SUITE, `${c.role}: deny=${c.expectDeny}`, denied === c.expectDeny,
      `HTTP=${res.status}`);
  }
}

// ── Suite 3: Graduation override authorization ────────────────────────────────

async function suiteGraduation(
  ids: Record<string, Identity>,
): Promise<void> {
  const SUITE = "Graduation";

  // Create batch + applicant fixtures via psql
  const batchId = `w1reg-batch-${TS}`;
  const appEmail = `w1reg-app-${TS}@invalid.local`;
  await psql(
    `INSERT INTO public.batches (batch_id, batch_name, status, start_date, end_date, registration_open, active)
     VALUES ('${batchId}', 'W1Reg Batch ${TS}', 'Draft', '2026-01-01', '2026-12-31', false, false);`,
  );
  await psql(
    `INSERT INTO public.applicants (email, first_name, last_name)
     VALUES ('${appEmail}', 'W1Reg', 'Applicant');`,
  );
  const appId = await psql(
    `SELECT id FROM public.applicants WHERE email = '${appEmail}' LIMIT 1;`,
  );
  if (!appId.trim()) throw new Error("graduation: applicant fixture failed");

  const payload = {
    p_applicant_id: appId.trim(),
    p_batch_id: batchId,
    p_eligible: true,
    p_reason: "w1reg",
  };
  const countSql =
    `SELECT COUNT(*) FROM public.graduation_eligibility WHERE applicant_id = '${appId.trim()}' AND batch_id = '${batchId}';`;

  const cases: Array<{ label: string; jwt: string | null; expectDeny: boolean }> = [
    { label: "anon", jwt: null, expectDeny: true },
    { label: "pending", jwt: ids.pending.jwt, expectDeny: true },
    { label: "teacher", jwt: ids.teacher.jwt, expectDeny: true },
    { label: "admin", jwt: ids.admin.jwt, expectDeny: false },
    { label: "superadmin", jwt: ids.superadmin.jwt, expectDeny: false },
  ];

  for (const c of cases) {
    const before = parseInt(await psql(countSql), 10);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/override_graduation_eligibility`,
      {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          "Content-Type": "application/json",
          ...(c.jwt ? { Authorization: `Bearer ${c.jwt}` } : {}),
        },
        body: JSON.stringify(payload),
      },
    );
    await res.text();
    const after = parseInt(await psql(countSql), 10);
    const mutated = after > before;
    if (mutated) {
      await psql(
        `DELETE FROM public.graduation_eligibility WHERE applicant_id = '${appId.trim()}' AND batch_id = '${batchId}';`,
      );
    }
    const denied = !mutated;
    assert(SUITE, `${c.label}: deny=${c.expectDeny}`, denied === c.expectDeny,
      `HTTP=${res.status}`);
  }

  // Cleanup
  await psql(
    `DELETE FROM public.graduation_eligibility WHERE batch_id = '${batchId}';
     DELETE FROM public.applicants WHERE email = '${appEmail}';
     DELETE FROM public.batches WHERE batch_id = '${batchId}';`,
  );
}

// ── Suite 4: Audit logs RLS ───────────────────────────────────────────────────

async function suiteAudit(ids: Record<string, Identity>): Promise<void> {
  const SUITE = "AuditRLS";

  // Seed a row via psql (bypasses RLS)
  const seedId = crypto.randomUUID();
  await psql(
    `INSERT INTO public.audit_logs (id, action, actor_id, entity_type, entity_id, details)
     VALUES ('${seedId}', 'W1REG_SEED', 'diag', 'test', 'seed-${TS}', '{"seed":true}');`,
  );

  // SELECT: pending/teacher should see 0 rows; admin/superadmin should see > 0
  for (const [role, expectRows] of [
    ["pending", false], ["teacher", false],
    ["admin", true], ["superadmin", true],
  ] as Array<[string, boolean]>) {
    const res = await restAs(
      ids[role].jwt,
      "GET",
      `/rest/v1/audit_logs?select=id&limit=1`,
    );
    const rows = Array.isArray(res.body) ? res.body.length : 0;
    assert(SUITE, `${role} SELECT: hasRows=${expectRows}`, (rows > 0) === expectRows,
      `HTTP=${res.status} rows=${rows}`);
  }

  // INSERT: pending/teacher denied; admin/superadmin succeed
  for (const [role, expectAllow] of [
    ["pending", false], ["teacher", false],
    ["admin", true], ["superadmin", true],
  ] as Array<[string, boolean]>) {
    const insertId = crypto.randomUUID();
    const res = await restAs(
      ids[role].jwt,
      "POST",
      `/rest/v1/audit_logs`,
      {
        id: insertId,
        action: `W1REG_INSERT_${role.toUpperCase()}`,
        actor_id: ids[role].userId,
        entity_type: "test",
        entity_id: `ins-${TS}`,
        details: {},
      },
    );
    const exists = (await psql(
      `SELECT COUNT(*) FROM public.audit_logs WHERE id = '${insertId}';`,
    )).trim() === "1";
    if (exists) await psql(`DELETE FROM public.audit_logs WHERE id = '${insertId}';`);
    assert(SUITE, `${role} INSERT: allow=${expectAllow}`, exists === expectAllow,
      `HTTP=${res.status}`);
  }

  // UPDATE: pending/teacher denied; admin/superadmin succeed
  for (const [role, expectMutate] of [
    ["pending", false], ["teacher", false],
    ["admin", true], ["superadmin", true],
  ] as Array<[string, boolean]>) {
    const rowId = crypto.randomUUID();
    await psql(
      `INSERT INTO public.audit_logs (id, action, actor_id, entity_type, entity_id, details)
       VALUES ('${rowId}', 'W1REG_UPD_SEED', 'diag', 'test', 'upd-${TS}', '{"v":1}');`,
    );
    const res = await restAs(
      ids[role].jwt,
      "PATCH",
      `/rest/v1/audit_logs?id=eq.${rowId}`,
      { details: { v: 2, modified_by: role } },
    );
    const after = await psql(
      `SELECT details->>'v' FROM public.audit_logs WHERE id = '${rowId}';`,
    );
    const mutated = after.trim() === "2";
    await psql(`DELETE FROM public.audit_logs WHERE id = '${rowId}';`);
    assert(SUITE, `${role} UPDATE: mutate=${expectMutate}`, mutated === expectMutate,
      `HTTP=${res.status}`);
  }

  // DELETE: pending/teacher denied; admin/superadmin succeed
  for (const [role, expectDelete] of [
    ["pending", false], ["teacher", false],
    ["admin", true], ["superadmin", true],
  ] as Array<[string, boolean]>) {
    const rowId = crypto.randomUUID();
    await psql(
      `INSERT INTO public.audit_logs (id, action, actor_id, entity_type, entity_id, details)
       VALUES ('${rowId}', 'W1REG_DEL_SEED', 'diag', 'test', 'del-${TS}', '{}');`,
    );
    const res = await restAs(
      ids[role].jwt,
      "DELETE",
      `/rest/v1/audit_logs?id=eq.${rowId}`,
    );
    const stillExists = (await psql(
      `SELECT COUNT(*) FROM public.audit_logs WHERE id = '${rowId}';`,
    )).trim() === "1";
    if (stillExists) await psql(`DELETE FROM public.audit_logs WHERE id = '${rowId}';`);
    assert(SUITE, `${role} DELETE: deleted=${expectDelete}`, !stillExists === expectDelete,
      `HTTP=${res.status}`);
  }

  // Cleanup seed row
  await psql(`DELETE FROM public.audit_logs WHERE id = '${seedId}';`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const created: Identity[] = [];

  try {
    console.log("Setting up identities...");
    const ids: Record<string, Identity> = {};
    for (const role of ["pending", "teacher", "admin", "superadmin"]) {
      ids[role] = await createIdentity(role);
      created.push(ids[role]);
      console.log(`  ${role}: ${ids[role].userId.substring(0, 8)}...`);
    }

    console.log("\nRunning ACL state checks...");
    await suiteAcl();

    console.log("Running Teacher authorization suite...");
    await suiteTeacher(ids);

    console.log("Running Graduation authorization suite...");
    await suiteGraduation(ids);

    console.log("Running Audit logs RLS suite...");
    await suiteAudit(ids);
  } finally {
    console.log("\nCleaning up...");
    for (const id of created) {
      await deleteIdentity(id).catch(() => {});
    }
  }

  // ── Print report ──────────────────────────────────────────────────────────
  const suites = [...new Set(findings.map((f) => f.suite))];
  let allPass = true;

  console.log("\n" + "=".repeat(60));
  console.log("WAVE 1 SECURITY REGRESSION");
  console.log("=".repeat(60));

  for (const suite of suites) {
    const sf = findings.filter((f) => f.suite === suite);
    const pass = sf.every((f) => f.pass);
    allPass = allPass && pass;
    console.log(`\n${suite}: ${pass ? "PASS" : "FAIL"}`);
    for (const f of sf) {
      const icon = f.pass ? "  ✓" : "  ✗";
      const detail = f.detail ? `  (${f.detail})` : "";
      console.log(`${icon} ${f.check}${detail}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`RESULT: ${allPass ? "ALL PASS" : "FAILURES DETECTED"}`);
  console.log("=".repeat(60));

  if (!allPass) Deno.exit(1);
}

main().catch((err) => {
  console.error("REGRESSION FAILED:", err);
  Deno.exit(1);
});
