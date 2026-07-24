import { ApiError } from "../_lib/errors.ts";
import { json, normalizeTimeSlot, safeLower, withTimeout } from "../_lib/http.ts";
import type { ActionContext } from "../_lib/types.ts";
import { writeAudit } from "../_lib/teacher-auth.ts";
import { notifyProfilesPush, resolveStaffRecipients } from "../../_shared/push-notify.ts";

function normalizeCampusCodes(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const uniq = new Set<string>();
  for (const item of arr) {
    const code = String(item || "").trim().toUpperCase();
    if (code) uniq.add(code);
  }
  return [...uniq];
}

export async function submitTeacherAvailabilityAction(ctx: ActionContext): Promise<Response> {
  const { db, auth, params } = ctx;

  const slots = Array.isArray(params.slots) ? params.slots : [];
  if (!slots.length) throw new ApiError("INVALID_PAYLOAD", "No slots provided", 400);

  const teacherEmail = safeLower(params.teacherEmail || auth?.teacher?.email || auth?.user?.email || "");
  const teacherIdFromAuth = String(auth?.teacher?.teacherId || "").trim();
  let teacherId = String(params.teacherId || teacherIdFromAuth || "").trim();

  if (!teacherId) {
    if (!teacherEmail) {
      throw new ApiError("INVALID_PAYLOAD", "teacherId or teacherEmail is required", 400);
    }
    const teacherRes = await withTimeout(
      db
        .from("teachers")
        .select("teacher_id")
        .eq("email", teacherEmail)
        .eq("active", true)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle(),
      "resolve teacher_id by email",
    );
    if (teacherRes.error || !teacherRes.data?.teacher_id) {
      throw new ApiError("INVALID_PAYLOAD", "Teacher not found for teacherEmail", 400);
    }
    teacherId = String(teacherRes.data.teacher_id);
  }

  const batchId = String(params.batchId || "").trim() || null;
  const month = String(params.month || "").trim();
  const year = String(params.year || "").trim();

  const bySlot = new Map<string, {
    day: string;
    time_slot: string;
    campusCodes: Set<string>;
  }>();

  for (const s of slots) {
    const day = String(s.teacherDay || s.day || "").trim();
    const timeSlot = normalizeTimeSlot(s.timeSlot || s.time || s.teacherTime);
    if (!day || !timeSlot) continue;

    const explicitCodes = normalizeCampusCodes(
      s.selectedCampusCodes || s.selectedFellowshipCodes || s.fellowship_codes,
    );
    const campusCode = String(s.campusCode || s.fellowshipCode || "").trim().toUpperCase();
    const campusCodes = explicitCodes.length ? explicitCodes : (campusCode ? [campusCode] : []);

    const key = `${day}__${timeSlot}`;
    if (!bySlot.has(key)) {
      bySlot.set(key, { day, time_slot: timeSlot, campusCodes: new Set<string>() });
    }
    const agg = bySlot.get(key)!;
    campusCodes.forEach((code) => agg.campusCodes.add(code));
  }

  const inserts = [...bySlot.values()].map((slot) => {
    const selectedCodes = [...slot.campusCodes];
    if (!selectedCodes.length) {
      throw new ApiError(
        "INVALID_PAYLOAD",
        `No campus selected for ${slot.day} ${slot.time_slot}. Select at least one campus.`,
        400,
      );
    }
    return {
      teacher_id: teacherId,
      batch_id: batchId,
      day: slot.day,
      time_slot: slot.time_slot,
      selected_fellowship_codes: selectedCodes,
      status: "Tentative",
      notes: String(`Teacher portal submission${month || year ? ` - ${month} ${year}` : ""}`).slice(0, 300),
      created_by: teacherEmail || auth?.teacher?.email || null,
      updated_by: teacherEmail || auth?.teacher?.email || null,
    };
  });

  if (!inserts.length) throw new ApiError("INVALID_PAYLOAD", "No valid availability slots", 400);

  const insertRes = await withTimeout(
    db
      .from("teacher_availability")
      .upsert(inserts, { onConflict: "teacher_id,batch_id,day,time_slot" }),
    "upsert availability",
  );
  if (insertRes.error) throw new ApiError("INTERNAL_ERROR", `Failed to save availability: ${insertRes.error.message}`, 500);

  await writeAudit(db, {
    action: "AVAILABILITY_UPDATED",
    actorEmail: auth.teacher.email,
    actorId: auth.user.id,
    entityType: "teacher_availability",
    entityId: teacherId,
    status: "ok",
    details: { upserted: inserts.length, slot_count: inserts.length },
  });

  // Complementary push channel (PWA Phase C.2): nudge admins that a teacher
  // submitted availability awaiting approval. Recipients = admins only
  // (superadmin + admin) per the C.2 gate. `db` is service-role, so it can read
  // admin subscriptions. Fire-and-forget: never affects the submission response.
  try {
    const admins = await resolveStaffRecipients(db, ["superadmin", "admin"]);
    if (admins.length > 0) {
      const who = String(auth?.teacher?.email || teacherEmail || "A teacher");
      await notifyProfilesPush(db, admins, {
        title: "Availability submitted",
        body: `${who} submitted availability for approval.`,
        url: "/staff/availability-approval",
        type: "teacher_availability",
      });
    }
  } catch (_pushErr) {
    // Best-effort only.
  }

  return json({ ok: true, data: { upserted: inserts.length } });
}
