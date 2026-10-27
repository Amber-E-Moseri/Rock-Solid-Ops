import { submitTeacherAvailabilityAction } from "./_actions/submit-teacher-availability.ts";
import { approveAvailabilityAction } from "./_actions/approve-availability.ts";
import { AVAILABILITY_APPROVAL_CERTIFIED, assertAvailabilityApprovalCertified } from "./_lib/approval-hold.ts";
import { ApiError } from "./_lib/errors.ts";

// Fake service-role client. Reads are answered from `teachers`; every write (and rpc) is recorded so a refusal
// can be checked for zero side effects. Audit inserts are recorded too, but they are excluded from stateWrites.
function fakeDb(teachers: any[] = [], availability: any[] = []) {
  const writes: { table: string; op: string; payload?: any }[] = [];
  const db: any = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const q: any = {
        select() { return q; },
        eq(col: string, val: unknown) { filters[col] = val; return q; },
        in() { return q; },
        is() { return q; },
        not() { return q; },
        limit() { return q; },
        maybeSingle() {
          const row = table === "teachers" ? teachers.find((t) => t.teacher_id === filters.teacher_id) ?? null : null;
          return Promise.resolve({ data: row, error: null });
        },
        then(resolve: any) {
          const data = table === "teacher_availability"
            ? availability.filter((r) => r.teacher_id === filters.teacher_id)
            : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
        upsert(payload: unknown) { writes.push({ table, op: "upsert", payload }); return Promise.resolve({ error: null }); },
        insert(payload: unknown) { writes.push({ table, op: "insert", payload }); return Promise.resolve({ error: null }); },
      };
      return q;
    },
    rpc(name: string) { writes.push({ table: name, op: "rpc" }); return Promise.resolve({ data: null, error: null }); },
  };
  return { db, writes };
}

// Writes that would change availability or approval state. Audit inserts are excluded on purpose.
function stateWrites(writes: { table: string; op: string }[]) {
  return writes.filter((w) => w.table === "teacher_availability" || w.op === "rpc");
}

function authFor(role: string, teacherId: string) {
  return {
    user: { id: `user-${role}`, email: `${role}@example.com` },
    role,
    teacherMapped: teacherId !== "",
    teacher: { teacherId, fullName: role, email: `${role}@example.com` },
  } as any;
}

const TEACHERS = [
  { teacher_id: "t2", email: "t2@example.com", active: true, status: "ACTIVE", deleted_at: null },
  { teacher_id: "t3", email: "t3@example.com", active: false, status: "ACTIVE", deleted_at: null },
  { teacher_id: "t4", email: "t4@example.com", active: true, status: "ACTIVE", deleted_at: "2026-10-01T00:00:00Z" },
  { teacher_id: "t5", email: "t5@example.com", active: true, status: "PENDING", deleted_at: null },
];

const slots = [{ teacherDay: "Monday", timeSlot: "19:00", campusCode: "YORK" }];

async function expectApiError(run: () => Promise<unknown>, code: string, status: number) {
  let caught: unknown = null;
  try {
    await run();
  } catch (err) {
    caught = err;
  }
  if (!(caught instanceof ApiError)) throw new Error(`expected ApiError ${code}, got ${String(caught)}`);
  if (caught.code !== code) throw new Error(`expected code ${code}, got ${caught.code}`);
  if (caught.status !== status) throw new Error(`expected status ${status}, got ${caught.status}`);
}

function upsertedTeacherIds(writes: { table: string; op: string; payload?: any }[]) {
  return writes
    .filter((w) => w.table === "teacher_availability" && w.op === "upsert")
    .flatMap((w) => (w.payload as any[]).map((row) => row.teacher_id));
}

// ---- Teacher self-service -------------------------------------------------------------------------------------

Deno.test("Availability authz: teacher writes own availability (no teacherId supplied)", async () => {
  const { db, writes } = fakeDb(TEACHERS);
  const res = await submitTeacherAvailabilityAction({ db, auth: authFor("teacher", "t1"), params: { slots } });
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  const ids = upsertedTeacherIds(writes);
  if (ids.length !== 1 || ids[0] !== "t1") throw new Error(`expected a single own-row write for t1, saw ${ids.join(",")}`);
});

Deno.test("Availability authz: teacher supplying its own teacherId is allowed", async () => {
  const { db, writes } = fakeDb(TEACHERS);
  await submitTeacherAvailabilityAction({ db, auth: authFor("teacher", "t1"), params: { slots, teacherId: "t1" } });
  if (upsertedTeacherIds(writes).join(",") !== "t1") throw new Error("own teacherId must write only the caller's rows");
});

Deno.test("Availability authz: teacher supplying a FOREIGN teacherId is rejected with 403 and zero writes", async () => {
  const { db, writes } = fakeDb(TEACHERS);
  await expectApiError(
    () => submitTeacherAvailabilityAction({ db, auth: authFor("teacher", "t1"), params: { slots, teacherId: "t2" } }),
    "AVAILABILITY_WRITE_FORBIDDEN",
    403,
  );
  if (stateWrites(writes).length !== 0) throw new Error(`no availability write allowed, saw ${JSON.stringify(stateWrites(writes))}`);
});

Deno.test("Availability authz: client teacherEmail cannot redirect a teacher's write", async () => {
  const { db, writes } = fakeDb(TEACHERS);
  await submitTeacherAvailabilityAction({
    db,
    auth: authFor("teacher", "t1"),
    params: { slots, teacherEmail: "t2@example.com" },
  });
  if (upsertedTeacherIds(writes).join(",") !== "t1") throw new Error("teacherEmail must not override the authenticated owner");
});

Deno.test("Availability authz: unmapped teacher account is rejected with zero writes", async () => {
  const { db, writes } = fakeDb(TEACHERS);
  await expectApiError(
    () => submitTeacherAvailabilityAction({ db, auth: authFor("teacher", ""), params: { slots, teacherId: "t2" } }),
    "INVALID_TEACHER_MAPPING",
    403,
  );
  if (stateWrites(writes).length !== 0) throw new Error("unmapped account must not write");
});

// ---- Admin / superadmin --------------------------------------------------------------------------------------

for (const role of ["admin", "superadmin"]) {
  Deno.test(`Availability authz: ${role} writes for a verified active teacher`, async () => {
    const { db, writes } = fakeDb(TEACHERS);
    await submitTeacherAvailabilityAction({ db, auth: authFor(role, ""), params: { slots, teacherId: "t2" } });
    if (upsertedTeacherIds(writes).join(",") !== "t2") throw new Error("admin write must target the named active teacher");
  });

  Deno.test(`Availability authz: ${role} targeting a missing, inactive, deleted or non-ACTIVE teacher is denied`, async () => {
    const cases: [string, string][] = [
      ["t9", "INVALID_TEACHER_MAPPING"],
      ["t3", "TEACHER_NOT_ACTIVE"],
      ["t4", "TEACHER_NOT_ACTIVE"],
      ["t5", "TEACHER_NOT_ACTIVE"],
    ];
    for (const [teacherId, code] of cases) {
      const { db, writes } = fakeDb(TEACHERS);
      await expectApiError(
        () => submitTeacherAvailabilityAction({ db, auth: authFor(role, ""), params: { slots, teacherId } }),
        code,
        403,
      );
      if (stateWrites(writes).length !== 0) throw new Error(`${teacherId}: no write allowed`);
    }
  });

  Deno.test(`Availability authz: ${role} without a teacherId is refused rather than defaulting to the admin's own record`, async () => {
    const { db, writes } = fakeDb(TEACHERS);
    await expectApiError(
      () => submitTeacherAvailabilityAction({ db, auth: authFor(role, ""), params: { slots } }),
      "INVALID_PAYLOAD",
      400,
    );
    if (stateWrites(writes).length !== 0) throw new Error("no write allowed without an explicit target");
  });
}

// ---- Other staff roles: write paths refused until separately certified ---------------------------------------

for (const role of ["pastor", "subgroup_admin", "principal", "regional_secretary", "parent"]) {
  Deno.test(`Availability authz: ${role} write is denied for own and foreign targets, zero writes`, async () => {
    for (const teacherId of ["t1", "t2", ""]) {
      const { db, writes } = fakeDb(TEACHERS);
      await expectApiError(
        () => submitTeacherAvailabilityAction({ db, auth: authFor(role, "t1"), params: { slots, teacherId } }),
        "AVAILABILITY_WRITE_FORBIDDEN",
        403,
      );
      if (stateWrites(writes).length !== 0) throw new Error(`${role} with teacherId "${teacherId}": no write allowed`);
    }
  });
}

// ---- Approval hold ------------------------------------------------------------------------------------------

// Any database access or external call made before the refusal counts as a side effect.
function spyDb() {
  const touches: string[] = [];
  const db: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      touches.push(`db.${String(prop)}`);
      return () => db;
    },
  });
  return { db, touches };
}

Deno.test("Availability approval hold: flag stays uncertified in code", () => {
  if (AVAILABILITY_APPROVAL_CERTIFIED !== false) throw new Error("approval must stay held until separately certified");
});

Deno.test("Availability approval hold: guard refuses when uncertified and passes when certified", () => {
  assertAvailabilityApprovalCertified(true);
  let caught: unknown = null;
  try {
    assertAvailabilityApprovalCertified(false);
  } catch (err) {
    caught = err;
  }
  if (!(caught instanceof ApiError) || caught.code !== "APPROVAL_HELD" || caught.status !== 423) {
    throw new Error("guard must refuse with APPROVAL_HELD / 423");
  }
});

Deno.test("Availability approval hold: approveAvailability refuses before any database access", async () => {
  const { db, touches } = spyDb();
  await expectApiError(
    () => approveAvailabilityAction({ db, auth: authFor("superadmin", ""), params: { availabilityId: "a1" } }),
    "APPROVAL_HELD",
    423,
  );
  if (touches.length !== 0) throw new Error(`no database access allowed, saw: ${touches.join(", ")}`);
});

Deno.test("Availability approval hold: request parameters cannot lift the hold", async () => {
  const { db, touches } = spyDb();
  await expectApiError(
    () =>
      approveAvailabilityAction({
        db,
        auth: authFor("superadmin", ""),
        params: { availabilityId: "a1", certified: true, approvalCertified: true, bypassHold: true },
      }),
    "APPROVAL_HELD",
    423,
  );
  if (touches.length !== 0) throw new Error(`no database access allowed, saw: ${touches.join(", ")}`);
});

// ---- Attribution: created_by / updated_by ---------------------------------------------------------------------

function upsertedRows(writes: { table: string; op: string; payload?: any }[]) {
  return writes
    .filter((w) => w.table === "teacher_availability" && w.op === "upsert")
    .flatMap((w) => w.payload as any[]);
}

const creatorSlots = [
  { teacherDay: "Monday", timeSlot: "19:00", campusCode: "YORK" },
  { teacherDay: "Tuesday", timeSlot: "20:00", campusCode: "YORK" },
];

Deno.test("Attribution: teacher self-write records the teacher as created_by and updated_by", async () => {
  const { db, writes } = fakeDb(TEACHERS);
  await submitTeacherAvailabilityAction({ db, auth: authFor("teacher", "t1"), params: { slots } });
  const rows = upsertedRows(writes);
  if (rows.length !== 1) throw new Error(`expected 1 row, saw ${rows.length}`);
  if (rows[0].created_by !== "teacher@example.com" || rows[0].updated_by !== "teacher@example.com") {
    throw new Error(`expected teacher attribution, saw ${rows[0].created_by} / ${rows[0].updated_by}`);
  }
});

Deno.test("Attribution: admin writing on behalf of a teacher is attributed to the admin, not the target", async () => {
  const { db, writes } = fakeDb(TEACHERS);
  await submitTeacherAvailabilityAction({ db, auth: authFor("admin", ""), params: { slots, teacherId: "t2" } });
  const rows = upsertedRows(writes);
  if (rows[0].teacher_id !== "t2") throw new Error(`row must belong to t2, saw ${rows[0].teacher_id}`);
  if (rows[0].created_by !== "admin@example.com" || rows[0].updated_by !== "admin@example.com") {
    throw new Error(`expected admin attribution, saw ${rows[0].created_by} / ${rows[0].updated_by}`);
  }
});

Deno.test("Attribution: updating an existing row preserves its original created_by", async () => {
  const existing = [
    { teacher_id: "t1", day: "Monday", time_slot: "19:00:00", batch_id: null, created_by: "original@example.com" },
  ];
  const { db, writes } = fakeDb(TEACHERS, existing);
  await submitTeacherAvailabilityAction({ db, auth: authFor("teacher", "t1"), params: { slots } });
  const rows = upsertedRows(writes);
  if (rows[0].created_by !== "original@example.com") throw new Error(`created_by was overwritten: ${rows[0].created_by}`);
  if (rows[0].updated_by !== "teacher@example.com") throw new Error(`updated_by must be the actor, saw ${rows[0].updated_by}`);
});

Deno.test("Attribution: a new row gets the actor while an existing row in the same submission keeps its creator", async () => {
  const existing = [
    { teacher_id: "t1", day: "Monday", time_slot: "19:00:00", batch_id: null, created_by: "original@example.com" },
  ];
  const { db, writes } = fakeDb(TEACHERS, existing);
  await submitTeacherAvailabilityAction({ db, auth: authFor("teacher", "t1"), params: { slots: creatorSlots } });
  const rows = upsertedRows(writes);
  const monday = rows.find((r) => r.day === "Monday");
  const tuesday = rows.find((r) => r.day === "Tuesday");
  if (!monday || !tuesday) throw new Error("expected both Monday and Tuesday rows");
  if (monday.created_by !== "original@example.com") throw new Error(`existing row lost its creator: ${monday.created_by}`);
  if (tuesday.created_by !== "teacher@example.com") throw new Error(`new row must be attributed to the actor: ${tuesday.created_by}`);
  if (monday.updated_by !== "teacher@example.com" || tuesday.updated_by !== "teacher@example.com") {
    throw new Error("updated_by must be the actor on every row");
  }
});

Deno.test("Attribution: teacher-supplied created_by / updated_by / teacherEmail are ignored", async () => {
  const existing = [
    { teacher_id: "t1", day: "Monday", time_slot: "19:00:00", batch_id: null, created_by: "original@example.com" },
  ];
  const { db, writes } = fakeDb(TEACHERS, existing);
  await submitTeacherAvailabilityAction({
    db,
    auth: authFor("teacher", "t1"),
    params: {
      slots,
      created_by: "spoof@example.com",
      updated_by: "admin@example.com",
      teacherEmail: "t2@example.com",
    },
  });
  const rows = upsertedRows(writes);
  if (rows[0].created_by !== "original@example.com") throw new Error(`spoofed request replaced the creator: ${rows[0].created_by}`);
  if (rows[0].updated_by !== "teacher@example.com") throw new Error(`spoofed request set updated_by: ${rows[0].updated_by}`);
});

Deno.test("Attribution: admin-supplied created_by in the body is ignored", async () => {
  const { db, writes } = fakeDb(TEACHERS);
  await submitTeacherAvailabilityAction({
    db,
    auth: authFor("admin", ""),
    params: { slots, teacherId: "t2", created_by: "spoof@example.com", updated_by: "spoof@example.com" },
  });
  const rows = upsertedRows(writes);
  if (rows[0].created_by !== "admin@example.com" || rows[0].updated_by !== "admin@example.com") {
    throw new Error(`body attribution must be ignored, saw ${rows[0].created_by} / ${rows[0].updated_by}`);
  }
});
