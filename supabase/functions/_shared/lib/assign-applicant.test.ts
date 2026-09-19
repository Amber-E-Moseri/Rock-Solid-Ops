import { assignApplicant } from "./assign-applicant.ts";
import { mockSupabaseClient } from "../test-utils.ts";

Deno.test("Dedup guard: assignApplicant uses upsert conflict keys for students/roster/moodle", async () => {
  const db = mockSupabaseClient(async ({ table, action }) => {
    if (table === "applicants" && action === "select") {
      return { data: { id: "app-1", email: "student@example.com", full_name: "Student One", group_id: "CE", subgroup_id: "CESGA", fellowship_code: "UM" }, error: null };
    }
    if (table === "class_options" && action === "select") {
      return { data: { class_option_id: "class-1", teacher_id: "t-1", teacher_name: "Teacher 1", group_id: "CE", subgroup_id: "CESGA" }, error: null };
    }
    if (table === "class_slots" && action === "select") {
      return { data: { class_slot_id: "slot-1", current_enrolment: 1, max_capacity: 20, status: "Active", batch_id: "MAY2026" }, error: null };
    }
    return { data: [], error: null };
  });

  await assignApplicant("app-1", "class-1", db as any, { batchId: "MAY2026", triggeredBy: "processor" });
  await assignApplicant("app-1", "class-1", db as any, { batchId: "MAY2026", triggeredBy: "processor" });

  const upserts = (db as any).__calls.filter((c: any) => c.action === "upsert");
  const studentUpsert = upserts.find((c: any) => c.table === "students");
  const rosterUpsert = upserts.find((c: any) => c.table === "class_roster");
  const moodleUpsert = upserts.find((c: any) => c.table === "moodle_enrollment_sync");

  if (!studentUpsert || studentUpsert.options?.onConflict !== "student_id") throw new Error("students upsert conflict key missing");
  if (!rosterUpsert || rosterUpsert.options?.onConflict !== "student_id,class_option_id,batch_id") throw new Error("class_roster upsert conflict key missing");
  if (!moodleUpsert || moodleUpsert.options?.onConflict !== "dedupe_key") throw new Error("moodle upsert conflict key missing");
});

// E-3 regression: trigger is sole authority for class_slots.current_enrolment.
// assignApplicant must NOT write to class_slots — the DB trigger handles the increment.
Deno.test("Counter authority: assignApplicant does NOT write to class_slots", async () => {
  const db = mockSupabaseClient(async ({ table, action }) => {
    if (table === "applicants" && action === "select") {
      return { data: { id: "app-2", email: "s2@example.com", full_name: "Student Two", group_id: "CE", subgroup_id: "CESGA", fellowship_code: "UM", batch_id: "MAY2026", class_option_id: "class-1" }, error: null };
    }
    if (table === "class_options" && action === "select") {
      return { data: { class_option_id: "class-1", teacher_id: "t-1", teacher_name: "Teacher 1", group_id: "CE", subgroup_id: "CESGA", active: true, enrollment_open: true }, error: null };
    }
    return { data: [], error: null };
  });

  await assignApplicant("app-2", "class-1", db as any, { batchId: "MAY2026", triggeredBy: "processor" });

  const slotWrites = (db as any).__calls.filter(
    (c: any) => c.table === "class_slots" && (c.action === "update" || c.action === "update.eq")
  );
  if (slotWrites.length > 0) {
    throw new Error(`assignApplicant must not write to class_slots directly; found ${slotWrites.length} write(s). Trigger is sole authority.`);
  }
});

// E-3 regression: class_slots is not read by assignApplicant (resolveClassSlot removed from call path).
Deno.test("Counter authority: assignApplicant does NOT read class_slots", async () => {
  const db = mockSupabaseClient(async ({ table, action }) => {
    if (table === "applicants" && action === "select") {
      return { data: { id: "app-3", email: "s3@example.com", full_name: "Student Three", group_id: "CE", subgroup_id: "CESGA", fellowship_code: "UM", batch_id: "MAY2026", class_option_id: "class-1" }, error: null };
    }
    if (table === "class_options" && action === "select") {
      return { data: { class_option_id: "class-1", teacher_id: "t-1", teacher_name: "Teacher 1", group_id: "CE", subgroup_id: "CESGA", active: true, enrollment_open: true }, error: null };
    }
    if (table === "class_slots") {
      throw new Error("class_slots must not be queried by assignApplicant after E-3 fix");
    }
    return { data: [], error: null };
  });

  await assignApplicant("app-3", "class-1", db as any, { batchId: "MAY2026", triggeredBy: "processor" });
  // If we reach here, class_slots was not queried — test passes.
});
