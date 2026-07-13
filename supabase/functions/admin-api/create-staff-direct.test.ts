import {
  allowedTargetRolesFor,
  assertStaffCreationAllowed,
  createStaffDirectAction,
} from "./_actions/create-staff-direct.ts";

// ── Pure permission-boundary tests ────────────────────────────────────────────
// Decision (docs/migration-log.md 2026-07-13, user-confirmed):
//   superadmin -> any role; admin -> teacher only; everyone else -> nothing.

Deno.test("boundary: superadmin may create every elevated + non-elevated role", () => {
  for (const target of ["teacher", "principal", "admin", "superadmin", "subgroup_admin", "pastor", "regional_secretary"]) {
    const d = assertStaffCreationAllowed("superadmin", target);
    if (!d.ok) throw new Error(`superadmin should be allowed to create ${target}, got: ${d.error}`);
  }
});

Deno.test("boundary: admin may create teacher only", () => {
  const ok = assertStaffCreationAllowed("admin", "teacher");
  if (!ok.ok) throw new Error("admin should be allowed to create teacher");

  for (const target of ["principal", "admin", "superadmin", "subgroup_admin", "pastor", "regional_secretary"]) {
    const d = assertStaffCreationAllowed("admin", target);
    if (d.ok) throw new Error(`admin must NOT be allowed to create ${target}`);
    if (d.status !== 403) throw new Error(`expected 403 for admin->${target}, got ${d.status}`);
  }
});

Deno.test("boundary: admin creating another admin is rejected (no lateral privilege spread)", () => {
  const d = assertStaffCreationAllowed("admin", "admin");
  if (d.ok || d.status !== 403) throw new Error("admin creating admin must be a 403");
});

Deno.test("boundary: lower-privilege roles cannot create any staff", () => {
  for (const caller of ["principal", "subgroup_admin", "pastor", "regional_secretary", "teacher", "pending", "", "viewer"]) {
    if (allowedTargetRolesFor(caller).size !== 0) throw new Error(`${caller} should have no creatable roles`);
    const d = assertStaffCreationAllowed(caller, "teacher");
    if (d.ok) throw new Error(`${caller} must NOT be allowed to create staff`);
    if (d.status !== 403) throw new Error(`expected 403 for caller ${caller}, got ${d.status}`);
  }
});

Deno.test("boundary: `pending` and unknown roles are never valid creation targets", () => {
  for (const target of ["pending", "wizard", ""]) {
    const d = assertStaffCreationAllowed("superadmin", target);
    if (d.ok) throw new Error(`target '${target}' must be rejected`);
    if (d.status !== 400) throw new Error(`expected 400 for invalid target '${target}', got ${d.status}`);
  }
});

// ── Handler-level tests ───────────────────────────────────────────────────────

function fakeServiceClient(opts: { existingProfile?: boolean } = {}) {
  const created: any[] = [];
  const deleted: string[] = [];
  const upserts: any[] = [];
  const audits: any[] = [];
  const client: any = {
    __created: created,
    __deleted: deleted,
    __upserts: upserts,
    __audits: audits,
    auth: {
      admin: {
        createUser: async (payload: any) => {
          created.push(payload);
          return { data: { user: { id: "new-user-1" } }, error: null };
        },
        deleteUser: async (id: string) => {
          deleted.push(id);
          return { data: {}, error: null };
        },
      },
    },
    from(table: string) {
      const chain: any = {
        select() { return chain; },
        ilike() { return chain; },
        limit() { return chain; },
        maybeSingle: async () => ({
          data: table === "profiles" && opts.existingProfile ? { user_id: "old", email: "x" } : null,
          error: null,
        }),
        upsert: async (payload: any, options: any) => {
          upserts.push({ table, payload, options });
          return { data: payload, error: null };
        },
        insert: async (payload: any) => {
          audits.push({ table, payload });
          return { data: payload, error: null };
        },
      };
      return chain;
    },
  };
  return client;
}

async function readJson(res: Response) {
  return { status: res.status, body: await res.json() };
}

Deno.test("handler: principal caller is rejected 403 BEFORE any auth user is created", async () => {
  const svc = fakeServiceClient();
  const res = await createStaffDirectAction(
    {
      db: svc,
      auth: { user: { id: "u-principal" }, profile: { role: "principal", email: "p@x.com" } },
      params: { full_name: "New Admin", email: "new@x.com", temp_password: "password123", role: "admin" },
    },
    { serviceClient: svc },
  );
  const { status, body } = await readJson(res);
  if (status !== 403 || body.ok !== false) throw new Error(`expected 403, got ${status}`);
  if (svc.__created.length !== 0) throw new Error("no auth user should be created for a rejected caller");
});

Deno.test("handler: admin creating an admin is rejected 403 with no side effects", async () => {
  const svc = fakeServiceClient();
  const res = await createStaffDirectAction(
    {
      db: svc,
      auth: { user: { id: "u-admin" }, profile: { role: "admin", email: "a@x.com" } },
      params: { full_name: "New Admin", email: "new@x.com", temp_password: "password123", role: "admin" },
    },
    { serviceClient: svc },
  );
  const { status } = await readJson(res);
  if (status !== 403) throw new Error(`expected 403, got ${status}`);
  if (svc.__created.length !== 0 || svc.__upserts.length !== 0) throw new Error("rejected admin must produce no writes");
});

Deno.test("handler: superadmin creating an admin succeeds and finalizes the profile role", async () => {
  const svc = fakeServiceClient();
  const res = await createStaffDirectAction(
    {
      db: svc,
      auth: { user: { id: "u-super" }, profile: { role: "superadmin", email: "s@x.com" } },
      params: { full_name: "New Admin", email: "New@X.com", temp_password: "password123", role: "admin" },
    },
    { serviceClient: svc },
  );
  const { status, body } = await readJson(res);
  if (status !== 200 || body.ok !== true) throw new Error(`expected 200 ok, got ${status} ${JSON.stringify(body)}`);
  if (body.user_id !== "new-user-1" || body.role !== "admin") throw new Error("unexpected success payload");
  if (svc.__created.length !== 1) throw new Error("exactly one auth user should be created");
  const up = svc.__upserts[0];
  if (!up || up.payload.role !== "admin" || up.payload.email !== "new@x.com") throw new Error("profile not finalized to admin/normalized email");
  if (svc.__audits.length !== 1 || svc.__audits[0].payload.action !== "staff_created_direct") throw new Error("audit row missing");
});

Deno.test("handler: admin creating a teacher succeeds", async () => {
  const svc = fakeServiceClient();
  const res = await createStaffDirectAction(
    {
      db: svc,
      auth: { user: { id: "u-admin" }, profile: { role: "admin", email: "a@x.com" } },
      params: { full_name: "New Teacher", email: "t@x.com", temp_password: "password123", role: "teacher" },
    },
    { serviceClient: svc },
  );
  const { status, body } = await readJson(res);
  if (status !== 200 || body.ok !== true) throw new Error(`expected 200 ok, got ${status}`);
});

Deno.test("handler: duplicate email is rejected 409 before auth user creation", async () => {
  const svc = fakeServiceClient({ existingProfile: true });
  const res = await createStaffDirectAction(
    {
      db: svc,
      auth: { user: { id: "u-super" }, profile: { role: "superadmin", email: "s@x.com" } },
      params: { full_name: "Dup", email: "dup@x.com", temp_password: "password123", role: "teacher" },
    },
    { serviceClient: svc },
  );
  const { status } = await readJson(res);
  if (status !== 409) throw new Error(`expected 409, got ${status}`);
  if (svc.__created.length !== 0) throw new Error("no auth user should be created for a duplicate");
});

Deno.test("handler: short temp_password is rejected 400 for an otherwise-authorized caller", async () => {
  const svc = fakeServiceClient();
  const res = await createStaffDirectAction(
    {
      db: svc,
      auth: { user: { id: "u-super" }, profile: { role: "superadmin", email: "s@x.com" } },
      params: { full_name: "X", email: "x@x.com", temp_password: "short", role: "teacher" },
    },
    { serviceClient: svc },
  );
  const { status } = await readJson(res);
  if (status !== 400) throw new Error(`expected 400, got ${status}`);
});
