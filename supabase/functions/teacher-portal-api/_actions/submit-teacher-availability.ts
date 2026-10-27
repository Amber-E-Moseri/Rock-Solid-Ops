import { ApiError } from "../_lib/errors.ts";
import { json, normalizeTimeSlot, safeLower, withTimeout } from "../_lib/http.ts";
import type { ActionContext } from "../_lib/types.ts";
import { writeAudit } from "../_lib/teacher-auth.ts";
import { resolveAvailabilityWriteTarget } from "../_lib/availability-write-authz.ts";
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

// Identity of one availability row for the upsert conflict target (teacher_id, batch_id, day, time_slot).
function availabilityKey(day: unknown, timeSlot: unknown, batchId: unknown): string {
  return `${String(day ?? "")}__${String(timeSlot ?? "")}__${String(batchId ?? "")}`;
}

export async function submitTeacherAvailabilityAction(ctx: ActionContext): Promise<Response> {
  const { db, auth, params } = ctx;

  // Authorization comes first: target ownership is decided server-side from the authenticated session (see
  // resolveAvailabilityWriteTarget). A client-supplied teacherId or teacherEmail never overrides it, and refused
  // roles get the authorization refusal before any payload validation or database write.
  const { teacherId, teacherEmail } = await resolveAvailabilityWriteTarget(db, auth, params);

  // created_by / updated_by record the authenticated actor. They are never the target teacher's email and never a
  // client-supplied value, so an admin write is attributed to the admin.
  const actorEmail = safeLower(auth?.user?.email || auth?.teacher?.email || "") || null;

  const slots = Array.isArray(params.slots) ? params.slots : [];
  if (!slots.length) throw new ApiError("INVALID_PAYLOAD", "No slots provided", 400);

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
      created_by: actorEmail,
      updated_by: actorEmail,
    };
  });

  if (!inserts.length) throw new ApiError("INVALID_PAYLOAD", "No valid availability slots", 400);

  // The upsert overwrites every column it sends, so created_by must be carried over from an existing row. A new row
  // is attributed to the authenticated actor. A request-supplied created_by is never read.
  const existingRes = await withTimeout(
    db
      .from("teacher_availability")
      .select("day,time_slot,batch_id,created_by")
      .eq("teacher_id", teacherId),
    "load existing availability creators",
  );
  if (existingRes.error) throw new ApiError("INTERNAL_ERROR", "Failed to load existing availability", 500);
  const creatorByKey = new Map<string, string | null>();
  for (const row of existingRes.data || []) {
    creatorByKey.set(availabilityKey(row.day, row.time_slot, row.batch_id), row.created_by ?? null);
  }
  for (const row of inserts) {
    const key = availabilityKey(row.day, row.time_slot, row.batch_id);
    row.created_by = creatorByKey.has(key) ? creatorByKey.get(key) ?? null : actorEmail;
  }

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
