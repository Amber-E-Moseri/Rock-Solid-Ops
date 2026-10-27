import { submitLegacyAttendanceAction } from "./_actions/submit-legacy-attendance.ts";
import { submitTeacherAttendanceAction } from "./_actions/submit-teacher-attendance.ts";
import { submitSessionOutcomesAction } from "./_actions/submit-session-outcomes.ts";
import { ATTENDANCE_SUBMIT_CERTIFIED, assertAttendanceSubmitCertified } from "./_lib/attendance-submit-hold.ts";
import { ApiError } from "./_lib/errors.ts";

// Any database access or external call made before the refusal counts as a side effect. The `then` probe is
// answered with undefined so an awaited value is not mistaken for a thenable.
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

const auth = {
  user: { id: "u1", email: "teacher@example.com" },
  teacher: { teacherId: "t1", fullName: "Teacher", email: "teacher@example.com" },
} as any;

// A complete, otherwise valid payload. The refusal must come before any of this is validated or written.
const params = {
  classOptionId: "c1",
  classSession: "Class1",
  classDate: "2026-10-26",
  records: [{ applicant_id: "a1", status: "Present" }],
  guestRecords: [],
  attendanceRows: [{ student_id: "s1", status: "Present" }],
};

async function withFetchSpy(run: (calls: string[]) => Promise<void>) {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: any) => {
    calls.push(String(input));
    return Promise.reject(new Error("network must not be reached"));
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function expectHeld(run: () => Promise<unknown>) {
  let caught: unknown = null;
  try {
    await run();
  } catch (err) {
    caught = err;
  }
  if (!(caught instanceof ApiError)) throw new Error(`expected ApiError, got ${String(caught)}`);
  if (caught.code !== "ATTENDANCE_SUBMIT_HELD") throw new Error(`expected ATTENDANCE_SUBMIT_HELD, got ${caught.code}`);
  if (caught.status !== 423) throw new Error(`expected status 423, got ${caught.status}`);
}

Deno.test("Attendance hold: server flag is uncertified", () => {
  if (ATTENDANCE_SUBMIT_CERTIFIED !== false) throw new Error("ATTENDANCE_SUBMIT_CERTIFIED must stay false until certified");
});

Deno.test("Attendance hold: guard refuses when uncertified and passes when certified", () => {
  assertAttendanceSubmitCertified(true);
  let caught: unknown = null;
  try {
    assertAttendanceSubmitCertified(false);
  } catch (err) {
    caught = err;
  }
  if (!(caught instanceof ApiError) || caught.code !== "ATTENDANCE_SUBMIT_HELD") throw new Error("guard must refuse with ATTENDANCE_SUBMIT_HELD");
});

Deno.test("Attendance hold: submitTeacherAttendance refuses direct requests with no side effects", async () => {
  const { db, touches } = spyDb();
  await withFetchSpy(async (calls) => {
    await expectHeld(() => submitTeacherAttendanceAction({ db, auth, params }));
    if (touches.length !== 0) throw new Error(`no database access allowed, saw: ${touches.join(", ")}`);
    if (calls.length !== 0) throw new Error(`no external call allowed, saw: ${calls.join(", ")}`);
  });
});

Deno.test("Attendance hold: submitLegacyAttendance refuses direct requests with no side effects", async () => {
  const { db, touches } = spyDb();
  await withFetchSpy(async (calls) => {
    await expectHeld(() => submitLegacyAttendanceAction({ db, auth, params }));
    if (touches.length !== 0) throw new Error(`no database access allowed, saw: ${touches.join(", ")}`);
    if (calls.length !== 0) throw new Error(`no external call allowed, saw: ${calls.join(", ")}`);
  });
});

Deno.test("Attendance hold: refusal also holds for an empty payload, before validation", async () => {
  const { db, touches } = spyDb();
  await expectHeld(() => submitLegacyAttendanceAction({ db, auth, params: {} }));
  await expectHeld(() => submitTeacherAttendanceAction({ db, auth, params: {} }));
  if (touches.length !== 0) throw new Error(`no database access allowed, saw: ${touches.join(", ")}`);
});

Deno.test("Attendance hold: submitSessionOutcomes refuses direct requests with no side effects", async () => {
  const { db, touches } = spyDb();
  const outcomesParams = {
    classOptionId: "c1",
    classSession: "Class1",
    classDate: "2026-10-26",
    submitted: true,
    entries: [{ studentId: "s1", personType: "student", milestoneId: "m1", outcomeResult: "Pass" }],
  };
  await withFetchSpy(async (calls) => {
    await expectHeld(() => submitSessionOutcomesAction({ db, auth, params: outcomesParams }));
    if (touches.length !== 0) throw new Error(`no database access allowed, saw: ${touches.join(", ")}`);
    if (calls.length !== 0) throw new Error(`no external call allowed, saw: ${calls.join(", ")}`);
  });
});

Deno.test("Attendance hold: submitSessionOutcomes refusal holds for an empty or unauthenticated call", async () => {
  const { db, touches } = spyDb();
  await expectHeld(() => submitSessionOutcomesAction({ db, auth, params: {} }));
  await expectHeld(() => submitSessionOutcomesAction({ db, auth: null as any, params: {} }));
  if (touches.length !== 0) throw new Error(`no database access allowed, saw: ${touches.join(", ")}`);
});

Deno.test("Attendance hold: every attendance submit action is refused before any side effect", async () => {
  const { db, touches } = spyDb();
  const actions = [submitTeacherAttendanceAction, submitLegacyAttendanceAction, submitSessionOutcomesAction];
  for (const action of actions) {
    await expectHeld(() => action({ db, auth, params }));
  }
  if (touches.length !== 0) throw new Error(`no database access allowed, saw: ${touches.join(", ")}`);
});
