// Regression tests: legacy Teacher Management activation must never mark a teacher ACTIVE when the sign-in
// role was not granted, and must not swallow role-assignment errors.
// Run: node --test tests/legacy-teacher-activation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoPath = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const A = require(repoPath("foundation/js/teacher-activation.js"));
const pageSrc = readFileSync(repoPath("foundation/js/teacher-management.js"), "utf8");
const htmlSrc = readFileSync(repoPath("foundation/staff/teacher-management.html"), "utf8");

const UID = "11111111-1111-4111-8111-111111111111";
const ACTIVATE = { role: "teacher", is_active: true };

// A minimal stand-in for the supabase-js query builder. It records each write and applies it to state.
// behave.profileWrite(patch, callNumber) and behave.teacherWrite(patch) can return { error } or { rows }.
function fakeDb(behave = {}) {
  const writes = [];
  const state = { profile: { role: "pending", is_active: false }, teacher: { status: "PENDING" } };
  let profileCalls = 0;
  const db = {
    writes,
    state,
    from(table) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: table === "profiles" ? { ...state.profile } : null, error: null }),
              };
            },
          };
        },
        update(patch) {
          return {
            eq() {
              const exec = async () => {
                writes.push({ table, patch });
                if (table === "profiles") {
                  profileCalls += 1;
                  const outcome = behave.profileWrite ? behave.profileWrite(patch, profileCalls) : {};
                  if (outcome.error) return { data: null, error: outcome.error };
                  const rows = outcome.rows ?? 1;
                  state.profile = { ...state.profile, ...patch };
                  return { data: Array.from({ length: rows }, () => ({ user_id: UID })), error: null };
                }
                const outcome = behave.teacherWrite ? behave.teacherWrite(patch) : {};
                if (outcome.error) return { data: null, error: outcome.error };
                state.teacher = { ...state.teacher, ...patch };
                return { data: null, error: null };
              };
              return { select: () => exec(), then: (ok, bad) => exec().then(ok, bad) };
            },
          };
        },
      };
    },
  };
  return db;
}

const teacherWriter = (db, patch) => async () => {
  const { error } = await db.from("teachers").update(patch).eq("teacher_id", "t-1");
  if (error) throw error;
};

const DENIED = { code: "42501", message: "You are not permitted to change staff roles." };

// ── Admin: role promotion refused by the database ───────────────────────────────────────────

test("admin activation is refused when the sign-in role cannot be granted, and the teacher record is untouched", async () => {
  const db = fakeDb({ profileWrite: () => ({ error: DENIED }) });
  const teacherPatch = { status: "ACTIVE", active: true };
  await assert.rejects(
    A.runActivation({ db, teacherUserId: UID, profilePatch: ACTIVATE, writeTeacher: teacherWriter(db, teacherPatch) }),
    (err) => err.message === DENIED.message,
  );
  assert.equal(db.writes.filter((w) => w.table === "teachers").length, 0, "teacher must not be written");
  assert.equal(db.state.teacher.status, "PENDING");
  assert.equal(db.state.profile.role, "pending");
});

test("activation fails when the role write matches no row, instead of reporting success", async () => {
  const db = fakeDb({ profileWrite: () => ({ rows: 0 }) });
  await assert.rejects(
    A.runActivation({ db, teacherUserId: UID, profilePatch: ACTIVATE, writeTeacher: teacherWriter(db, { status: "ACTIVE" }) }),
    (err) => err.code === "PROFILE_NOT_UPDATED",
  );
  assert.equal(db.writes.filter((w) => w.table === "teachers").length, 0);
  assert.equal(db.state.teacher.status, "PENDING");
});

// ── Superadmin: promotion succeeds, role is granted before the teacher is marked ACTIVE ──────

test("superadmin activation assigns the teacher role first, then marks the teacher ACTIVE", async () => {
  const db = fakeDb();
  await A.runActivation({ db, teacherUserId: UID, profilePatch: ACTIVATE, writeTeacher: teacherWriter(db, { status: "ACTIVE", active: true }) });
  assert.deepEqual(db.writes.map((w) => w.table), ["profiles", "teachers"], "promote the role, then write the teacher");
  assert.equal(db.writes[0].table, "profiles");
  assert.deepEqual(db.writes[0].patch, ACTIVATE);
  assert.equal(db.state.profile.role, "teacher");
  assert.equal(db.state.profile.is_active, true);
  assert.equal(db.state.teacher.status, "ACTIVE");
});

// ── Teacher write fails after the role was granted: the role is restored ─────────────────────

test("when the teacher write fails after promotion, the role is restored and the error is reported", async () => {
  const db = fakeDb({ teacherWrite: () => ({ error: { message: "teachers write failed" } }) });
  await assert.rejects(
    A.runActivation({ db, teacherUserId: UID, profilePatch: ACTIVATE, writeTeacher: teacherWriter(db, { status: "ACTIVE" }) }),
    (err) => err.message === "teachers write failed",
  );
  assert.equal(db.state.profile.role, "pending", "role restored to the prior value");
  assert.equal(db.state.profile.is_active, false, "active flag restored to the prior value");
  assert.equal(db.state.teacher.status, "PENDING");
});

test("when the revert also fails, the message tells a superadmin the prior role to restore", async () => {
  const db = fakeDb({
    teacherWrite: () => ({ error: { message: "teachers write failed" } }),
    profileWrite: (patch, n) => (n === 1 ? { rows: 1 } : { error: { message: "revert denied" } }),
  });
  await assert.rejects(
    A.runActivation({ db, teacherUserId: UID, profilePatch: ACTIVATE, writeTeacher: teacherWriter(db, { status: "ACTIVE" }) }),
    (err) => err.code === "REVERT_FAILED" && /superadmin/.test(err.message) && /"pending"/.test(err.message),
  );
});

// ── Unlinked and missing accounts never reach ACTIVE ──────────────────────────────────────────

test("activation without a linked sign-in account is refused and writes nothing", async () => {
  const db = fakeDb();
  await assert.rejects(
    A.runActivation({ db, teacherUserId: null, profilePatch: ACTIVATE, writeTeacher: teacherWriter(db, { status: "ACTIVE" }) }),
    (err) => err.code === "NOT_LINKED",
  );
  assert.equal(db.writes.length, 0);
});

test("activation with no profile row is refused and writes nothing", async () => {
  const db = fakeDb();
  db.state.profile = null;
  db.from = (table) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    update: () => { throw new Error("no write expected"); },
  });
  await assert.rejects(
    A.runActivation({ db, teacherUserId: UID, profilePatch: ACTIVATE, writeTeacher: async () => {} }),
    (err) => err.code === "NO_PROFILE",
  );
});

// ── Non-activation actions report profile errors instead of dropping them ─────────────────────

test("updateProfileStrict propagates a profile write error", async () => {
  const db = fakeDb({ profileWrite: () => ({ error: { message: "profile write failed" } }) });
  await assert.rejects(A.updateProfileStrict(db, UID, { is_active: false }), (err) => err.message === "profile write failed");
});

test("updateProfileStrict skips a teacher with no sign-in account without writing", async () => {
  const db = fakeDb();
  await A.updateProfileStrict(db, null, { is_active: false });
  assert.equal(db.writes.length, 0);
});

// ── Source contract: the page no longer swallows errors and routes activation through the helper ──

test("teacher-management.js no longer contains the silent profile update", () => {
  assert.doesNotMatch(pageSrc, /non-fatal/);
  assert.doesNotMatch(pageSrc, /async function updateProfile\(/);
});

test("activation in teacher-management.js goes through runActivation, not a direct browser role write", () => {
  assert.match(pageSrc, /if \(action === "activate"\) \{[\s\S]*?runActivation\(\{/);
  assert.match(pageSrc, /await FSTeacherActivation\.updateProfileStrict\(global\.supabase, row\.teacher_user_id, profilePatch\)/);
});

test("teacher-activation.js does not contain an empty catch that would swallow an error", () => {
  const src = readFileSync(repoPath("foundation/js/teacher-activation.js"), "utf8");
  assert.doesNotMatch(src, /catch\s*(\([^)]*\))?\s*\{\s*\}/);
});

test("the page loads teacher-activation.js before teacher-management.js", () => {
  const helper = htmlSrc.indexOf('src="../js/teacher-activation.js"');
  const page = htmlSrc.indexOf('src="../js/teacher-management.js"');
  assert.ok(helper > 0 && page > 0 && helper < page, "helper must load first");
});

test("createTeacherDirect is still present and is not changed by this remediation", () => {
  assert.match(pageSrc, /action: "createTeacherDirect"/);
});
